//! H1 (hooks-plan §3) — presença de sessões EXTERNAS dos CLIs.
//!
//! Os hooks instalados (hooks_install.rs) postam eventos de ciclo de vida no
//! hook_gateway; aqui cada payload vira UM sinal normalizado e alimenta um
//! mapa EM MEMÓRIA de sessões abertas fora do app (terminal). Nada é
//! persistido de propósito (replay-safe: reiniciou o app, a sessão externa
//! some — honesto, porque não temos como saber se ela ainda vive).
//!
//! O app OBSERVA, não dirige: isto é telemetria de presença. Não cria
//! conversa no fio (não somos donos da sessão), não tem botão de controle.
//! Runs spawnados pelo PRÓPRIO app carregam `MYCOCKPIT_RUN_ID` no env
//! (herdada pelo hook e enviada no header) e são ignorados aqui — o adapter
//! já vê tudo deles com muito mais detalhe.
//!
//! Fail-open no render: evento desconhecido/payload sem sessão é ignorado em
//! silêncio (nunca crasha nem inventa presença). Quem decide o dialeto é o
//! registry (`Capabilities.hook_dialect`), nunca o nome do agent.

use crate::adapters::{capabilities_of, HookDialect};
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

/// Evento emitido pro webview a cada mudança (lista completa — simples e
/// idempotente; o volume é minúsculo).
pub const SESSIONS_EVENT: &str = "hooks://sessions";
/// Env que o app seta nos runs que ELE spawna (correlação, hooks-plan §4.7).
pub const RUN_ENV: &str = "FROTA_RUN_ID";

/// O nome LEGADO da mesma variável. O snippet de hook instalado em
/// `~/.claude/settings.json` de cada máquina cita `${MYCOCKPIT_RUN_ID}`, e ele
/// não se atualiza sozinho. Enquanto houver snippet antigo rodando, o app
/// SETA AS DUAS: o hook velho continua correlacionando o run em vez de virar
/// fantasma no Painel, calado (ADR-222). Sai quando a janela fechar.
pub const RUN_ENV_LEGADO: &str = "MYCOCKPIT_RUN_ID";

/// Marca um spawn como NOSSO: a env é herdada pelos hooks globais do CLI, que
/// a mandam no header `X-Mycockpit-Run` — e o `ingest`/`permission_roundtrip`
/// tratam header não-vazio como sessão do APP (nunca externa). TODO caminho
/// que sobe um CLI passa por aqui (run_once, codex app-server e as
/// meta-tarefas `claude -p` do juiz/sugestões) — ponto único pra não regredir
/// a dupla contagem. `run_id` real nos runs; sentinela `"oneshot"` nas
/// meta-tarefas (o gateway só exige NÃO-VAZIO).
pub fn correlate_run(cmd: &mut tokio::process::Command, run_id: &str) {
    cmd.env(RUN_ENV, run_id).env(RUN_ENV_LEGADO, run_id);
    crate::segredos::aplicar(cmd, run_id); // o ambiente POR RUN passa todo por aqui (ADR-288)
}

/// Sessão externa sem sinal há mais que isto é podada (o CLI pode ter morrido
/// sem Stop — crash, kill -9). 4h cobre qualquer pausa de almoço realista.
const STALE_MS: i64 = 4 * 60 * 60 * 1000;
/// Teto de sessões rastreadas (defesa contra flood de payload forjado local).
const CAP: usize = 100;

/// Uma sessão externa viva. `status` é vocabulário FECHADO:
/// "working" (evento de atividade) · "waiting" (o CLI pediu o usuário)
/// · "blocked" (permissão pendente) · "idle" (Stop: turno terminou).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalSession {
    pub agent: String,
    pub session_id: String,
    pub cwd: String,
    pub status: String,
    /// Último evento cru (telemetria honesta pro tooltip).
    pub last_event: String,
    /// Tool corrente, quando o evento carrega (PreToolUse).
    pub tool: Option<String>,
    /// Epoch ms do último sinal ("visto há X" deriva disto).
    pub last_seen: i64,
    pub started_at: i64,
}

/// Estado vivo (managed no Tauri). Chave: `agent:session_id`.
#[derive(Default)]
pub struct ExternalSessions(pub Mutex<HashMap<String, ExternalSession>>);

// ---------------------------------------------------------------------------
// Normalização PURA por dialeto (testada com os payloads REAIS).
// ---------------------------------------------------------------------------

/// O que um evento de hook significa pra presença.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum SignalKind {
    Working,
    Waiting,
    Blocked,
    Idle,
    /// Sessão encerrou (SessionEnd): sai do mapa.
    End,
}

/// Sinal normalizado de UM payload de hook.
#[derive(Debug, PartialEq)]
pub struct HookSignal {
    pub session_id: String,
    pub cwd: String,
    pub kind: SignalKind,
    pub event: String,
    pub tool: Option<String>,
}

fn str_of(v: &Value, key: &str) -> Option<String> {
    v.get(key).and_then(|x| x.as_str()).map(str::to_string)
}

/// Dialeto ClaudeSettings/CodexHooksJson (mesmo shape, [E4]): o payload
/// carrega `hook_event_name`, `session_id`, `cwd` (snake_case — fixtures
/// reais capturadas 12/08/2026 nesta máquina).
fn normalize_claude_family(payload: &Value) -> Option<HookSignal> {
    let event = str_of(payload, "hook_event_name")?;
    let session_id = str_of(payload, "session_id").filter(|s| !s.is_empty())?;
    let cwd = str_of(payload, "cwd").unwrap_or_default();
    let tool = str_of(payload, "tool_name");
    let kind = match event.as_str() {
        // sessão nasceu; ainda não está trabalhando.
        "SessionStart" => SignalKind::Idle,
        "UserPromptSubmit" | "PreToolUse" | "PostToolUse" => SignalKind::Working,
        // Notification: permission_prompt = bloqueada em permissão; o resto
        // (idle_prompt, agent_needs_input, elicitation_*) = esperando você.
        "Notification" => {
            if str_of(payload, "notification_type").as_deref() == Some("permission_prompt") {
                SignalKind::Blocked
            } else {
                SignalKind::Waiting
            }
        }
        "PermissionRequest" => SignalKind::Blocked,
        "Stop" => SignalKind::Idle,
        "SessionEnd" => SignalKind::End,
        // evento desconhecido: fail-open — ignora, nunca inventa estado.
        _ => return None,
    };
    Some(HookSignal {
        session_id,
        cwd,
        kind,
        event,
        tool,
    })
}

