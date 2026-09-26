//! Navegador do projeto (B2.1 do docs/browser-plan.md).
//!
//! O app passa a ser DONO de um Chromium por projeto, em segundo plano por
//! padrão: spawn com
//! `--remote-debugging-port=0` e perfil persistente próprio, ciclo de vida no
//! `ProcessRegistry` do frota-work (process group, tail, TERM antes de KILL,
//! kill_all no quit) e endpoint CDP publicado para quem roteia MCP
//! (`mcp_control::plan_for_run` injeta `--cdp-endpoint`).
//!
//! **Eixo de posse: PROJETO**, não conversa/run. O `ProcessRegistry` é indexado
//! por conversa/run, então aqui os dois eixos são sintéticos e documentados:
//! `conv_id = "browser:<project_id>"` e `run_id = "browser-<project_id>"`.
//! Consequências assumidas: (a) o fio do chat ignora esses eventos de processo
//! (nenhuma conversa tem esse id, o reducer sai no `if (!cur)`); (b) o
//! `kill_all` do quit continua matando o navegador junto; (c) a UI acompanha
//! pelo evento `browser_state` no MESMO canal `work://event`.
//!
//! Estado real, nunca teatro: "ligado" só depois de `GET /json/version`
//! responder no endpoint; um navegador que morreu sozinho vira `off` na próxima
//! consulta (e o evento sai), nunca fica pendurado como vivo.

use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Manager;
use tokio::process::Command;
use tokio::time::timeout;

use crate::work_gateway::ProcessRegistry;

/// Cache do Playwright (relativo ao HOME), por plataforma suportada.
#[cfg(target_os = "macos")]
const PLAYWRIGHT_CACHE: &str = "Library/Caches/ms-playwright";
#[cfg(target_os = "linux")]
const PLAYWRIGHT_CACHE: &str = ".cache/ms-playwright";

/// Sufixos conhecidos do binário dentro de `chromium-<rev>/`, em ordem de
/// preferência. O layout atual é o Chrome for Testing completo por arquitetura;
/// os dois últimos cobrem instalações antigas que ainda usavam `Chromium.app`.
#[cfg(target_os = "macos")]
const CHROMIUM_SUFFIXES: [&str; 4] = [
    "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
];
#[cfg(target_os = "linux")]
const CHROMIUM_SUFFIXES: [&str; 3] = [
    "chrome-linux/chrome",
    "chrome-linux64/chrome",
    "chrome-linux/chromium",
];

/// Fallback: Chromium do sistema. O perfil continua sendo o isolado da Frota,
/// sem herdar login pessoal, mas evita exigir
/// download quando a máquina já tem um.
#[cfg(target_os = "macos")]
const SYSTEM_CHROMIUM: [&str; 2] = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
];
#[cfg(target_os = "linux")]
const SYSTEM_CHROMIUM: [&str; 4] = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
];

const MISSING_CHROMIUM: &str =
    "não encontrei um Chromium nesta máquina; instale com `npx playwright install chromium` ou instale Chrome/Chromium pelo sistema";

/// Quanto esperamos o Chromium anunciar a porta de depuração antes de desistir.
const ENDPOINT_TIMEOUT: Duration = Duration::from_secs(20);
const ENDPOINT_POLL: Duration = Duration::from_millis(250);
/// Health do endpoint: loopback, resposta é instantânea ou não vem.
const HEALTH_TIMEOUT: Duration = Duration::from_secs(3);

/// Sessão VIVA de navegador de um projeto. Só existe depois do health.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserSession {
    pub project_id: String,
    pub project_path: String,
    /// Id do processo no `ProcessRegistry` (o mesmo eixo do frota-work).
    pub process_id: String,
    pub pid: u32,
    /// O que o MCP recebe em `--cdp-endpoint` (`http://127.0.0.1:<porta>`).
    pub endpoint: String,
    /// String de browser reportada pelo `/json/version` (ex.: "Chrome/149…").
    pub browser: Option<String>,
    pub user_data_dir: String,
    pub binary: String,
    /// `false` = Chromium em segundo plano, observado pelo painel da Frota.
    pub window_visible: bool,
    pub started_at: i64,
}

/// O que a UI precisa saber antes de decidir ligar: a sessão (se viva) e o
/// binário descoberto, com versão ou motivo honesto da ausência.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserStatus {
    pub project_id: String,
    pub session: Option<BrowserSession>,
    pub binary: Option<String>,
    pub version: Option<String>,
    pub detail: Option<String>,
}

