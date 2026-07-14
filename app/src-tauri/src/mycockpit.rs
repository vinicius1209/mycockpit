//! Fase 1, `.mycockpit/config.toml`: lar durável da config POR PROJETO
//! (modo / modelo helper / permissão). Decisão do usuário: 100% local
//! (`.mycockpit/.gitignore` = `*`). O arquivo é a fonte de verdade; o SQLite
//! do app vira cache. Edição via toml_edit preserva comentários/formatação.

use serde::Serialize;
use std::path::Path;
use toml_edit::{value, DocumentMut};

#[derive(Serialize, Default)]
pub struct McConfig {
    /// `.mycockpit/config.toml` existe no disco?
    pub exists: bool,
    pub mode: Option<String>,
    /// "haiku" | "off" (None = chave ausente → front aplica default).
    pub helper: Option<String>,
    /// leitura | padrao | liberado
    pub permission: Option<String>,
    /// Pastas extras liberadas ao agent (viram `--add-dir`). Valores CRUS como
    /// escritos no TOML (relativos ou absolutos) — a resolução p/ o spawn é feita
    /// por `resolve_extra_dirs`.
    #[serde(default)]
    pub extra_dirs: Vec<String>,
}

/// Lê um array de strings do doc TOML (vazio se ausente/tipo errado).
fn toml_str_array(doc: &DocumentMut, key: &str) -> Vec<String> {
    doc.get(key)
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

#[tauri::command]
pub fn read_mycockpit_config(path: String) -> Result<McConfig, String> {
    let cfg = Path::new(&path).join(".mycockpit").join("config.toml");
    let Ok(text) = std::fs::read_to_string(&cfg) else {
        return Ok(McConfig::default()); // exists: false
    };
    // TOML inválido NÃO vira "tudo default" em silêncio: o arquivo é editável à
    // mão; mascarar um typo esconderia a config real (o front loga o warn).
    let doc = text
        .parse::<DocumentMut>()
        .map_err(|e| format!("config.toml inválido: {e}"))?;
    let get = |k: &str| doc.get(k).and_then(|v| v.as_str()).map(str::to_string);
    Ok(McConfig {
        exists: true,
        mode: get("mode"),
        helper: get("helper"),
        permission: get("permission"),
        extra_dirs: toml_str_array(&doc, "extra_dirs"),
    })
}

/// Resolve as pastas extras liberadas para um `cwd` (que pode ser um worktree
/// sob `.mycockpit/worktrees/…`): sobe a árvore até achar `.mycockpit/config.toml`,
/// resolve paths relativos contra a RAIZ do projeto, canoniza e descarta os que
/// não existem. Chamado no spawn (`run_agent`) → vira `--add-dir` em cada adapter.
pub fn resolve_extra_dirs(cwd: &str) -> Vec<String> {
    let mut cur: &Path = Path::new(cwd);
    loop {
        let cfg = cur.join(".mycockpit").join("config.toml");
        if cfg.is_file() {
            return read_and_resolve(&cfg, cur);
        }
        match cur.parent() {
            Some(p) => cur = p,
            None => return Vec::new(),
        }
    }
}

fn read_and_resolve(cfg: &Path, project_root: &Path) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(cfg) else {
        return Vec::new();
    };
    let Ok(doc) = text.parse::<DocumentMut>() else {
        return Vec::new();
    };
    toml_str_array(&doc, "extra_dirs")
        .iter()
        .filter_map(|s| {
            let p = Path::new(s);
            let abs = if p.is_absolute() {
                p.to_path_buf()
            } else {
                project_root.join(p)
            };
            std::fs::canonicalize(&abs).ok()
        })
        .filter(|p| p.is_dir())
        .map(|p| p.to_string_lossy().into_owned())
        .collect()
}