/// Dialeto AgyConfigHooks: o payload NÃO carrega o nome do evento (por isso o
/// script o manda no header — `event_hint`). camelCase/protojson: a sessão é
/// `conversationId` e o cwd sai de `workspacePaths[0]` (doc embarcada [E9]).
fn normalize_agy(event_hint: Option<&str>, payload: &Value) -> Option<HookSignal> {
    let event = event_hint?.to_string();
    let session_id = str_of(payload, "conversationId").filter(|s| !s.is_empty())?;
    let cwd = payload
        .get("workspacePaths")
        .and_then(|x| x.as_array())
        .and_then(|a| a.first())
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string();
    let tool = payload
        .pointer("/toolCall/name")
        .and_then(|x| x.as_str())
        .map(str::to_string);
    let kind = match event.as_str() {
        "PreInvocation" | "PostInvocation" | "PostToolUse" | "PreToolUse" => SignalKind::Working,
        // Stop = fim do loop de execução; sem SessionEnd no agy, a poda por
        // idade cobre o encerramento (degradação honesta — sem inventar fim).
        "Stop" => SignalKind::Idle,
        _ => return None,
    };
    Some(HookSignal {
        session_id,
        cwd,
        kind,
        event,
        tool,
    })
}

/// Normaliza UM payload pro dialeto dado. PURO.
pub fn normalize(
    dialect: HookDialect,
    event_hint: Option<&str>,
    payload: &Value,
) -> Option<HookSignal> {
    match dialect {
        HookDialect::ClaudeSettings | HookDialect::CodexHooksJson => {
            normalize_claude_family(payload)
        }
        HookDialect::AgyConfigHooks => normalize_agy(event_hint, payload),
    }
}

fn status_str(kind: SignalKind) -> &'static str {
    match kind {
        SignalKind::Working => "working",
        SignalKind::Waiting => "waiting",
        SignalKind::Blocked => "blocked",
        SignalKind::Idle => "idle",
        SignalKind::End => "idle",
    }
}

/// Aplica um sinal ao mapa (PURO sobre o mapa; `now_ms` injetável nos testes).
/// Devolve true se algo mudou (só aí vale re-emitir).
pub fn apply_signal(
    map: &mut HashMap<String, ExternalSession>,
    agent: &str,
    sig: HookSignal,
    now_ms: i64,
) -> bool {
    let key = format!("{agent}:{}", sig.session_id);
    if sig.kind == SignalKind::End {
        return map.remove(&key).is_some();
    }
    // poda de velhas ANTES de inserir (o mapa nunca cresce sem limite).
    map.retain(|_, s| now_ms - s.last_seen < STALE_MS);
    if !map.contains_key(&key) && map.len() >= CAP {
        return false; // teto: não rastreia sessão nova além do cap.
    }
    let entry = map.entry(key).or_insert_with(|| ExternalSession {
        agent: agent.to_string(),
        session_id: sig.session_id.clone(),
        cwd: sig.cwd.clone(),
        status: String::new(),
        last_event: String::new(),
        tool: None,
        last_seen: now_ms,
        started_at: now_ms,
    });
    entry.status = status_str(sig.kind).to_string();
    entry.last_event = sig.event;
    entry.tool = sig.tool;
    entry.last_seen = now_ms;
    if !sig.cwd.is_empty() {
        entry.cwd = sig.cwd;
    }
    true
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Lista ordenada (mais recente primeiro) — o shape que o front consome.
pub fn snapshot(map: &HashMap<String, ExternalSession>) -> Vec<ExternalSession> {
    let mut v: Vec<ExternalSession> = map.values().cloned().collect();
    v.sort_by(|a, b| {
        b.last_seen
            .cmp(&a.last_seen)
            .then(a.session_id.cmp(&b.session_id))
    });
    v
}

/// Ingesta um payload autenticado vindo do hook_gateway. Devolve true se o
/// payload foi consumido como evento de presença (mesmo contrato do
/// `usage_window::ingest_statusline`: false = sem consumidor, o gateway loga
/// em debug e segue — nunca erro pro script).
pub fn ingest(
    app: &AppHandle,
    agent: &str,
    run_header: Option<&str>,
    event_hint: Option<&str>,
    payload: &Value,
) -> bool {
    let Some(dialect) = capabilities_of(agent).and_then(|c| c.hook_dialect) else {
        return false;
    };
    // run do PRÓPRIO app (env herdada → header presente): consumido e
    // deliberadamente ignorado — o adapter já cobre esses com mais detalhe.
    if run_header.is_some_and(|r| !r.trim().is_empty()) {
        return true;
    }
    let Some(sig) = normalize(dialect, event_hint, payload) else {
        return false;
    };
    let state: State<'_, ExternalSessions> = app.state();
    let changed = {
        let Ok(mut map) = state.0.lock() else {
            return false;
        };
        let changed = apply_signal(&mut map, agent, sig, now_ms());
        if changed {
            Some(snapshot(&map))
        } else {
            None
        }
    };
    if let Some(list) = changed {
        let _ = app.emit(SESSIONS_EVENT, &list);
    }
    true
}

/// Hidratação do boot do front (padrão `usage_snapshots`).
#[tauri::command]
pub fn hook_sessions(state: State<'_, ExternalSessions>) -> Vec<ExternalSession> {
    state.0.lock().map(|m| snapshot(&m)).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// H2 — permissão SÍNCRONA respondível na UI/Companion (hooks-plan §3).
//
// O script segura a resposta HTTP; aqui o pedido vira uma pendência na MESMA
// fila de interações do app (PendingApprovals + `interaction://request`), que
// já alimenta o card da UI, o sino e o Companion. A resposta humana volta
// pelo `answer_interaction` de sempre e vira o corpo que o script pipa pro
// stdout no formato do dialeto.
//
// Fail-SAFE de permissão: timeout sem humano ⇒ `ask` — o CLI cai no PRÓPRIO
// prompt no terminal. Nunca um allow fantasma, nunca um deny fabricado.
//
// E fail-open de AUTORIDADE (hooks-plan §6.2): a fila tem TETO. Acima dele o
// pedido novo degrada na hora em vez de segurar mais uma conexão por 30s pra
// produzir `ask` no fim de qualquer jeito. O disjuntor do lado do script
// (hooks_install, §6.1) é a outra metade: aqui a gente para de ENFILEIRAR, lá
// o script para de PERGUNTAR.
// ---------------------------------------------------------------------------

/// Teto do round-trip humano. MENOR que o `--max-time 32` do script e que o
/// timeout 35s do config (camadas: gateway responde antes de alguém desistir).
pub const PERMISSION_TIMEOUT_MS: u64 = 30_000;

/// Teto de pedidos de permissão pendentes AO MESMO TEMPO (fail-open de
/// AUTORIDADE, hooks-plan §6.2). Acima disto o pedido NOVO degrada na hora
/// (`ask`) em vez de entrar na fila.
///
/// Por que 8: a fila é HUMANA e serial (um card por vez), e cada CLI pede
/// permissão de forma serial dentro de uma sessão (uma tool call por vez).
/// 8 pendentes = 8 sessões simultâneas travadas esperando a mesma pessoa —
/// mais do que qualquer uso plausível numa máquina, e mais do que alguém
/// decide antes do teto de 30s de cada uma expirar. Acima disso o que existe
/// é laço de retry, sessão esquecida ou payload forjado local: enfileirar
/// seria segurar N conexões e N tasks pra produzir `ask` no fim de qualquer
/// jeito. Degradar na hora é a resposta honesta — o prompt nativo do terminal
/// continua lá.
pub const MAX_PENDING_PERMISSIONS: usize = 8;

/// Contador de pendências em voo. Vaga reservada por RAII: qualquer saída do
/// round-trip (decisão, timeout, erro) devolve a vaga — sem `finally` esquecido.
pub struct PermissionGate(std::sync::atomic::AtomicUsize);

/// Vaga viva. Enquanto existe, ocupa um lugar do teto.
pub struct PermissionSlot<'a>(&'a PermissionGate);

impl Drop for PermissionSlot<'_> {
    fn drop(&mut self) {
        self.0 .0.fetch_sub(1, std::sync::atomic::Ordering::Release);
    }
}

