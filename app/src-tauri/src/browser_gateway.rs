//! `frota-browser`: o navegador da Frota chega a QUALQUER motor que fale MCP
//! (ADR-224 §1), no molde do `frota-work` (ADR-173): mesmo binário como MCP
//! stdio, mesmo socket do run (`FROTA_WORK_SOCK`), identidade do run herdada
//! pelo processo. O que o Playwright MCP não consegue, este consegue: com o
//! navegador DESLIGADO a tool não some nem falha em silêncio; responde
//! "desligado", pede o gesto à pessoa (`browser_needed` no canal de trabalho)
//! e a próxima chamada funciona depois que ela liga. A decisão continua
//! humana; o agente ganha o direito de pedir.
//!
//! Tudo aqui é em cima do que a barra humana já faz (`browser_cdp`,
//! `browser_capture`), mais código e arquivo (`browser_script`). Clique, teclado e navegação exigem a lease de piloto
//! (ADR-131), tomada no PRIMEIRO input e segurada até o fim do run; observar
//! (status, snapshot, captura) não.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

pub const MCP_SERVER_NAME: &str = "frota-browser";
pub const SUBCOMANDO: &str = "browser-server";
pub const STATUS_TOOL: &str = "browser_status";
pub const NAVIGATE_TOOL: &str = "browser_navigate";
pub const SNAPSHOT_TOOL: &str = "browser_snapshot";
pub const CAPTURE_TOOL: &str = "browser_capture";
pub const CLICK_TOOL: &str = "browser_click";
pub const TYPE_TOOL: &str = "browser_type";
pub const KEY_TOOL: &str = "browser_key";
/// Roda JavaScript na página e devolve o valor (correção de 22/09/2026: sem
/// isto o agente ia ao Playwright de terceiro, ver `browser_script.rs`).
pub const EVALUATE_TOOL: &str = "browser_evaluate";
/// Coloca arquivos do projeto ou da pasta temporária num `<input type=file>`.
pub const UPLOAD_TOOL: &str = "browser_upload";
/// Abas (ADR-231). Antes o agente não sabia que elas existiam: agia na
/// primeira que o Chromium listava, e link com `target=_blank` a trocava por
/// baixo dele (a aba nova passa a ser a primeira da lista).
pub const TABS_TOOL: &str = "browser_tabs";
pub const TAB_SELECT_TOOL: &str = "browser_tab_select";
pub const TAB_NEW_TOOL: &str = "browser_tab_new";
pub const TAB_CLOSE_TOOL: &str = "browser_tab_close";

/// Texto da página que vai ao modelo por chamada. Página inteira é contexto
/// que ninguém pediu; quem quer mais, pede de novo com `offset`.
const SNAPSHOT_CHARS: usize = 20_000;
/// Um pedido de "liga o navegador" por run a cada tanto: o agente insiste, a
/// pessoa não precisa ver a mesma pergunta dez vezes.
const PEDIDO_INTERVALO_MS: i64 = 30_000;

pub fn is_browser_tool(name: &str) -> bool {
    matches!(
        name,
        STATUS_TOOL
            | NAVIGATE_TOOL
            | SNAPSHOT_TOOL
            | CAPTURE_TOOL
            | CLICK_TOOL
            | TYPE_TOOL
            | KEY_TOOL
            | EVALUATE_TOOL
            | UPLOAD_TOOL
            | TABS_TOOL
            | TAB_SELECT_TOOL
            | TAB_NEW_TOOL
            | TAB_CLOSE_TOOL
    )
}

/// Executar código e enviar arquivo são efeito além do input: só em modo que
/// age (`processes_allowed`), como os processos gerenciados.
pub fn is_effect_tool(name: &str) -> bool {
    matches!(name, EVALUATE_TOOL | UPLOAD_TOOL)
}

pub const TOOLS: [&str; 13] = [
    STATUS_TOOL, NAVIGATE_TOOL, SNAPSHOT_TOOL, CAPTURE_TOOL, CLICK_TOOL, TYPE_TOOL, KEY_TOOL,
    EVALUATE_TOOL, UPLOAD_TOOL, TABS_TOOL, TAB_SELECT_TOOL, TAB_NEW_TOOL, TAB_CLOSE_TOOL,
];

/// O que o motor recebe para subir o MCP. Mesmo socket do `frota-work`: a
/// identidade do run já mora nele.
#[derive(Clone, Debug)]
pub struct GatewayConfig {
    pub server_bin: String,
    pub socket: String,
}

impl GatewayConfig {
    pub fn claude_server_json(&self) -> Value {
        json!({
            "type": "stdio",
            "command": self.server_bin,
            "args": [SUBCOMANDO],
            "env": { crate::work_gateway::SOCK_ENV: self.socket }
        })
    }

    pub fn configure_codex(&self, cmd: &mut Command) {
        let key = format!("mcp_servers.{MCP_SERVER_NAME}");
        let quote = |value: &str| serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into());
        cmd.arg("-c")
            .arg(format!("{key}.enabled=true"))
            .arg("-c")
            .arg(format!("{key}.command={}", quote(&self.server_bin)))
            .arg("-c")
            .arg(format!("{key}.args=[\"{SUBCOMANDO}\"]"))
            .arg("-c")
            .arg(format!(
                "{key}.env.{}={}",
                crate::work_gateway::SOCK_ENV,
                quote(&self.socket)
            ));
    }
}

