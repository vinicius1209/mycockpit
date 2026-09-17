//! Marcar uma região do navegador do projeto e enviar ao agente (navegador PRD
//! R4, B3). A pessoa arrasta um retângulo sobre o quadro congelado; a Frota:
//!
//! 1. converte a região do quadro (pixels da imagem) para pixels CSS da página;
//! 2. acha os elementos REAIS ali por CDP (`DOM.getNodeForLocation` em pontos de
//!    amostra + uma função em página que sobe até o elemento interessante e diz
//!    papel, nome e seletor);
//! 3. desenha o traço na própria página, recorta com margem e tira o traço;
//! 4. confere que a página não mudou no meio (senão cancela com aviso).
//!
//! Observação, não pilotagem: não exige ser o piloto (ADR-131). O traço é um
//! elemento temporário com `pointer-events: none`, removido mesmo se algo falhar.

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::time::timeout;
use tokio_tungstenite::tungstenite::Message;

/// A função que roda na página (o MESMO arquivo das fixtures).
const DESCREVER: &str = include_str!("browser_marcacao_descrever.js");
const PRAZO_POR_CHAMADA: Duration = Duration::from_secs(8);
/// Folga de página em volta da região no recorte, para o traço aparecer inteiro.
const MARGEM_DO_RECORTE: f64 = 16.0;
/// Menor lado aceito, em pixels CSS: abaixo disto foi clique, não marcação.
const MENOR_LADO: f64 = 4.0;
const MAX_ELEMENTOS: usize = 8;
const ID_DO_TRACO: &str = "__frota_marcacao";

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Caixa {
    pub x: f64,
    pub y: f64,
    pub largura: f64,
    pub altura: f64,
}