impl PermissionGate {
    pub const fn new() -> Self {
        Self(std::sync::atomic::AtomicUsize::new(0))
    }
    /// Reserva uma vaga. `None` = teto batido (o chamador degrada na hora).
    /// CAS em laço: nunca passa do teto nem com pedidos concorrentes.
    pub fn reserve(&self) -> Option<PermissionSlot<'_>> {
        use std::sync::atomic::Ordering::{AcqRel, Acquire};
        let mut cur = self.0.load(Acquire);
        loop {
            if cur >= MAX_PENDING_PERMISSIONS {
                return None;
            }
            // `AcqRel` no sucesso: este RMW ADQUIRE um recurso, então precisa
            // das duas metades (o `Release` sozinho era inofensivo aqui, porque
            // a vaga é só um contador, mas o idiomático diz o que se quer).
            match self.0.compare_exchange_weak(cur, cur + 1, AcqRel, Acquire) {
                Ok(_) => return Some(PermissionSlot(self)),
                Err(c) => cur = c,
            }
        }
    }
    pub fn pending(&self) -> usize {
        self.0.load(std::sync::atomic::Ordering::Acquire)
    }
}

impl Default for PermissionGate {
    fn default() -> Self {
        Self::new()
    }
}

/// O teto do processo (o gateway é único; a fila humana é única).
static PERMISSION_GATE: PermissionGate = PermissionGate::new();

/// Decisão de permissão normalizada (o dialeto só entra na SERIALIZAÇÃO).
#[derive(Debug, PartialEq)]
pub enum HookDecision {
    Allow,
    Deny(String),
    /// Sem opinião: o CLI segue o fluxo nativo (prompt no terminal).
    Ask,
}

/// Pedido de permissão normalizado de um payload de hook.
#[derive(Debug, PartialEq)]
pub struct HookPermission {
    pub session_id: String,
    pub cwd: String,
    pub tool_name: String,
    pub tool_input: Value,
    /// Conveniência pro card da UI (input.command quando existe).
    pub command: String,
    /// true = PERGUNTA do modelo (AskUserQuestion), não permissão real: não
    /// vira pendência de aprovação (a resposta certa é no terminal) — a
    /// sessão marca "esperando você" e o CLI recebe `ask` na hora. Distinção
    /// por nome de tool é domínio do dialeto (confinada aqui).
    pub is_question: bool,
}

