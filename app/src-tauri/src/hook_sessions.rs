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
pub const RUN_ENV: &str = "MYCOCKPIT_RUN_ID";

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
    Some(HookSignal { session_id, cwd, kind, event, tool })
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
    Some(HookSignal { session_id, cwd, kind, event, tool })
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
    v.sort_by(|a, b| b.last_seen.cmp(&a.last_seen).then(a.session_id.cmp(&b.session_id)));
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
    state
        .0
        .lock()
        .map(|m| snapshot(&m))
        .unwrap_or_default()
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
            normalize(HookDialect::ClaudeSettings, None, &base).unwrap().kind,
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
