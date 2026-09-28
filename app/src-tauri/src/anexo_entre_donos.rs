//! Copia um anexo de um dono para outro, dentro da raiz de anexos
//! (docs/composer-vira-nota-spec.md §2): o rascunho que vira nota leva as
//! imagens junto, e a nota que volta ao composer as devolve à conversa.
//!
//! Os bytes ficam no Rust. Passar pela ponte seria `number[]` em JSON, até
//! 10 MB por anexo, nos dois sentidos. A gravação usa as MESMAS funções da
//! conversa e da nota (`save_to_disk`, `save_note_to_disk`): sniff, allowlist,
//! teto e dedup não se duplicam aqui.
//!
//! Mora fora de `attachments.rs` porque ele está perto do teto de 1000 linhas
//! (ADR-232).

use serde::Deserialize;
use std::path::Path;
use tauri::{AppHandle, Manager};

use crate::attachments::{
    attachments_root, save_note_to_disk, save_to_disk, ActiveConvs, Attachment,
};

#[derive(Debug, Deserialize)]
#[serde(tag = "tipo", rename_all = "kebab-case")]
pub enum DonoDoAnexo {
    Conversa { id: String },
    Nota { id: String },
}

/// Lê um anexo exigindo que ele more sob a raiz de anexos, depois de resolver
/// `..` e symlink (a mesma régua do `read_attachment`).
fn ler_sob_a_raiz(app_data: &Path, raiz: &Path, path: &str) -> Result<Vec<u8>, String> {
    let raiz = raiz.canonicalize().map_err(|_| "caminho de anexo inválido".to_string())?;
    match app_data.join(path).canonicalize() {
        Ok(canon) if canon.starts_with(&raiz) && canon.is_file() => {
            std::fs::read(&canon).map_err(|e| e.to_string())
        }
        _ => Err("caminho de anexo inválido".to_string()),
    }
}

#[tauri::command]
pub async fn copiar_anexo(
    app: AppHandle,
    path: String,
    nome: String,
    para: DonoDoAnexo,
    active: tauri::State<'_, ActiveConvs>,
) -> Result<Attachment, String> {
    let app_data = app.path().app_data_dir().map_err(|e| format!("sem app_data_dir: {e}"))?;
    let bytes = ler_sob_a_raiz(&app_data, &attachments_root(&app)?, &path)?;
    match para {
        DonoDoAnexo::Conversa { id } => save_to_disk(&app, &id, &nome, None, &bytes, active.inner()),
        DonoDoAnexo::Nota { id } => save_note_to_disk(&app, &id, &nome, None, &bytes, active.inner()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(tag: &str) -> (std::path::PathBuf, std::path::PathBuf) {
        let base = std::env::temp_dir().join(format!("frota-anexo-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let raiz = base.join("attachments");
        std::fs::create_dir_all(raiz.join("c0ffee00c0ffee00c0ffee00c0ffee00")).unwrap();
        (base, raiz)
    }

    #[test]
    fn le_o_anexo_que_mora_sob_a_raiz() {
        let (base, raiz) = fixture("valido");
        let rel = "attachments/c0ffee00c0ffee00c0ffee00c0ffee00/4df9cc61137de769.png";
        std::fs::write(base.join(rel), b"\x89PNG\r\n\x1a\n").unwrap();
        assert_eq!(ler_sob_a_raiz(&base, &raiz, rel).unwrap(), b"\x89PNG\r\n\x1a\n");
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn caminho_que_sai_da_raiz_e_recusado() {
        let (base, raiz) = fixture("fora");
        std::fs::write(base.join("segredo.txt"), b"x").unwrap();
        assert!(ler_sob_a_raiz(&base, &raiz, "attachments/../segredo.txt").is_err());
        assert!(ler_sob_a_raiz(&base, &raiz, "attachments/c0ffee00c0ffee00c0ffee00c0ffee00").is_err());
        assert!(ler_sob_a_raiz(&base, &raiz, "attachments/nao-existe.png").is_err());
        #[cfg(unix)]
        {
            let link = raiz.join("c0ffee00c0ffee00c0ffee00c0ffee00/link.png");
            std::os::unix::fs::symlink(base.join("segredo.txt"), &link).unwrap();
            let rel = "attachments/c0ffee00c0ffee00c0ffee00c0ffee00/link.png";
            assert!(ler_sob_a_raiz(&base, &raiz, rel).is_err());
        }
        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn o_destino_chega_com_o_tipo_que_o_front_manda() {
        let c: DonoDoAnexo = serde_json::from_value(serde_json::json!({ "tipo": "conversa", "id": "c1" })).unwrap();
        assert!(matches!(c, DonoDoAnexo::Conversa { id } if id == "c1"));
        let n: DonoDoAnexo = serde_json::from_value(serde_json::json!({ "tipo": "nota", "id": "n1" })).unwrap();
        assert!(matches!(n, DonoDoAnexo::Nota { id } if id == "n1"));
    }
}