/// Estado do navegador por run: a lease de piloto, o relógio do pedido e a
/// aba em que o agente está (ADR-231).
#[derive(Default)]
pub struct BrowserGateway {
    lease: Mutex<Option<crate::experience_broker::BrowserPilotLease>>,
    ultimo_pedido_ms: Mutex<i64>,
    /// A aba do agente neste run. Só muda por gesto dele (selecionar, abrir,
    /// fechar) ou quando ela some.
    aba: Mutex<Option<String>>,
    /// Abas que o agente já viu: a diferença é o que ele precisa saber que
    /// abriu.
    conhecidas: Mutex<std::collections::HashSet<String>>,
}

impl BrowserGateway {
    /// A aba do agente entre as abertas: a fixada, se ainda existe; senão a
    /// primeira, que passa a ser a dele.
    fn fixar(&self, abas: &[crate::browser_cdp::RawPage]) -> Option<crate::browser_cdp::RawPage> {
        let mut aba = self.aba.lock().ok()?;
        let escolhida = escolher_aba(abas, aba.as_deref())?;
        *aba = Some(abas[escolhida].id.clone());
        Some(abas[escolhida].clone())
    }

    fn trocar(&self, id: &str) {
        if let Ok(mut aba) = self.aba.lock() {
            *aba = Some(id.to_string());
        }
    }

    fn aba_atual(&self) -> Option<String> {
        self.aba.lock().ok().and_then(|a| a.clone())
    }

    /// Anota as abas vistas e devolve as que apareceram desde a última vez.
    /// Na primeira vez nada é "novo": é o navegador como o agente o encontrou.
    fn registrar(&self, abas: &[crate::browser_cdp::RawPage]) -> Vec<crate::browser_cdp::RawPage> {
        let Ok(mut conhecidas) = self.conhecidas.lock() else {
            return Vec::new();
        };
        let primeira_vez = conhecidas.is_empty();
        let novas = abas
            .iter()
            .filter(|p| conhecidas.insert(p.id.clone()) && !primeira_vez)
            .cloned()
            .collect();
        novas
    }
}

/// Índice da aba do agente: a fixada, se ainda existe; senão a primeira. Puro.
fn escolher_aba(abas: &[crate::browser_cdp::RawPage], fixada: Option<&str>) -> Option<usize> {
    if abas.is_empty() {
        return None;
    }
    Some(fixada.and_then(|id| abas.iter().position(|p| p.id == id)).unwrap_or(0))
}

fn aba_json(page: &crate::browser_cdp::RawPage, cwd: &str) -> Value {
    json!({
        "id": page.id,
        "title": page.title.chars().take(240).collect::<String>(),
        "url": crate::browser_cdp::sanitize_page_url_no_projeto(&page.url, Some(Path::new(cwd))),
    })
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|t| t.as_millis() as i64)
        .unwrap_or(0)
}

struct Alvo {
    project_id: String,
    page: crate::browser_cdp::RawPage,
    abas: Vec<crate::browser_cdp::RawPage>,
    /// Abas que surgiram desde a última ação do agente.
    novas: Vec<crate::browser_cdp::RawPage>,
}

const RECUSA: &str = "A pessoa preferiu não ligar o navegador do projeto agora. Siga sem ele, ou diga o que queria verificar e peça que ela confira.";

/// Quanto a tool espera o gesto da pessoa antes de desistir (ADR-228).
const ESPERA_PELO_GESTO: std::time::Duration = std::time::Duration::from_secs(90);

/// Projetos em que a pessoa fechou o aviso sem ligar, e quando. A espera de
/// cada chamada só olha recusa feita DEPOIS que ela começou a esperar.
fn recusas() -> &'static Mutex<std::collections::HashMap<String, i64>> {
    static R: std::sync::OnceLock<Mutex<std::collections::HashMap<String, i64>>> = std::sync::OnceLock::new();
    R.get_or_init(Default::default)
}

fn recusado_desde(project_path: &str, desde: i64) -> bool {
    recusas()
        .lock()
        .ok()
        .and_then(|r| r.get(project_path).copied())
        .is_some_and(|quando| quando >= desde)
}

/// A pessoa fechou o aviso de "ligar o navegador" sem ligar: quem espera o
/// gesto para agora, com uma resposta honesta, em vez de esgotar os 90 s.
#[tauri::command]
pub fn browser_pedido_recusado(project_path: String) {
    if let Ok(mut r) = recusas().lock() {
        r.insert(project_path, now_ms());
    }
}

