//! Navegador do projeto: a página vira imagem (navegador PRD R3).
//!
//! "Anexar à conversa" e "Copiar imagem" pedem ao Chromium um
//! `Page.captureScreenshot` em PNG, na resolução real da página (não o JPEG do
//! screencast, que é reduzido). Os bytes vão direto para o armazenamento de
//! anexos ou para o clipboard: nada de base64 no Channel. Capturar é
//! observação, então não exige ser o piloto (ADR-131).

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;
use tauri_plugin_clipboard_manager::ClipboardExt;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;

const ID_DA_CAPTURA: u64 = 1;
/// Página pesada leva mais que o input para rasterizar.
const PRAZO_DA_CAPTURA: Duration = Duration::from_secs(15);
const ASSINATURA_PNG: &[u8] = b"\x89PNG\r\n\x1a\n";

/// O PNG dentro da resposta do `Page.captureScreenshot`, conferido pela
/// assinatura: resposta de erro ou dado que não é PNG vira erro legível.
pub(crate) fn png_da_resposta(resposta: &Value) -> Result<Vec<u8>, String> {
    if let Some(erro) = resposta.get("error") {
        let motivo = erro.get("message").and_then(Value::as_str).unwrap_or("erro sem motivo");
        return Err(format!("o navegador recusou a captura: {motivo}"));
    }
    let dado = resposta
        .pointer("/result/data")
        .and_then(Value::as_str)
        .ok_or("o navegador não devolveu a imagem da página")?;
    let png = crate::evidence::decode_base64(dado).ok_or("a imagem da página veio corrompida")?;
    if !png.starts_with(ASSINATURA_PNG) {
        return Err("a captura não é um PNG".into());
    }
    Ok(png)
}

/// Nome do anexo a partir da URL já limpa: `pagina-localhost-3981.png`.
pub(crate) fn nome_da_captura(url_limpa: &str) -> String {
    let host = url::Url::parse(url_limpa)
        .ok()
        .and_then(|u| {
            u.host_str()
                .map(|h| match u.port() {
                    Some(porta) => format!("{h}-{porta}"),
                    None => h.to_string(),
                })
        })
        .unwrap_or_default();
    let limpo: String = host
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .chars()
        .take(60)
        .collect();
    if limpo.is_empty() {
        "pagina.png".into()
    } else {
        format!("pagina-{limpo}.png")
    }
}

async fn capturar_png(websocket_url: &str) -> Result<Vec<u8>, String> {
    timeout(PRAZO_DA_CAPTURA, async {
        let (mut socket, _) = tokio_tungstenite::connect_async(websocket_url)
            .await
            .map_err(|error| format!("não consegui falar com a página: {error}"))?;
        let pedido = json!({
            "id": ID_DA_CAPTURA,
            "method": "Page.captureScreenshot",
            "params": {"format": "png", "fromSurface": true, "captureBeyondViewport": false}
        });
        socket
            .send(Message::Text(pedido.to_string().into()))
            .await
            .map_err(|error| format!("a captura não foi pedida: {error}"))?;
        loop {
            let mensagem = socket
                .next()
                .await
                .ok_or("a página encerrou o canal antes da captura")?
                .map_err(|error| format!("captura interrompida: {error}"))?;
            let Message::Text(texto) = mensagem else { continue };
            let Ok(valor) = serde_json::from_str::<Value>(&texto) else { continue };
            if valor.get("id").and_then(Value::as_u64) == Some(ID_DA_CAPTURA) {
                return png_da_resposta(&valor);
            }
        }
    })
    .await
    .map_err(|_| "a captura da página excedeu o tempo limite".to_string())?
}