#[derive(Default)]
pub struct BrowserRegistry {
    sessions: Mutex<HashMap<String, BrowserSession>>,
    lifecycle: Mutex<HashSet<String>>,
}

/// Serializa ligar/desligar por projeto. Dois gestos concorrentes nunca podem
/// criar dois Chromiums no mesmo perfil nem devolver uma sessão já encerrada.
struct BrowserLifecycleGuard {
    project_id: String,
    registry: Arc<BrowserRegistry>,
}

impl Drop for BrowserLifecycleGuard {
    fn drop(&mut self) {
        if let Ok(mut projects) = self.registry.lifecycle.lock() {
            projects.remove(&self.project_id);
        }
    }
}

impl BrowserRegistry {
    /// PIDs das sessões vivas: o que NÃO é navegador órfão.
    pub(crate) fn pids(&self) -> std::collections::HashSet<u32> {
        self.sessions
            .lock()
            .map(|m| m.values().map(|s| s.pid).collect())
            .unwrap_or_default()
    }

    /// As sessões vivas (o painel da máquina mede a memória de cada uma).
    pub(crate) fn sessoes(&self) -> Vec<BrowserSession> {
        self.sessions.lock().map(|m| m.values().cloned().collect()).unwrap_or_default()
    }

    pub(crate) fn get(&self, project_id: &str) -> Option<BrowserSession> {
        self.sessions
            .lock()
            .ok()
            .and_then(|map| map.get(project_id).cloned())
    }

    fn put(&self, session: BrowserSession) {
        if let Ok(mut map) = self.sessions.lock() {
            map.insert(session.project_id.clone(), session);
        }
    }

    fn remove(&self, project_id: &str) -> Option<BrowserSession> {
        self.sessions
            .lock()
            .ok()
            .and_then(|mut map| map.remove(project_id))
    }

    fn begin_lifecycle(
        self: &Arc<Self>,
        project_id: &str,
    ) -> Result<BrowserLifecycleGuard, String> {
        let mut projects = self
            .lifecycle
            .lock()
            .map_err(|_| "ciclo de vida do navegador indisponível".to_string())?;
        if !projects.insert(project_id.into()) {
            return Err(
                "o Navegador deste projeto já está ligando ou desligando; aguarde um instante"
                    .into(),
            );
        }
        Ok(BrowserLifecycleGuard {
            project_id: project_id.into(),
            registry: self.clone(),
        })
    }
}

// ---- descoberta do binário (puro + testável) -------------------------------

/// Revisão de um diretório do cache do Playwright. Só `chromium-<rev>` conta:
/// o shell reduzido não oferece o mesmo browser/perfil persistente, e
/// `ffmpeg-*`/`webkit-*` não são Chromium.
fn playwright_revision(dir_name: &str) -> Option<u64> {
    dir_name.strip_prefix("chromium-")?.parse::<u64>().ok()
}

/// Diretório de Chromium mais NOVO do cache (maior revisão). `None` quando o
/// Playwright nunca instalou um Chromium headed nesta máquina.
fn best_playwright_dir(names: &[String]) -> Option<String> {
    names
        .iter()
        .filter_map(|name| playwright_revision(name).map(|rev| (rev, name.clone())))
        .max_by_key(|(rev, _)| *rev)
        .map(|(_, name)| name)
}

/// Primeiro layout conhecido que existe de fato dentro de `root`. `exists` é
/// injetado para o teste rodar sobre uma fixture de paths, sem tocar o disco.
fn chromium_binary_in(root: &Path, exists: &dyn Fn(&Path) -> bool) -> Option<PathBuf> {
    CHROMIUM_SUFFIXES
        .iter()
        .map(|suffix| root.join(suffix))
        .find(|path| exists(path))
}