/// A página ativa do navegador do projeto, ou o motivo de não haver uma.
///
/// Navegador desligado (ADR-228, corrige o ADR-224 §1): se a pessoa
/// autorizou o agente a ligar o navegador deste projeto, ele liga e a tela é
/// avisada. Senão, pede o gesto e ESPERA até 90 s: liga → segue no mesmo
/// turno; a pessoa fecha o aviso → responde na hora que ela preferiu não
/// ligar. Antes a tool voltava com erro em ~160 ms e o aviso prometia "o
/// agente tenta de novo sozinho", o que nada fazia (sicredi, 23/09/2026: a
/// pessoa ligou e teve de escrever "tente novamente").
async fn alvo(
    app: &tauri::AppHandle,
    gateway: &BrowserGateway,
    run_id: &str,
    conv_id: &str,
    cwd: &str,
) -> Result<Alvo, String> {
    let project_id = crate::browser::project_id_of(app, cwd)?;
    if crate::browser::live_endpoint(app, &project_id).await.is_none() {
        let agora = now_ms();
        if crate::browser_autorizacao::pode_ligar(app, &project_id) {
            crate::browser::browser_start(app.clone(), cwd.to_string(), Some(false)).await?;
            crate::work_gateway::emit_work(
                app,
                "browser_autostarted",
                json!({ "runId": run_id, "convId": conv_id, "projectPath": cwd }),
            );
        } else {
            // Recusa recente vale como resposta: o agente que insiste não
            // reabre o aviso que a pessoa acabou de fechar.
            if recusado_desde(cwd, agora - PEDIDO_INTERVALO_MS) {
                return Err(RECUSA.into());
            }
            // Sem limite de frequência aqui: o aviso tem id por projeto, então
            // o mesmo pedido nunca aparece duas vezes, e quem espera sempre
            // tem um aviso na tela.
            if let Ok(mut t) = gateway.ultimo_pedido_ms.lock() {
                *t = agora;
            }
            crate::work_gateway::emit_work(
                app,
                "browser_needed",
                json!({ "runId": run_id, "convId": conv_id, "projectPath": cwd }),
            );
            esperar_o_gesto(app, &project_id, cwd, agora).await?;
        }
    }
    // Só as páginas desta conversa (ADR-244), e o run começa na última em que
    // ela trabalhou, não na primeira do navegador.
    let abas = crate::browser_donos::paginas_da_conversa(app, cwd, conv_id).await?;
    if gateway.aba_atual().is_none() {
        if let Some(ultima) = crate::browser_donos::com(|d| d.ultima(conv_id)) {
            gateway.trocar(&ultima);
        }
    }
    let page = gateway
        .fixar(&abas)
        .ok_or("o navegador está ligado mas não tem nenhuma aba aberta")?;
    crate::browser_donos::com(|d| d.usar(conv_id, &page.id));
    let novas = gateway.registrar(&abas);
    Ok(Alvo { project_id, page, abas, novas })
}