async fn capturar_alvo(
    app: &tauri::AppHandle,
    project_path: &str,
    target_id: &str,
) -> Result<(Vec<u8>, String, String), String> {
    let (_, page) = crate::browser_cdp::target_for(app, project_path, target_id).await?;
    let websocket_url = page.websocket_url.as_deref().ok_or("a página não publicou um canal")?;
    let png = capturar_png(websocket_url).await?;
    let url = crate::browser_cdp::sanitize_page_url(&page.url);
    let title: String = page.title.chars().take(240).collect();
    Ok((png, url, title))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PaginaAnexada {
    pub attachment: crate::attachments::Attachment,
    /// URL sem credencial, query nem fragmento (`sanitize_page_url`).
    pub url: String,
    pub title: String,
}

/// Anexa a página visível ao rascunho da conversa: o anexo nasce pelo MESMO
/// núcleo do colar (sniff, allowlist, teto de tamanho, dedup).
#[tauri::command]
pub async fn browser_capture_attach(
    app: tauri::AppHandle,
    project_path: String,
    target_id: String,
    conv_id: String,
    active: tauri::State<'_, crate::attachments::ActiveConvs>,
) -> Result<PaginaAnexada, String> {
    let (png, url, title) = capturar_alvo(&app, &project_path, &target_id).await?;
    let attachment = crate::attachments::save_to_disk(
        &app,
        &conv_id,
        &nome_da_captura(&url),
        Some("image/png".into()),
        &png,
        active.inner(),
    )?;
    Ok(PaginaAnexada { attachment, url, title })
}

/// Copia a página visível como imagem para o clipboard do sistema.
#[tauri::command]
pub async fn browser_capture_copy(
    app: tauri::AppHandle,
    project_path: String,
    target_id: String,
) -> Result<(), String> {
    let (png, _, _) = capturar_alvo(&app, &project_path, &target_id).await?;
    let imagem = tauri::image::Image::from_bytes(&png)
        .map_err(|error| format!("não consegui ler a imagem da página: {error}"))?;
    app.clipboard()
        .write_image(&imagem)
        .map_err(|error| format!("não consegui copiar a imagem: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    const RESPOSTA_REAL: &str = include_str!("../testdata/chromium-cdp/capture-screenshot-png.json");

    #[test]
    fn resposta_real_vira_png_com_a_resolucao_da_pagina() {
        let resposta: Value = serde_json::from_str(RESPOSTA_REAL).unwrap();
        let png = png_da_resposta(&resposta).unwrap();
        assert!(png.starts_with(ASSINATURA_PNG));
        // IHDR: largura e altura em big-endian nos bytes 16..24 (viewport 96×60)
        assert_eq!(u32::from_be_bytes(png[16..20].try_into().unwrap()), 96);
        assert_eq!(u32::from_be_bytes(png[20..24].try_into().unwrap()), 60);
        let imagem = tauri::image::Image::from_bytes(&png).unwrap();
        assert_eq!((imagem.width(), imagem.height()), (96, 60));
    }

    #[test]
    fn erro_ou_dado_estranho_nao_viram_anexo() {
        let erro = json!({"id": 1, "error": {"code": -32000, "message": "Unable to capture screenshot"}});
        assert!(png_da_resposta(&erro).unwrap_err().contains("Unable to capture screenshot"));
        assert!(png_da_resposta(&json!({"id": 1, "result": {}})).is_err());
        // JPEG em base64 não passa como PNG
        assert!(png_da_resposta(&json!({"id": 1, "result": {"data": "/9j/4AAQ"}})).is_err());
    }

    #[test]
    fn nome_do_anexo_vem_do_host_limpo() {
        assert_eq!(nome_da_captura("http://localhost:3981/"), "pagina-localhost-3981.png");
        assert_eq!(nome_da_captura("https://nextjs.org/docs"), "pagina-nextjs-org.png");
        assert_eq!(nome_da_captura("Endereço indisponível"), "pagina.png");
        assert_eq!(nome_da_captura("about:blank"), "pagina.png");
    }

    #[test]
    fn url_anexada_sai_sem_query_nem_credencial() {
        let limpa = crate::browser_cdp::sanitize_page_url(
            "https://ana:segredo@app.exemplo.com/painel?token=abc#sessao",
        );
        assert_eq!(limpa, "https://app.exemplo.com/painel");
    }
}
