//! Fase 1 — `.mycockpit/config.toml`: lar durável da config POR PROJETO
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
}

#[tauri::command]
pub fn read_mycockpit_config(path: String) -> McConfig {
    let cfg = Path::new(&path).join(".mycockpit").join("config.toml");
    let Ok(text) = std::fs::read_to_string(&cfg) else {
        return McConfig::default(); // exists: false
    };
    let doc = text.parse::<DocumentMut>().unwrap_or_default();
    let get = |k: &str| doc.get(k).and_then(|v| v.as_str()).map(str::to_string);
    McConfig {
        exists: true,
        mode: get("mode"),
        helper: get("helper"),
        permission: get("permission"),
    }
}

/// Escreve as chaves fornecidas em `.mycockpit/config.toml`, criando a pasta
/// (com `.gitignore` = `*`) e o arquivo se não existirem. Round-trip via toml_edit.
#[tauri::command]
pub fn write_mycockpit_config(
    path: String,
    mode: Option<String>,
    helper: Option<String>,
    permission: Option<String>,
) -> Result<(), String> {
    let dir = Path::new(&path).join(".mycockpit");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // 100% local: ignora tudo dentro de .mycockpit/
    let gi = dir.join(".gitignore");
    if !gi.exists() {
        std::fs::write(&gi, "*\n").map_err(|e| e.to_string())?;
    }

    let cfg = dir.join("config.toml");
    let mut doc = std::fs::read_to_string(&cfg)
        .ok()
        .and_then(|t| t.parse::<DocumentMut>().ok())
        .unwrap_or_else(|| {
            let mut d = DocumentMut::new();
            d["version"] = value(1);
            d
        });

    if let Some(m) = mode {
        doc["mode"] = value(m);
    }
    if let Some(h) = helper {
        doc["helper"] = value(h);
    }
    if let Some(p) = permission {
        doc["permission"] = value(p);
    }

    std::fs::write(&cfg, doc.to_string()).map_err(|e| e.to_string())?;
    Ok(())
}