/// Binário do Chromium: o do Playwright primeiro, o do sistema depois. Erro é
/// mensagem acionável (não "falhou"), no espírito do detect.rs.
pub fn find_chromium() -> Result<PathBuf, String> {
    let exists = |path: &Path| path.is_file();
    if let Some(home) = std::env::var_os("HOME") {
        let cache = PathBuf::from(home).join(PLAYWRIGHT_CACHE);
        let names: Vec<String> = std::fs::read_dir(&cache)
            .map(|entries| {
                entries
                    .flatten()
                    .map(|entry| entry.file_name().to_string_lossy().into_owned())
                    .collect()
            })
            .unwrap_or_default();
        if let Some(dir) = best_playwright_dir(&names) {
            if let Some(bin) = chromium_binary_in(&cache.join(dir), &exists) {
                return Ok(bin);
            }
        }
    }
    SYSTEM_CHROMIUM
        .iter()
        .map(PathBuf::from)
        .find(|path| exists(path))
        .ok_or_else(|| MISSING_CHROMIUM.to_string())
}

/// Versão reportada pelo binário (`--version`), pelo MESMO extrator do
/// detect.rs: "Google Chrome for Testing 149.0.7827.55" → "149.0.7827.55".
async fn binary_version(bin: &Path) -> Option<String> {
    let out = timeout(HEALTH_TIMEOUT, Command::new(bin).arg("--version").output())
        .await
        .ok()?
        .ok()?;
    if !out.status.success() {
        return None;
    }
    crate::detect::extract_version(&String::from_utf8_lossy(&out.stdout))
}

// ---- endpoint (puro + testável) --------------------------------------------

/// `DevToolsActivePort`, escrito pelo Chromium no user-data-dir: 1ª linha é a
/// porta efetiva (a que `--remote-debugging-port=0` sorteou), 2ª é o path do
/// websocket do browser. O arquivo não termina em newline.
pub(crate) fn parse_active_port(raw: &str) -> Option<u16> {
    raw.lines().next()?.trim().parse::<u16>().ok()
}

/// Linha de stderr do Chromium: "DevTools listening on ws://127.0.0.1:<porta>/…".
/// Fonte secundária (o tail do ProcessRegistry já a captura) para o caso do
/// arquivo do perfil não aparecer.
pub(crate) fn parse_devtools_line(text: &str) -> Option<u16> {
    text.lines().rev().find_map(|line| {
        let rest = line.split_once("DevTools listening on ws://")?.1;
        let authority = rest.split('/').next()?;
        authority.rsplit_once(':')?.1.parse::<u16>().ok()
    })
}

/// O endpoint que vai para o `--cdp-endpoint`. Loopback explícito: o Chromium
/// só escuta em 127.0.0.1 e o Playwright resolve o websocket via `/json/version`.
pub(crate) fn endpoint_for(port: u16) -> String {
    format!("http://127.0.0.1:{port}")
}

/// `/json/version` → campo "Browser" (ex.: "Chrome/149.0.7827.55").
pub(crate) fn parse_browser_version(raw: &str) -> Option<String> {
    serde_json::from_str::<Value>(raw)
        .ok()?
        .get("Browser")?
        .as_str()
        .map(str::to_string)
}

/// `/json/version` → WebSocket do browser (`webSocketDebuggerUrl`), para MCP que
/// conecta por `--wsEndpoint` (B4).
pub(crate) fn parse_browser_ws_url(raw: &str) -> Option<String> {
    serde_json::from_str::<Value>(raw)
        .ok()?
        .get("webSocketDebuggerUrl")?
        .as_str()
        .filter(|url| url.starts_with("ws://127.0.0.1:"))
        .map(str::to_string)
}

/// O WebSocket do browser AGORA, lido do endpoint vivo. `None` quando não responde.
pub(crate) async fn browser_ws_url(endpoint: &str) -> Option<String> {
    let response = timeout(
        HEALTH_TIMEOUT,
        reqwest::Client::new()
            .get(format!("{endpoint}/json/version"))
            .send(),
    )
    .await
    .ok()?
    .ok()?;
    let body = timeout(HEALTH_TIMEOUT, response.text()).await.ok()?.ok()?;
    parse_browser_ws_url(&body)
}

/// Health real do endpoint. `Some(browser)` = vivo; `None` = morto/indisponível
/// (o app nunca declara vivo sem esta resposta). A requisição vive no processo
/// da Frota; disponibilidade de um `curl` externo não vira pré-condição oculta.
async fn probe_endpoint(endpoint: &str) -> Option<String> {
    let response = timeout(
        HEALTH_TIMEOUT,
        reqwest::Client::new()
            .get(format!("{endpoint}/json/version"))
            .send(),
    )
    .await
    .ok()?
    .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let raw = timeout(HEALTH_TIMEOUT, response.text()).await.ok()?.ok()?;
    parse_browser_version(&raw)
}

