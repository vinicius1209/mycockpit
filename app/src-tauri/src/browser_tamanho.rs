//! O tamanho da página do navegador do projeto, com emulação de aparelho
//! completa (ADR-285): viewport, escala de tela, `mobile`, orientação, toque e
//! user agent, e não só a janela menor.
//!
//! Medido no Chrome for Testing 153 (sonda de 29/09/2026): a emulação pedida
//! por uma sessão CDP vale para as outras (a captura do agente sai no tamanho
//! emulado), mas só enquanto aquela sessão está aberta. Ao fechar, user agent,
//! toque e escala voltam; o tamanho da página, não. Por isso cada página
//! emulada tem uma sessão própria que fica viva, e voltar ao padrão limpa a
//! emulação explicitamente antes de fechar.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::tungstenite::Message;

/// Os tamanhos do seletor: id, largura, altura, celular (toque, user agent
/// móvel, `mobile`), escala de tela.
const PRESETS: [(&str, u32, u32, bool, f64); 5] = [
    ("celular", 390, 844, true, 3.0),
    ("celular-grande", 430, 932, true, 3.0),
    ("tablet", 820, 1180, true, 2.0),
    ("notebook", 1280, 800, false, 1.0),
    ("desktop", 1440, 900, false, 1.0),
];
pub const PERSONALIZADO: &str = "personalizado";
const LADO_MIN: u32 = 200;
const LADO_MAX: u32 = 3840;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tamanho {
    pub preset: String,
    pub largura: u32,
    pub altura: u32,
    pub celular: bool,
    #[serde(default)]
    pub girado: bool,
}

impl Tamanho {
    /// O de sempre (ADR-229): notebook, sem emulação, a própria janela.
    pub fn padrao() -> Self {
        Self { preset: "notebook".into(), largura: 1280, altura: 800, celular: false, girado: false }
    }

    pub fn e_padrao(&self) -> bool {
        *self == Self::padrao()
    }

    /// Largura e altura da página, já giradas.
    pub fn efetivo(&self) -> (u32, u32) {
        if self.girado { (self.altura, self.largura) } else { (self.largura, self.altura) }
    }

    fn escala(&self) -> f64 {
        PRESETS
            .iter()
            .find(|p| p.0 == self.preset)
            .map(|p| p.4)
            .unwrap_or(if self.celular { 3.0 } else { 1.0 })
    }

    /// O tablet se apresenta sem "Mobile" no user agent, como o Chrome de
    /// tablet faz; o resto do modo celular é igual.
    fn e_tablet(&self) -> bool {
        self.preset == "tablet"
    }

    /// Confere e completa o que veio de fora (tela ou agente). Preset
    /// conhecido usa as medidas da tabela; o personalizado exige medidas
    /// plausíveis. Puro.
    pub fn normalizado(self) -> Result<Tamanho, String> {
        if let Some(p) = PRESETS.iter().find(|p| p.0 == self.preset) {
            return Ok(Tamanho { preset: p.0.into(), largura: p.1, altura: p.2, celular: p.3, girado: self.girado });
        }
        if self.preset != PERSONALIZADO {
            let ids: Vec<&str> = PRESETS.iter().map(|p| p.0).collect();
            return Err(format!("tamanho desconhecido; use {} ou {PERSONALIZADO}", ids.join(", ")));
        }
        for lado in [self.largura, self.altura] {
            if !(LADO_MIN..=LADO_MAX).contains(&lado) {
                return Err(format!("cada lado vai de {LADO_MIN} a {LADO_MAX} pixels"));
            }
        }
        Ok(self)
    }
}

/// O user agent do Chrome móvel na versão do Chromium que está rodando, no
/// formato reduzido que o Chrome de verdade manda ("Chrome/153.0.0.0"). Puro.
pub fn user_agent_movel(produto: &str, tablet: bool) -> String {
    let versao = produto.split('/').nth(1).and_then(|v| v.split('.').next()).unwrap_or("153");
    let movel = if tablet { "" } else { " Mobile" };
    format!(
        "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{versao}.0.0.0{movel} Safari/537.36"
    )
}

/// Os comandos CDP que põem a página no tamanho. `produto` é o do
/// `Browser.getVersion` ("Chrome/153.0.8010.12"). Puro.
pub fn comandos(t: &Tamanho, produto: &str) -> Vec<Value> {
    let (largura, altura) = t.efetivo();
    let (tipo, angulo) = match (t.celular, t.girado) {
        (true, false) => ("portraitPrimary", 0),
        (true, true) => ("landscapePrimary", 90),
        (false, false) => ("landscapePrimary", 0),
        (false, true) => ("portraitPrimary", 90),
    };
    let mut lista = vec![
        json!({"method": "Emulation.setDeviceMetricsOverride", "params": {
            "width": largura, "height": altura, "deviceScaleFactor": t.escala(), "mobile": t.celular,
            "screenOrientation": {"type": tipo, "angle": angulo}
        }}),
        json!({"method": "Emulation.setTouchEmulationEnabled", "params": {"enabled": t.celular, "maxTouchPoints": if t.celular { 5 } else { 1 }}}),
    ];
    if t.celular {
        let versao = produto.split('/').nth(1).and_then(|v| v.split('.').next()).unwrap_or("153");
        lista.push(json!({"method": "Emulation.setUserAgentOverride", "params": {
            "userAgent": user_agent_movel(produto, t.e_tablet()),
            "platform": "Linux armv8l",
            "userAgentMetadata": {
                "brands": [{"brand": "Chromium", "version": versao}, {"brand": "Not.A/Brand", "version": "99"}],
                "platform": "Android", "platformVersion": "10", "architecture": "", "model": "K",
                "mobile": !t.e_tablet()
            }
        }}));
    }
    lista
}