/// Espera a pessoa ligar o navegador (ou recusar), com teto.
async fn esperar_o_gesto(
    app: &tauri::AppHandle,
    project_id: &str,
    cwd: &str,
    desde: i64,
) -> Result<(), String> {
    let limite = tokio::time::Instant::now() + ESPERA_PELO_GESTO;
    loop {
        if crate::browser::live_endpoint(app, project_id).await.is_some() {
            return Ok(());
        }
        if recusado_desde(cwd, desde) {
            return Err(RECUSA.into());
        }
        if tokio::time::Instant::now() >= limite {
            return Err("O navegador do projeto continua desligado: pedi à pessoa para ligá-lo e esperei 90 s sem resposta. Siga com outra parte do trabalho e diga o que falta verificar no navegador.".into());
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
}

/// Input pede a lease de piloto. Tomada uma vez por run; se a pessoa está
/// pilotando, o agente espera, não disputa (ADR-131).
fn assegurar_lease(
    app: &tauri::AppHandle,
    gateway: &BrowserGateway,
    project_id: &str,
    run_id: &str,
) -> Result<(), String> {
    use tauri::Manager;
    let mut lease = gateway.lease.lock().map_err(|_| "lease indisponível".to_string())?;
    if lease.is_some() {
        return Ok(());
    }
    let broker = app.state::<Arc<crate::experience_broker::ExperienceBroker>>();
    match broker.acquire_agent(project_id, run_id) {
        Ok(nova) => {
            *lease = Some(nova);
            Ok(())
        }
        Err(_) => Err("A pessoa está pilotando o navegador agora. Só observe (snapshot, captura) ou tente de novo quando ela soltar o controle.".into()),
    }
}

fn websocket(page: &crate::browser_cdp::RawPage) -> Result<&str, String> {
    page.websocket_url
        .as_deref()
        .ok_or_else(|| "a página não publicou um canal de pilotagem".to_string())
}

fn status_json(alvo: &Alvo, cwd: &str) -> Value {
    json!({
        "ligado": true,
        "url": crate::browser_cdp::sanitize_page_url_no_projeto(&alvo.page.url, Some(Path::new(cwd))),
        "title": alvo.page.title.chars().take(240).collect::<String>(),
    })
}

/// Trata uma ação do `frota-browser` vinda pelo socket do run.
pub async fn handle(
    app: &tauri::AppHandle,
    gateway: &BrowserGateway,
    run_id: &str,
    conv_id: &str,
    cwd: &str,
    effects_allowed: bool,
    action: &str,
    args: &Value,
) -> Result<Value, String> {
    if is_effect_tool(action) && !effects_allowed {
        return Err("executar código e enviar arquivo não estão disponíveis neste modo de permissão".into());
    }
    if action == STATUS_TOOL {
        let project_id = crate::browser::project_id_of(app, cwd)?;
        if crate::browser::live_endpoint(app, &project_id).await.is_none() {
            return Ok(json!({ "ligado": false, "dica": "Navegue ou peça um snapshot para a Frota pedir à pessoa que ligue o navegador." }));
        }
        let alvo = alvo(app, gateway, run_id, conv_id, cwd).await?;
        return Ok(status_json(&alvo, cwd));
    }
    let alvo = alvo(app, gateway, run_id, conv_id, cwd).await?;
    let ws = websocket(&alvo.page)?;
    let resultado: Result<Value, String> = match action {
        SNAPSHOT_TOOL => {
            let offset = args.get("offset").and_then(Value::as_u64).unwrap_or(0) as usize;
            let texto = crate::browser_cdp::avaliar(
                ws,
                "(() => { const b = document.body; return { url: location.href, title: document.title, text: b ? b.innerText : '' } })()",
            )
            .await?;
            let inteiro = texto.get("text").and_then(Value::as_str).unwrap_or("");
            let chars: Vec<char> = inteiro.chars().collect();
            let fim = (offset + SNAPSHOT_CHARS).min(chars.len());
            let trecho: String = chars.get(offset.min(chars.len())..fim).unwrap_or(&[]).iter().collect();
            Ok(json!({
                "url": crate::browser_cdp::sanitize_page_url_no_projeto(&alvo.page.url, Some(Path::new(cwd))),
                "title": texto.get("title").cloned().unwrap_or(Value::Null),
                "text": trecho,
                "offset": offset,
                "total_chars": chars.len(),
                "truncated": fim < chars.len(),
            }))
        }
        CAPTURE_TOOL => {
            let png = crate::browser_capture::capturar_png(ws).await?;
            let path = arquivo_temporario(app, conv_id, &png)?;
            let mut status = status_json(&alvo, cwd);
            status["png_path"] = json!(path.to_string_lossy());
            Ok(status)
        }
        NAVIGATE_TOOL => {
            let url = args.get("url").and_then(Value::as_str).unwrap_or("").trim();
            if url.is_empty() {
                return Err("url ausente".into());
            }
            assegurar_lease(app, gateway, &alvo.project_id, run_id)?;
            let destino = crate::browser_cdp::politica_da_barra(url, Path::new(cwd))?;
            crate::browser_cdp::pilotar(ws, vec![json!({
                "id": 1, "method": "Page.navigate", "params": {"url": destino}
            })])
            .await?;
            Ok(json!({ "ok": true, "url": crate::browser_cdp::sanitize_page_url_no_projeto(&destino, Some(Path::new(cwd))) }))
        }
        CLICK_TOOL => {
            let x = args.get("x").and_then(Value::as_f64).ok_or("x ausente")?;
            let y = args.get("y").and_then(Value::as_f64).ok_or("y ausente")?;
            assegurar_lease(app, gateway, &alvo.project_id, run_id)?;
            crate::browser_cdp::pilotar(ws, crate::browser_cdp::comandos_de_input(
                crate::browser_cdp::BrowserInputAction::Click { x, y },
                Path::new(cwd),
            )?)
            .await?;
            Ok(json!({ "ok": true }))
        }
        TYPE_TOOL => {
            let text = args.get("text").and_then(Value::as_str).unwrap_or("");
            if text.is_empty() {
                return Err("text ausente".into());
            }
            assegurar_lease(app, gateway, &alvo.project_id, run_id)?;
            crate::browser_cdp::pilotar(ws, crate::browser_cdp::comandos_de_input(
                crate::browser_cdp::BrowserInputAction::Text { text: text.into() },
                Path::new(cwd),
            )?)
            .await?;
            Ok(json!({ "ok": true }))
        }
        KEY_TOOL => {
            let key = args.get("key").and_then(Value::as_str).unwrap_or("").to_string();
            let code = args
                .get("code")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| key.clone());
            if key.is_empty() {
                return Err("key ausente".into());
            }
            assegurar_lease(app, gateway, &alvo.project_id, run_id)?;
            crate::browser_cdp::pilotar(ws, crate::browser_cdp::comandos_de_input(
                crate::browser_cdp::BrowserInputAction::Key { key, code },
                Path::new(cwd),
            )?)
            .await?;
            Ok(json!({ "ok": true }))
        }
        EVALUATE_TOOL => {
            let expressao = args.get("expression").and_then(Value::as_str).unwrap_or("");
            assegurar_lease(app, gateway, &alvo.project_id, run_id)?;
            let valor = crate::browser_script::executar(ws, expressao).await?;
            Ok(crate::browser_script::resultado_para_o_modelo(&valor))
        }
        UPLOAD_TOOL => {
            let seletor = args
                .get("selector")
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("input[type=file]");
            let caminhos: Vec<String> = args
                .get("paths")
                .and_then(Value::as_array)
                .map(|lista| lista.iter().filter_map(Value::as_str).map(str::to_string).collect())
                .unwrap_or_default();
            let arquivos = crate::browser_script::arquivos_permitidos(
                &caminhos,
                Path::new(cwd),
                &crate::browser_script::pastas_temporarias(),
            )?;
            assegurar_lease(app, gateway, &alvo.project_id, run_id)?;
            let quantos = arquivos.len();
            crate::browser_script::enviar_arquivos(ws, seletor, arquivos).await?;
            Ok(json!({ "ok": true, "arquivos": quantos, "selector": seletor }))
        }
        TABS_TOOL => Ok(json!({
            "abas": alvo.abas.iter().map(|p| {
                let mut aba = aba_json(p, cwd);
                aba["ativa"] = json!(p.id == alvo.page.id);
                aba
            }).collect::<Vec<_>>(),
        })),
        TAB_SELECT_TOOL => {
            let id = args.get("id").and_then(Value::as_str).unwrap_or("").trim();
            let page = alvo
                .abas
                .iter()
                .find(|p| p.id == id)
                .ok_or("essa aba não existe mais; liste com browser_tabs")?;
            assegurar_lease(app, gateway, &alvo.project_id, run_id)?;
            gateway.trocar(&page.id);
            crate::browser_donos::com(|d| d.usar(conv_id, &page.id));
            crate::browser_cdp::ativar_aba(app, cwd, &page.id).await?;
            Ok(json!({ "ok": true, "aba": aba_json(page, cwd) }))
        }
        TAB_NEW_TOOL => {
            let url = args.get("url").and_then(Value::as_str).unwrap_or("").trim();
            let destino = if url.is_empty() {
                None
            } else {
                Some(crate::browser_cdp::politica_da_barra(url, Path::new(cwd))?)
            };
            assegurar_lease(app, gateway, &alvo.project_id, run_id)?;
            let nova = crate::browser_cdp::nova_aba(app, cwd).await?;
            crate::browser_donos::com(|d| {
                d.tomar(&nova.id, conv_id);
                d.usar(conv_id, &nova.id);
            });
            gateway.registrar(std::slice::from_ref(&nova));
            gateway.trocar(&nova.id);
            if let (Some(destino), Some(ws)) = (&destino, nova.websocket_url.as_deref()) {
                crate::browser_cdp::pilotar(ws, vec![json!({
                    "id": 1, "method": "Page.navigate", "params": {"url": destino}
                })])
                .await?;
            }
            let url = destino.as_deref().unwrap_or("about:blank");
            Ok(json!({ "ok": true, "aba": { "id": nova.id, "url": crate::browser_cdp::sanitize_page_url_no_projeto(url, Some(Path::new(cwd))) } }))
        }
        TAB_CLOSE_TOOL => {
            let id = args
                .get("id")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|id| !id.is_empty())
                .unwrap_or(&alvo.page.id)
                .to_string();
            if !alvo.abas.iter().any(|p| p.id == id) {
                return Err("essa aba não existe mais; liste com browser_tabs".into());
            }
            if alvo.abas.len() <= 1 {
                return Err("é a única aba aberta; navegue nela em vez de fechar".into());
            }
            assegurar_lease(app, gateway, &alvo.project_id, run_id)?;
            crate::browser_cdp::fechar_aba(app, cwd, &id).await?;
            let restantes: Vec<_> = alvo.abas.iter().filter(|p| p.id != id).cloned().collect();
            let ativa = gateway.fixar(&restantes).map(|p| {
                crate::browser_donos::com(|d| d.usar(conv_id, &p.id));
                aba_json(&p, cwd)
            });
            Ok(json!({ "ok": true, "fechada": id, "ativa": ativa }))
        }
        _ => Err("ação desconhecida".into()),
    };
    let mut valor = resultado?;
    // Ação que pode abrir aba (clique, tecla, script): confere de novo na
    // hora. A aba que abrir depois aparece na próxima chamada, pelo `alvo`.
    let mut novas = alvo.novas;
    // Página sem dono que surgiu agora nasceu desta ação: é desta conversa.
    if matches!(action, CLICK_TOOL | KEY_TOOL | EVALUATE_TOOL | TYPE_TOOL) {
        if let Ok(todas) = crate::browser_cdp::abas_do_projeto(app, cwd).await {
            let minhas = crate::browser_donos::com(|d| {
                for p in d.sem_dono(&todas) {
                    d.tomar(&p.id, conv_id);
                }
                d.da_conversa(conv_id, &todas)
            });
            novas.extend(gateway.registrar(&minhas));
        }
    }
    if !novas.is_empty() {
        if let Some(obj) = valor.as_object_mut() {
            obj.insert("abas_novas".into(), json!(novas.iter().map(|p| aba_json(p, cwd)).collect::<Vec<_>>()));
            obj.insert(
                "dica".into(),
                json!("Abriu aba nova. Você continua na aba de antes; para ir até ela, use browser_tab_select com o id."),
            );
        }
    }
    // O agente está usando o navegador AGORA: a tela abre a vista ao vivo e
    // segue a aba dele (ADR-229, ADR-231). Uma vez por turno é regra da tela.
    crate::work_gateway::emit_work(
        app,
        "browser_agent_active",
        json!({ "runId": run_id, "convId": conv_id, "projectPath": cwd, "targetId": gateway.aba_atual() }),
    );
    Ok(valor)
}