/// Escreve as chaves fornecidas em `.mycockpit/config.toml`, criando a pasta
/// (com `.gitignore` = `*`) e o arquivo se não existirem. Round-trip via toml_edit.
#[tauri::command]
pub fn write_mycockpit_config(
    path: String,
    mode: Option<String>,
    helper: Option<String>,
    permission: Option<String>,
    extra_dirs: Option<Vec<String>>,
) -> Result<(), String> {
    let dir = Path::new(&path).join(".mycockpit");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // 100% local: ignora tudo dentro de .mycockpit/
    let gi = dir.join(".gitignore");
    if !gi.exists() {
        std::fs::write(&gi, "*\n").map_err(|e| e.to_string())?;
    }

    let cfg = dir.join("config.toml");
    let mut doc = match std::fs::read_to_string(&cfg) {
        // arquivo EXISTE mas não parseia: NÃO sobrescreve o conteúdo autoral
        // (comentários/chaves) com um doc novo; o usuário conserta o TOML antes.
        Ok(t) => t
            .parse::<DocumentMut>()
            .map_err(|e| format!("config.toml inválido, não vou sobrescrever: {e}"))?,
        Err(_) => {
            let mut d = DocumentMut::new();
            d["version"] = value(1);
            d
        }
    };

    if let Some(m) = mode {
        doc["mode"] = value(m);
    }
    if let Some(h) = helper {
        doc["helper"] = value(h);
    }
    if let Some(p) = permission {
        doc["permission"] = value(p);
    }
    if let Some(dirs) = extra_dirs {
        // lista vazia → remove a chave (config limpa); senão grava o array.
        if dirs.is_empty() {
            doc.remove("extra_dirs");
        } else {
            let mut arr = toml_edit::Array::new();
            for d in dirs {
                arr.push(d);
            }
            doc["extra_dirs"] = value(arr);
        }
    }

    crate::fsx::write_atomic(&cfg, &doc.to_string())?;
    Ok(())
}

// ---------------- Export do contexto de conversa ----------------
//
// O frontend guarda a conversa (itens JSON) no SQLite e RENDERIZA o markdown;
// aqui só gravamos com segurança em `.mycockpit/context/<conv_id>.md` — arquivo
// legível por qualquer code agent, referenciado pelo caminho relativo no prompt.

/// Máximo de exports retidos em `.mycockpit/context/` (limpeza best-effort).
const MAX_CONTEXT_FILES: usize = 30;

/// conv_id vira NOME DE ARQUIVO: só `[a-zA-Z0-9_-]`, senão Err — nada de
/// traversal, espaço ou ponto (sem `..`, sem extensão disfarçada).
fn safe_conv_id(conv_id: &str) -> Result<&str, String> {
    if conv_id.is_empty() {
        return Err("conv_id vazio".into());
    }
    if !conv_id
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err(format!(
            "conv_id inválido: '{conv_id}' (use só letras, números, '-' e '_')"
        ));
    }
    Ok(conv_id)
}

/// Garante `dir` existente com um `.gitignore` auto-ignorante (`*`) dentro —
/// mesmo padrão do `.mycockpit/` acima: 100% local, nunca vaza pro git.
fn ensure_ignored_dir(dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let gi = dir.join(".gitignore");
    if !gi.exists() {
        std::fs::write(&gi, "*\n").map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Se sobrar mais que `keep` arquivos `.md` no dir, apaga os mais ANTIGOS por
/// mtime. Best-effort: qualquer erro (mtime ilegível, remove falhou) é ignorado
/// — limpeza nunca pode falhar o export.
fn trim_old_exports(dir: &Path, keep: usize) {
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    let mut mds: Vec<(std::time::SystemTime, std::path::PathBuf)> = rd
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("md") {
                return None;
            }
            let mtime = e.metadata().and_then(|m| m.modified()).ok()?;
            Some((mtime, p))
        })
        .collect();
    if mds.len() <= keep {
        return;
    }
    mds.sort_by_key(|(t, _)| *t); // mais antigo primeiro
    for (_, p) in mds.iter().take(mds.len() - keep) {
        let _ = std::fs::remove_file(p);
    }
}