/// Volta ao padrão antes de fechar a sessão: fechar sozinho deixaria o
/// tamanho preso (medido). Puro.
pub fn comandos_de_limpeza() -> Vec<Value> {
    vec![
        json!({"method": "Emulation.clearDeviceMetricsOverride", "params": {}}),
        json!({"method": "Emulation.setTouchEmulationEnabled", "params": {"enabled": false}}),
    ]
}

// ------------------------------------------------------------ persistência ---

pub fn ler(app: &tauri::AppHandle, project_id: &str) -> Tamanho {
    if let Some(t) = cache().lock().ok().and_then(|c| c.get(project_id).cloned()) {
        return t;
    }
    let lido = crate::mcp_control::db(app)
        .ok()
        .and_then(|conn| {
            conn.query_row("SELECT tamanho FROM browser_viewport WHERE project_id = ?1", [project_id], |r| {
                r.get::<_, String>(0)
            })
            .ok()
        })
        .and_then(|json| serde_json::from_str::<Tamanho>(&json).ok())
        .and_then(|t| t.normalizado().ok())
        .unwrap_or_else(Tamanho::padrao);
    if let Ok(mut c) = cache().lock() {
        c.insert(project_id.to_string(), lido.clone());
    }
    lido
}

fn gravar(app: &tauri::AppHandle, project_id: &str, t: &Tamanho) -> Result<(), String> {
    let conn = crate::mcp_control::db(app)?;
    let agora = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    let json = serde_json::to_string(t).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO browser_viewport (project_id, tamanho, updated_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![project_id, json, agora],
    )
    .map_err(|e| e.to_string())?;
    if let Ok(mut c) = cache().lock() {
        c.insert(project_id.to_string(), t.clone());
    }
    Ok(())
}

fn cache() -> &'static Mutex<HashMap<String, Tamanho>> {
    static C: OnceLock<Mutex<HashMap<String, Tamanho>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

/// O clique vira toque neste projeto? (modo celular, humano e agente.)
pub fn toque(app: &tauri::AppHandle, project_id: &str) -> bool {
    ler(app, project_id).celular
}

// ------------------------------------------------------ sessões de emulação ---

struct Emulando {
    tamanho: Tamanho,
    parar: tokio::sync::watch::Sender<bool>,
    geracao: u64,
}

fn emuladores() -> &'static Mutex<HashMap<String, Emulando>> {
    static E: OnceLock<Mutex<HashMap<String, Emulando>>> = OnceLock::new();
    E.get_or_init(Default::default)
}

fn proxima_geracao() -> u64 {
    static G: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    G.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1
}

/// Deixa a página no tamanho do projeto. Barato quando já está: é uma busca
/// no mapa. No padrão, encerra a emulação que houver.
pub async fn garantir(app: &tauri::AppHandle, project_id: &str, page: &crate::browser_cdp::RawPage) {
    let Some(ws) = page.websocket_url.clone() else { return };
    let alvo = ler(app, project_id);
    let (receptor, geracao) = {
        let Ok(mut mapa) = emuladores().lock() else { return };
        if let Some(atual) = mapa.get(&page.id) {
            if atual.tamanho == alvo && !atual.parar.is_closed() {
                return;
            }
            let _ = atual.parar.send(true);
            mapa.remove(&page.id);
        }
        if alvo.e_padrao() {
            return;
        }
        let (parar, receptor) = tokio::sync::watch::channel(false);
        let geracao = proxima_geracao();
        mapa.insert(page.id.clone(), Emulando { tamanho: alvo.clone(), parar, geracao });
        (receptor, geracao)
    };
    let (pronto_tx, pronto_rx) = tokio::sync::oneshot::channel();
    let id = page.id.clone();
    tauri::async_runtime::spawn(async move {
        if let Err(erro) = manter(&ws, &alvo, receptor, pronto_tx).await {
            eprintln!("[navegador] emulação da página {id} caiu: {erro}");
        }
        if let Ok(mut mapa) = emuladores().lock() {
            if mapa.get(&id).is_some_and(|e| e.geracao == geracao) {
                mapa.remove(&id);
            }
        }
    });
    // Quem chamou (a ação do agente, a primeira vista) age já no tamanho certo.
    let _ = tokio::time::timeout(std::time::Duration::from_secs(5), pronto_rx).await;
}