/// Parse do pedido de permissão. None = o payload não é deste formato
/// (fail-open: o gateway devolve `ask` sem segurar nada). PURO.
pub fn parse_permission(dialect: HookDialect, payload: &Value) -> Option<HookPermission> {
    match dialect {
        HookDialect::ClaudeSettings | HookDialect::CodexHooksJson => {
            let session_id = str_of(payload, "session_id").filter(|s| !s.is_empty())?;
            let tool_name = str_of(payload, "tool_name")?;
            let tool_input = payload.get("tool_input").cloned().unwrap_or(Value::Null);
            let command = tool_input
                .get("command")
                .and_then(|x| x.as_str())
                .unwrap_or_default()
                .to_string();
            Some(HookPermission {
                session_id,
                cwd: str_of(payload, "cwd").unwrap_or_default(),
                is_question: tool_name == "AskUserQuestion",
                tool_name,
                tool_input,
                command,
            })
        }
        HookDialect::AgyConfigHooks => {
            let session_id = str_of(payload, "conversationId").filter(|s| !s.is_empty())?;
            let tool_name = payload
                .pointer("/toolCall/name")
                .and_then(|x| x.as_str())?
                .to_string();
            let tool_input = payload
                .pointer("/toolCall/args")
                .cloned()
                .unwrap_or(Value::Null);
            // args do run_command carregam CommandLine (doc embarcada [E9]).
            let command = tool_input
                .get("CommandLine")
                .and_then(|x| x.as_str())
                .unwrap_or_default()
                .to_string();
            let cwd = payload
                .pointer("/workspacePaths/0")
                .and_then(|x| x.as_str())
                .unwrap_or_default()
                .to_string();
            Some(HookPermission {
                session_id,
                cwd,
                tool_name,
                tool_input,
                command,
                is_question: false,
            })
        }
    }
}

/// Serializa a decisão no stdout que o DIALETO espera. PURO.
/// claude/codex: `hookSpecificOutput.decision.behavior` (docs 12/08/2026 +
/// script vivo do Xirp [E2]); agy: `decision` de topo (doc embarcada [E9]).
pub fn decision_body(dialect: HookDialect, decision: &HookDecision) -> String {
    match dialect {
        HookDialect::ClaudeSettings | HookDialect::CodexHooksJson => {
            let d = match decision {
                HookDecision::Allow => serde_json::json!({ "behavior": "allow" }),
                HookDecision::Deny(reason) => {
                    serde_json::json!({ "behavior": "deny", "decisionReason": reason })
                }
                HookDecision::Ask => serde_json::json!({ "behavior": "ask" }),
            };
            serde_json::json!({
                "hookSpecificOutput": {
                    "hookEventName": "PermissionRequest",
                    "decision": d,
                }
            })
            .to_string()
        }
        HookDialect::AgyConfigHooks => match decision {
            HookDecision::Allow => serde_json::json!({ "decision": "allow" }).to_string(),
            HookDecision::Deny(reason) => {
                serde_json::json!({ "decision": "deny", "reason": reason }).to_string()
            }
            HookDecision::Ask => serde_json::json!({ "decision": "ask" }).to_string(),
        },
    }
}

/// Resposta humana ({allow, message?} do answer_interaction) → decisão.
/// Resposta que não parseia = Ask (nunca deny fabricado por bug de shape).
pub fn decision_from_answer(answer: &Value) -> HookDecision {
    match answer.get("allow").and_then(|x| x.as_bool()) {
        Some(true) => HookDecision::Allow,
        Some(false) => HookDecision::Deny(
            answer
                .get("message")
                .and_then(|x| x.as_str())
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("negado pelo usuário na Frota")
                .to_string(),
        ),
        None => HookDecision::Ask,
    }
}

/// Registra a pendência no MESMO registro das interações inline (o
/// answer_interaction destrava). Devolve o receiver.
fn register_pending(
    pending: &std::sync::Arc<crate::approval::PendingApprovals>,
    id: &str,
) -> Option<tokio::sync::oneshot::Receiver<Value>> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Value>();
    let mut map = pending.0.lock().ok()?;
    map.insert(
        id.to_string(),
        crate::approval::Pending {
            kind: "approval".to_string(),
            tx,
        },
    );
    Some(rx)
}

/// Espera a decisão humana com teto. Timeout/cancelamento ⇒ Ask (fail-SAFE:
/// o prompt nativo decide no terminal). Remove a pendência em qualquer saída.
pub async fn await_decision(
    pending: &std::sync::Arc<crate::approval::PendingApprovals>,
    id: &str,
    rx: tokio::sync::oneshot::Receiver<Value>,
    timeout: std::time::Duration,
) -> HookDecision {
    let decision = match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(answer)) => decision_from_answer(&answer),
        // timeout OU canal dropado: sem humano, sem opinião.
        _ => HookDecision::Ask,
    };
    if let Ok(mut map) = pending.0.lock() {
        map.remove(id);
    }
    decision
}

/// Atualiza a presença da sessão dona de um pedido de permissão (blocked
/// enquanto pende/timeout — sticky até o PreToolUse/PostToolUse/Stop
/// correlacionado chegar; working quando o humano decidiu e o CLI segue).
fn mark_permission_state(app: &AppHandle, agent: &str, perm: &HookPermission, kind: SignalKind) {
    let state: State<'_, ExternalSessions> = app.state();
    let changed = {
        let Ok(mut map) = state.0.lock() else { return };
        let sig = HookSignal {
            session_id: perm.session_id.clone(),
            cwd: perm.cwd.clone(),
            kind,
            event: "PermissionRequest".to_string(),
            tool: Some(perm.tool_name.clone()),
        };
        let changed = apply_signal(&mut map, agent, sig, now_ms());
        if changed {
            Some(snapshot(&map))
        } else {
            None
        }
    };
    if let Some(list) = changed {
        let _ = app.emit(SESSIONS_EVENT, &list);
    }
}