/// A captura atravessa o socket como CAMINHO, não como base64: o socket tem
/// teto de 1 MB e uma página cheia passa disso. O processo do MCP lê, apaga e
/// devolve o bloco `image` ao motor, que o transforma em evidência no fio
/// (B1). Arquivo 0600 na pasta de cache do app.
fn arquivo_temporario(app: &tauri::AppHandle, conv_id: &str, png: &[u8]) -> Result<PathBuf, String> {
    use tauri::Manager;
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("sem pasta de cache: {e}"))?
        .join("browser-captures");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let nome = format!(
        "{}-{}-{}.png",
        conv_id.chars().filter(|c| c.is_ascii_alphanumeric()).take(16).collect::<String>(),
        now_ms(),
        std::process::id()
    );
    let path = dir.join(nome);
    std::fs::write(&path, png).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(path)
}

// ------------------------------------------------------------ processo MCP ---

pub fn run_mcp_server() {
    let rt = tokio::runtime::Runtime::new().expect("browser-server: runtime tokio");
    rt.block_on(mcp_loop());
}

async fn mcp_loop() {
    let mut reader = BufReader::new(tokio::io::stdin()).lines();
    let mut stdout = tokio::io::stdout();
    async fn write(stdout: &mut tokio::io::Stdout, value: Value) {
        let mut line = value.to_string();
        line.push('\n');
        let _ = stdout.write_all(line.as_bytes()).await;
        let _ = stdout.flush().await;
    }
    while let Ok(Some(line)) = reader.next_line().await {
        let message: Value = match serde_json::from_str(line.trim()) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let method = message.get("method").and_then(Value::as_str).unwrap_or("");
        let id = message.get("id").cloned();
        let result = match method {
            "initialize" => Some(json!({
                "protocolVersion": crate::work_gateway::MCP_PROTOCOL_VERSION,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": MCP_SERVER_NAME, "version": "0.1.0" }
            })),
            "ping" => Some(json!({})),
            "notifications/initialized" | "initialized" => None,
            // As tools existem SEMPRE. Navegador desligado é resposta de
            // chamada, não ausência de ferramenta: é o que permite pedir. Só
            // as de efeito (código e arquivo) dependem do modo do run.
            "tools/list" => {
                let readiness = crate::work_gateway::request_parent("work_ready", &json!({})).await;
                Some(json!({ "tools": available_tools(readiness.as_ref()) }))
            }
            "tools/call" => {
                if id.as_ref().is_none_or(Value::is_null) {
                    None
                } else {
                    let params = message.get("params");
                    let tool = params.and_then(|v| v.get("name")).and_then(Value::as_str).unwrap_or("");
                    let args = params.and_then(|v| v.get("arguments")).cloned().unwrap_or(Value::Null);
                    let payload = crate::work_gateway::request_parent(tool, &args).await;
                    Some(resposta_da_tool(tool, payload))
                }
            }
            _ => {
                if id.as_ref().is_some_and(|value| !value.is_null()) {
                    write(&mut stdout, json!({
                        "jsonrpc": "2.0", "id": id,
                        "error": { "code": -32601, "message": "method not found" }
                    })).await;
                }
                None
            }
        };
        if let (Some(result), Some(id)) = (result, id) {
            write(&mut stdout, json!({ "jsonrpc": "2.0", "id": id, "result": result })).await;
        }
    }
}