async fn chamar(
    socket: &mut tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    id: u64,
    comando: &Value,
) -> Result<Value, String> {
    let mut pedido = comando.clone();
    pedido["id"] = json!(id);
    socket.send(Message::Text(pedido.to_string().into())).await.map_err(|e| e.to_string())?;
    loop {
        let msg = socket.next().await.ok_or("a página fechou")?.map_err(|e| e.to_string())?;
        let Message::Text(texto) = msg else { continue };
        let Ok(valor) = serde_json::from_str::<Value>(&texto) else { continue };
        if valor.get("id").and_then(Value::as_u64) != Some(id) {
            continue;
        }
        if let Some(erro) = valor.get("error") {
            return Err(format!("{}: {erro}", comando["method"]));
        }
        return Ok(valor);
    }
}

async fn manter(
    ws: &str,
    tamanho: &Tamanho,
    mut parar: tokio::sync::watch::Receiver<bool>,
    pronto: tokio::sync::oneshot::Sender<()>,
) -> Result<(), String> {
    let (mut socket, _) = tokio::time::timeout(std::time::Duration::from_secs(5), tokio_tungstenite::connect_async(ws))
        .await
        .map_err(|_| "a página não respondeu".to_string())?
        .map_err(|e| e.to_string())?;
    let versao = chamar(&mut socket, 1, &json!({"method": "Browser.getVersion", "params": {}})).await?;
    let produto = versao.pointer("/result/product").and_then(Value::as_str).unwrap_or("Chrome/153").to_string();
    for (i, comando) in comandos(tamanho, &produto).iter().enumerate() {
        chamar(&mut socket, 10 + i as u64, comando).await?;
    }
    let _ = pronto.send(());
    loop {
        tokio::select! {
            mudou = parar.changed() => {
                if mudou.is_err() || *parar.borrow() {
                    for (i, comando) in comandos_de_limpeza().iter().enumerate() {
                        let _ = tokio::time::timeout(std::time::Duration::from_secs(2), chamar(&mut socket, 100 + i as u64, comando)).await;
                    }
                    let _ = socket.close(None).await;
                    return Ok(());
                }
            }
            msg = socket.next() => {
                // Eventos não pedidos são ignorados; fim do canal é a página fechada.
                match msg {
                    None | Some(Err(_)) => return Ok(()),
                    Some(Ok(Message::Close(_))) => return Ok(()),
                    Some(Ok(_)) => {}
                }
            }
        }
    }
}

/// Muda o tamanho do projeto: grava, aplica em todas as páginas abertas e
/// avisa a tela. Devolve o tamanho normalizado.
pub async fn definir(app: &tauri::AppHandle, project_path: &str, tamanho: Tamanho) -> Result<Tamanho, String> {
    let tamanho = tamanho.normalizado()?;
    let project_id = crate::browser::project_id_of(app, project_path)?;
    gravar(app, &project_id, &tamanho)?;
    if crate::browser::live_endpoint(app, &project_id).await.is_some() {
        if let Ok(abas) = crate::browser_cdp::abas_do_projeto(app, project_path).await {
            for aba in &abas {
                garantir(app, &project_id, aba).await;
            }
        }
        if tamanho.e_padrao() {
            crate::browser_janela::ajustar_no_projeto(app, project_path).await;
        }
    }
    use tauri::Emitter;
    let _ = app.emit("browser://tamanho", json!({ "projectPath": project_path, "tamanho": tamanho }));
    Ok(tamanho)
}

/// A ferramenta `browser_resize` do agente (D9 do lote 2): mesma porta da
/// tela, então a pessoa vê a troca no seletor e no fio.
pub async fn pelo_agente(app: &tauri::AppHandle, project_path: &str, args: &Value) -> Result<Value, String> {
    let preset = args.get("tamanho").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if preset.is_empty() {
        return Err("tamanho ausente".into());
    }
    let lado = |k: &str| args.get(k).and_then(Value::as_u64).unwrap_or(0) as u32;
    let pedido = Tamanho {
        preset,
        largura: lado("largura"),
        altura: lado("altura"),
        celular: args.get("celular").and_then(Value::as_bool).unwrap_or(false),
        girado: args.get("girado").and_then(Value::as_bool).unwrap_or(false),
    };
    let t = definir(app, project_path, pedido).await?;
    let (w, h) = t.efetivo();
    Ok(json!({
        "ok": true,
        "tamanho": t,
        "pagina": format!("{w}×{h}"),
        "dica": if t.celular {
            "Página em modo celular: toque, user agent móvel e escala de tela. O clique vira toque. Capture para conferir o layout."
        } else {
            "Página no tamanho pedido. Capture para conferir o layout."
        }
    }))
}

#[tauri::command]
pub fn browser_tamanho(app: tauri::AppHandle, project_path: String) -> Result<Tamanho, String> {
    let project_id = crate::browser::project_id_of(&app, &project_path)?;
    Ok(ler(&app, &project_id))
}

#[tauri::command]
pub async fn set_browser_tamanho(app: tauri::AppHandle, project_path: String, tamanho: Tamanho) -> Result<Tamanho, String> {
    definir(&app, &project_path, tamanho).await
}

#[cfg(test)]
#[path = "browser_tamanho_tests.rs"]
mod tests;
