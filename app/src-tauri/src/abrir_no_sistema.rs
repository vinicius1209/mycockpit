//! "Abrir no app padrão" do menu de arquivo (docs/explorador-de-arquivos-prd.md,
//! D1): só para o que o visualizador da Frota não lê bem e só por extensão
//! conhecida. Abrir `.command`, `.sh` ou `.app` no app padrão é EXECUTAR, e
//! isso nunca sai de um item de menu.

use std::path::{Component, Path, PathBuf};

const EXTENSOES: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "ico", "svg", "pdf", "mp4", "m4v", "mov", "webm", "mp3",
    "wav", "m4a", "ogg", "oga", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "odt", "ods", "odp",
];

/// A extensão pode ir para o app padrão? Puro.
pub(crate) fn extensao_permitida(caminho: &Path) -> bool {
    caminho
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| EXTENSOES.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// O arquivo `rel` dentro de `root`, resolvido e contido. Link que aponta para
/// fora da raiz é recusado.
pub(crate) fn arquivo_contido(root: &str, rel: &str) -> Result<PathBuf, String> {
    let raiz = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    let rel = Path::new(rel);
    if rel.components().any(|c| !matches!(c, Component::Normal(_) | Component::CurDir)) {
        return Err("caminho inválido".into());
    }
    let alvo = std::fs::canonicalize(raiz.join(rel)).map_err(|e| e.to_string())?;
    if !alvo.starts_with(&raiz) || !alvo.is_file() {
        return Err("arquivo fora da raiz do projeto".into());
    }
    Ok(alvo)
}

#[tauri::command]
pub async fn abrir_no_app_padrao(app: tauri::AppHandle, root: String, rel: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let alvo = tauri::async_runtime::spawn_blocking(move || arquivo_contido(&root, &rel))
        .await
        .map_err(|e| e.to_string())??;
    if !extensao_permitida(&alvo) {
        return Err("este tipo de arquivo não abre pelo menu".into());
    }
    app.opener()
        .open_path(alvo.to_string_lossy().to_string(), None::<&str>)
        .map_err(|e| format!("não consegui abrir no app padrão: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn so_abre_o_que_nao_se_executa() {
        assert!(extensao_permitida(Path::new("docs/print.PNG")));
        assert!(extensao_permitida(Path::new("relatorio.pdf")));
        assert!(!extensao_permitida(Path::new("scripts/build.sh")));
        assert!(!extensao_permitida(Path::new("Rodar.command")));
        assert!(!extensao_permitida(Path::new("Frota.app")));
        assert!(!extensao_permitida(Path::new("Makefile")));
    }

    #[test]
    fn recusa_subir_da_raiz_e_link_para_fora() {
        let unico = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let base = std::env::temp_dir().join(format!("frota-abrir-{}-{unico}", std::process::id()));
        let raiz = base.join("projeto");
        std::fs::create_dir_all(&raiz).unwrap();
        std::fs::write(raiz.join("a.png"), b"x").unwrap();
        std::fs::write(base.join("fora.png"), b"x").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(base.join("fora.png"), raiz.join("link.png")).unwrap();
        let r = raiz.to_string_lossy().to_string();

        assert!(arquivo_contido(&r, "a.png").is_ok());
        assert!(arquivo_contido(&r, "../fora.png").is_err());
        assert!(arquivo_contido(&r, "/etc/hosts").is_err());
        #[cfg(unix)]
        assert!(arquivo_contido(&r, "link.png").is_err());
        let _ = std::fs::remove_dir_all(&base);
    }
}
