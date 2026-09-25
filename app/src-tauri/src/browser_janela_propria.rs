//! Cada página de conversa numa janela própria do Chromium (ADR-257).
//!
//! As conversas de um projeto dividiam UMA janela do Chromium, uma aba cada.
//! Numa janela só uma aba fica à frente, e a de fundo não é pintada: medido no
//! Chromium do projeto (25/09/2026), a página de fundo mandou 0 quadros em
//! 2,5 s, e a nova janela própria, 61 em 3 s, ao mesmo tempo que a outra. Era
//! o "só consigo ver o conteúdo de uma página". E trazer a página para a
//! frente (`Page.bringToFront`, o primeiro conserto) tiraria da frente a página
//! em que um agente de outra conversa estivesse trabalhando.
//!
//! Com uma janela por página não há frente para disputar. Só no headless: a
//! janela visível é da pessoa, e encher a tela dela de janelas seria pior.

use serde_json::{json, Value};

use crate::browser_cdp::RawPage;
use crate::browser_marcacao::SessaoCdp;

/// Tamanho da janela nova: a viewport do projeto (ADR-229). A moldura que o
/// Chrome come da altura é acertada depois por `browser_janela::ajustar`.
fn parametros_da_janela(url: &str) -> Value {
    let (largura, altura) = crate::browser_janela::VIEWPORT;
    json!({ "url": url, "newWindow": true, "background": true, "width": largura, "height": altura })
}

/// Cria a página numa janela própria e devolve como ela aparece em `/json/list`.
async fn criar_em_janela_propria(endpoint: &str, url: &str) -> Result<RawPage, String> {
    let ws = crate::browser::browser_ws_url(endpoint)
        .await
        .ok_or("o navegador não publicou o canal de controle")?;
    let mut sessao = SessaoCdp::conectar(&ws).await?;
    let resposta = sessao.chamar("Target.createTarget", parametros_da_janela(url)).await?;
    let id = resposta
        .pointer("/result/targetId")
        .and_then(Value::as_str)
        .ok_or("o navegador não disse qual página abriu")?
        .to_string();
    // A lista do `/json/list` pode demorar um instante para incluir a página.
    for _ in 0..10 {
        let paginas = crate::browser_cdp::raw_pages(endpoint).await?;
        if let Some(pagina) = paginas.into_iter().find(|p| p.id == id && p.websocket_url.is_some()) {
            return Ok(pagina);
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    Err("a página nova não apareceu na lista do navegador".into())
}

/// A página nova de uma conversa. Headless: janela própria. Janela visível:
/// uma aba, como antes.
pub(crate) async fn nova_pagina(app: &tauri::AppHandle, project_path: &str) -> Result<RawPage, String> {
    let (_, sessao) = crate::browser_cdp::project_session(app, project_path).await?;
    if sessao.window_visible {
        return crate::browser_cdp::nova_aba_na_janela(&sessao.endpoint).await;
    }
    criar_em_janela_propria(&sessao.endpoint, "about:blank").await
}

/// A página está atrás de outra na mesma janela? Uma página de fundo não é
/// pintada e nunca manda quadro. Falha na pergunta conta como "não sei", e
/// "não sei" não acusa nada.
pub(crate) async fn de_fundo(ws: &str) -> bool {
    let Ok(mut sessao) = SessaoCdp::conectar(ws).await else { return false };
    sessao
        .chamar("Runtime.evaluate", json!({ "expression": "document.visibilityState", "returnByValue": true }))
        .await
        .ok()
        .and_then(|r| r.pointer("/result/result/value").and_then(Value::as_str).map(|v| v == "hidden"))
        .unwrap_or(false)
}

/// Gesto da pessoa (o botão "Abrir numa janela própria"): a página antiga, que
/// divide a janela com outras, reabre na mesma URL numa janela própria, e a
/// conversa passa a usar a nova. Recarrega: o login fica (mesmo perfil), o que
/// estava digitado na página se perde, e por isso é gesto, não automático.
pub(crate) async fn mover(
    app: &tauri::AppHandle,
    project_path: &str,
    antiga: &RawPage,
    conversa: Option<&str>,
) -> Result<RawPage, String> {
    let (_, sessao) = crate::browser_cdp::project_session(app, project_path).await?;
    let url = if antiga.url.is_empty() { "about:blank" } else { antiga.url.as_str() };
    let nova = criar_em_janela_propria(&sessao.endpoint, url).await?;
    if let Some(conv) = conversa {
        crate::browser_donos::com(|d| {
            d.tomar(&nova.id, conv);
            d.usar(conv, &nova.id);
        });
    }
    // Fechar a antiga é o fim do gesto; se falhar, ela só sobra na lista.
    if let Err(erro) = crate::browser_cdp::fechar_aba(app, project_path, &antiga.id).await {
        log::warn!("não fechei a página antiga depois de mover: {erro}");
    }
    Ok(nova)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_pagina_nova_nasce_numa_janela_propria_do_tamanho_do_projeto() {
        let p = parametros_da_janela("about:blank");
        assert_eq!(p["newWindow"], true);
        // Em segundo plano: abrir a página da conversa não rouba o foco de nada.
        assert_eq!(p["background"], true);
        assert_eq!(p["width"], crate::browser_janela::VIEWPORT.0);
        assert_eq!(p["height"], crate::browser_janela::VIEWPORT.1);
    }
}