/// Exporta o markdown (renderizado pelo front) da conversa pra
/// `.mycockpit/context/<conv_id>.md` (write atômico, sobrescreve re-export).
/// Devolve o caminho RELATIVO — é o que vai pro prompt do agent.
#[tauri::command]
pub fn export_conv_context(
    project_path: String,
    conv_id: String,
    markdown: String,
) -> Result<String, String> {
    let id = safe_conv_id(&conv_id)?;
    let root = crate::skills::validate_project_path(&project_path)?;
    // `.mycockpit/` também ganha o .gitignore (o export pode rodar antes de
    // qualquer config ser escrita — padrão do write_mycockpit_config).
    ensure_ignored_dir(&root.join(".mycockpit"))?;
    let dir = root.join(".mycockpit").join("context");
    ensure_ignored_dir(&dir)?;
    crate::fsx::write_atomic(&dir.join(format!("{id}.md")), &markdown)?;
    trim_old_exports(&dir, MAX_CONTEXT_FILES);
    Ok(format!(".mycockpit/context/{id}.md"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conv_id_sanitization() {
        assert_eq!(safe_conv_id("abc-123_XYZ").unwrap(), "abc-123_XYZ");
        assert!(safe_conv_id("").is_err());
        assert!(safe_conv_id("../etc/passwd").is_err()); // traversal
        assert!(safe_conv_id("a/b").is_err());
        assert!(safe_conv_id("a\\b").is_err());
        assert!(safe_conv_id("a b").is_err()); // espaço
        assert!(safe_conv_id("a.md").is_err()); // ponto
        assert!(safe_conv_id("é-conv").is_err()); // não-ASCII
    }

    #[test]
    fn export_creates_dir_gitignore_and_overwrites() {
        let tmp = std::env::temp_dir().join(format!("mycockpit-ctx-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        let pp = tmp.to_string_lossy().to_string();

        // export cria dir + gitignore + arquivo e devolve o RELATIVO.
        let rel = export_conv_context(pp.clone(), "conv-1".into(), "# Oi\n".into()).unwrap();
        assert_eq!(rel, ".mycockpit/context/conv-1.md");
        let dir = tmp.join(".mycockpit").join("context");
        assert_eq!(std::fs::read_to_string(dir.join(".gitignore")).unwrap(), "*\n");
        assert_eq!(
            std::fs::read_to_string(tmp.join(".mycockpit").join(".gitignore")).unwrap(),
            "*\n"
        );
        assert_eq!(std::fs::read_to_string(dir.join("conv-1.md")).unwrap(), "# Oi\n");

        // re-export SOBRESCREVE (last-writer-wins, sem erro).
        let rel2 = export_conv_context(pp.clone(), "conv-1".into(), "# Novo\n".into()).unwrap();
        assert_eq!(rel2, rel);
        assert_eq!(std::fs::read_to_string(dir.join("conv-1.md")).unwrap(), "# Novo\n");

        // conv_id malicioso não escreve nada.
        assert!(export_conv_context(pp, "../fora".into(), "x".into()).is_err());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn trim_keeps_newest() {
        let tmp = std::env::temp_dir().join(format!("mycockpit-ctx-trim-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();
        for i in 0..5 {
            let p = tmp.join(format!("c{i}.md"));
            std::fs::write(&p, "x").unwrap();
            // mtime crescente explícito (granularidade de FS não é confiável).
            let t = std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1000 + i);
            let _ = filetime_set(&p, t);
        }
        std::fs::write(tmp.join(".gitignore"), "*\n").unwrap(); // não pode ser apagado
        trim_old_exports(&tmp, 3);
        assert!(!tmp.join("c0.md").exists(), "mais antigo apagado");
        assert!(!tmp.join("c1.md").exists());
        assert!(tmp.join("c2.md").exists());
        assert!(tmp.join("c4.md").exists(), "mais novo fica");
        assert!(tmp.join(".gitignore").exists(), "só .md entra na limpeza");
        let _ = std::fs::remove_dir_all(&tmp);
    }

    /// Seta o mtime sem dep externa: reabre o arquivo e usa set_modified (Rust 1.75+).
    fn filetime_set(p: &Path, t: std::time::SystemTime) -> std::io::Result<()> {
        let f = std::fs::OpenOptions::new().write(true).open(p)?;
        f.set_modified(t)
    }
}
