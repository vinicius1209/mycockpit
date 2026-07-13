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