// ---- ciclo de vida ---------------------------------------------------------

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Aspas simples do shell: o ProcessRegistry executa via `/bin/zsh -lc`, e o
/// path do Chromium do Playwright tem espaços.
fn shell_quote(raw: &str) -> String {
    format!("'{}'", raw.replace('\'', "'\\''"))
}

/// Linha de comando do navegador do projeto.
///
/// `--remote-debugging-port=0`: o SO escolhe a porta e o Chromium a publica no
/// `DevToolsActivePort` (porta fixa colidiria entre projetos).
/// `--user-data-dir`: perfil POR PROJETO, persistente (login de dev sobrevive
/// entre turnos) e obrigatório: o Chrome 136+ recusa depuração remota no perfil
/// padrão do usuário.
pub(crate) fn browser_command(binary: &str, user_data_dir: &str, window_visible: bool) -> String {
    let mut flags = vec![
        "--remote-debugging-port=0".to_string(),
        "--remote-debugging-address=127.0.0.1".to_string(),
        format!("--user-data-dir={user_data_dir}"),
        "--no-first-run".into(),
        "--no-default-browser-check".into(),
        // Página de fundo e janela coberta seguem vivas (ADR-257): sem isto o
        // Chromium desacelera timers e renderização de quem não está à frente,
        // e o agente que trabalha numa página enquanto a pessoa olha outra
        // travava esperando algo que só anda em primeiro plano.
        "--disable-background-timer-throttling".into(),
        "--disable-renderer-backgrounding".into(),
        "--disable-backgrounding-occluded-windows".into(),
    ];
    if !window_visible {
        flags.push("--headless=new".into());
        // Sem isto o headless nasce numa tela de 800×600 e a página ficava com
        // 756×413 (ADR-229). A altura ainda perde a faixa do navegador; quem
        // acerta a viewport exata é `browser_janela::ajustar`.
        flags.push(crate::browser_janela::flag_de_janela());
    }
    flags.push("about:blank".into());
    let mut parts = vec![shell_quote(binary)];
    parts.extend(flags.iter().map(|flag| shell_quote(flag)));
    parts.join(" ")
}

fn conv_axis(project_id: &str) -> String {
    format!("browser:{project_id}")
}

fn run_axis(project_id: &str) -> String {
    format!("browser-{project_id}")
}

fn profile_dir(app: &tauri::AppHandle, project_id: &str) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("sem app_data_dir: {e}"))?
        .join("browser-profiles")
        .join(project_id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("não consegui criar o perfil: {e}"))?;
    Ok(dir)
}

fn emit_state(app: &tauri::AppHandle, project_id: &str, session: Option<&BrowserSession>) {
    crate::work_gateway::emit_work(
        app,
        "browser_state",
        serde_json::json!({ "projectId": project_id, "session": session }),
    );
}

/// Endpoint VIVO do navegador do projeto, ou `None`. Confere a saúde a cada
/// consulta: sessão que morreu (usuário fechou a janela, crash) é derrubada do
/// registry e a UI é avisada, em vez de continuar prometendo um endpoint morto.
pub async fn live_endpoint(app: &tauri::AppHandle, project_id: &str) -> Option<String> {
    let registry = app.state::<Arc<BrowserRegistry>>();
    let session = registry.get(project_id)?;
    if probe_endpoint(&session.endpoint).await.is_some() {
        return Some(session.endpoint);
    }
    registry.remove(project_id);
    emit_state(app, project_id, None);
    None
}

/// Espera o Chromium anunciar a porta: `DevToolsActivePort` do perfil primeiro
/// (fonte de primeira mão) e, se ele não aparecer, a linha "DevTools listening
/// on ws://…" que o tail do ProcessRegistry já captura no stderr.
async fn await_endpoint(
    registry: &ProcessRegistry,
    process_id: &str,
    user_data_dir: &Path,
) -> Result<u16, String> {
    let port_file = user_data_dir.join("DevToolsActivePort");
    let deadline = std::time::Instant::now() + ENDPOINT_TIMEOUT;
    while std::time::Instant::now() < deadline {
        let view = registry
            .view(process_id)
            .ok_or_else(|| "processo do navegador sumiu do registry".to_string())?;
        if view.status != "running" {
            return Err(format!(
                "o navegador encerrou antes de anunciar a porta de depuração ({})",
                view.status
            ));
        }
        if let Some(port) = std::fs::read_to_string(&port_file)
            .ok()
            .as_deref()
            .and_then(parse_active_port)
        {
            return Ok(port);
        }
        if let Some(port) = parse_devtools_line(&view.output) {
            return Ok(port);
        }
        tokio::time::sleep(ENDPOINT_POLL).await;
    }
    Err("o navegador subiu mas não anunciou a porta de depuração".into())
}