impl Caixa {
    fn centro(&self) -> (f64, f64) {
        (self.x + self.largura / 2.0, self.y + self.altura / 2.0)
    }
    fn contem(&self, (px, py): (f64, f64)) -> bool {
        px >= self.x && px <= self.x + self.largura && py >= self.y && py <= self.y + self.altura
    }
    fn area_em_comum(&self, outra: &Caixa) -> f64 {
        let l = (self.x + self.largura).min(outra.x + outra.largura) - self.x.max(outra.x);
        let a = (self.y + self.altura).min(outra.y + outra.altura) - self.y.max(outra.y);
        if l > 0.0 && a > 0.0 {
            l * a
        } else {
            0.0
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ElementoMarcado {
    pub papel: String,
    pub nome: String,
    pub seletor: String,
    pub tag: String,
    pub caixa: Caixa,
}

/// A região como a UI a desenhou: sobre a IMAGEM do quadro, com o tamanho dela.
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegiaoNoQuadro {
    pub x: f64,
    pub y: f64,
    pub largura: f64,
    pub altura: f64,
    pub quadro_largura: f64,
    pub quadro_altura: f64,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    pub largura: f64,
    pub altura: f64,
    #[serde(skip)]
    pub page_x: f64,
    #[serde(skip)]
    pub page_y: f64,
}

/// `Page.getLayoutMetrics` → viewport visível em pixels CSS e o scroll.
pub fn viewport_de(resposta: &Value) -> Option<Viewport> {
    let v = resposta.pointer("/result/cssVisualViewport")?;
    Some(Viewport {
        largura: v.get("clientWidth")?.as_f64()?,
        altura: v.get("clientHeight")?.as_f64()?,
        page_x: v.get("pageX").and_then(Value::as_f64).unwrap_or(0.0),
        page_y: v.get("pageY").and_then(Value::as_f64).unwrap_or(0.0),
    })
}

/// Região do quadro → pixels CSS da viewport, presa dentro dela.
pub fn regiao_css(r: &RegiaoNoQuadro, v: &Viewport) -> Option<Caixa> {
    if r.quadro_largura <= 0.0 || r.quadro_altura <= 0.0 {
        return None;
    }
    let ex = v.largura / r.quadro_largura;
    let ey = v.altura / r.quadro_altura;
    let x0 = (r.x * ex).clamp(0.0, v.largura);
    let y0 = (r.y * ey).clamp(0.0, v.altura);
    let x1 = ((r.x + r.largura) * ex).clamp(0.0, v.largura);
    let y1 = ((r.y + r.altura) * ey).clamp(0.0, v.altura);
    let caixa = Caixa { x: x0.min(x1), y: y0.min(y1), largura: (x1 - x0).abs(), altura: (y1 - y0).abs() };
    (caixa.largura >= MENOR_LADO && caixa.altura >= MENOR_LADO).then_some(caixa)
}

/// Onde perguntar "quem está aqui": o centro primeiro, depois uma grade 3×3.
pub fn pontos_de_amostra(c: &Caixa) -> Vec<(i64, i64)> {
    let mut pontos: Vec<(i64, i64)> = Vec::new();
    let (cx, cy) = c.centro();
    pontos.push((cx.round() as i64, cy.round() as i64));
    for fy in [1.0 / 6.0, 0.5, 5.0 / 6.0] {
        for fx in [1.0 / 6.0, 0.5, 5.0 / 6.0] {
            let p = ((c.x + c.largura * fx).round() as i64, (c.y + c.altura * fy).round() as i64);
            if !pontos.contains(&p) {
                pontos.push(p);
            }
        }
    }
    pontos
}

/// Resposta do `Runtime.callFunctionOn` com a função de descrever → elemento.
/// A raiz do documento (`html`, `body`) é fundo, não elemento marcado.
pub fn elemento_da_resposta(resposta: &Value) -> Option<ElementoMarcado> {
    let valor = resposta.pointer("/result/result/value")?;
    let elemento: ElementoMarcado = serde_json::from_value(valor.clone()).ok()?;
    (!matches!(elemento.tag.as_str(), "html" | "body")).then_some(elemento)
}

/// Sem repetição (pelo seletor), os que contêm o centro da marcação primeiro, do
/// mais específico (menor caixa) ao mais amplo; depois quem mais ocupa a região.
/// Um contêiner grande também contém o centro, mas não é o que foi marcado.
/// No máximo oito.
pub fn ordenar_elementos(elementos: Vec<ElementoMarcado>, regiao: &Caixa) -> Vec<ElementoMarcado> {
    let mut unicos: Vec<ElementoMarcado> = Vec::new();
    for e in elementos {
        if !unicos.iter().any(|u| u.seletor == e.seletor) {
            unicos.push(e);
        }
    }
    let centro = regiao.centro();
    let area = |c: &Caixa| c.largura * c.altura;
    unicos.sort_by(|a, b| {
        let (ca, cb) = (a.caixa.contem(centro), b.caixa.contem(centro));
        cb.cmp(&ca).then_with(|| {
            if ca && cb {
                area(&a.caixa).partial_cmp(&area(&b.caixa))
            } else {
                b.caixa.area_em_comum(regiao).partial_cmp(&a.caixa.area_em_comum(regiao))
            }
            .unwrap_or(std::cmp::Ordering::Equal)
        })
    });
    unicos.truncate(MAX_ELEMENTOS);
    unicos
}

/// O recorte: a região com margem, dentro da viewport.
pub fn recorte_com_margem(c: &Caixa, v: &Viewport) -> Caixa {
    let x0 = (c.x - MARGEM_DO_RECORTE).max(0.0);
    let y0 = (c.y - MARGEM_DO_RECORTE).max(0.0);
    let x1 = (c.x + c.largura + MARGEM_DO_RECORTE).min(v.largura);
    let y1 = (c.y + c.altura + MARGEM_DO_RECORTE).min(v.altura);
    Caixa { x: x0, y: y0, largura: x1 - x0, altura: y1 - y0 }
}

/// O texto que vai ao rascunho junto da imagem (ou sozinho, para motor sem imagem).
pub fn descricao_da_marcacao(
    titulo: &str,
    url: &str,
    v: &Viewport,
    regiao: &Caixa,
    elementos: &[ElementoMarcado],
) -> String {
    let pagina = if titulo.trim().is_empty() {
        url.to_string()
    } else {
        format!("\"{}\" ({url})", titulo.trim())
    };
    let mut linhas = vec![format!(
        "Marquei uma região na página {pagina}, viewport {}×{}: x {}, y {}, {}×{} px.",
        v.largura.round(),
        v.altura.round(),
        regiao.x.round(),
        regiao.y.round(),
        regiao.largura.round(),
        regiao.altura.round()
    )];
    if elementos.is_empty() {
        linhas.push("Nenhum elemento identificável na região.".into());
    } else {
        linhas.push("Elementos na região:".into());
        for e in elementos {
            let nome = if e.nome.is_empty() { String::new() } else { format!(" \"{}\"", e.nome) };
            linhas.push(format!("- {}{} · `{}`", e.papel, nome, e.seletor));
        }
    }
    linhas.join("\n")
}

/// Sessão CDP curta sobre o WebSocket da página: uma chamada por vez, casando a
/// resposta pelo id e ignorando eventos no meio.
struct SessaoCdp {
    socket: tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    proximo_id: u64,
}

impl SessaoCdp {
    async fn conectar(ws: &str) -> Result<Self, String> {
        let (socket, _) = timeout(PRAZO_POR_CHAMADA, tokio_tungstenite::connect_async(ws))
            .await
            .map_err(|_| "a página não abriu o canal a tempo".to_string())?
            .map_err(|e| format!("não consegui falar com a página: {e}"))?;
        Ok(Self { socket, proximo_id: 1 })
    }

    async fn chamar(&mut self, metodo: &str, params: Value) -> Result<Value, String> {
        let id = self.proximo_id;
        self.proximo_id += 1;
        let pedido = json!({ "id": id, "method": metodo, "params": params });
        timeout(PRAZO_POR_CHAMADA, async {
            self.socket
                .send(Message::Text(pedido.to_string().into()))
                .await
                .map_err(|e| format!("{metodo} não foi enviado: {e}"))?;
            loop {
                let msg = self
                    .socket
                    .next()
                    .await
                    .ok_or_else(|| format!("a página fechou o canal durante {metodo}"))?
                    .map_err(|e| format!("{metodo} interrompido: {e}"))?;
                let Message::Text(texto) = msg else { continue };
                let Ok(valor) = serde_json::from_str::<Value>(&texto) else { continue };
                if valor.get("id").and_then(Value::as_u64) == Some(id) {
                    if let Some(erro) = valor.get("error") {
                        return Err(format!("o navegador recusou {metodo}: {erro}"));
                    }
                    return Ok(valor);
                }
            }
        })
        .await
        .map_err(|_| format!("{metodo} excedeu o tempo limite"))?
    }

    async fn url_atual(&mut self) -> Result<String, String> {
        let r = self
            .chamar("Runtime.evaluate", json!({ "expression": "location.href", "returnByValue": true }))
            .await?;
        Ok(r.pointer("/result/result/value").and_then(Value::as_str).unwrap_or_default().to_string())
    }
}

pub struct Recorte {
    pub png: Vec<u8>,
    pub viewport: Viewport,
    pub regiao: Caixa,
    pub elementos: Vec<ElementoMarcado>,
}

/// O fluxo inteiro contra o WebSocket de uma página. Separado do comando para
/// rodar num teste com Chromium de verdade.
pub async fn marcar_na_pagina(ws: &str, regiao: &RegiaoNoQuadro) -> Result<Recorte, String> {
    let mut s = SessaoCdp::conectar(ws).await?;
    let url_antes = s.url_atual().await?;
    let viewport = viewport_de(&s.chamar("Page.getLayoutMetrics", json!({})).await?)
        .ok_or("o navegador não informou o tamanho da página")?;
    let css = regiao_css(regiao, &viewport).ok_or("marque uma região maior")?;
    s.chamar("DOM.getDocument", json!({ "depth": 0 })).await?;
    let mut achados = Vec::new();
    for (x, y) in pontos_de_amostra(&css) {
        let Ok(no) = s
            .chamar(
                "DOM.getNodeForLocation",
                json!({ "x": x, "y": y, "includeUserAgentShadowDOM": false, "ignorePointerEventsNone": true }),
            )
            .await
        else {
            continue;
        };
        let Some(backend) = no.pointer("/result/backendNodeId").and_then(Value::as_i64) else { continue };
        let Ok(resolvido) = s.chamar("DOM.resolveNode", json!({ "backendNodeId": backend })).await else {
            continue;
        };
        let Some(objeto) = resolvido.pointer("/result/object/objectId").and_then(Value::as_str) else {
            continue;
        };
        let descrito = s
            .chamar(
                "Runtime.callFunctionOn",
                json!({ "objectId": objeto, "functionDeclaration": DESCREVER, "returnByValue": true }),
            )
            .await;
        if let Some(e) = descrito.ok().as_ref().and_then(elemento_da_resposta) {
            achados.push(e);
        }
    }
    let elementos = ordenar_elementos(achados, &css);
    let traco = format!(
        "(() => {{ const d = document.createElement('div'); d.id = '{ID_DO_TRACO}'; \
         Object.assign(d.style, {{ position: 'fixed', left: '{}px', top: '{}px', width: '{}px', height: '{}px', \
         outline: '2px solid #e5484d', outlineOffset: '1px', pointerEvents: 'none', zIndex: '2147483647' }}); \
         document.documentElement.appendChild(d); }})()",
        css.x, css.y, css.largura, css.altura
    );
    let recorte = recorte_com_margem(&css, &viewport);
    s.chamar("Runtime.evaluate", json!({ "expression": traco })).await?;
    let captura = s
        .chamar(
            "Page.captureScreenshot",
            json!({
                "format": "png",
                "fromSurface": true,
                "captureBeyondViewport": false,
                "clip": {
                    "x": recorte.x + viewport.page_x,
                    "y": recorte.y + viewport.page_y,
                    "width": recorte.largura,
                    "height": recorte.altura,
                    "scale": 1
                }
            }),
        )
        .await;
    // O traço sai sempre, deu certo ou não.
    let _ = s
        .chamar(
            "Runtime.evaluate",
            json!({ "expression": format!("document.getElementById('{ID_DO_TRACO}')?.remove()") }),
        )
        .await;
    let png = crate::browser_capture::png_da_resposta(&captura?)?;
    if s.url_atual().await? != url_antes {
        return Err("a página mudou durante a marcação; marque de novo".into());
    }
    Ok(Recorte { png, viewport, regiao: css, elementos })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Marcacao {
    pub attachment: crate::attachments::Attachment,
    pub url: String,
    pub title: String,
    /// A região em pixels da página: o rascunho mostra o tamanho na pílula sem
    /// ter que reler a descrição.
    pub regiao: Caixa,
    pub descricao: String,
    pub elementos: Vec<ElementoMarcado>,
}

#[tauri::command]
pub async fn browser_marcar(
    app: tauri::AppHandle,
    project_path: String,
    target_id: String,
    conv_id: String,
    regiao: RegiaoNoQuadro,
    active: tauri::State<'_, crate::attachments::ActiveConvs>,
) -> Result<Marcacao, String> {
    let (_, page) = crate::browser_cdp::target_for(&app, &project_path, &target_id).await?;
    let ws = page.websocket_url.as_deref().ok_or("a página não publicou um canal")?;
    let recorte = marcar_na_pagina(ws, &regiao).await?;
    let url = crate::browser_cdp::sanitize_page_url(&page.url);
    let title: String = page.title.chars().take(240).collect();
    let nome = crate::browser_capture::nome_da_captura(&url).replacen("pagina", "marcacao", 1);
    let attachment = crate::attachments::save_to_disk(
        &app,
        &conv_id,
        &nome,
        Some("image/png".into()),
        &recorte.png,
        active.inner(),
    )?;
    let descricao = descricao_da_marcacao(&title, &url, &recorte.viewport, &recorte.regiao, &recorte.elementos);
    Ok(Marcacao { attachment, url, title, regiao: recorte.regiao, descricao, elementos: recorte.elementos })
}

#[cfg(test)]
mod tests {
    use super::*;

    const REAL: &str = include_str!("../testdata/chromium-cdp/marcacao.json");

    fn real() -> Value {
        serde_json::from_str(REAL).unwrap()
    }

    #[test]
    fn viewport_e_regiao_do_quadro_em_pixels_css() {
        let v = viewport_de(&real()["getLayoutMetrics"]).unwrap();
        assert_eq!((v.largura, v.altura), (1280.0, 800.0));
        // quadro de 640×400 (screencast reduzido): a região dobra em CSS
        let r = RegiaoNoQuadro { x: 100.0, y: 60.0, largura: 110.0, altura: 50.0, quadro_largura: 640.0, quadro_altura: 400.0 };
        assert_eq!(regiao_css(&r, &v), Some(Caixa { x: 200.0, y: 120.0, largura: 220.0, altura: 100.0 }));
        // arrastar para fora fica preso na viewport; clique vira nada
        let fora = RegiaoNoQuadro { x: 600.0, y: 380.0, largura: 200.0, altura: 200.0, quadro_largura: 640.0, quadro_altura: 400.0 };
        assert_eq!(regiao_css(&fora, &v), Some(Caixa { x: 1200.0, y: 760.0, largura: 80.0, altura: 40.0 }));
        let clique = RegiaoNoQuadro { x: 10.0, y: 10.0, largura: 1.0, altura: 1.0, quadro_largura: 640.0, quadro_altura: 400.0 };
        assert_eq!(regiao_css(&clique, &v), None);
    }

    #[test]
    fn marcar_o_botao_devolve_o_botao_pelo_centro_do_traco() {
        let botao = elemento_da_resposta(&real()["callFunctionOn_botao"]).unwrap();
        assert_eq!((botao.papel.as_str(), botao.nome.as_str()), ("button", "Finalizar pedido"));
        assert_eq!(botao.seletor, "body > main > form > button");
        // o ponto amostrado no centro do botão (do teste real) está dentro da caixa
        let ponto = real()["getNodeForLocation_botao"]["ponto"].clone();
        assert!(botao.caixa.contem((ponto[0].as_f64().unwrap(), ponto[1].as_f64().unwrap())));
        // região que pega o botão e sobra: o botão vem antes do título grande
        let regiao = Caixa { x: botao.caixa.x - 20.0, y: botao.caixa.y - 10.0, largura: botao.caixa.largura + 40.0, altura: botao.caixa.altura + 20.0 };
        let titulo = ElementoMarcado {
            papel: "heading".into(),
            nome: "Loja de teste".into(),
            seletor: "body > header > h1".into(),
            tag: "h1".into(),
            caixa: Caixa { x: 0.0, y: 0.0, largura: 1280.0, altura: 400.0 },
        };
        let ordem = ordenar_elementos(vec![titulo.clone(), botao.clone(), botao.clone()], &regiao);
        assert_eq!(ordem.iter().map(|e| e.seletor.as_str()).collect::<Vec<_>>(), vec![botao.seletor.as_str(), "body > header > h1"]);
    }

    #[test]
    fn fundo_da_pagina_nao_vira_elemento() {
        let fundo = json!({ "result": { "result": { "value": { "papel": "body", "nome": "", "seletor": "body", "tag": "body", "caixa": { "x": 0, "y": 0, "largura": 1280, "altura": 800 } } } } });
        assert!(elemento_da_resposta(&fundo).is_none());
        assert!(elemento_da_resposta(&json!({ "result": { "result": { "type": "object", "subtype": "null", "value": null } } })).is_none());
    }

    #[test]
    fn amostras_comecam_no_centro_e_recorte_respeita_a_viewport() {
        let c = Caixa { x: 10.0, y: 10.0, largura: 60.0, altura: 30.0 };
        let pontos = pontos_de_amostra(&c);
        assert_eq!(pontos[0], (40, 25));
        assert_eq!(pontos.len(), 9);
        let v = Viewport { largura: 1280.0, altura: 800.0, page_x: 0.0, page_y: 0.0 };
        assert_eq!(recorte_com_margem(&c, &v), Caixa { x: 0.0, y: 0.0, largura: 86.0, altura: 56.0 });
    }

    #[test]
    fn descricao_diz_pagina_viewport_regiao_e_elementos() {
        let botao = elemento_da_resposta(&real()["callFunctionOn_botao"]).unwrap();
        let v = Viewport { largura: 1280.0, altura: 800.0, page_x: 0.0, page_y: 0.0 };
        let regiao = Caixa { x: 230.0, y: 140.0, largura: 150.0, altura: 60.0 };
        assert_eq!(
            descricao_da_marcacao("Loja de teste", "http://localhost:3981/", &v, &regiao, &[botao]),
            "Marquei uma região na página \"Loja de teste\" (http://localhost:3981/), viewport 1280×800: x 230, y 140, 150×60 px.\nElementos na região:\n- button \"Finalizar pedido\" · `body > main > form > button`"
        );
        assert!(descricao_da_marcacao("", "http://x/", &v, &regiao, &[]).ends_with("Nenhum elemento identificável na região."));
    }

    /// Chromium de verdade: sobe a página de loja, marca o botão e confere o
    /// elemento, o PNG e que o traço saiu da página. `--ignored` (precisa do
    /// Chromium do Playwright nesta máquina).
    #[tokio::test]
    #[ignore = "sobe um Chromium real"]
    async fn marcacao_real_contra_chromium() {
        let bin = crate::browser::find_chromium().expect("Chromium");
        let dir = std::env::temp_dir().join(format!("frota-marcacao-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let pagina = "data:text/html,<body style='margin:0;font-family:sans-serif'><header style='padding:24px'><h1>Loja de teste</h1></header><main style='padding:24px'><form><label for='email'>E-mail</label> <input id='email'><button type='submit' style='margin-left:12px;padding:10px 18px'><span>Finalizar pedido</span></button></form></main></body>";
        let mut filho = std::process::Command::new(bin)
            .args(["--headless=new", "--remote-debugging-port=0", "--no-first-run", "--window-size=1280,800"])
            .arg(format!("--user-data-dir={}", dir.display()))
            .arg(pagina)
            .spawn()
            .unwrap();
        let mut porta = None;
        for _ in 0..50 {
            if let Ok(t) = std::fs::read_to_string(dir.join("DevToolsActivePort")) {
                porta = crate::browser::parse_active_port(&t);
                if porta.is_some() {
                    break;
                }
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        let porta = porta.expect("porta do DevTools");
        tokio::time::sleep(Duration::from_millis(800)).await;
        let lista: Value = reqwest::get(format!("http://127.0.0.1:{porta}/json/list")).await.unwrap().json().await.unwrap();
        let ws = lista.as_array().unwrap().iter().find(|p| p["type"] == "page").unwrap()["webSocketDebuggerUrl"].as_str().unwrap().to_string();
        let mut s = SessaoCdp::conectar(&ws).await.unwrap();
        let v = viewport_de(&s.chamar("Page.getLayoutMetrics", json!({})).await.unwrap()).unwrap();
        let caixa: Value = s
            .chamar("Runtime.evaluate", json!({ "expression": "JSON.stringify(document.querySelector('button').getBoundingClientRect())", "returnByValue": true }))
            .await
            .unwrap();
        let b: Value = serde_json::from_str(caixa.pointer("/result/result/value").unwrap().as_str().unwrap()).unwrap();
        // região no quadro = pixels CSS (quadro do mesmo tamanho da viewport)
        let regiao = RegiaoNoQuadro {
            x: b["x"].as_f64().unwrap() - 8.0,
            y: b["y"].as_f64().unwrap() - 8.0,
            largura: b["width"].as_f64().unwrap() + 16.0,
            altura: b["height"].as_f64().unwrap() + 16.0,
            quadro_largura: v.largura,
            quadro_altura: v.altura,
        };
        let recorte = marcar_na_pagina(&ws, &regiao).await.unwrap();
        let sobrou = s
            .chamar("Runtime.evaluate", json!({ "expression": format!("!!document.getElementById('{ID_DO_TRACO}')"), "returnByValue": true }))
            .await
            .unwrap();
        if let Ok(destino) = std::env::var("FROTA_MARCACAO_PNG") {
            std::fs::write(destino, &recorte.png).unwrap();
        }
        let _ = filho.kill();
        let _ = filho.wait();
        std::fs::remove_dir_all(&dir).ok();
        assert_eq!(recorte.elementos[0].papel, "button");
        assert_eq!(recorte.elementos[0].nome, "Finalizar pedido");
        assert!(recorte.png.starts_with(b"\x89PNG"));
        assert_eq!(sobrou.pointer("/result/result/value"), Some(&json!(false)), "o traço ficou na página");
        println!("elementos: {:?}", recorte.elementos.iter().map(|e| (&e.papel, &e.nome, &e.seletor)).collect::<Vec<_>>());
    }
}
