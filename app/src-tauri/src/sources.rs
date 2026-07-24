//! Fase 2, "source resolver": indexa as fontes REAIS do projeto (NÃO copia).
//! Personas ← .claude/agents · Specs ← .claude/plans/{slug}/manifest.json ·
//! Memórias ← dir path-encoded do Claude CLI. Sempre lê do disco; zero store paralelo.

use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct Persona {
    pub name: String,
    pub description: Option<String>,
    pub model: Option<String>,
    pub path: String,
}

#[derive(Serialize)]
pub struct Spec {
    pub slug: String,
    pub stage: Option<String>,
    pub title: Option<String>,
    pub path: String,
}

#[derive(Serialize)]
pub struct MemoryInfo {
    pub exists: bool,
    pub count: usize,
    /// Caminho do MEMORY.md (índice) p/ o detalhe. None se ausente.
    pub path: Option<String>,
}

/// Aviso de drift: uma cópia legada está mais velha que a fonte real.
#[derive(Serialize)]
pub struct Drift {
    pub copy: String,
    pub source: String,
    pub days_stale: i64,
}

#[derive(Serialize)]
pub struct ProjectSources {
    pub personas: Vec<Persona>,
    pub specs: Vec<Spec>,
    pub memory: MemoryInfo,
    pub drift: Vec<Drift>,
}

/// Lê um campo do frontmatter YAML. Entende valor inline (`key: foo`) E block
/// scalar (`key: |` / `>`), devolvendo o 1º parágrafo do bloco. Parser mínimo
/// (sem dep de YAML), suficiente p/ name/description/model dos agents.
fn frontmatter(text: &str, key: &str) -> Option<String> {
    let lines: Vec<&str> = text.lines().collect();
    if lines.first()?.trim() != "---" {
        return None;
    }
    let prefix = format!("{key}:");
    let mut i = 1;
    while i < lines.len() {
        let line = lines[i];
        if line.trim() == "---" {
            return None;
        }
        if let Some(rest) = line.trim_start().strip_prefix(&prefix) {
            let v = rest.trim();
            // valor inline
            if !v.is_empty() && v != "|" && v != ">" && v != "|-" && v != ">-" {
                return Some(v.trim_matches('"').trim_matches('\'').to_string());
            }
            // block scalar → junta só o 1º parágrafo das linhas indentadas
            let mut para: Vec<String> = Vec::new();
            i += 1;
            while i < lines.len() {
                let bl = lines[i];
                if bl.trim() == "---" {
                    break;
                }
                if bl.trim().is_empty() {
                    if !para.is_empty() {
                        break;
                    }
                    i += 1;
                    continue;
                }
                if !bl.starts_with(' ') && !bl.starts_with('\t') {
                    break; // próxima chave não-indentada
                }
                para.push(bl.trim().to_string());
                i += 1;
            }
            return (!para.is_empty()).then(|| para.join(" "));
        }
        i += 1;
    }
    None
}

fn read_personas(claude_dir: &Path) -> Vec<Persona> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(claude_dir.join("agents")) {
        for e in rd.filter_map(|e| e.ok()) {
            let p = e.path();
            if p.extension().is_none_or(|x| x != "md") {
                continue;
            }
            if let Ok(text) = std::fs::read_to_string(&p) {
                let stem = p
                    .file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("")
                    .to_string();
                out.push(Persona {
                    name: frontmatter(&text, "name").unwrap_or(stem),
                    description: frontmatter(&text, "description"),
                    model: frontmatter(&text, "model"),
                    path: p.to_string_lossy().to_string(),
                });
            }
        }
    }
    out.sort_by_key(|p| p.name.to_lowercase());
    out
}

fn read_specs(claude_dir: &Path) -> Vec<Spec> {
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(claude_dir.join("plans")) {
        for e in rd.filter_map(|e| e.ok()) {
            let dir = e.path();
            let manifest = dir.join("manifest.json");
            if !dir.is_dir() || !manifest.is_file() {
                continue;
            }
            let slug = dir
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("")
                .to_string();
            let (stage, title) = std::fs::read_to_string(&manifest)
                .ok()
                .and_then(|c| serde_json::from_str::<serde_json::Value>(&c).ok())
                .map(|v| {
                    let get = |k: &str| {
                        v.get(k).and_then(|x| x.as_str()).map(str::to_string)
                    };
                    (
                        get("stage"),
                        get("title").or_else(|| get("name")).or_else(|| get("description")),
                    )
                })
                .unwrap_or((None, None));
            // detalhe: prefere SPEC.md → PRD.md → manifest.json
            let detail = ["SPEC.md", "PRD.md", "manifest.json"]
                .iter()
                .map(|f| dir.join(f))
                .find(|p| p.is_file())
                .unwrap_or_else(|| manifest.clone());
            out.push(Spec {
                slug,
                stage,
                title,
                path: detail.to_string_lossy().to_string(),
            });
        }
    }
    out.sort_by(|a, b| a.slug.cmp(&b.slug));
    out
}