/// Round-trip completo de UM pedido de permissão vindo do gateway. `None` =
/// o payload NÃO é um pedido de permissão deste motor (o gateway segue o
/// fluxo fire-and-forget normal). `Some(body)` = corpo pro stdout do script.
pub async fn permission_roundtrip(
    app: &AppHandle,
    agent: &str,
    run_header: Option<&str>,
    event_hint: Option<&str>,
    payload: &Value,
) -> Option<String> {
    let caps = capabilities_of(agent)?;
    let dialect = caps.hook_dialect?;
    if !caps.hooks_permission {
        return None;
    }
    // é o evento de permissão deste dialeto? (claude/codex: nome no payload;
    // agy: só no header — o payload não carrega o evento.)
    let event = str_of(payload, "hook_event_name").or_else(|| event_hint.map(str::to_string))?;
    if event != crate::hooks_install::permission_event_name(dialect) {
        return None;
    }
    // run do PRÓPRIO app: o gate inline (frota-approval / app-server) já cobre —
    // devolve `ask` na hora, sem segurar nem duplicar card.
    if run_header.is_some_and(|r| !r.trim().is_empty()) {
        return Some(decision_body(dialect, &HookDecision::Ask));
    }
    let Some(perm) = parse_permission(dialect, payload) else {
        // payload sem os campos esperados: fail-open, sem segurar nada.
        return Some(decision_body(dialect, &HookDecision::Ask));
    };
    if perm.is_question {
        // AskUserQuestion: pergunta de CONTEÚDO — a resposta certa é no
        // terminal. Sessão marca "esperando você" (limpa quando o próximo
        // evento chegar = respondeu) e o CLI segue o fluxo nativo.
        let sig = HookSignal {
            session_id: perm.session_id.clone(),
            cwd: perm.cwd.clone(),
            kind: SignalKind::Waiting,
            event: "AskUserQuestion".to_string(),
            tool: Some(perm.tool_name.clone()),
        };
        let state: State<'_, ExternalSessions> = app.state();
        let changed = {
            let Ok(mut map) = state.0.lock() else {
                return Some(decision_body(dialect, &HookDecision::Ask));
            };
            let changed = apply_signal(&mut map, agent, sig, now_ms());
            if changed {
                Some(snapshot(&map))
            } else {
                None
            }
        };
        if let Some(list) = changed {
            let _ = app.emit(SESSIONS_EVENT, &list);
        }
        return Some(decision_body(dialect, &HookDecision::Ask));
    }
    // pendência na fila ÚNICA de interações (UI + sino + Companion).
    mark_permission_state(app, agent, &perm, SignalKind::Blocked);
    // teto de pendências: acima dele o pedido NOVO não entra na fila — vira
    // `ask` na hora (o prompt nativo decide no terminal). A sessão já está
    // marcada `blocked` acima: a UI mostra "esperando você" de verdade, que é
    // o que está acontecendo — nada de card que ninguém vai olhar.
    let Some(_slot) = PERMISSION_GATE.reserve() else {
        log::warn!(
            "hooks: teto de permissões pendentes batido ({} de {MAX_PENDING_PERMISSIONS} em voo); pedido de {agent} ({}) degradado pra `ask`, responda no terminal",
            PERMISSION_GATE.pending(),
            perm.tool_name
        );
        return Some(decision_body(dialect, &HookDecision::Ask));
    };
    let pending: State<'_, std::sync::Arc<crate::approval::PendingApprovals>> = app.state();
    let pending = pending.inner().clone();
    static SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let id = format!(
        "hookperm-{}-{}",
        std::process::id(),
        SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    );
    let Some(rx) = register_pending(&pending, &id) else {
        return Some(decision_body(dialect, &HookDecision::Ask));
    };
    let _ = app.emit(
        "interaction://request",
        serde_json::json!({
            "id": id,
            // sessão externa não tem run do app: run_id vazio ⇒ card global.
            "run_id": "",
            "kind": "approval",
            "data": {
                "tool_name": perm.tool_name,
                "command": perm.command,
                "input": perm.tool_input,
                // origem pro card/notificação/Companion dizerem DE ONDE veio.
                "hook": {
                    "engine": agent,
                    "sessionId": perm.session_id,
                    "cwd": perm.cwd,
                },
            },
        }),
    );
    let decision = await_decision(
        &pending,
        &id,
        rx,
        std::time::Duration::from_millis(PERMISSION_TIMEOUT_MS),
    )
    .await;
    match decision {
        // humano decidiu: o CLI segue (allow roda a tool; deny devolve o
        // motivo ao modelo, que continua o turno) — sessão volta a trabalhar.
        HookDecision::Allow | HookDecision::Deny(_) => {
            mark_permission_state(app, agent, &perm, SignalKind::Working);
        }
        // timeout: o card sai da fila (não dá mais pra responder — teatro é
        // proibido) e a SESSÃO fica blocked (sticky) até o evento
        // correlacionado chegar (o usuário respondeu no terminal).
        HookDecision::Ask => {
            let _ = app.emit("interaction://resolved", serde_json::json!({ "id": id }));
        }
    }
    Some(decision_body(dialect, &decision))
}

