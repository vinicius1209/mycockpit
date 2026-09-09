//! Navegação e busca de arquivos por demanda. A árvore nunca materializa o
//! projeto inteiro: cada expansão lista um nível e a busca é paginada.

use ignore::WalkBuilder;
use serde::Serialize;
use std::path::{Component, Path, PathBuf};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

const DEFAULT_DIR_LIMIT: usize = 200;
const DEFAULT_SEARCH_LIMIT: usize = 80;
const MAX_PAGE_LIMIT: usize = 500;
const SEARCH_VISIT_BUDGET: usize = 100_000;
const SEARCH_DEADLINE: Duration = Duration::from_millis(2_500);
const GIT_PROBE_TIMEOUT: Duration = Duration::from_millis(1_500);

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDirEntry {
    name: String,
    rel_path: String,
    kind: String,
    is_symlink: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDirPage {
    parent: String,
    entries: Vec<ProjectDirEntry>,
    next_cursor: Option<String>,
    truncated: bool,
    root_revision: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileSearchPage {
    query: String,
    entries: Vec<ProjectDirEntry>,
    next_cursor: Option<String>,
    truncated: bool,
    source: String,
    root_revision: String,
}

fn normalized_limit(limit: Option<u32>, default: usize) -> usize {
    (limit.unwrap_or(default as u32) as usize).clamp(1, MAX_PAGE_LIMIT)
}

fn cursor_offset(cursor: Option<&str>) -> Result<usize, String> {
    match cursor {
        None | Some("") => Ok(0),
        Some(value) => value
            .parse::<usize>()
            .map_err(|_| "cursor de arquivos inválido".to_string()),
    }
}

fn relative_path(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute()
        || path.components().any(|part| {
            matches!(
                part,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("caminho de pasta inválido".into());
    }
    Ok(path.to_path_buf())
}

fn canonical_root(root: &str) -> Result<PathBuf, String> {
    let root = std::fs::canonicalize(root).map_err(|error| error.to_string())?;
    if !root.is_dir() {
        return Err("a raiz do projeto não é uma pasta".into());
    }
    Ok(root)
}

fn has_symlink_component(root: &Path, rel: &Path) -> bool {
    let mut current = root.to_path_buf();
    for part in rel.components() {
        if let Component::Normal(name) = part {
            current.push(name);
            if std::fs::symlink_metadata(&current)
                .map(|metadata| metadata.file_type().is_symlink())
                .unwrap_or(false)
            {
                return true;
            }
        }
    }
    false
}

fn scoped_directory(root: &Path, rel: &Path) -> Result<PathBuf, String> {
    let rel = relative_path(rel)?;
    if has_symlink_component(root, &rel) {
        return Err("links de pasta não são expandidos automaticamente".into());
    }
    let target = std::fs::canonicalize(root.join(&rel)).map_err(|error| error.to_string())?;
    if !target.starts_with(root) || !target.is_dir() {
        return Err("pasta fora da raiz do projeto".into());
    }
    Ok(target)
}

fn structural_exclusion(name: &str) -> bool {
    matches!(name, ".git" | ".DS_Store")
}

/// Esta entrada é excluída POR DECISÃO nossa (não é do projeto, é encanamento)?
///
/// Existe separado de `entry_from_path` porque a diferença entre "não mostro
/// isto de propósito" e "não consegui ler isto" é a diferença entre uma pasta
/// listada inteira e uma leitura parcial. As duas moravam no mesmo `None`, e o
/// resultado é que TODO repositório git dizia "leitura parcial" na barra: o
/// `.git` está sempre lá, sempre foi excluído de propósito, e a exclusão era
/// contada como falha. Aviso que nunca apaga não avisa nada.
fn structurally_excluded(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(structural_exclusion)
}

fn root_revision(root: &Path) -> String {
    fn stamp(path: &Path) -> (u64, u32, u64) {
        let Ok(metadata) = std::fs::metadata(path) else {
            return (0, 0, 0);
        };
        let modified = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .unwrap_or_default();
        (modified.as_secs(), modified.subsec_nanos(), metadata.len())
    }
    // A revisão é da RAIZ, não do diretório pedido. Duas páginas de pastas
    // diferentes precisam ser comparáveis pelo cache compartilhado.
    let mut input = format!("{}:{:?}", root.display(), stamp(root));
    let git_index = root.join(".git/index");
    input.push_str(&format!(":{:?}", stamp(&git_index)));
    blake3::hash(input.as_bytes()).to_hex()[..16].to_string()
}

/// Lê um caminho como entrada da árvore. `None` significa UMA coisa só: não deu
/// para ler (nome fora de UTF-8, caminho fora da raiz, metadata recusada). Quem
/// chama trata isso como leitura parcial, então exclusão nossa NÃO mora aqui —
/// ela é filtro explícito de quem varre (`structurally_excluded`).
fn entry_from_path(root: &Path, path: &Path) -> Option<ProjectDirEntry> {
    let name = path.file_name()?.to_str()?.to_string();
    let rel_path = path.strip_prefix(root).ok()?.to_str()?.replace('\\', "/");
    let link_metadata = std::fs::symlink_metadata(path).ok()?;
    let is_symlink = link_metadata.file_type().is_symlink();
    let target_metadata = if is_symlink {
        std::fs::metadata(path).ok()
    } else {
        Some(link_metadata)
    };
    let kind = if target_metadata
        .as_ref()
        .is_some_and(|metadata| metadata.is_dir())
    {
        "directory"
    } else {
        "file"
    };
    Some(ProjectDirEntry {
        name,
        rel_path,
        kind: kind.into(),
        is_symlink,
    })
}

fn compare_entries(left: &ProjectDirEntry, right: &ProjectDirEntry) -> std::cmp::Ordering {
    let left_dir = left.kind == "directory";
    let right_dir = right.kind == "directory";
    right_dir
        .cmp(&left_dir)
        .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
        .then_with(|| left.name.cmp(&right.name))
}

fn list_dir_children_blocking(
    root: &str,
    rel_path: &str,
    cursor: Option<&str>,
    limit: Option<u32>,
) -> Result<ProjectDirPage, String> {
    let root = canonical_root(root)?;
    let rel = relative_path(Path::new(rel_path))?;
    let directory = scoped_directory(&root, &rel)?;
    let offset = cursor_offset(cursor)?;
    let limit = normalized_limit(limit, DEFAULT_DIR_LIMIT);
    let mut incomplete = false;
    let mut builder = WalkBuilder::new(&directory);
    builder
        .max_depth(Some(1))
        .follow_links(false)
        .hidden(false)
        .parents(true)
        .ignore(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .require_git(false);
    let mut entries = Vec::new();
    for result in builder.build().skip(1) {
        match result {
            Ok(found) if structurally_excluded(found.path()) => {}
            Ok(found) => match entry_from_path(&root, found.path()) {
                Some(entry) => entries.push(entry),
                None => incomplete = true,
            },
            Err(_) => incomplete = true,
        }
    }
    entries.sort_by(compare_entries);
    let has_more = entries.len() > offset.saturating_add(limit);
    let page = entries.into_iter().skip(offset).take(limit).collect();
    Ok(ProjectDirPage {
        parent: rel.to_string_lossy().replace('\\', "/"),
        entries: page,
        next_cursor: has_more.then(|| (offset + limit).to_string()),
        truncated: incomplete,
        root_revision: root_revision(&root),
    })
}

#[tauri::command]
pub async fn list_dir_children(
    root: String,
    rel_path: String,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<ProjectDirPage, String> {
    tokio::time::timeout(
        SEARCH_DEADLINE,
        tokio::task::spawn_blocking(move || {
            list_dir_children_blocking(&root, &rel_path, cursor.as_deref(), limit)
        }),
    )
    .await
    .map_err(|_| "a leitura desta pasta excedeu o tempo limite".to_string())?
    .map_err(|error| error.to_string())?
}

fn is_broad_root(root: &Path) -> bool {
    if root.parent().is_none() {
        return true;
    }
    std::env::var_os("HOME")
        .and_then(|home| std::fs::canonicalize(home).ok())
        .is_some_and(|home| home == root)
}

async fn is_git_repository(root: &Path) -> Result<bool, String> {
    let output = tokio::time::timeout(
        GIT_PROBE_TIMEOUT,
        Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["rev-parse", "--is-inside-work-tree"])
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "o Git excedeu o tempo limite ao classificar o projeto".to_string())?
    .map_err(|error| format!("não foi possível consultar o Git: {error}"))?;
    Ok(output.status.success() && String::from_utf8_lossy(&output.stdout).trim() == "true")
}

async fn search_git(
    root: &Path,
    query: &str,
    offset: usize,
    limit: usize,
) -> Result<(Vec<ProjectDirEntry>, Option<String>, bool), String> {
    let mut child = Command::new("git")
        .arg("-c")
        .arg("core.quotepath=false")
        .arg("-C")
        .arg(root)
        .args([
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "--",
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|error| format!("não foi possível iniciar o Git: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "o Git não abriu a saída de arquivos".to_string())?;
    let mut lines = BufReader::new(stdout).lines();
    let deadline = tokio::time::Instant::now() + SEARCH_DEADLINE;
    let normalized = query.to_lowercase();
    let mut matches_seen = 0usize;
    let mut visited = 0usize;
    let mut entries = Vec::new();
    let mut truncated = false;
    let mut has_more = false;
    loop {
        let line = match tokio::time::timeout_at(deadline, lines.next_line()).await {
            Ok(Ok(Some(line))) => line,
            Ok(Ok(None)) => break,
            Ok(Err(_)) => {
                truncated = true;
                break;
            }
            Err(_) => {
                truncated = true;
                break;
            }
        };
        visited += 1;
        if visited > SEARCH_VISIT_BUDGET {
            truncated = true;
            break;
        }
        let path = line.replace('\\', "/");
        if !path.to_lowercase().contains(&normalized) {
            continue;
        }
        if matches_seen < offset {
            matches_seen += 1;
            continue;
        }
        if entries.len() >= limit {
            has_more = true;
            break;
        }
        let absolute = root.join(&path);
        if structurally_excluded(&absolute) {
            continue;
        }
        let mut entry = entry_from_path(root, &absolute).unwrap_or(ProjectDirEntry {
            name: Path::new(&path)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(&path)
                .to_string(),
            rel_path: path,
            kind: "file".into(),
            is_symlink: false,
        });
        entry.kind = "file".into();
        entries.push(entry);
        matches_seen += 1;
    }
    let stopped_early = has_more || truncated;
    drop(lines);
    if stopped_early {
        let _ = child.kill().await;
    }
    let status = child.wait().await.map_err(|error| error.to_string())?;
    if !stopped_early && !status.success() {
        return Err("o Git não conseguiu listar os arquivos deste projeto".into());
    }
    // Limite de tempo/visita é terminal e precisa aparecer como `truncated`.
    // Publicar cursor nesse caso repetiria a mesma caminhada e poderia devolver
    // para sempre a mesma página quando os matches estão depois do orçamento.
    let next = has_more.then(|| (offset + entries.len()).to_string());
    Ok((entries, next, truncated))
}

fn search_non_git_blocking(
    root: &Path,
    query: &str,
    offset: usize,
    limit: usize,
) -> Result<(Vec<ProjectDirEntry>, Option<String>, bool), String> {
    let normalized = query.to_lowercase();
    let started = Instant::now();
    let mut builder = WalkBuilder::new(root);
    builder
        .follow_links(false)
        .hidden(false)
        .parents(true)
        .ignore(true)
        .git_ignore(true)
        .git_global(true)
        .git_exclude(true)
        .require_git(false);
    let mut visited = 0usize;
    let mut matches_seen = 0usize;
    let mut entries = Vec::new();
    let mut truncated = false;
    let mut has_more = false;
    for result in builder.build().skip(1) {
        if started.elapsed() >= SEARCH_DEADLINE || visited >= SEARCH_VISIT_BUDGET {
            truncated = true;
            break;
        }
        visited += 1;
        let Ok(found) = result else {
            truncated = true;
            continue;
        };
        if !found
            .file_type()
            .is_some_and(|kind| kind.is_file() || kind.is_symlink())
        {
            continue;
        }
        if structurally_excluded(found.path()) {
            continue;
        }
        let Some(entry) = entry_from_path(root, found.path()) else {
            truncated = true;
            continue;
        };
        if !entry.rel_path.to_lowercase().contains(&normalized) {
            continue;
        }
        if matches_seen < offset {
            matches_seen += 1;
            continue;
        }
        if entries.len() >= limit {
            has_more = true;
            break;
        }
        entries.push(entry);
        matches_seen += 1;
    }
    entries.sort_by(compare_entries);
    let next = has_more.then(|| (offset + entries.len()).to_string());
    Ok((entries, next, truncated))
}

#[tauri::command]
pub async fn search_project_files(
    root: String,
    query: String,
    cursor: Option<String>,
    limit: Option<u32>,
) -> Result<ProjectFileSearchPage, String> {
    let query = query.trim().to_string();
    if query.is_empty() {
        return Err("digite algo para buscar arquivos".into());
    }
    let root_path = canonical_root(&root)?;
    if is_broad_root(&root_path) {
        return Err("Escolha uma pasta mais específica para buscar arquivos.".into());
    }
    let offset = cursor_offset(cursor.as_deref())?;
    let limit = normalized_limit(limit, DEFAULT_SEARCH_LIMIT);
    let revision = root_revision(&root_path);
    if is_git_repository(&root_path).await? {
        let (entries, next_cursor, truncated) =
            search_git(&root_path, &query, offset, limit).await?;
        return Ok(ProjectFileSearchPage {
            query,
            entries,
            next_cursor,
            truncated,
            source: "git".into(),
            root_revision: revision,
        });
    }
    let root_for_walk = root_path.clone();
    let query_for_walk = query.clone();
    let (entries, next_cursor, truncated) = tokio::task::spawn_blocking(move || {
        search_non_git_blocking(&root_for_walk, &query_for_walk, offset, limit)
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(ProjectFileSearchPage {
        query,
        entries,
        next_cursor,
        truncated,
        source: "ignored-walk".into(),
        root_revision: revision,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(tag: &str) -> PathBuf {
        let root =
            std::env::temp_dir().join(format!("frota-project-files-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    /// Regressão: TODO repositório git dizia "leitura parcial" na barra do
    /// explorador. O `.git` está sempre na raiz e sempre foi excluído de
    /// propósito, mas a exclusão voltava como o mesmo `None` de "não consegui
    /// ler" e acendia o aviso. Sinal que nunca apaga não informa nada, e este
    /// ainda por cima era falso: a leitura estava completa.
    #[test]
    fn exclusao_nossa_nao_e_leitura_parcial() {
        let root = fixture("excluded");
        std::fs::create_dir_all(root.join(".git/objects")).unwrap();
        std::fs::write(root.join(".git/config"), "[core]").unwrap();
        std::fs::write(root.join(".DS_Store"), "").unwrap();
        std::fs::write(root.join("README.md"), "# oi").unwrap();

        let page = list_dir_children_blocking(&root.to_string_lossy(), "", None, None).unwrap();
        assert!(
            !page.truncated,
            "a leitura foi completa: o que faltou, faltou por decisão nossa"
        );
        assert_eq!(
            page.entries
                .iter()
                .map(|entry| entry.rel_path.as_str())
                .collect::<Vec<_>>(),
            ["README.md"],
            "o encanamento não vira item do projeto"
        );
    }

    #[test]
    fn lista_somente_um_nivel_e_pagina_sem_corte_silencioso() {
        let root = fixture("dir");
        std::fs::create_dir_all(root.join("src/nested")).unwrap();
        std::fs::write(root.join("src/app.rs"), "fn main() {}").unwrap();
        std::fs::write(root.join("README.md"), "# oi").unwrap();
        std::fs::write(root.join("z.txt"), "z").unwrap();

        let first = list_dir_children_blocking(&root.to_string_lossy(), "", None, Some(2)).unwrap();
        assert_eq!(first.entries.len(), 2);
        assert_eq!(first.entries[0].rel_path, "src");
        assert_eq!(first.entries[0].kind, "directory");
        assert_eq!(first.entries[1].rel_path, "README.md");
        assert_eq!(first.next_cursor.as_deref(), Some("2"));
        assert!(!first
            .entries
            .iter()
            .any(|entry| entry.rel_path == "src/app.rs"));

        let second = list_dir_children_blocking(
            &root.to_string_lossy(),
            "",
            first.next_cursor.as_deref(),
            Some(2),
        )
        .unwrap();
        assert_eq!(second.entries[0].rel_path, "z.txt");
        assert!(second.next_cursor.is_none());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recusa_traversal_e_pasta_ausente() {
        let root = fixture("scope");
        let root_str = root.to_string_lossy();
        assert!(list_dir_children_blocking(&root_str, "../", None, None).is_err());
        assert!(list_dir_children_blocking(&root_str, "/tmp", None, None).is_err());
        assert!(list_dir_children_blocking(&root_str, "sumiu", None, None).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_fica_visivel_mas_diretorio_nao_expande() {
        let root = fixture("symlink");
        std::fs::create_dir_all(root.join("real")).unwrap();
        std::os::unix::fs::symlink(root.join("real"), root.join("atalho")).unwrap();
        let page = list_dir_children_blocking(&root.to_string_lossy(), "", None, None).unwrap();
        let link = page
            .entries
            .iter()
            .find(|entry| entry.name == "atalho")
            .unwrap();
        assert!(link.is_symlink);
        assert_eq!(link.kind, "directory");
        assert!(list_dir_children_blocking(&root.to_string_lossy(), "atalho", None, None).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn busca_nao_git_respeita_ignore_aninhado() {
        let root = fixture("ignore");
        std::fs::create_dir_all(root.join("src/cache")).unwrap();
        std::fs::write(root.join("src/.ignore"), "cache/\n").unwrap();
        std::fs::write(root.join("src/cache/segredo.log"), "x").unwrap();
        std::fs::write(root.join("src/visivel.log"), "x").unwrap();

        let (entries, _, truncated) = search_non_git_blocking(&root, ".log", 0, 20).unwrap();
        assert!(!truncated);
        assert_eq!(
            entries
                .iter()
                .map(|entry| entry.rel_path.as_str())
                .collect::<Vec<_>>(),
            vec!["src/visivel.log"]
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[tokio::test]
    async fn busca_git_inclui_rastreado_e_nao_rastreado_mas_nao_ignorado() {
        let root = fixture("git");
        crate::proc::run("git", &["init", "-q"], Some(&root.to_string_lossy())).unwrap();
        std::fs::write(root.join("tracked.rs"), "x").unwrap();
        std::fs::write(root.join("untracked.rs"), "x").unwrap();
        std::fs::write(root.join("ignored.rs"), "x").unwrap();
        std::fs::write(root.join(".gitignore"), "ignored.rs\n").unwrap();
        crate::proc::run(
            "git",
            &["add", "tracked.rs", ".gitignore"],
            Some(&root.to_string_lossy()),
        )
        .unwrap();

        let page = search_project_files(
            root.to_string_lossy().into_owned(),
            ".rs".into(),
            None,
            Some(20),
        )
        .await
        .unwrap();
        let paths = page
            .entries
            .iter()
            .map(|entry| entry.rel_path.as_str())
            .collect::<Vec<_>>();
        assert_eq!(paths, vec!["untracked.rs", "tracked.rs"]);
        assert_eq!(page.source, "git");
        std::fs::remove_dir_all(root).unwrap();
    }
}