/// Dir de memória per-projeto do Claude CLI: ~/.claude/projects/<path-encoded>/memory
/// onde <path-encoded> = caminho absoluto com `/` → `-`.
fn read_memory(project_path: &str) -> MemoryInfo {
    let Ok(home) = std::env::var("HOME") else {
        return MemoryInfo {
            exists: false,
            count: 0,
            path: None,
        };
    };
    let encoded = project_path.replace('/', "-");
    let dir = Path::new(&home)
        .join(".claude")
        .join("projects")
        .join(&encoded)
        .join("memory");
    let exists = dir.is_dir();
    let count = if exists {
        std::fs::read_dir(&dir)
            .map(|rd| {
                rd.filter_map(|e| e.ok())
                    .filter(|e| {
                        e.path().extension().is_some_and(|x| x == "md")
                            && e.file_name() != "MEMORY.md"
                    })
                    .count()
            })
            .unwrap_or(0)
    } else {
        0
    };
    let index = dir.join("MEMORY.md");
    MemoryInfo {
        exists,
        count,
        path: index
            .is_file()
            .then(|| index.to_string_lossy().to_string()),
    }
}

/// Pares conhecidos cópia-legada → fonte. Sinaliza se a cópia ficou pra trás.
fn read_drift(base: &Path) -> Vec<Drift> {
    let mut out = Vec::new();
    let pairs = [(".cockpit/profile.md", "AGENTS.md")];
    for (copy_rel, src_rel) in pairs {
        let (Ok(cm), Ok(sm)) = (
            std::fs::metadata(base.join(copy_rel)),
            std::fs::metadata(base.join(src_rel)),
        ) else {
            continue;
        };
        let (Ok(ct), Ok(st)) = (cm.modified(), sm.modified()) else {
            continue;
        };
        if let Ok(d) = st.duration_since(ct) {
            out.push(Drift {
                copy: copy_rel.to_string(),
                source: src_rel.to_string(),
                days_stale: (d.as_secs() / 86400) as i64,
            });
        }
    }
    out
}

#[tauri::command]
pub fn read_project_sources(path: String) -> ProjectSources {
    let base = Path::new(&path);
    let cd = base.join(".claude");
    ProjectSources {
        personas: read_personas(&cd),
        specs: read_specs(&cd),
        memory: read_memory(&path),
        drift: read_drift(base),
    }
}

/// Lê um arquivo de texto (p/ o detalhe de persona/spec/memória). Trunca p/ a UI.
/// ESCOPADO: só dentro da raiz dada (o projeto) ou de ~/.claude (memórias/skills
/// globais). Markdown de agent renderizado na UI nunca deve virar primitiva de
/// leitura arbitrária do disco (~/.ssh etc).
#[tauri::command]
pub fn read_text_file(root: String, path: String) -> Result<String, String> {
    let canon = std::fs::canonicalize(&path).map_err(|e| e.to_string())?;
    let mut allowed: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(r) = std::fs::canonicalize(&root) {
        allowed.push(r);
    }
    if let Some(home) = std::env::var_os("HOME") {
        if let Ok(c) = std::fs::canonicalize(Path::new(&home).join(".claude")) {
            allowed.push(c);
        }
    }
    if !allowed.iter().any(|a| canon.starts_with(a)) {
        return Err("caminho fora do projeto (e de ~/.claude): leitura bloqueada".into());
    }
    let c = std::fs::read_to_string(&canon).map_err(|e| e.to_string())?;
    Ok(if c.chars().count() > 24000 {
        let mut out: String = c.chars().take(24000).collect();
        out.push_str("\n…");
        out
    } else {
        c
    })
}

/// Opção invocável por "/", comando (.claude/commands) OU skill (.claude/skills).
#[derive(Serialize)]
pub struct SlashCommand {
    pub name: String,
    pub description: Option<String>,
    pub kind: String,   // "command" | "skill"
    pub origin: String, // "project" | "global"
}