// ---------------------------------------------------------------------------
// Testes — payloads REAIS capturados nesta máquina em 12/08/2026 (claude
// 2.1.220 com hooks de captura em escopo de projeto; ver hooks-plan §1) e o
// contrato camelCase da doc embarcada do agy [E9] (o escopo workspace do agy
// não carregou nesta máquina; o global é do usuário — payload do doc oficial
// do produto, com os campos verificados no grupo vivo do Orca).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// SessionStart REAL (capturado 12/08/2026).
    fn session_start() -> Value {
        json!({
            "session_id": "b1cec953-fecf-4ad0-b7e4-b64e8ed159eb",
            "transcript_path": "/Users/viniciusmachado/.claude/projects/x/b1cec953.jsonl",
            "cwd": "/private/tmp/scratch/capture/claude",
            "hook_event_name": "SessionStart",
            "source": "startup"
        })
    }

    /// PreToolUse REAL (capturado 12/08/2026): carrega tool_name/tool_input.
    fn pre_tool_use() -> Value {
        json!({
            "session_id": "b1cec953-fecf-4ad0-b7e4-b64e8ed159eb",
            "cwd": "/private/tmp/scratch/capture/claude",
            "prompt_id": "04c357be-4bf7-477f-97d9-54eb5085b3f0",
            "permission_mode": "default",
            "effort": { "level": "high" },
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "tool_input": { "command": "echo oi", "description": "Print \"oi\"" },
            "tool_use_id": "toolu_017drfKkZ7y6tdv6tQzSYFn7"
        })
    }

    /// Stop REAL (capturado 12/08/2026).
    fn stop() -> Value {
        json!({
            "session_id": "b1cec953-fecf-4ad0-b7e4-b64e8ed159eb",
            "cwd": "/private/tmp/scratch/capture/claude",
            "hook_event_name": "Stop",
            "stop_hook_active": false,
            "last_assistant_message": "O comando rodou com sucesso e imprimiu `oi`.",
            "background_tasks": [],
            "session_crons": []
        })
    }

    /// SessionEnd REAL (capturado 12/08/2026).
    fn session_end() -> Value {
        json!({
            "session_id": "b1cec953-fecf-4ad0-b7e4-b64e8ed159eb",
            "cwd": "/private/tmp/scratch/capture/claude",
            "hook_event_name": "SessionEnd",
            "reason": "other"
        })
    }

    /// PreToolUse do agy — shape da doc oficial embarcada (camelCase).
    fn agy_pre_tool_use() -> Value {
        json!({
            "conversationId": "ec33ebf9-0cba-4100-8142-c61503f6c587",
            "workspacePaths": ["/Users/viniciusmachado/projetos/mycockpit"],
            "transcriptPath": "/x/.gemini/antigravity-cli/transcript.jsonl",
            "modelName": "auto",
            "toolCall": { "name": "run_command", "args": { "CommandLine": "npm test" } },
            "stepIdx": 19
        })
    }

    #[test]
    fn ciclo_de_vida_do_claude_vira_presenca_honesta() {
        let mut map = HashMap::new();
        // nasce ociosa (SessionStart não é trabalho).
        let s = normalize(HookDialect::ClaudeSettings, None, &session_start()).unwrap();
        assert_eq!(s.kind, SignalKind::Idle);
        assert!(apply_signal(&mut map, "claude-code", s, 1_000));
        let sess = &snapshot(&map)[0];
        assert_eq!(sess.status, "idle");
        assert_eq!(sess.cwd, "/private/tmp/scratch/capture/claude");
        // PreToolUse = trabalhando, com a tool na cara.
        let s = normalize(HookDialect::ClaudeSettings, None, &pre_tool_use()).unwrap();
        assert_eq!(s.tool.as_deref(), Some("Bash"));
        apply_signal(&mut map, "claude-code", s, 2_000);
        let sess = &snapshot(&map)[0];
        assert_eq!(sess.status, "working");
        assert_eq!(sess.tool.as_deref(), Some("Bash"));
        assert_eq!(sess.last_seen, 2_000);
        assert_eq!(sess.started_at, 1_000, "started_at é do primeiro sinal");
        // Stop = ociosa (turno acabou; sessão segue aberta no terminal).
        let s = normalize(HookDialect::ClaudeSettings, None, &stop()).unwrap();
        apply_signal(&mut map, "claude-code", s, 3_000);
        assert_eq!(snapshot(&map)[0].status, "idle");
        // SessionEnd = some do mapa (fim de verdade).
        let s = normalize(HookDialect::ClaudeSettings, None, &session_end()).unwrap();
        assert_eq!(s.kind, SignalKind::End);
        assert!(apply_signal(&mut map, "claude-code", s, 4_000));
        assert!(map.is_empty());
    }

    #[test]
    fn codex_fala_o_mesmo_dialeto_do_claude() {
        // [E4]: schema idêntico — o MESMO payload shape normaliza igual.
        let s = normalize(HookDialect::CodexHooksJson, None, &pre_tool_use()).unwrap();
        assert_eq!(s.kind, SignalKind::Working);
        assert_eq!(s.session_id, "b1cec953-fecf-4ad0-b7e4-b64e8ed159eb");
    }

    #[test]
    fn notification_distingue_permissao_de_espera() {
        let mut base = session_start();
        base["hook_event_name"] = json!("Notification");
        base["notification_type"] = json!("permission_prompt");
        let s = normalize(HookDialect::ClaudeSettings, None, &base).unwrap();
        assert_eq!(s.kind, SignalKind::Blocked);
        base["notification_type"] = json!("idle_prompt");
        let s = normalize(HookDialect::ClaudeSettings, None, &base).unwrap();
        assert_eq!(s.kind, SignalKind::Waiting);
        // tipo desconhecido degrada pra waiting (notificação = precisa de você).
        base["notification_type"] = json!("tipo_novo_do_futuro");
        assert_eq!(
            normalize(HookDialect::ClaudeSettings, None, &base)
                .unwrap()
                .kind,
            SignalKind::Waiting
        );
    }

    #[test]
    fn agy_usa_o_header_de_evento_e_o_conversation_id() {
        // o payload do agy NÃO carrega o nome do evento: sem header, ignora.
        assert!(normalize(HookDialect::AgyConfigHooks, None, &agy_pre_tool_use()).is_none());
        let s = normalize(
            HookDialect::AgyConfigHooks,
            Some("PreToolUse"),
            &agy_pre_tool_use(),
        )
        .unwrap();
        assert_eq!(s.session_id, "ec33ebf9-0cba-4100-8142-c61503f6c587");
        assert_eq!(s.cwd, "/Users/viniciusmachado/projetos/mycockpit");
        assert_eq!(s.tool.as_deref(), Some("run_command"));
        assert_eq!(s.kind, SignalKind::Working);
        // Stop do agy = ociosa.
        let s = normalize(
            HookDialect::AgyConfigHooks,
            Some("Stop"),
            &json!({ "conversationId": "abc", "terminationReason": "model_stop" }),
        )
        .unwrap();
        assert_eq!(s.kind, SignalKind::Idle);
    }

    #[test]
    fn evento_desconhecido_e_payload_sem_sessao_sao_ignorados() {
        // fail-open: nunca crasha, nunca inventa presença.
        let mut v = session_start();
        v["hook_event_name"] = json!("EventoNovoDoFuturo");
        assert!(normalize(HookDialect::ClaudeSettings, None, &v).is_none());
        assert!(normalize(HookDialect::ClaudeSettings, None, &json!({})).is_none());
        assert!(normalize(
            HookDialect::ClaudeSettings,
            None,
            &json!({ "hook_event_name": "Stop", "session_id": "" })
        )
        .is_none());
        assert!(normalize(
            HookDialect::AgyConfigHooks,
            Some("EventoNovo"),
            &agy_pre_tool_use()
        )
        .is_none());
    }

    #[test]
    fn sessao_muda_some_com_a_poda_por_idade() {
        let mut map = HashMap::new();
        let s = normalize(HookDialect::ClaudeSettings, None, &session_start()).unwrap();
        apply_signal(&mut map, "claude-code", s, 0);
        // outra sessão chega 5h depois: a primeira (muda há 5h) é podada.
        let mut outro = session_start();
        outro["session_id"] = json!("sessao-nova");
        let s = normalize(HookDialect::ClaudeSettings, None, &outro).unwrap();
        apply_signal(&mut map, "claude-code", s, 5 * 60 * 60 * 1000);
        let list = snapshot(&map);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].session_id, "sessao-nova");
    }

    // ---- H2: permissão síncrona ----

    /// PermissionRequest do claude — shape das docs oficiais (verificadas
    /// 12/08/2026). Só dispara em sessão INTERATIVA (em `-p` a tool é
    /// auto-negada sem o evento — verificado empiricamente nesta máquina),
    /// por isso a fixture vem do contrato documentado + o script vivo do
    /// Xirp que o consome [E2], não de uma captura headless.
    fn claude_permission_request() -> Value {
        json!({
            "session_id": "26f8cfe6-f107-46c5-834c-ab8b2832cf11",
            "prompt_id": "2a11c663-ffed-4e36-a45d-5746b838cbe8",
            "transcript_path": "/Users/x/.claude/projects/y/26f8cfe6.jsonl",
            "cwd": "/Users/viniciusmachado/projetos/mycockpit",
            "permission_mode": "default",
            "hook_event_name": "PermissionRequest",
            "tool_name": "Bash",
            "tool_input": {
                "command": "rm -rf /tmp/build",
                "description": "Clean build directory"
            },
            "tool_use_id": "toolu_01Q3avbS4mjEZrbrrCxWm7XT"
        })
    }

    #[test]
    fn parse_do_pedido_de_permissao_do_claude_family() {
        for d in [HookDialect::ClaudeSettings, HookDialect::CodexHooksJson] {
            let p = parse_permission(d, &claude_permission_request()).unwrap();
            assert_eq!(p.tool_name, "Bash");
            assert_eq!(p.command, "rm -rf /tmp/build");
            assert_eq!(p.session_id, "26f8cfe6-f107-46c5-834c-ab8b2832cf11");
            assert_eq!(p.cwd, "/Users/viniciusmachado/projetos/mycockpit");
            assert!(!p.is_question);
        }
        // payload sem session_id: None (o gateway devolve ask sem segurar).
        assert!(parse_permission(
            HookDialect::ClaudeSettings,
            &json!({ "hook_event_name": "PermissionRequest", "tool_name": "Bash" })
        )
        .is_none());
    }

    #[test]
    fn ask_user_question_e_pergunta_nao_permissao() {
        // distinção por nome de tool, como o Orca faz — confinada ao dialeto.
        let mut v = claude_permission_request();
        v["tool_name"] = json!("AskUserQuestion");
        v["tool_input"] = json!({ "questions": [] });
        let p = parse_permission(HookDialect::ClaudeSettings, &v).unwrap();
        assert!(p.is_question);
    }

    #[test]
    fn parse_do_pedido_de_permissao_do_agy() {
        let p = parse_permission(HookDialect::AgyConfigHooks, &agy_pre_tool_use()).unwrap();
        assert_eq!(p.tool_name, "run_command");
        assert_eq!(p.command, "npm test");
        assert_eq!(p.session_id, "ec33ebf9-0cba-4100-8142-c61503f6c587");
        assert!(!p.is_question);
    }

    #[test]
    fn decisao_vira_o_stdout_do_dialeto() {
        // claude/codex: hookSpecificOutput.decision.behavior (docs + Xirp).
        let allow = decision_body(HookDialect::ClaudeSettings, &HookDecision::Allow);
        let v: Value = serde_json::from_str(&allow).unwrap();
        assert_eq!(
            v["hookSpecificOutput"]["hookEventName"],
            "PermissionRequest"
        );
        assert_eq!(v["hookSpecificOutput"]["decision"]["behavior"], "allow");
        let deny = decision_body(
            HookDialect::CodexHooksJson,
            &HookDecision::Deny("motivo".into()),
        );
        let v: Value = serde_json::from_str(&deny).unwrap();
        assert_eq!(v["hookSpecificOutput"]["decision"]["behavior"], "deny");
        assert_eq!(
            v["hookSpecificOutput"]["decision"]["decisionReason"],
            "motivo"
        );
        let ask = decision_body(HookDialect::ClaudeSettings, &HookDecision::Ask);
        let v: Value = serde_json::from_str(&ask).unwrap();
        assert_eq!(v["hookSpecificOutput"]["decision"]["behavior"], "ask");
        // agy: decision de topo (doc embarcada [E9]).
        assert_eq!(
            decision_body(HookDialect::AgyConfigHooks, &HookDecision::Allow),
            r#"{"decision":"allow"}"#
        );
        assert_eq!(
            decision_body(HookDialect::AgyConfigHooks, &HookDecision::Ask),
            r#"{"decision":"ask"}"#
        );
        let deny = decision_body(
            HookDialect::AgyConfigHooks,
            &HookDecision::Deny("não".into()),
        );
        let v: Value = serde_json::from_str(&deny).unwrap();
        assert_eq!(v["decision"], "deny");
        assert_eq!(v["reason"], "não");
    }

    #[test]
    fn resposta_humana_vira_decisao_e_lixo_vira_ask() {
        assert_eq!(
            decision_from_answer(&json!({ "allow": true })),
            HookDecision::Allow
        );
        assert_eq!(
            decision_from_answer(&json!({ "allow": false, "message": "perigoso" })),
            HookDecision::Deny("perigoso".into())
        );
        assert_eq!(
            decision_from_answer(&json!({ "allow": false })),
            HookDecision::Deny("negado pelo usuário na Frota".into())
        );
        // shape inesperado NUNCA vira deny fabricado: ask (fluxo nativo).
        assert_eq!(decision_from_answer(&json!({})), HookDecision::Ask);
        assert_eq!(decision_from_answer(&json!("allow")), HookDecision::Ask);
    }

    /// A máquina da pendência: chega → humano responde → resolve com a
    /// decisão; sem resposta → timeout → ask; e o registro fica limpo nos
    /// dois caminhos (nada vaza).
    #[tokio::test]
    async fn pendencia_respondida_resolve_e_timeout_vira_ask() {
        let pending = std::sync::Arc::new(crate::approval::PendingApprovals::default());
        // caminho 1: humano permite (o answer_interaction destrava o tx).
        let rx = register_pending(&pending, "hookperm-t-1").unwrap();
        {
            let mut map = pending.0.lock().unwrap();
            let p = map.remove("hookperm-t-1").unwrap();
            let _ = p.tx.send(json!({ "allow": true }));
        }
        let d = await_decision(
            &pending,
            "hookperm-t-1",
            rx,
            std::time::Duration::from_millis(1_000),
        )
        .await;
        assert_eq!(d, HookDecision::Allow);
        // caminho 2: ninguém responde → ask no teto, sem pendurar.
        let rx = register_pending(&pending, "hookperm-t-2").unwrap();
        let d = await_decision(
            &pending,
            "hookperm-t-2",
            rx,
            std::time::Duration::from_millis(20),
        )
        .await;
        assert_eq!(d, HookDecision::Ask);
        assert!(
            pending.0.lock().unwrap().is_empty(),
            "o registro tem que ficar limpo nos dois caminhos"
        );
    }

    #[test]
    fn teto_de_pendencias_degrada_o_pedido_novo_em_vez_de_enfileirar() {
        // gate PRÓPRIO do teste (o de produção é do processo): 8 pedidos
        // ocupam a fila; o 9º não entra.
        let gate = PermissionGate::new();
        let vagas: Vec<_> = (0..MAX_PENDING_PERMISSIONS)
            .map(|i| gate.reserve().unwrap_or_else(|| panic!("vaga {i}")))
            .collect();
        assert_eq!(vagas.len(), MAX_PENDING_PERMISSIONS);
        assert_eq!(gate.pending(), MAX_PENDING_PERMISSIONS);
        assert!(
            gate.reserve().is_none(),
            "acima do teto o pedido novo NÃO entra na fila"
        );
        // e o que ele devolve é o desfecho neutro, nunca um allow fantasma.
        for d in [
            HookDialect::ClaudeSettings,
            HookDialect::CodexHooksJson,
            HookDialect::AgyConfigHooks,
        ] {
            let body = decision_body(d, &HookDecision::Ask);
            assert!(!body.contains("allow"), "{d:?}: {body}");
            assert!(!body.contains("deny"), "{d:?}: {body}");
            assert!(body.contains("ask"), "{d:?}: {body}");
        }
    }

    #[test]
    fn vaga_volta_pro_teto_quando_o_pedido_termina() {
        // RAII: qualquer saída do round-trip (decisão, timeout, erro) devolve
        // a vaga — senão o teto viraria um travamento permanente.
        let gate = PermissionGate::new();
        {
            let _v = gate.reserve().unwrap();
            assert_eq!(gate.pending(), 1);
        }
        assert_eq!(gate.pending(), 0);
        let mut vagas: Vec<_> = (0..MAX_PENDING_PERMISSIONS)
            .filter_map(|_| gate.reserve())
            .collect();
        assert!(gate.reserve().is_none());
        vagas.pop();
        assert!(
            gate.reserve().is_some(),
            "uma pendência resolvida abre lugar pra próxima"
        );
    }

    #[test]
    fn correlate_run_marca_o_spawn_como_nosso() {
        // o ponto ÚNICO por onde run_once/app-server/meta-tarefa passam: sem
        // isto o POST do hook chegaria sem X-Mycockpit-Run e viraria fantasma.
        let mut cmd = tokio::process::Command::new("claude");
        correlate_run(&mut cmd, "run-abc");
        let env = cmd
            .as_std()
            .get_envs()
            .find(|(k, _)| *k == std::ffi::OsStr::new(RUN_ENV))
            .and_then(|(_, v)| v)
            .map(|v| v.to_string_lossy().into_owned());
        assert_eq!(env.as_deref(), Some("run-abc"));
    }

    #[test]
    fn teto_de_sessoes_nao_estoura() {
        let mut map = HashMap::new();
        for i in 0..(CAP + 20) {
            let mut v = session_start();
            v["session_id"] = json!(format!("s-{i}"));
            let s = normalize(HookDialect::ClaudeSettings, None, &v).unwrap();
            apply_signal(&mut map, "claude-code", s, 1_000);
        }
        assert_eq!(map.len(), CAP);
    }
}