/// Resposta MCP a partir do que o app respondeu pelo socket. A captura vira
/// bloco `image` (base64 lido do arquivo temporário, que é apagado) mais o
/// texto com url e título.
fn resposta_da_tool(tool: &str, payload: Option<Value>) -> Value {
    match payload {
        Some(value) if value.get("ok").and_then(Value::as_bool) == Some(true) => {
            let result = value.get("result").cloned().unwrap_or(Value::Null);
            if tool == CAPTURE_TOOL {
                if let Some(path) = result.get("png_path").and_then(Value::as_str) {
                    let bytes = std::fs::read(path);
                    let _ = std::fs::remove_file(path);
                    if let Ok(bytes) = bytes {
                        use base64::Engine;
                        let data = base64::engine::general_purpose::STANDARD.encode(bytes);
                        let mut texto = result.clone();
                        if let Some(obj) = texto.as_object_mut() {
                            obj.remove("png_path");
                        }
                        return json!({ "content": [
                            { "type": "image", "data": data, "mimeType": "image/png" },
                            { "type": "text", "text": texto.to_string() }
                        ]});
                    }
                }
            }
            json!({ "content": [{ "type": "text", "text": result.to_string() }] })
        }
        Some(value) => json!({
            "content": [{ "type": "text", "text": value.get("error").and_then(Value::as_str).unwrap_or("falha no navegador") }],
            "isError": true
        }),
        None => json!({
            "content": [{ "type": "text", "text": "Frota indisponível" }],
            "isError": true
        }),
    }
}

/// Código e arquivo só quando o app confirma um modo que age; na dúvida, fora.
fn available_tools(readiness: Option<&Value>) -> Vec<Value> {
    let effects = readiness.is_some_and(|reply| {
        reply["ok"] == true && reply["result"]["ready"] == true && reply["result"]["processesAllowed"] == true
    });
    tool_specs()
        .into_iter()
        .filter(|tool| effects || !is_effect_tool(tool["name"].as_str().unwrap_or("")))
        .collect()
}