fn collect_commands(dir: &Path, prefix: &str, origin: &str, out: &mut Vec<SlashCommand>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.filter_map(|e| e.ok()) {
        let p = e.path();
        if p.is_dir() {
            let ns = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            let next = if prefix.is_empty() {
                ns.to_string()
            } else {
                format!("{prefix}:{ns}")
            };
            collect_commands(&p, &next, origin, out);
        } else if p.extension().is_some_and(|x| x == "md") {
            let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("");
            let name = if prefix.is_empty() {
                stem.to_string()
            } else {
                format!("{prefix}:{stem}")
            };
            let description = std::fs::read_to_string(&p)
                .ok()
                .and_then(|t| frontmatter(&t, "description"));
            out.push(SlashCommand {
                name,
                description,
                kind: "command".to_string(),
                origin: origin.to_string(),
            });
        }
    }
}

/// Skills (.claude/skills/<name>/SKILL.md), invocáveis por /<name>.
fn collect_skills(dir: &Path, origin: &str, out: &mut Vec<SlashCommand>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.filter_map(|e| e.ok()) {
        let p = e.path();
        if !p.is_dir() {
            continue;
        }
        let Some(name) = p.file_name().and_then(|s| s.to_str()) else {
            continue;
        };
        let description = std::fs::read_to_string(p.join("SKILL.md"))
            .ok()
            .and_then(|t| frontmatter(&t, "description"));
        out.push(SlashCommand {
            name: name.to_string(),
            description,
            kind: "skill".to_string(),
            origin: origin.to_string(),
        });
    }
}

#[tauri::command]
pub fn read_project_commands(path: String) -> Vec<SlashCommand> {
    let mut out = Vec::new();
    // projeto (.claude/), entra primeiro → vence no dedup
    let cd = Path::new(&path).join(".claude");
    collect_commands(&cd.join("commands"), "", "project", &mut out);
    collect_skills(&cd.join("skills"), "project", &mut out);
    // global (~/.claude/)
    if let Ok(home) = std::env::var("HOME") {
        let gd = Path::new(&home).join(".claude");
        collect_commands(&gd.join("commands"), "", "global", &mut out);
        collect_skills(&gd.join("skills"), "global", &mut out);
    }
    // dedup por (kind, name), o do projeto (inserido antes) vence
    let mut seen = std::collections::HashSet::new();
    out.retain(|c| seen.insert((c.kind.clone(), c.name.clone())));
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Walk de fallback (projeto sem git): pula pastas pesadas, cap embutido.
fn walk_files(base: &Path, dir: &Path, out: &mut Vec<String>, depth: usize) {
    if out.len() >= 8000 || depth > 10 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.filter_map(|e| e.ok()) {
        let p = e.path();
        let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if p.is_dir() {
            if matches!(
                name,
                "node_modules" | ".git" | "target" | "dist" | "build" | ".next"
            ) {
                continue;
            }
            walk_files(base, &p, out, depth + 1);
        } else if let Ok(rel) = p.strip_prefix(base) {
            out.push(rel.to_string_lossy().to_string());
        }
    }
}

/// Lista arquivos do projeto p/ o "@" (referência). git ls-files respeita o
/// .gitignore e é rápido; fallback p/ walk em projeto sem git.
#[tauri::command]
pub fn list_project_files(path: String) -> Vec<String> {
    if let Some(s) = crate::proc::run_ok(
        "git",
        &["-C", &path, "ls-files", "--cached", "--others", "--exclude-standard"],
        None,
    ) {
        let mut v: Vec<String> = s.lines().take(8000).map(str::to_string).collect();
        v.sort();
        return v;
    }
    let base = Path::new(&path);
    let mut out = Vec::new();
    walk_files(base, base, &mut out, 0);
    out.sort();
    out
}

/// Persiste um arquivo de estado da missão no worktree (P1 confiabilidade:
/// missão sobrevive a restart). Agora recebe o `rel_path` (ex.:
/// `.mycockpit/missions/<slug>/run-state.json`) pra ISOLAR cada missão numa
/// pasta própria — antes o nome fixo `.mission/run-state.json` fazia missões no
/// mesmo cwd se SOBRESCREVEREM. ESCOPADO: `rel_path` tem que ser relativo e não
/// pode escapar do cwd (sem `..`, sem absoluto; o pai canônico tem que começar
/// no root). Escrita atômica (fsx) porque os agents leem/escrevem em paralelo.
#[tauri::command]
pub fn write_mission_state(cwd: String, rel_path: String, content: String) -> Result<(), String> {
    let root = std::fs::canonicalize(&cwd).map_err(|e| e.to_string())?;
    if !root.is_dir() {
        return Err("cwd da missão não é um diretório".into());
    }
    let rel = std::path::Path::new(&rel_path);
    if rel.is_absolute()
        || rel
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("caminho de missão inválido (fora do cwd)".into());
    }
    let target = root.join(rel);
    let parent = target
        .parent()
        .ok_or_else(|| "caminho de missão sem pasta-pai".to_string())?;
    std::fs::create_dir_all(parent).map_err(|e| format!("não criei a pasta da missão: {e}"))?;
    // defesa extra contra symlink/traversal: o pai REAL tem que estar no root.
    let cparent = std::fs::canonicalize(parent).map_err(|e| e.to_string())?;
    if !cparent.starts_with(&root) {
        return Err("caminho de missão escaparia do cwd".into());
    }
    crate::fsx::write_atomic(&target, &content)
}