async fn start_session(
    app: &tauri::AppHandle,
    project_id: String,
    project_path: String,
    window_visible: bool,
) -> Result<BrowserSession, String> {
    let binary = find_chromium()?;
    let user_data_dir = profile_dir(app, &project_id)?;
    // Porta velha do perfil enganaria o poll (o arquivo sobrevive ao processo).
    let _ = std::fs::remove_file(user_data_dir.join("DevToolsActivePort"));
    let cwd = if Path::new(&project_path).is_dir() {
        project_path.clone()
    } else {
        std::env::temp_dir().to_string_lossy().into_owned()
    };
    let registry = app.state::<Arc<ProcessRegistry>>().inner().clone();
    let view = registry
        .spawn(
            app.clone(),
            run_axis(&project_id),
            conv_axis(&project_id),
            browser_command(
                &binary.to_string_lossy(),
                &user_data_dir.to_string_lossy(),
                window_visible,
            ),
            cwd,
            Some("Navegador do projeto".into()),
        )
        .await?;
    let port = match await_endpoint(&registry, &view.id, &user_data_dir).await {
        Ok(port) => port,
        Err(error) => {
            // Fail-closed no efeito: sem endpoint não há navegador utilizável,
            // então o processo não fica pendurado consumindo memória.
            let _ = registry.stop(app, &view.id);
            return Err(error);
        }
    };
    let endpoint = endpoint_for(port);
    let browser = probe_endpoint(&endpoint).await;
    if browser.is_none() {
        let _ = registry.stop(app, &view.id);
        return Err(format!(
            "a porta {port} abriu mas o endpoint CDP não respondeu; o navegador não está utilizável"
        ));
    }
    let session = BrowserSession {
        project_id,
        project_path,
        process_id: view.id,
        pid: view.pid,
        endpoint,
        browser,
        user_data_dir: user_data_dir.to_string_lossy().into_owned(),
        binary: binary.to_string_lossy().into_owned(),
        window_visible,
        started_at: now_ms(),
    };
    app.state::<Arc<BrowserRegistry>>().put(session.clone());
    if !window_visible {
        crate::browser_janela::ajustar_no_projeto(app, &session.project_path).await;
    }
    emit_state(app, &session.project_id, Some(&session));
    Ok(session)
}

pub(crate) fn project_id_of(app: &tauri::AppHandle, project_path: &str) -> Result<String, String> {
    let conn = crate::mcp_control::db(app)?;
    crate::mcp_control::project_id_for_path(&conn, project_path)
}

/// Liga o navegador do projeto. Idempotente: com uma sessão viva devolve a
/// mesma (nada de segundo Chromium no mesmo perfil, que só entregaria a janela
/// pro processo antigo e morreria).
#[tauri::command]
pub async fn browser_start(
    app: tauri::AppHandle,
    project_path: String,
    window_visible: Option<bool>,
) -> Result<BrowserSession, String> {
    let project_id = project_id_of(&app, &project_path)?;
    let registry = app.state::<Arc<BrowserRegistry>>().inner().clone();
    let _lifecycle = registry.begin_lifecycle(&project_id)?;
    if live_endpoint(&app, &project_id).await.is_some() {
        if let Some(session) = registry.get(&project_id) {
            return Ok(session);
        }
    }
    start_session(
        &app,
        project_id,
        project_path,
        window_visible.unwrap_or(false),
    )
    .await
}

