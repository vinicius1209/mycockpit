//! "Abrir no app padrão" só para documento (D6 do lote 2 do Maestri, ADR-286).
//!
//! O `openPath` do plugin opener não tem permissão no `opener:default`, e
//! liberar abriria QUALQUER caminho, inclusive executável e script, com um
//! clique vindo de um cartão que o agente escreveu. Aqui a régua é uma lista
//! de tipos de documento e mídia, e arquivo com permissão de execução fica de
//! fora mesmo com extensão de documento.

use std::path::Path;

/// Tipos que abrem no app padrão. Fica de fora o que roda código ao abrir
/// (html, svg, scripts, pacotes, apps).
const DOCUMENTOS: [&str; 30] = [
    "pdf", "png", "jpg", "jpeg", "gif", "webp", "heic", "tiff", "bmp", "mp4", "mov", "webm", "m4v", "mp3", "wav",
    "m4a", "aac", "csv", "tsv", "xlsx", "xls", "ods", "numbers", "docx", "doc", "odt", "rtf", "pages", "pptx", "key",
];

/// O caminho pode abrir no app padrão? Puro sobre o que foi lido do disco.
pub fn pode_abrir(caminho: &Path, executavel: bool) -> Result<(), String> {
    let ext = caminho.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).unwrap_or_default();
    if !DOCUMENTOS.contains(&ext.as_str()) {
        return Err("só abro documento, imagem, planilha, apresentação, áudio ou vídeo no app padrão; use Mostrar na pasta".into());
    }
    if executavel {
        return Err("este arquivo tem permissão de execução; use Mostrar na pasta".into());
    }
    Ok(())
}

#[cfg(unix)]
fn e_executavel(meta: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode() & 0o111 != 0
}

#[tauri::command(async)]
pub fn abrir_documento(path: String) -> Result<(), String> {
    let caminho = Path::new(&path);
    let meta = std::fs::metadata(caminho).map_err(|_| "não encontrei o arquivo (ele ainda existe?)".to_string())?;
    if !meta.is_file() {
        return Err("não é um arquivo".into());
    }
    pode_abrir(caminho, e_executavel(&meta))?;
    let programa = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
    // Solto: o app padrão vive por conta própria; esperar por ele seria segurar
    // o comando pelo tempo que a pessoa ficar com o arquivo aberto.
    std::process::Command::new(programa)
        .arg(caminho)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("não consegui abrir: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn abre_documento_e_recusa_o_que_roda_codigo() {
        assert!(pode_abrir(Path::new("/tmp/relatorio.PDF"), false).is_ok());
        assert!(pode_abrir(Path::new("/tmp/funil.png"), false).is_ok());
        for perigoso in ["/tmp/x.sh", "/tmp/x.command", "/tmp/x.app", "/tmp/x.html", "/tmp/x.svg", "/tmp/x.pkg", "/tmp/sem-extensao"] {
            assert!(pode_abrir(Path::new(perigoso), false).is_err(), "{perigoso}");
        }
    }

    #[test]
    fn documento_com_permissao_de_execucao_nao_abre() {
        assert!(pode_abrir(Path::new("/tmp/relatorio.pdf"), true).unwrap_err().contains("execução"));
    }

    #[test]
    fn o_arquivo_de_verdade_passa_pela_mesma_regua() {
        let dir = std::env::temp_dir().join(format!("frota-abrir-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("roda.pdf");
        std::fs::write(&script, b"#!/bin/sh").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        assert!(abrir_documento(script.to_string_lossy().into()).unwrap_err().contains("execução"));
        assert!(abrir_documento(dir.to_string_lossy().into()).unwrap_err().contains("não é um arquivo"));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