/// Lista os arquivos de UMA pasta de missão (`.mycockpit/missions/<slug>/`).
/// As pastas de missão são gitignoradas, então `list_project_files` (git
/// ls-files) NÃO as enxerga — daí este walker escopado. Devolve caminhos
/// RELATIVOS ao rel_dir (ex.: "plan.md", "reports/05.md", "2-reviewer.json").
/// Mesmo guard do write: rel_dir relativo, sem `..`, base real dentro do root.
#[tauri::command]
pub fn list_mission_files(cwd: String, rel_dir: String) -> Result<Vec<String>, String> {
    let root = std::fs::canonicalize(&cwd).map_err(|e| e.to_string())?;
    let rel = std::path::Path::new(&rel_dir);
    if rel.is_absolute()
        || rel
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err("caminho de missão inválido".into());
    }
    let base = root.join(rel);
    if !base.is_dir() {
        return Ok(Vec::new()); // pasta ainda não criada = sem arquivos
    }
    let cbase = std::fs::canonicalize(&base).map_err(|e| e.to_string())?;
    if !cbase.starts_with(&root) {
        return Err("caminho de missão escaparia do cwd".into());
    }
    let mut out = Vec::new();
    walk_files(&cbase, &cbase, &mut out, 0);
    out.sort();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_mission_state_cria_pasta_e_grava() {
        let tmp = std::env::temp_dir().join(format!("mc-run-state-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let rel = ".mycockpit/missions/2026-07-24-abc123-tarefa/run-state.json";
        write_mission_state(tmp.to_string_lossy().into(), rel.into(), "{\"version\":1}".into())
            .unwrap();
        let out = std::fs::read_to_string(tmp.join(rel)).unwrap();
        assert_eq!(out, "{\"version\":1}");
        // regrava por cima (marcos seguintes) sem erro.
        write_mission_state(tmp.to_string_lossy().into(), rel.into(), "{\"version\":2}".into())
            .unwrap();
        let out = std::fs::read_to_string(tmp.join(rel)).unwrap();
        assert_eq!(out, "{\"version\":2}");
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn write_mission_state_rejeita_cwd_invalido() {
        assert!(
            write_mission_state("/caminho/que/nao/existe".into(), "a/b.json".into(), "x".into())
                .is_err()
        );
    }

    #[test]
    fn write_mission_state_rejeita_traversal() {
        let tmp = std::env::temp_dir().join(format!("mc-trav-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let cwd: String = tmp.to_string_lossy().into();
        // `..` no caminho é rejeitado (não escreve fora do cwd).
        assert!(write_mission_state(cwd.clone(), "../fora.json".into(), "x".into()).is_err());
        // caminho absoluto é rejeitado.
        assert!(write_mission_state(cwd, "/etc/evil".into(), "x".into()).is_err());
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn list_mission_files_lista_relativo_e_recursivo() {
        let tmp = std::env::temp_dir().join(format!("mc-list-{}", std::process::id()));
        let dir = ".mycockpit/missions/2026-07-24-abc-tarefa";
        let base = tmp.join(dir);
        std::fs::create_dir_all(base.join("reports")).unwrap();
        std::fs::write(base.join("plan.md"), "# plano").unwrap();
        std::fs::write(base.join("2-reviewer.json"), "{}").unwrap();
        std::fs::write(base.join("reports/05.md"), "rel").unwrap();
        let mut files =
            list_mission_files(tmp.to_string_lossy().into(), dir.into()).unwrap();
        files.sort();
        assert_eq!(files, vec!["2-reviewer.json", "plan.md", "reports/05.md"]);
        std::fs::remove_dir_all(&tmp).unwrap();
    }

    #[test]
    fn list_mission_files_pasta_ausente_devolve_vazio() {
        let tmp = std::env::temp_dir().join(format!("mc-list2-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let out =
            list_mission_files(tmp.to_string_lossy().into(), ".mycockpit/missions/x".into())
                .unwrap();
        assert!(out.is_empty());
        // traversal rejeitado.
        assert!(list_mission_files(tmp.to_string_lossy().into(), "../x".into()).is_err());
        std::fs::remove_dir_all(&tmp).unwrap();
    }
}