/// Desliga o navegador do projeto (TERM no grupo, como qualquer processo
/// gerenciado). O perfil fica no disco: é o ponto do perfil persistente.
#[tauri::command]
pub async fn browser_stop(app: tauri::AppHandle, project_path: String) -> Result<(), String> {
    let project_id = project_id_of(&app, &project_path)?;
    let registry = app.state::<Arc<BrowserRegistry>>().inner().clone();
    let _lifecycle = registry.begin_lifecycle(&project_id)?;
    let broker = app.state::<Arc<crate::experience_broker::ExperienceBroker>>();
    // Qualquer página em uso por um run ou plugin impede desligar (ADR-258).
    if let Some(pilot) = broker.em_uso(&project_id) {
        return Err(format!(
            "o navegador está em uso por {}; encerre a atividade antes de desligá-lo",
            pilot.label.to_lowercase()
        ));
    }
    app.state::<Arc<crate::browser_cdp::BrowserPreviewRegistry>>()
        .stop_project(&project_id);
    broker.release_project(&project_id);
    let session = registry.remove(&project_id);
    emit_state(&app, &project_id, None);
    let Some(session) = session else {
        return Ok(());
    };
    let registry = app.state::<Arc<ProcessRegistry>>();
    registry.stop(&app, &session.process_id).map(|_| ())
}