fn tool_specs() -> Vec<Value> {
    vec![
        json!({
            "name": STATUS_TOOL,
            "description": "Diz se o navegador do projeto (o Chromium da Frota) está ligado e qual página está aberta. Ligar é gesto da pessoa: se estiver desligado, qualquer outra tool deste servidor pede a ela.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": NAVIGATE_TOOL,
            "description": "Abre uma URL http/https, ou um arquivo HTML deste projeto (caminho relativo como docs/mocks/x.html), no navegador da Frota. Toma o controle do navegador para este turno.",
            "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"] }
        }),
        json!({
            "name": SNAPSHOT_TOOL,
            "description": "Lê a página aberta: url, título e o texto visível (até 20 mil caracteres por chamada; use offset para seguir). Não precisa do controle.",
            "inputSchema": { "type": "object", "properties": { "offset": { "type": "integer", "minimum": 0 } } }
        }),
        json!({
            "name": CAPTURE_TOOL,
            "description": "Captura a página aberta como imagem PNG; ela vira evidência na conversa. Não precisa do controle.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": CLICK_TOOL,
            "description": "Clica na página nas coordenadas x, y em pixels CSS (use a captura para localizar). Toma o controle.",
            "inputSchema": { "type": "object", "properties": { "x": { "type": "number" }, "y": { "type": "number" } }, "required": ["x", "y"] }
        }),
        json!({
            "name": TYPE_TOOL,
            "description": "Digita texto no elemento focado. Toma o controle.",
            "inputSchema": { "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] }
        }),
        json!({
            "name": KEY_TOOL,
            "description": "Pressiona uma tecla (key e code do DOM, ex.: Enter/Enter, Tab/Tab). Toma o controle.",
            "inputSchema": { "type": "object", "properties": { "key": { "type": "string" }, "code": { "type": "string" } }, "required": ["key"] }
        }),
        json!({
            "name": EVALUATE_TOOL,
            "description": "Roda JavaScript na página aberta e devolve o valor retornado (serializável). Aceita uma expressão ou uma função, ex.: async () => { ...; return x }; promessas são aguardadas (até 30 s). Use para testar código que precisa de navegador de verdade (canvas, File, import de módulo do dev server). Toma o controle.",
            "inputSchema": { "type": "object", "properties": { "expression": { "type": "string" } }, "required": ["expression"] }
        }),
        json!({
            "name": UPLOAD_TOOL,
            "description": "Coloca arquivos num <input type=\"file\"> da página, como se a pessoa tivesse escolhido (dispara change). Só aceita arquivos deste projeto (caminho relativo) ou da pasta temporária. Toma o controle.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "paths": { "type": "array", "items": { "type": "string" } },
                    "selector": { "type": "string", "description": "Seletor CSS do input; padrão: input[type=file]" }
                },
                "required": ["paths"]
            }
        }),
        json!({
            "name": TABS_TOOL,
            "description": "Lista as abas abertas no navegador da Frota (id, título, url) e diz em qual você está (ativa). As outras tools agem só na sua aba; link que abre aba nova não troca você de aba, e a resposta avisa em abas_novas.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": TAB_SELECT_TOOL,
            "description": "Passa a trabalhar na aba de id informado (de browser_tabs ou de abas_novas). Toma o controle.",
            "inputSchema": { "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] }
        }),
        json!({
            "name": TAB_NEW_TOOL,
            "description": "Abre uma aba nova, opcionalmente já numa URL http/https ou num HTML do projeto, e passa a trabalhar nela. Toma o controle.",
            "inputSchema": { "type": "object", "properties": { "url": { "type": "string" } } }
        }),
        json!({
            "name": TAB_CLOSE_TOOL,
            "description": "Fecha uma aba (a sua, se não informar o id). Não fecha a última. Fechando a sua, você passa para a primeira que sobrou. Toma o controle.",
            "inputSchema": { "type": "object", "properties": { "id": { "type": "string" } } }
        }),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn as_tools_sao_as_do_contrato_e_existem_mesmo_com_o_navegador_desligado() {
        let nomes: Vec<String> = tool_specs()
            .iter()
            .map(|t| t["name"].as_str().unwrap().to_string())
            .collect();
        assert_eq!(nomes, TOOLS);
        for nome in TOOLS {
            assert!(is_browser_tool(nome));
        }
        assert!(!is_browser_tool("process_start"));
    }

    fn aba(id: &str) -> crate::browser_cdp::RawPage {
        serde_json::from_value(json!({
            "id": id, "title": format!("aba {id}"), "url": "http://127.0.0.1:3000/", "type": "page",
            "webSocketDebuggerUrl": format!("ws://127.0.0.1:1/devtools/page/{id}")
        }))
        .unwrap()
    }

    #[test]
    fn a_aba_do_agente_fica_fixa_quando_um_link_abre_outra_na_frente() {
        // Ordem real do /json/list depois de um target=_blank (Chrome for
        // Testing 151): a aba nova vem PRIMEIRO.
        let gateway = BrowserGateway::default();
        assert_eq!(gateway.fixar(&[aba("A")]).unwrap().id, "A");
        assert!(gateway.registrar(&[aba("A")]).is_empty(), "o navegador encontrado não é novidade");
        let depois = [aba("B"), aba("A")];
        assert_eq!(gateway.fixar(&depois).unwrap().id, "A", "antes o agente ia parar em B sem saber");
        let novas = gateway.registrar(&depois);
        assert_eq!(novas.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), ["B"]);
        assert!(gateway.registrar(&depois).is_empty(), "avisa uma vez só");
    }

    #[test]
    fn aba_fixada_que_sumiu_cede_a_primeira() {
        let gateway = BrowserGateway::default();
        gateway.trocar("X");
        assert_eq!(gateway.fixar(&[aba("B"), aba("A")]).unwrap().id, "B");
        assert_eq!(gateway.aba_atual().as_deref(), Some("B"));
        assert_eq!(escolher_aba(&[], Some("B")), None);
    }

    #[test]
    fn codigo_e_arquivo_so_aparecem_em_modo_que_age() {
        let nomes = |reply: Option<Value>| -> Vec<String> {
            available_tools(reply.as_ref())
                .iter()
                .map(|t| t["name"].as_str().unwrap().to_string())
                .collect()
        };
        let pleno = nomes(Some(json!({ "ok": true, "result": { "ready": true, "processesAllowed": true } })));
        assert_eq!(pleno, TOOLS);
        let restrito = nomes(Some(json!({ "ok": true, "result": { "ready": true, "processesAllowed": false } })));
        assert!(!restrito.iter().any(|n| is_effect_tool(n)));
        assert_eq!(restrito.len(), TOOLS.len() - 2, "ver, navegar e clicar seguem valendo");
        // Sem resposta do app, fica fora: fail-closed no efeito.
        assert!(!nomes(None).iter().any(|n| is_effect_tool(n)));
    }

    #[test]
    fn captura_vira_bloco_image_e_o_arquivo_temporario_some() {
        let dir = std::env::temp_dir().join(format!("frota-browser-teste-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let png = dir.join("captura.png");
        std::fs::write(&png, b"\x89PNG\r\n\x1a\nfake").unwrap();
        let resposta = resposta_da_tool(
            CAPTURE_TOOL,
            Some(json!({ "ok": true, "result": { "ligado": true, "url": "http://localhost:5173/", "title": "App", "png_path": png.to_string_lossy() } })),
        );
        let blocos = resposta["content"].as_array().unwrap();
        assert_eq!(blocos[0]["type"], "image");
        assert_eq!(blocos[0]["mimeType"], "image/png");
        assert!(blocos[0]["data"].as_str().unwrap().starts_with("iVBOR"));
        assert!(blocos[1]["text"].as_str().unwrap().contains("localhost:5173"));
        assert!(!blocos[1]["text"].as_str().unwrap().contains("png_path"));
        assert!(!png.exists(), "o temporário é apagado depois de lido");
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// ADR-228: fechar o aviso é recusa, mas só para quem começou a esperar
    /// ANTES dela; um pedido novo depois da janela volta a perguntar.
    #[test]
    fn recusa_so_vale_para_quem_esperava_antes_dela() {
        let projeto = format!("/tmp/projeto-recusa-{}", std::process::id());
        let antes = now_ms() - 10;
        assert!(!recusado_desde(&projeto, antes));
        browser_pedido_recusado(projeto.clone());
        assert!(recusado_desde(&projeto, antes), "quem esperava antes vê a recusa");
        assert!(!recusado_desde(&projeto, now_ms() + 1_000), "pedido novo depois dela, não");
        assert!(!recusado_desde("/tmp/outro-projeto", antes), "recusa é do projeto");
    }

    #[test]
    fn navegador_desligado_e_erro_com_instrucao_nao_falha_muda() {
        let resposta = resposta_da_tool(
            NAVIGATE_TOOL,
            Some(json!({ "ok": false, "error": "O navegador do projeto está desligado. Pedi à pessoa para ligá-lo na Frota; tente de novo depois que ela confirmar, e siga com outra parte do trabalho enquanto isso." })),
        );
        assert_eq!(resposta["isError"], true);
        assert!(resposta["content"][0]["text"].as_str().unwrap().contains("Pedi à pessoa"));
    }

    #[test]
    fn codex_recebe_o_servidor_por_override_efemero() {
        let config = GatewayConfig { server_bin: "/app/frota".into(), socket: "/tmp/frota-work-abc.sock".into() };
        let mut cmd = Command::new("codex");
        config.configure_codex(&mut cmd);
        let args: Vec<String> = cmd.as_std().get_args().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(args.contains(&"mcp_servers.frota-browser.enabled=true".to_string()));
        assert!(args.iter().any(|a| a == "mcp_servers.frota-browser.args=[\"browser-server\"]"));
        assert!(args.iter().any(|a| a.starts_with("mcp_servers.frota-browser.env.FROTA_WORK_SOCK=")));
        let claude = config.claude_server_json();
        assert_eq!(claude["args"][0], SUBCOMANDO);
        assert_eq!(claude["env"]["FROTA_WORK_SOCK"], "/tmp/frota-work-abc.sock");
    }
}
