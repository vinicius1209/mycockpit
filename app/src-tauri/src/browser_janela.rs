//! O tamanho da página do navegador do projeto (ADR-229).
//!
//! Pergunta de 23/09/2026, olhando o navegador na aba: "essa resolução está
//! correta?". Não estava. Medido no Chromium vivo do sicredi: tela 800×600
//! (o padrão do headless), janela 756×556 e página 756×413, porque o Chrome
//! 151 desenha a faixa do navegador (`webui-toolbar`) mesmo em headless e ela
//! come 143 px. A tabela da página cortava com barra de rolagem lateral, e o
//! quadro aparecia pequeno no meio da aba.
//!
//! `--window-size` acerta a largura e a janela, mas a faixa continua comendo a
//! altura, e o quanto ela come é do Chrome, não nosso. Então a viewport exata
//! se acerta medindo: janela menos página é a moldura, e a janela nova é a
//! viewport desejada mais a moldura. Testado no binário real: 1280×657 vira
//! 1280×800 e continua assim depois de navegar.
//!
//! Só no headless. A janela visível é da pessoa, e o tamanho dela também.

use serde_json::{json, Value};

/// Viewport da página em pixels CSS: um notebook comum, na proporção do
/// quadro da aba e da janela flutuante.
pub const VIEWPORT: (u32, u32) = (1280, 800);

pub fn flag_de_janela() -> String {
    format!("--window-size={},{}", VIEWPORT.0, VIEWPORT.1)
}

/// O tamanho de janela que dá `alvo` de página, dada a janela e a página de
/// agora (a diferença é a moldura). `None` quando já está certo. Puro.
pub fn janela_para(janela: (u32, u32), pagina: (u32, u32), alvo: (u32, u32)) -> Option<(u32, u32)> {
    if pagina == alvo {
        return None;
    }
    let moldura = (janela.0.saturating_sub(pagina.0), janela.1.saturating_sub(pagina.1));
    Some((alvo.0 + moldura.0, alvo.1 + moldura.1))
}

fn par(valor: &Value, a: &str, b: &str) -> Option<(u32, u32)> {
    Some((valor.get(a)?.as_u64()? as u32, valor.get(b)?.as_u64()? as u32))
}

/// Acerta a viewport da página ativa do projeto. Não bloqueia nada que
/// dependa dele: falhar só deixa a página no tamanho que estava, e o motivo
/// vai ao log.
pub async fn ajustar_no_projeto(app: &tauri::AppHandle, project_path: &str) {
    ajustar_na_pagina(app, project_path, None).await
}

/// O mesmo, na janela de UMA página: com uma janela por página (ADR-257), a
/// primeira da lista não é a que a pessoa está olhando.
pub async fn ajustar_na_pagina(app: &tauri::AppHandle, project_path: &str, alvo: Option<&str>) {
    if let Err(erro) = ajustar(app, project_path, alvo).await {
        eprintln!("[navegador] não acertei o tamanho da página: {erro}");
    }
}

async fn ajustar(app: &tauri::AppHandle, project_path: &str, alvo: Option<&str>) -> Result<(), String> {
    let (_, sessao) = crate::browser_cdp::project_session(app, project_path).await?;
    if sessao.window_visible {
        return Ok(());
    }
    let pagina = match alvo {
        Some(id) => crate::browser_cdp::target_for(app, project_path, id).await?.1,
        None => crate::browser_cdp::pagina_ativa(app, project_path).await?,
    };
    let ws = pagina.websocket_url.as_deref().ok_or("a página não publicou canal")?;
    let mut s = crate::browser_marcacao::SessaoCdp::conectar(ws).await?;
    let janela = s.chamar("Browser.getWindowForTarget", json!({})).await?;
    let id = janela.pointer("/result/windowId").and_then(Value::as_u64).ok_or("janela sem id")?;
    let bounds = janela.pointer("/result/bounds").cloned().unwrap_or(Value::Null);
    let tamanho = par(&bounds, "width", "height").ok_or("janela sem tamanho")?;
    let medida = s
        .chamar(
            "Runtime.evaluate",
            json!({ "expression": "({ w: innerWidth, h: innerHeight })", "returnByValue": true }),
        )
        .await?;
    let visivel = medida
        .pointer("/result/result/value")
        .and_then(|v| par(v, "w", "h"))
        .ok_or("a página não disse o próprio tamanho")?;
    let Some((w, h)) = janela_para(tamanho, visivel, VIEWPORT) else {
        return Ok(());
    };
    s.chamar(
        "Browser.setWindowBounds",
        json!({ "windowId": id, "bounds": { "width": w, "height": h } }),
    )
    .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_moldura_medida_no_chromium_real_vira_janela_certa() {
        // Chrome for Testing 151, headless, --window-size=1280,800: janela
        // 1280×800, página 1280×657 (a faixa do navegador come 143 px).
        assert_eq!(janela_para((1280, 800), (1280, 657), VIEWPORT), Some((1280, 943)));
        // sem o flag (a tela padrão de 800×600): janela 756×556, página 756×413
        assert_eq!(janela_para((756, 556), (756, 413), VIEWPORT), Some((1280, 943)));
    }

    #[test]
    fn pagina_ja_no_tamanho_nao_mexe_na_janela() {
        assert_eq!(janela_para((1280, 943), (1280, 800), VIEWPORT), None);
    }

    #[test]
    fn o_flag_diz_a_viewport() {
        assert_eq!(flag_de_janela(), "--window-size=1280,800");
    }
}