/// Estado honesto para a UI: a sessão (só se o endpoint responder AGORA) e o
/// binário descoberto, com versão ou o motivo da ausência.
#[tauri::command]
pub async fn browser_status(
    app: tauri::AppHandle,
    project_path: String,
) -> Result<BrowserStatus, String> {
    let project_id = project_id_of(&app, &project_path)?;
    let session = match live_endpoint(&app, &project_id).await {
        Some(_) => app.state::<Arc<BrowserRegistry>>().get(&project_id),
        None => None,
    };
    let (binary, version, detail) = match find_chromium() {
        Ok(bin) => {
            let version = binary_version(&bin).await;
            (Some(bin.to_string_lossy().into_owned()), version, None)
        }
        Err(error) => (None, None, Some(error)),
    };
    Ok(BrowserStatus {
        project_id,
        session,
        binary,
        version,
        detail,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escolhe_o_chromium_completo_mais_novo_do_cache_do_playwright() {
        // Nomes REAIS de ~/Library/Caches/ms-playwright desta máquina.
        let names: Vec<String> = [
            "b",
            "chromium-1208",
            "chromium-1228",
            "chromium_headless_shell-1208",
            "chromium_headless_shell-1228",
            "ffmpeg-1011",
        ]
        .iter()
        .map(|s| s.to_string())
        .collect();
        assert_eq!(
            best_playwright_dir(&names).as_deref(),
            Some("chromium-1228")
        );
        // Headless shell não substitui o Chromium completo com perfil.
        assert_eq!(playwright_revision("chromium_headless_shell-1228"), None);
        assert_eq!(playwright_revision("ffmpeg-1011"), None);
        assert_eq!(best_playwright_dir(&[]), None);
    }

    #[test]
    fn acha_o_binario_no_layout_real_e_no_legado() {
        let root = PathBuf::from("/cache/chromium-1228");
        // Layout REAL da instalação atual (arm64, "Google Chrome for Testing").
        let atual = root.join(
            "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        );
        let found = chromium_binary_in(&root, &|path| path == atual);
        assert_eq!(found.as_deref(), Some(atual.as_path()));
        // Layout antigo (Chromium.app) segue reconhecido.
        let legado = root.join("chrome-mac/Chromium.app/Contents/MacOS/Chromium");
        assert_eq!(
            chromium_binary_in(&root, &|path| path == legado).as_deref(),
            Some(legado.as_path())
        );
        // Diretório sem nenhum layout conhecido: nada, nunca um chute.
        assert!(chromium_binary_in(&root, &|_| false).is_none());
    }

    #[test]
    fn sem_chromium_a_mensagem_aponta_o_comando_de_instalacao() {
        assert!(MISSING_CHROMIUM.contains("npx playwright install chromium"));
    }

    #[test]
    fn le_a_porta_do_devtools_active_port() {
        // Fixture REAL: arquivo escrito pelo Chrome for Testing 149.0.7827.55
        // com --remote-debugging-port=0 (sem newline no fim).
        let fixture = "62934\n/devtools/browser/f6645add-0357-4628-bdb6-06bd6c83bd65";
        assert_eq!(parse_active_port(fixture), Some(62934));
        assert_eq!(endpoint_for(62934), "http://127.0.0.1:62934");
        // Arquivo vazio/pela metade não vira porta inventada.
        assert_eq!(parse_active_port(""), None);
        assert_eq!(parse_active_port("\n/devtools/browser/x"), None);
    }

    #[test]
    fn le_a_porta_da_linha_de_stderr_do_chromium() {
        // Fixture REAL do stderr do mesmo lançamento (o tail do ProcessRegistry
        // já captura esta linha; até aqui ela era ignorada).
        let tail = "\nDevTools listening on ws://127.0.0.1:62934/devtools/browser/f6645add-0357-4628-bdb6-06bd6c83bd65";
        assert_eq!(parse_devtools_line(tail), Some(62934));
        // Relançamento no mesmo tail: vale a ÚLTIMA linha anunciada.
        let duas = "DevTools listening on ws://127.0.0.1:1111/devtools/browser/a\nDevTools listening on ws://127.0.0.1:2222/devtools/browser/b";
        assert_eq!(parse_devtools_line(duas), Some(2222));
        assert_eq!(parse_devtools_line("[0806/120000.1:INFO] nada aqui"), None);
    }

    #[test]
    fn le_o_browser_do_json_version() {
        // Fixture REAL de GET /json/version no endpoint acima.
        let fixture = r#"{
   "Browser": "Chrome/149.0.7827.55",
   "Protocol-Version": "1.3",
   "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
   "V8-Version": "14.9.207.21",
   "WebKit-Version": "537.36 (@3188f8a607ae7e067593be8aab7f02d2451fec07)",
   "webSocketDebuggerUrl": "ws://127.0.0.1:62934/devtools/browser/f6645add-0357-4628-bdb6-06bd6c83bd65"
}"#;
        assert_eq!(
            parse_browser_version(fixture).as_deref(),
            Some("Chrome/149.0.7827.55")
        );
        // B4: o WebSocket do browser sai do MESMO /json/version, só em loopback.
        assert_eq!(
            parse_browser_ws_url(fixture).as_deref(),
            Some("ws://127.0.0.1:62934/devtools/browser/f6645add-0357-4628-bdb6-06bd6c83bd65")
        );
        assert_eq!(
            parse_browser_ws_url(r#"{"webSocketDebuggerUrl":"ws://10.0.0.8:9222/devtools/browser/x"}"#),
            None
        );
        // Resposta que não é o /json/version (endpoint errado) não vira vida.
        assert_eq!(parse_browser_version("<html>404</html>"), None);
        assert_eq!(parse_browser_version("{}"), None);
    }

    #[test]
    fn comando_cita_o_binario_com_espaco_e_o_perfil_do_projeto() {
        let cmd = browser_command(
            "/Users/me/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
            "/Users/me/Library/Application Support/Frota/browser-profiles/proj-1",
            false,
        );
        assert!(cmd.starts_with("'/Users/me/Library/Caches"));
        assert!(cmd.contains("'--remote-debugging-port=0'"));
        assert!(cmd.contains("'--remote-debugging-address=127.0.0.1'"));
        assert!(cmd.contains("'--user-data-dir=/Users/me/Library/Application Support/Frota/browser-profiles/proj-1'"));
        assert!(cmd.contains("'--headless=new'"));
        assert!(cmd.contains("'--window-size=1280,800'"));
        let visible = browser_command("/usr/bin/chromium", "/tmp/profile", true);
        assert!(!visible.contains("--headless"));
        // janela visível é da pessoa: o tamanho é dela
        assert!(!visible.contains("--window-size"));
        // ADR-257: página de fundo e janela coberta seguem vivas, nos dois modos,
        // senão o agente trava na página que a pessoa não está olhando.
        for comando in [&cmd, &visible] {
            for opcao in [
                "--disable-background-timer-throttling",
                "--disable-renderer-backgrounding",
                "--disable-backgrounding-occluded-windows",
            ] {
                assert!(comando.contains(opcao), "falta {opcao}");
            }
        }
    }

    #[test]
    fn eixos_sinteticos_de_posse_sao_por_projeto() {
        assert_eq!(conv_axis("proj-1"), "browser:proj-1");
        assert_eq!(run_axis("proj-1"), "browser-proj-1");
    }

    #[test]
    fn ciclo_de_vida_impede_dois_spawns_do_mesmo_projeto() {
        let registry = Arc::new(BrowserRegistry::default());
        let first = registry.begin_lifecycle("proj-1").unwrap();
        assert!(registry.begin_lifecycle("proj-1").is_err());
        assert!(registry.begin_lifecycle("proj-2").is_ok());
        drop(first);
        assert!(registry.begin_lifecycle("proj-1").is_ok());
    }
}
