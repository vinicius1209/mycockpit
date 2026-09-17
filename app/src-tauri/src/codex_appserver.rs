//! Transporte `codex app-server` — o ÚNICO caminho em que o Codex PEDE permissão.
//!
//! POR QUE existe: `codex exec` (o transporte histórico, ver `CodexAdapter`) é MÃO
//! ÚNICA — ele conta o que JÁ fez. Não há `--ask-for-approval` no `exec` e, sem TTY,
//! ele nunca pausa. Resultado: no modo "Padrão" o Codex nunca perguntava nada, só
//! mudava o confinamento — o seletor de permissões prometia um contrato que não
//! existia. O `codex app-server` é o MESMO binário falando JSON-RPC (NDJSON) pelo
//! stdio: aí ele consegue mandar `item/commandExecution/requestApproval` e FICAR
//! PARADO esperando a nossa resposta. É o que a extensão de IDE do Codex usa.
//!
//! VERIFICADO na máquina (codex-cli 0.144.6, 2026-07):
//!   • enquadramento NDJSON; a RESPOSTA do servidor nem repete `"jsonrpc"` → o
//!     parse classifica por forma (id+result/error = resposta, method+id = pedido,
//!     method sozinho = notificação).
//!   • `approvalPolicy: "on-request"` NÃO pediu nada (o modelo só escala se o
//!     sandbox barrar) — `"untrusted"` pede de verdade. É o que o Padrão usa.
//!   • responder `{"decision":"accept"}` destrava e o turno segue até
//!     `turn/completed`. Foi assim que o gate foi provado ponta a ponta.
//!
//! LIMITE CONSCIENTE: `codex app-server` é marcado `[experimental]` no `--help`.
//! Por isso ele NÃO substitui o `exec`: só o modo Padrão passa por aqui, e uma
//! falha ANTES do turno (`startup_error`) faz o `run_agent` cair no `exec` com um
//! aviso visível — nunca um turno morto.

use crate::adapters::{Permission, RunRequest};
use crate::agent::{AgentEvent, RunRegistry};
use crate::approval::{DirectInteractions, PendingApprovals};
use crate::pricing::NormalizedUsage;
use serde_json::{json, Value};
use std::collections::HashSet;
use std::process::Stdio;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncSeekExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::{Mutex, Notify};

/// Ids das requisições que ESTE cliente inicia (o servidor ecoa no `id`).
const ID_INITIALIZE: i64 = 1;
const ID_THREAD: i64 = 2;
const ID_TURN: i64 = 3;
/// 2ª tentativa de abrir a thread, quando o `thread/resume` falhou (sessão sumiu).
const ID_THREAD_RETRY: i64 = 4;

/// Resultado de um run pelo app-server. Os eventos de conteúdo JÁ foram emitidos;
/// quem chama só decide os terminais (Cancelled/Done) — mesma divisão do `run_once`.
pub struct Outcome {
    pub cancelled: bool,
    pub failed: bool,
    /// Falha ANTES do turno começar (spawn, handshake, abertura da thread). É o
    /// ÚNICO caso em que o caller pode cair no transporte antigo sem duplicar
    /// nada na tela — depois do `turn/start` já saiu conteúdo.
    pub startup_error: Option<String>,
}

impl Outcome {
    fn startup(e: impl Into<String>) -> Self {
        Self {
            cancelled: false,
            failed: false,
            startup_error: Some(e.into()),
        }
    }
    fn done(cancelled: bool, failed: bool) -> Self {
        Self {
            cancelled,
            failed,
            startup_error: None,
        }
    }
}

// ----------------------------------------------------------------------------
// Peças PURAS (política, params, mapeamento). Testadas sem subir processo algum.
// ----------------------------------------------------------------------------

/// Política do turno: (approvalPolicy, sandboxPolicy) por modo de permissão.
///
/// `untrusted` é o que faz o Codex PERGUNTAR (verificado: `on-request` deixa o
/// modelo decidir e ele não pergunta). Os demais modos mantêm a semântica que o
/// `exec` já tinha — a função cobre todos p/ o dia em que o app-server virar o
/// transporte único, mas hoje só o Padrão chega aqui.
pub fn policy(permission: Permission, writable_roots: &[String]) -> (Value, Value) {
    match permission {
        Permission::Leitura | Permission::FusionRo => {
            (json!("never"), json!({ "type": "readOnly" }))
        }
        Permission::Padrao => (
            json!("untrusted"),
            json!({ "type": "workspaceWrite", "writableRoots": writable_roots }),
        ),
        Permission::Auto => (
            json!("never"),
            json!({ "type": "workspaceWrite", "writableRoots": writable_roots }),
        ),
        Permission::Liberado => (json!("never"), json!({ "type": "dangerFullAccess" })),
    }
}

/// `sandbox` do `thread/start`/`thread/resume` — enum simples (SandboxMode), não
/// o objeto tagueado do turno. Mesmo teto do `-s` do `codex exec`.
pub fn sandbox_mode(permission: Permission) -> &'static str {
    match permission {
        Permission::Leitura | Permission::FusionRo => "read-only",
        Permission::Padrao | Permission::Auto => "workspace-write",
        Permission::Liberado => "danger-full-access",
    }
}

/// Params de `thread/start` (thread nova) ou `thread/resume` (`resume` presente).
pub fn thread_params(req: &RunRequest, resume: Option<&str>) -> Value {
    let (approval, _) = policy(req.permission, &req.extra_dirs);
    let mut p = json!({
        "cwd": req.cwd,
        "sandbox": sandbox_mode(req.permission),
        "approvalPolicy": approval,
    });
    if let Some(m) = &req.model {
        p["model"] = json!(m);
    }
    if let Some(t) = resume {
        p["threadId"] = json!(t);
    }
    p
}

/// Params de `turn/start`. O prompt vai como `input[0]` de texto; cada anexo vira
/// um item `localImage` (o app-server só recebe path — o `-i` do exec é o gêmeo).
pub fn turn_params(thread_id: &str, req: &RunRequest, prompt: &str) -> Value {
    let (approval, sandbox) = policy(req.permission, &req.extra_dirs);
    let mut input = vec![json!({ "type": "text", "text": prompt })];
    for a in &req.attachments {
        input.push(json!({ "type": "localImage", "path": a.path }));
    }
    let mut p = json!({
        "threadId": thread_id,
        "cwd": req.cwd,
        "approvalPolicy": approval,
        "sandboxPolicy": sandbox,
        "input": input,
    });
    if let Some(m) = &req.model {
        p["model"] = json!(m);
    }
    if let Some(e) = &req.effort {
        p["effort"] = json!(e);
    }
    p
}

/// Estado de parsing que precisa sobreviver entre notificações do stream.
#[derive(Default)]
pub struct StreamState {
    /// itemIds de agentMessage que JÁ receberam delta: no `item/completed` deles
    /// basta fechar a bolha (TextStop). Sem isso o texto sairia DUPLICADO — uma
    /// vez em streaming e outra inteiro no fim.
    streamed: HashSet<String>,
    /// Último `tokenUsage.last` visto — o `turn/completed` não traz usage, então
    /// o Result é montado com este.
    last_usage: Option<NormalizedUsage>,
    /// Modelo (do config/seleção) p/ estimar o custo: o Codex não reporta USD.
    model: Option<String>,
    /// Evidência visual (browser-plan B1): destino em disco dos blocos image
    /// que vierem no `result` de um mcpToolCall. None = degrada sem evidência.
    evidence: Option<crate::evidence::EvidenceSink>,
}

impl StreamState {
    pub fn new(model: Option<String>) -> Self {
        Self {
            model,
            ..Default::default()
        }
    }
}

/// Corta um output longo p/ o cartão da tool (mesma régua do `codex_tool_result`).
fn clip(full: &str) -> (String, u64) {
    let lines = if full.trim().is_empty() {
        0
    } else {
        full.lines().count() as u64
    };
    let mut text: String = full.chars().take(600).collect();
    if full.chars().count() > 600 {
        text.push('…');
    }
    (text, lines)
}

/// Item que começou a executar: publica a folha imediatamente. O completed
/// posterior repete o mesmo id e o reducer deduplica a tool, anexando o result.
fn map_item_started(item: &Value) -> Vec<AgentEvent> {
    let id = item
        .get("id")
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string();
    if id.is_empty() {
        return vec![];
    }
    let text_of = |key: &str| {
        item.get(key)
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_string()
    };
    match item.get("type").and_then(|value| value.as_str()).unwrap_or("") {
        "commandExecution" => vec![AgentEvent::Tool {
            id,
            name: "Bash".into(),
            input: json!({ "command": text_of("command") }),
            parent_tool_id: None,
        }],
        "fileChange" => vec![AgentEvent::Tool {
            id,
            name: "Edit".into(),
            input: item.get("changes").cloned().unwrap_or(Value::Null),
            parent_tool_id: None,
        }],
        "mcpToolCall" | "dynamicToolCall" => vec![AgentEvent::Tool {
            id,
            name: item
                .get("tool")
                .and_then(|value| value.as_str())
                .unwrap_or("mcp")
                .to_string(),
            input: item.get("arguments").cloned().unwrap_or(Value::Null),
            parent_tool_id: None,
        }],
        "webSearch" => vec![AgentEvent::Tool {
            id,
            name: "WebSearch".into(),
            input: json!({ "query": text_of("query") }),
            parent_tool_id: None,
        }],
        // AUTO-COMPACTAÇÃO do codex. Descoberta no binário 0.149: o system
        // prompt dele diz "when you run out of context, the conversation is
        // automatically summarized for you", há a chave
        // `auto_compact_token_limit`, e o item chega como `ContextCompactionItem`
        // (aqui, camelCase, como os irmãos).
        //
        // Isto CAÍA no `_ => vec![]`: a conversa era compactada, o modelo perdia
        // detalhe e você não ficava sabendo. O claude já avisava (compact_boundary,
        // ADR-015) — a diferença entre os motores era invisível, que é o defeito
        // que o §2.2 e o selo do sandbox vêm corrigindo em outros eixos.
        "contextCompaction" => vec![AgentEvent::Notice {
            message: "Contexto cheio: o Codex resumiu a conversa sozinho — o detalhe antigo virou resumo.".to_string(),
        }],
        _ => vec![],
    }
}

/// Um `ThreadItem` concluído → Tool + ToolResult. No app-server a Tool pode já
/// ter vindo no `item/started`; repetir o id é intencional e replay-safe porque
/// o reducer deduplica a abertura e anexa este resultado.
fn map_item_completed(item: &Value, st: &mut StreamState) -> Vec<AgentEvent> {
    let id = item
        .get("id")
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string();
    let kind = item.get("type").and_then(|x| x.as_str()).unwrap_or("");
    let text_of = |k: &str| {
        item.get(k)
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .to_string()
    };

    let tool_result = |name_ok: bool, out: String, images: Vec<String>| {
        let (text, lines) = clip(&out);
        AgentEvent::ToolResult {
            id: id.clone(),
            ok: name_ok,
            text,
            lines,
            images,
        }
    };

    match kind {
        "agentMessage" => {
            // já streamado por delta → só fecha a bolha; senão manda o texto cheio
            // (agent sem partial messages nunca fica mudo).
            if st.streamed.remove(&id) {
                return vec![AgentEvent::TextStop];
            }
            let t = text_of("text");
            if t.trim().is_empty() {
                return vec![];
            }
            vec![AgentEvent::Text { text: t }, AgentEvent::TextStop]
        }
        "commandExecution" => {
            let exit = item.get("exitCode").and_then(|x| x.as_i64());
            let ok = exit.map(|c| c == 0).unwrap_or(true);
            let out = item
                .get("aggregatedOutput")
                .and_then(|x| x.as_str())
                .unwrap_or("")
                .to_string();
            vec![
                AgentEvent::Tool {
                    id: id.clone(),
                    name: "Bash".to_string(),
                    input: json!({ "command": text_of("command") }),
                    parent_tool_id: None,
                },
                tool_result(ok, out, Vec::new()),
            ]
        }
        "fileChange" => {
            let status = item.get("status").and_then(|x| x.as_str()).unwrap_or("");
            let ok = !matches!(status, "failed" | "declined" | "cancelled");
            vec![
                AgentEvent::Tool {
                    id: id.clone(),
                    name: "Edit".to_string(),
                    input: item.get("changes").cloned().unwrap_or(Value::Null),
                    parent_tool_id: None,
                },
                tool_result(ok, status.to_string(), Vec::new()),
            ]
        }
        "mcpToolCall" | "dynamicToolCall" => {
            let err = item.get("error").filter(|x| !x.is_null());
            // B1: blocos image do CallToolResult MCP viram evidência em disco;
            // com content estruturado, o texto do cartão vem dos blocos `text`
            // (antes o JSON cru — base64 incluso — entrava no clip de 600).
            let images = crate::evidence::collect_images(
                st.evidence.as_ref(),
                &id,
                item.pointer("/result/content").unwrap_or(&Value::Null),
            );
            let out = match err {
                Some(e) => e.to_string(),
                None => match item.pointer("/result/content").and_then(|c| c.as_array()) {
                    Some(blocks) => blocks
                        .iter()
                        .filter_map(|b| b.get("text").and_then(|x| x.as_str()))
                        .collect::<Vec<_>>()
                        .join("\n"),
                    None => item
                        .get("result")
                        .map(|r| r.to_string())
                        .unwrap_or_default(),
                },
            };
            vec![
                AgentEvent::Tool {
                    id: id.clone(),
                    name: item
                        .get("tool")
                        .and_then(|x| x.as_str())
                        .unwrap_or("mcp")
                        .to_string(),
                    input: item.get("arguments").cloned().unwrap_or(Value::Null),
                    parent_tool_id: None,
                },
                tool_result(err.is_none(), out, images),
            ]
        }
        "webSearch" => vec![
            AgentEvent::Tool {
                id: id.clone(),
                name: "WebSearch".to_string(),
                input: json!({ "query": text_of("query") }),
                parent_tool_id: None,
            },
            tool_result(true, String::new(), Vec::new()),
        ],
        // userMessage (o nosso próprio prompt), reasoning, plan… não viram cartão.
        _ => vec![],
    }
}

/// Notificação do servidor → eventos normalizados. PURA (o estado do stream entra
/// por `st`), então o mapeamento inteiro é testável sem subir o `codex`.
pub fn map_notification(method: &str, params: &Value, st: &mut StreamState) -> Vec<AgentEvent> {
    match method {
        "thread/started" => {
            let id = params
                .pointer("/thread/id")
                .and_then(|x| x.as_str())
                .unwrap_or_default()
                .to_string();
            vec![AgentEvent::Session {
                session_id: id,
                model: st.model.clone(),
                tools: 0,
            }]
        }
        "item/agentMessage/delta" => {
            let delta = params.get("delta").and_then(|x| x.as_str()).unwrap_or("");
            if delta.is_empty() {
                return vec![];
            }
            if let Some(item) = params.get("itemId").and_then(|x| x.as_str()) {
                st.streamed.insert(item.to_string());
            }
            vec![AgentEvent::TextDelta {
                text: delta.to_string(),
            }]
        }
        "item/completed" => match params.get("item") {
            Some(item) => map_item_completed(item, st),
            None => vec![],
        },
        // codex 0.154.0 (binário real, ADR-200): o `exec_command` que passa do
        // `yield_time_ms` segue rodando e manda a saída por aqui, linha a linha,
        // inclusive depois do `turn/completed` enquanto o app-server vive.
        "item/commandExecution/outputDelta" => {
            let delta = params.get("delta").and_then(|x| x.as_str()).unwrap_or("");
            match params.get("itemId").and_then(|x| x.as_str()) {
                Some(id) if !delta.is_empty() => vec![AgentEvent::ToolOutput {
                    id: id.to_string(),
                    text: delta.to_string(),
                }],
                _ => vec![],
            }
        }
        "item/started" => match params.get("item") {
            Some(item) => map_item_started(item),
            None => vec![],
        },
        "thread/tokenUsage/updated" => {
            let last = params.pointer("/tokenUsage/last");
            let get = |k: &str| {
                last.and_then(|u| u.get(k))
                    .and_then(|x| x.as_u64())
                    .unwrap_or(0)
            };
            let nu = NormalizedUsage {
                input: get("inputTokens"),
                cached_input: get("cachedInputTokens"),
                output: get("outputTokens"),
            };
            let ctx = nu.input.max(nu.cached_input);
            let window_tokens = params
                .pointer("/tokenUsage/modelContextWindow")
                .and_then(Value::as_u64)
                .filter(|n| *n > 0);
            st.last_usage = Some(nu);
            if ctx > 0 {
                vec![AgentEvent::ContextUsage {
                    tokens: ctx,
                    window_tokens,
                }]
            } else {
                vec![]
            }
        }
        "turn/completed" => {
            let had_usage = st.last_usage.is_some();
            let nu = st.last_usage.take().unwrap_or(NormalizedUsage {
                input: 0,
                cached_input: 0,
                output: 0,
            });
            // Codex não reporta USD → estima por tokens × tabela (igual ao exec).
            // `st.model` vem de `codex_cost_model` (requisitado → config.toml →
            // `None`, nunca um chute) — string vazia não casa catálogo nem SEED,
            // vira `(None, Unknown)` honesto em vez de gpt-5.5 inventado.
            let model = st.model.clone().unwrap_or_default();
            let (cost_usd, cost_source) = crate::pricing::estimate(&model, &nu);
            let mut out = Vec::new();
            if !had_usage || nu.input.max(nu.cached_input) == 0 {
                out.push(AgentEvent::ContextUnavailable);
            }
            out.push(AgentEvent::Result {
                ok: true,
                text: None,
                cost_usd,
                cost_source,
                input_tokens: nu.input,
                output_tokens: nu.output,
                cache_read: nu.cached_input,
                cache_creation: 0,
                // Assimetria REAL entre os dois transportes do Codex (ADR-033):
                // aqui o app-server publica `tokenUsage.last` (o ÚLTIMO turno),
                // enquanto o `codex exec --json` só publica o acumulado da
                // thread no `turn.completed`. Este caminho já é por turno →
                // nada a acumular, nada a devolver como baseline.
                cumulative_usage: None,
            });
            out
        }
        // Ruído de infraestrutura do app-server (subida de MCP, rate limits, hooks,
        // status de thread…): não vira evento. NÃO é "descartar em silêncio" — o
        // stream aqui é conversacional, não um log de turno como no `exec`.
        _ => vec![],
    }
}

/// Mensagem de erro estruturada de uma notificação `error`.
pub fn error_message(params: &Value) -> String {
    params
        .pointer("/error/message")
        .and_then(|x| x.as_str())
        .unwrap_or("o turno do codex falhou")
        .to_string()
}

/// Pedido servidor→cliente → cartão da UI (mesmo contrato do socket do Claude:
/// kind + data). `None` = pedido que ainda não sabemos representar.
pub fn approval_card(method: &str, params: &Value) -> Option<(&'static str, Value)> {
    let s = |k: &str| params.get(k).and_then(|x| x.as_str()).unwrap_or("");
    match method {
        "item/commandExecution/requestApproval" => Some((
            "approval",
            json!({
                "tool_name": "Bash",
                "command": s("command"),
                "input": { "command": s("command"), "cwd": s("cwd"), "reason": params.get("reason") },
            }),
        )),
        "item/fileChange/requestApproval" => Some((
            "approval",
            json!({
                "tool_name": "Edit",
                "command": s("grantRoot"),
                "input": { "reason": params.get("reason"), "grant_root": s("grantRoot") },
            }),
        )),
        _ => None,
    }
}

/// Resposta do usuário (contrato da UI: `{allow, message?}`) → `decision` do Codex.
/// `decline` (e não `cancel`) no negar: o turno CONTINUA e o modelo pode explicar
/// ou tentar outro caminho — `cancel` mataria o turno inteiro.
pub fn decision(answer: &Value) -> Value {
    let allow = answer
        .get("allow")
        .and_then(|x| x.as_bool())
        .unwrap_or(false);
    json!({ "decision": if allow { "accept" } else { "decline" } })
}

// ----------------------------------------------------------------------------
// Driver: spawn + máquina de estados do handshake + loop do stream.
// ----------------------------------------------------------------------------

/// Escreve UMA mensagem NDJSON no stdin do app-server.
async fn write_msg(stdin: &Arc<Mutex<ChildStdin>>, msg: &Value) -> std::io::Result<()> {
    let mut buf = msg.to_string();
    buf.push('\n');
    let mut w = stdin.lock().await;
    w.write_all(buf.as_bytes()).await?;
    w.flush().await
}

fn request(id: i64, method: &str, params: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params })
}

// ----------------------------------------------------------------------------
// Sonda ONE-SHOT (sem turno): o canal read-only que as capabilities de leitura
// compartilham. Existe UM handshake no app inteiro — o medidor de janela de uso
// (usage_window.rs) e a lista de modelos (model_list.rs) chamam daqui em vez de
// cada um subir o seu app-server com a sua cópia do initialize.
// ----------------------------------------------------------------------------

/// Falha de uma sonda one-shot. `kind` é estável porque o caller ramifica nele
/// (o `rpc` carrega a frase do SERVIDOR e é o único que o caller reclassifica).
pub struct ProbeError {
    pub kind: &'static str,
    pub message: String,
}

/// Snapshot confiável do contexto corrente de uma thread Codex. Os dois
/// campos vêm do mesmo evento `token_count` gravado pelo runtime no rollout.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ThreadContext {
    pub tokens: u64,
    pub window_tokens: u64,
}

impl ProbeError {
    fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
        }
    }
}

/// Sobe `codex -s read-only -a untrusted app-server`, faz
/// initialize → initialized → `method`, devolve o `result` e mata o processo.
///
/// READ-ONLY e SEM TURNO: nenhuma quota é consumida (foi assim que o
/// `account/rateLimits/read` foi provado na mão em 12/08/2026 e o `model/list`
/// em 14/08/2026). O framing é NDJSON e a resposta do servidor nem repete
/// `"jsonrpc"` — a classificação é por FORMA (`id` da requisição + result/error),
/// igual ao driver de turno acima. Linha de stdout que não é JSON é log do
/// próprio CLI e é ignorada (mesma postura do transporte).
pub async fn probe_once(
    method: &str,
    params: Value,
    timeout_secs: u64,
) -> Result<Value, ProbeError> {
    const ID_PROBE: i64 = 2;
    let mut cmd = Command::new("codex");
    // `-a never` e não `untrusted`: o codex 0.149 REMOVEU o valor `untrusted`
    // da flag (`possible values: on-request, never`) e a CLI passou a recusar
    // subir — o medidor de uso ficou "falhando desde 23:41" sem dizer por quê.
    //
    // Trocar aqui NÃO afrouxa turno nenhum, e isso foi verificado: a política de
    // aprovação real viaja no `approvalPolicy` de CADA `thread/start`, e o
    // protocolo CONTINUA aceitando `"untrusted"` ali (testado nesta versão,
    // com o processo subido em `-a never`). A flag da CLI é só o default do
    // processo; quem manda no turno é o parâmetro.
    cmd.args(["-s", "read-only", "-a", "never", "app-server"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // O stderr era `null`, e foi por isso que a falha chegou na tela como
        // "resposta inesperada": a CLI escreveu `invalid value 'untrusted'` e a
        // gente descartou. Mesma lição da ADR-045 — não jogue fora o motivo.
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = cmd.spawn().map_err(|e| {
        ProbeError::new(
            "spawn",
            format!("não consegui subir o codex app-server: {e}"),
        )
    })?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| ProbeError::new("spawn", "app-server sem stdin"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ProbeError::new("spawn", "app-server sem stdout"))?;
    // Guarda o stderr pra ANEXAR ao erro. Quando a CLI recusa uma flag ela
    // morre em silêncio no protocolo (nenhum JSON sai) e escreve o motivo AQUI;
    // sem isto, "invalid value 'untrusted'" virava "app-server encerrou antes
    // de responder", que não aponta pra lugar nenhum.
    let erro_da_cli = child.stderr.take();

    let run = async {
        for msg in [
            request(
                ID_INITIALIZE,
                "initialize",
                json!({"clientInfo":{"name":"frota","title":"Frota","version":env!("CARGO_PKG_VERSION")}}),
            ),
            json!({"jsonrpc":"2.0","method":"initialized"}),
            request(ID_PROBE, method, params),
        ] {
            let mut line = msg.to_string();
            line.push('\n');
            stdin
                .write_all(line.as_bytes())
                .await
                .map_err(|e| ProbeError::new("protocol", format!("stdin fechou: {e}")))?;
        }
        let _ = stdin.flush().await;
        let mut lines = BufReader::new(stdout).lines();
        loop {
            let line = lines
                .next_line()
                .await
                .map_err(|e| ProbeError::new("protocol", format!("stdout falhou: {e}")))?
                .ok_or_else(|| {
                    ProbeError::new("protocol", "app-server encerrou antes de responder")
                })?;
            let Ok(v) = serde_json::from_str::<Value>(line.trim()) else {
                continue; // log no stdout: ignora (mesma postura do transporte)
            };
            if v.get("id").and_then(|x| x.as_i64()) != Some(ID_PROBE) {
                continue;
            }
            if let Some(err) = v.get("error") {
                let msg = err
                    .get("message")
                    .and_then(|x| x.as_str())
                    .unwrap_or("erro sem mensagem")
                    .to_string();
                return Err(ProbeError::new("rpc", msg));
            }
            return Ok(v.get("result").cloned().unwrap_or(Value::Null));
        }
    };
    // Teto no probe inteiro: um app-server pendurado não pode segurar quem
    // chamou (o kill_on_drop derruba o processo junto).
    let out = tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), run)
        .await
        .unwrap_or_else(|_| {
            Err(ProbeError::new(
                "timeout",
                format!("o app-server não respondeu em {timeout_secs}s"),
            ))
        });
    let _ = child.kill().await;
    // Só lê o stderr no caminho de FALHA: no sucesso ele é ruído, e ler sempre
    // pagaria por um dado que ninguém usa.
    match out {
        Ok(v) => Ok(v),
        Err(e) => Err(match erro_da_cli {
            Some(se) => {
                let mut buf = String::new();
                let mut linhas = BufReader::new(se).lines();
                while let Ok(Some(l)) = linhas.next_line().await {
                    buf.push_str(&l);
                    buf.push('\n');
                    if buf.len() > 2000 {
                        break; // CLI tagarela não vira despejo de memória
                    }
                }
                let motivo = primeira_linha_util(&buf);
                if motivo.is_empty() {
                    e
                } else {
                    ProbeError::new(e.kind, format!("{} ({motivo})", e.message))
                }
            }
            None => e,
        }),
    }
}

/// Lê o footprint da ÚLTIMA chamada de uma thread criada pelo `codex exec`.
///
/// O JSONL público do exec só entrega `turn.completed.usage`, que é o total da
/// THREAD e serve para custo, não para o medidor. O app-server conhece o path
/// do rollout sem carregar os turnos (`thread/read includeTurns:false`); o
/// arquivo, por sua vez, guarda `last_token_usage` e `model_context_window` no
/// evento `token_count`. Se qualquer elo faltar, devolve erro e o chamador
/// publica `ContextUnavailable` em vez de reaproveitar um número antigo.
pub async fn probe_thread_context(thread_id: &str) -> Result<ThreadContext, ProbeError> {
    let result = probe_once(
        "thread/read",
        json!({ "threadId": thread_id, "includeTurns": false }),
        5,
    )
    .await?;
    let raw_path = result
        .pointer("/thread/path")
        .or_else(|| result.get("path"))
        .and_then(Value::as_str)
        .ok_or_else(|| ProbeError::new("protocol", "thread/read respondeu sem path"))?;
    let path = std::path::PathBuf::from(raw_path);
    let valid_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.ends_with(".jsonl") && n.contains(thread_id));
    if !path.is_absolute() || !valid_name {
        return Err(ProbeError::new(
            "protocol",
            "thread/read respondeu com path de rollout inválido",
        ));
    }
    let tail = rollout_tail(&path, 4 * 1024 * 1024).await?;
    parse_thread_context(&tail).ok_or_else(|| {
        ProbeError::new(
            "protocol",
            "rollout sem last_token_usage e model_context_window válidos",
        )
    })
}

async fn rollout_tail(path: &std::path::Path, max_bytes: u64) -> Result<String, ProbeError> {
    let mut file = tokio::fs::File::open(path)
        .await
        .map_err(|e| ProbeError::new("io", format!("não consegui abrir o rollout: {e}")))?;
    let len = file
        .metadata()
        .await
        .map_err(|e| ProbeError::new("io", format!("não consegui medir o rollout: {e}")))?
        .len();
    let start = len.saturating_sub(max_bytes);
    file.seek(std::io::SeekFrom::Start(start))
        .await
        .map_err(|e| ProbeError::new("io", format!("não consegui ler o rollout: {e}")))?;
    let mut bytes = Vec::with_capacity((len - start).min(max_bytes) as usize);
    file.read_to_end(&mut bytes)
        .await
        .map_err(|e| ProbeError::new("io", format!("não consegui ler o rollout: {e}")))?;
    if start > 0 {
        if let Some(first_line_end) = bytes.iter().position(|b| *b == b'\n') {
            bytes.drain(..=first_line_end);
        }
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Tail de rollout → último snapshot utilizável. Anda de trás para frente:
/// qualquer evento posterior irrelevante não encobre a medição final.
fn parse_thread_context(tail: &str) -> Option<ThreadContext> {
    for line in tail.lines().rev() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if value.pointer("/payload/type").and_then(Value::as_str) != Some("token_count") {
            continue;
        }
        let payload = value.get("payload")?;
        // ADR-198: o Codex compara ao limiar o `total_tokens` da última
        // chamada (entrada E saída, `context_window.rs` do 0.154.0). A saída
        // entra no próximo prompt, então medir só a entrada subestimava o anel
        // em até 4 mil tokens. Rollout sem `total_tokens` segue na entrada.
        let tokens = payload
            .pointer("/info/last_token_usage/total_tokens")
            .or_else(|| payload.pointer("/last_token_usage/total_tokens"))
            .or_else(|| payload.pointer("/info/last_token_usage/input_tokens"))
            .or_else(|| payload.pointer("/last_token_usage/input_tokens"))
            .and_then(Value::as_u64);
        let window_tokens = payload
            .pointer("/info/model_context_window")
            .or_else(|| payload.get("model_context_window"))
            .and_then(Value::as_u64);
        if let (Some(tokens), Some(window_tokens)) = (tokens, window_tokens) {
            if tokens > 0 && window_tokens > 0 {
                return Some(ThreadContext {
                    tokens,
                    window_tokens,
                });
            }
        }
        // É o token_count mais recente, mas está incompleto/zerado. Voltar a
        // um snapshot anterior faria dado velho parecer atual.
        return None;
    }
    None
}

/// A primeira linha do stderr que EXPLICA alguma coisa, cortada.
///
/// Pura e curta de propósito: o stderr de uma CLI que recusou flag traz a linha
/// útil no topo e um "For more information, try --help" embaixo. Despejar tudo
/// numa mensagem de UI trocaria um erro mudo por um erro ilegível.
fn primeira_linha_util(stderr: &str) -> String {
    for l in stderr.lines() {
        let t = l.trim();
        if t.is_empty() || t.starts_with("For more information") {
            continue;
        }
        return t.chars().take(160).collect();
    }
    String::new()
}

fn app_server_command(req: &RunRequest) -> Command {
    let mut cmd = Command::new("codex");
    // Mesmo MCP read-only do `codex exec`, por override efêmero. As opções
    // globais precisam vir antes do subcomando `app-server`.
    if !matches!(req.permission, Permission::FusionRo) {
        req.mcp_plan.configure_codex(&mut cmd);
        if let Some(gateway) = &req.context_gateway {
            gateway.configure_codex(&mut cmd);
        }
        if let Some(gateway) = &req.work_gateway {
            gateway.configure_codex(&mut cmd);
        }
        if let Some(gateway) = &req.tool_gateway {
            gateway.configure_codex(&mut cmd);
        }
    }
    cmd.arg("app-server");
    cmd
}

#[allow(clippy::too_many_arguments)]
pub async fn run(
    app: &tauri::AppHandle,
    run_id: &str,
    conv_id: &str,
    req: &RunRequest,
    cost_model: Option<String>,
    on_event: &Channel<AgentEvent>,
    notify: &Arc<Notify>,
    registry: &RunRegistry,
    pending: Arc<PendingApprovals>,
) -> Outcome {
    let mut cmd = app_server_command(req);
    cmd.current_dir(&req.cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    // Correlação dos hooks de status (mesma env do exec, ver agent.rs): o
    // app-server também herda os hooks globais do codex — sem isto, cada
    // turno nosso apareceria como "sessão externa" no Painel.
    crate::hook_sessions::correlate_run(&mut cmd, run_id);

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => return Outcome::startup(format!("não consegui subir o codex app-server: {e}")),
    };
    let child_pid = child.id();
    if let Some(pid) = child_pid {
        if let Ok(mut pids) = registry.1.lock() {
            pids.insert(run_id.to_string(), pid);
        }
    }
    let stdin = match child.stdin.take() {
        Some(s) => Arc::new(Mutex::new(s)),
        None => return Outcome::startup("sem stdin do codex app-server"),
    };
    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => return Outcome::startup("sem stdout do codex app-server"),
    };
    // stderr do app-server é log (subida de MCP, avisos) — drena p/ o pipe não
    // encher e travar o filho; só vira mensagem se o turno morrer sem explicação.
    let stderr = child.stderr.take();
    let stderr_task = tokio::spawn(async move {
        match stderr {
            Some(stderr) => crate::run_resources::collect_stderr_tail(stderr).await,
            None => crate::run_resources::CapturedTail::default(),
        }
    });
    let mut memory_watch = crate::run_resources::ProcessMemoryWatch::new(child_pid);
    let mut last_byte_at = None;

    // Gate de interação: MESMO registro/evento do socket do Claude, sem socket —
    // aqui o pedido já chega pelo stream. O Drop/shutdown resolve fail-closed
    // qualquer card ainda aberto quando o run morre.
    let interactions = Arc::new(DirectInteractions::new(app.clone(), pending));

    let mut reader = crate::run_resources::LimitedLineReader::new(stdout);
    let mut st = StreamState::new(cost_model);
    // Evidência visual (B1): mesmo sink do caminho `exec` — imagem de MCP
    // vira arquivo, nunca base64 no Channel. None degrada honesto.
    st.evidence = crate::evidence::EvidenceSink::for_conv(app, conv_id);
    let mut thread_id: Option<String> = None;
    let mut turn_id: Option<String> = None;
    let mut prompt = req.prompt.clone();
    let mut turn_started = false;
    let mut cancelled = false;
    let mut failed = false;
    let mut startup_error: Option<String> = None;
    let mut approval_seq: u64 = 0;

    if let Err(e) = write_msg(
        &stdin,
        &request(
            ID_INITIALIZE,
            "initialize",
            json!({ "clientInfo": { "name": "mycockpit", "version": env!("CARGO_PKG_VERSION") } }),
        ),
    )
    .await
    {
        return Outcome::startup(format!("falha no handshake do app-server: {e}"));
    }

    loop {
        tokio::select! {
            status = child.wait() => {
                let detail = status
                    .ok()
                    .and_then(|value| value.code())
                    .map(|code| format!(" (código {code})"))
                    .unwrap_or_default();
                if !turn_started {
                    startup_error = Some(format!("o codex app-server encerrou antes do turno{detail}"));
                } else {
                    failed = true;
                    let _ = on_event.send(AgentEvent::Error {
                        message: format!("o codex app-server encerrou antes do desfecho do turno{detail}"),
                    });
                }
                break;
            }
            line = reader.next_line() => {
                let line = match line {
                    Ok(Some(l)) => {
                        last_byte_at = Some(crate::run_resources::epoch_ms());
                        l
                    },
                    // EOF antes do turno = o app-server caiu na largada → o caller
                    // ainda pode cair no `exec`. Depois que o turno começou, só
                    // `turn/completed` é desfecho normal: EOF não pode virar Done(0).
                    Ok(None) => {
                        if !turn_started && startup_error.is_none() {
                            startup_error = Some("o codex app-server encerrou antes do turno".into());
                        } else if turn_started {
                            failed = true;
                            let _ = on_event.send(AgentEvent::Error {
                                message: "o codex app-server encerrou antes do desfecho do turno".into(),
                            });
                        }
                        break;
                    }
                    Err(error) => {
                        failed = true;
                        let _ = on_event.send(AgentEvent::Error {
                            message: format!("{error}; interrompi o run antes de processar um payload sem teto."),
                        });
                        crate::run_processes::terminate_run(run_id, child_pid);
                        break;
                    }
                };
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                let msg: Value = match serde_json::from_str(line) {
                    Ok(v) => v,
                    Err(_) => continue, // log do servidor no stdout: ignora
                };
                let method = msg.get("method").and_then(|x| x.as_str());
                let has_id = msg.get("id").is_some();

                match (method, has_id) {
                    // ---- pedido servidor→cliente: aprovação ----
                    (Some(m), true) => {
                        let id = msg.get("id").cloned().unwrap_or(Value::Null);
                        let params = msg.get("params").cloned().unwrap_or(Value::Null);
                        match approval_card(m, &params) {
                            Some((kind, data)) => {
                                approval_seq += 1;
                                let req_id = format!("{run_id}-cx{approval_seq}");
                                // task própria: o turno do Codex fica parado, mas o
                                // stream segue sendo lido (e o cancelar continua vivo).
                                let inter = interactions.clone();
                                let stdin2 = stdin.clone();
                                let run_id2 = run_id.to_string();
                                let m2 = m.to_string();
                                tokio::spawn(async move {
                                    let answer = inter.request(&run_id2, &req_id, kind, data).await;
                                    let out = json!({ "id": id, "result": decision(&answer) });
                                    if let Err(e) = write_msg(&stdin2, &out).await {
                                        log::warn!("codex app-server: falha ao responder {m2}: {e}");
                                    }
                                });
                            }
                            None => {
                                // Pedido que ainda não sabemos representar (permissões
                                // granulares, elicitação de MCP, pergunta de tool):
                                // responde erro de método e AVISA — nunca pendura o
                                // turno nem finge que aprovou.
                                let out = json!({
                                    "id": id,
                                    "error": { "code": -32601, "message": "cliente não trata este pedido" }
                                });
                                let _ = write_msg(&stdin, &out).await;
                                let _ = on_event.send(AgentEvent::Notice {
                                    message: format!("Codex pediu `{m}`, que o app ainda não sabe mostrar — recusado."),
                                });
                            }
                        }
                    }
                    // ---- notificação ----
                    (Some(m), false) => {
                        let params = msg.get("params").cloned().unwrap_or(Value::Null);
                        if m == "turn/started" {
                            turn_id = params
                                .pointer("/turn/id")
                                .and_then(|x| x.as_str())
                                .map(str::to_string);
                        }
                        if m == "error" {
                            failed = true;
                            let message = error_message(&params);
                            let _ = on_event.send(match crate::adapters::codex_limit(&message) {
                                Some(hit) => AgentEvent::LimitReached { message, reset_hint: hit.reset_hint },
                                None => AgentEvent::Error { message },
                            });
                            break;
                        }
                        for ev in map_notification(m, &params, &mut st) {
                            let _ = on_event.send(ev);
                        }
                        if m == "turn/completed" {
                            break;
                        }
                    }
                    // ---- resposta a uma requisição nossa ----
                    _ => {
                        let id = msg.get("id").and_then(|x| x.as_i64()).unwrap_or(-1);
                        let err = msg.get("error");
                        match (id, err) {
                            (ID_INITIALIZE, None) => {
                                let _ = write_msg(&stdin, &json!({
                                    "jsonrpc": "2.0", "method": "initialized", "params": {}
                                })).await;
                                let p = thread_params(req, req.resume.as_deref());
                                let m = if req.resume.is_some() { "thread/resume" } else { "thread/start" };
                                let _ = write_msg(&stdin, &request(ID_THREAD, m, p)).await;
                            }
                            (ID_THREAD, Some(e)) | (ID_THREAD_RETRY, Some(e)) => {
                                // resume falhou (sessão sumiu) → degradação graciosa:
                                // thread NOVA + recap do front, o mesmo contrato do
                                // `run_agent`. Se já era thread nova, é falha de start.
                                if id == ID_THREAD && req.resume.is_some() {
                                    // mesmo aviso único do run_agent (agent.rs) — ver
                                    // comentário lá sobre o segundo aviso empilhado.
                                    let used_memory = req.memory_fallback.is_some();
                                    let message = if used_memory {
                                        "Sessão anterior não encontrada; retomei com a memória do Frota."
                                    } else {
                                        "Sessão anterior não encontrada. Comecei uma nova."
                                    };
                                    let _ = on_event.send(AgentEvent::Notice {
                                        message: message.into(),
                                    });
                                    let _ = app.emit("resume://fallback", json!({
                                        "conv_id": conv_id,
                                        "run_id": run_id,
                                        "used_memory": used_memory,
                                    }));
                                    if let Some(fb) = &req.memory_fallback {
                                        prompt = format!("{fb}\n\n---\n\n{}", req.prompt);
                                    }
                                    let p = thread_params(req, None);
                                    let _ = write_msg(&stdin, &request(ID_THREAD_RETRY, "thread/start", p)).await;
                                } else {
                                    startup_error = Some(format!("thread do codex não abriu: {e}"));
                                    break;
                                }
                            }
                            (ID_THREAD, None) | (ID_THREAD_RETRY, None) => {
                                let tid = msg
                                    .pointer("/result/thread/id")
                                    .and_then(|x| x.as_str())
                                    .map(str::to_string);
                                match tid {
                                    Some(t) => {
                                        let p = turn_params(&t, req, &prompt);
                                        thread_id = Some(t);
                                        turn_started = true;
                                        let _ = on_event.send(AgentEvent::Started);
                                        let _ = write_msg(&stdin, &request(ID_TURN, "turn/start", p)).await;
                                    }
                                    None => {
                                        startup_error = Some("resposta de thread sem id".into());
                                        break;
                                    }
                                }
                            }
                            (ID_TURN, Some(e)) => {
                                failed = true;
                                let message = format!("o turno do codex não iniciou: {e}");
                                let _ = on_event.send(AgentEvent::Error { message });
                                break;
                            }
                            (ID_TURN, None) => {
                                turn_id = msg
                                    .pointer("/result/turn/id")
                                    .and_then(|x| x.as_str())
                                    .map(str::to_string);
                            }
                            _ => {}
                        }
                    }
                }
            }
            _ = notify.notified() => {
                cancelled = true;
                // interrupt educado ANTES do kill: dá ao Codex a chance de fechar a
                // thread (o resume seguinte encontra a sessão íntegra).
                if let (Some(t), Some(tu)) = (thread_id.as_ref(), turn_id.as_ref()) {
                    let _ = write_msg(&stdin, &request(9, "turn/interrupt", json!({
                        "threadId": t, "turnId": tu
                    }))).await;
                }
                crate::run_processes::terminate_run(run_id, child_pid);
                break;
            }
            resources = memory_watch.next() => {
                let observation = resources.observation;
                let _ = on_event.send(AgentEvent::RunStatus {
                    main_alive: observation.main_alive,
                    descendants: observation.descendants,
                    rss_mb: observation.rss_mb,
                    last_byte_at,
                    observed_at: crate::run_resources::epoch_ms(),
                });
                if let Some(rss_mb) = resources.warning_rss_mb {
                    let message = crate::run_resources::format_memory_warning_message(
                        rss_mb,
                        observation.root_rss_mb,
                    );
                    let _ = on_event.send(AgentEvent::Notice { message });
                }
            }
        }
    }

    // destrava (fail-closed) qualquer card ainda aberto: o turno morreu, ninguém
    // pode ficar esperando resposta de um run que não existe mais.
    interactions.shutdown();
    crate::run_processes::terminate_run(run_id, child_pid);
    let _ = child.wait().await;
    let stderr_capture = stderr_task.await.unwrap_or_default();
    let stderr_text = stderr_capture.text;

    // Só reporta stderr quando o turno nem começou (senão vira ruído: o
    // app-server loga falha de MCP de terceiros em run perfeitamente saudável).
    if let Some(e) = &mut startup_error {
        if !stderr_text.trim().is_empty() {
            let tail: String = stderr_text
                .lines()
                .rev()
                .take(3)
                .collect::<Vec<_>>()
                .join(" | ");
            e.push_str(&format!(" ({tail})"));
            if stderr_capture.truncated {
                e.push_str(" [stderr limitado aos 64 KiB finais]");
            }
        }
    }

    match startup_error {
        Some(e) => Outcome::startup(e),
        None => Outcome::done(cancelled, failed),
    }
}

#[cfg(test)]
mod tests {

    /// Captura real (codex 0.154.0 contra Responses API local, 16/09/2026): o
    /// comando passou do `yield_time_ms`, o turno fechou e a saída continuou
    /// chegando por `outputDelta` até o `item/completed`.
    #[test]
    fn saida_ao_vivo_do_terminal_vira_tool_output_com_o_id_do_item() {
        let captura = include_str!("../testdata/codex-0.154.0/background-terminal-appserver.jsonl");
        let mut st = StreamState::new(None);
        let mut started = None;
        let mut saida = String::new();
        for linha in captura.lines() {
            let Ok(v) = serde_json::from_str::<Value>(linha) else { continue };
            let Some(method) = v.get("method").and_then(Value::as_str) else { continue };
            let params = v.get("params").cloned().unwrap_or(Value::Null);
            for ev in map_notification(method, &params, &mut st) {
                match ev {
                    AgentEvent::Tool { id, name, .. } if name == "Bash" => started = Some(id),
                    AgentEvent::ToolOutput { id, text } => {
                        assert_eq!(Some(&id), started.as_ref(), "delta amarrado à tool que roda");
                        saida.push_str(&text);
                    }
                    _ => {}
                }
            }
        }
        assert_eq!(saida, "cx 2\ncx 3\ncx 4\ncx 5\ncx 6\nfim\n");
    }

    use super::*;
    use crate::attachments::{Attachment, AttachmentKind};

    fn req(permission: Permission) -> RunRequest {
        RunRequest {
            prompt: "faça X".into(),
            system_prompt: None,
            cwd: "/repo".into(),
            resume: None,
            memory_fallback: None,
            permission,
            model: Some("gpt-5.5".into()),
            effort: Some("high".into()),
            attachments: vec![],
            extra_dirs: vec![],
            approval: None,
            context_gateway: None,
            work_gateway: None,
            tool_gateway: None,
            mcp_plan: crate::mcp_control::McpRunPlan::default(),
            plan_first: false,
            usage_baseline: None,
        }
    }

    #[test]
    fn command_started_fica_visivel_antes_do_completed() {
        let mut st = StreamState::default();
        let evs = map_notification(
            "item/started",
            &json!({
                "item": {
                    "id": "cmd-live",
                    "type": "commandExecution",
                    "command": "pnpm test"
                }
            }),
            &mut st,
        );
        assert!(matches!(
            &evs[0],
            AgentEvent::Tool { id, name, .. }
                if id == "cmd-live" && name == "Bash"
        ));
    }

    /// O achado que motivou o módulo: `on-request` NÃO pergunta (o modelo só
    /// escala se o sandbox barrar). O Padrão TEM que ir de `untrusted`, senão o
    /// gate volta a ser uma promessa vazia.
    #[test]
    fn primeira_linha_util_pega_a_que_explica() {
        // O caso real de 23/08/2026: o codex 0.149 recusou a flag e escreveu
        // isto. A gente descartava, e a tela dizia só "resposta inesperada".
        let real = "error: invalid value 'untrusted' for '--ask-for-approval <APPROVAL_POLICY>'\n  [possible values: on-request, never]\n\nFor more information, try '--help'.\n";
        assert_eq!(
            primeira_linha_util(real),
            "error: invalid value 'untrusted' for '--ask-for-approval <APPROVAL_POLICY>'"
        );
    }

    #[test]
    fn primeira_linha_util_pula_o_rodape_inutil() {
        // "For more information" sozinho não explica nada; promovê-lo a motivo
        // seria trocar um erro mudo por um erro que finge falar.
        assert_eq!(
            primeira_linha_util("\n\nFor more information, try '--help'.\n"),
            ""
        );
        assert_eq!(primeira_linha_util(""), "");
    }

    #[test]
    fn primeira_linha_util_corta_linha_gigante() {
        let g = "x".repeat(500);
        assert_eq!(primeira_linha_util(&g).len(), 160);
    }

    #[test]
    fn padrao_usa_untrusted_o_unico_que_pergunta() {
        let (approval, sandbox) = policy(Permission::Padrao, &[]);
        assert_eq!(approval, json!("untrusted"));
        assert_eq!(sandbox["type"], "workspaceWrite");
    }

    #[test]
    fn liberado_nao_pergunta_e_nao_confina() {
        let (approval, sandbox) = policy(Permission::Liberado, &[]);
        assert_eq!(approval, json!("never"));
        assert_eq!(sandbox["type"], "dangerFullAccess");
    }

    #[test]
    fn leitura_e_fusion_ro_sao_read_only_sem_pedir() {
        for p in [Permission::Leitura, Permission::FusionRo] {
            let (approval, sandbox) = policy(p, &[]);
            assert_eq!(approval, json!("never"));
            assert_eq!(sandbox["type"], "readOnly");
        }
    }

    #[test]
    fn pastas_extras_viram_writable_roots() {
        let mut r = req(Permission::Padrao);
        r.extra_dirs = vec!["/outro/repo".into()];
        let p = turn_params("t1", &r, "oi");
        assert_eq!(p["sandboxPolicy"]["writableRoots"][0], "/outro/repo");
    }

    #[test]
    fn app_server_carrega_context_gateway_antes_do_subcomando() {
        let mut r = req(Permission::Padrao);
        r.context_gateway = Some(crate::context_gateway::GatewayConfig {
            server_bin: "/app/mycockpit".into(),
            root: "/repo".into(),
            conv_id: "c1".into(),
            db_path: Some("/data/mycockpit.db".into()),
        });
        let cmd = app_server_command(&r);
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|x| x.to_string_lossy().into_owned())
            .collect();
        let subcommand = args.iter().position(|x| x == "app-server").unwrap();
        let cfg = args
            .iter()
            .position(|x| x.contains("mcp_servers.mc-context.command"))
            .unwrap();
        assert!(cfg < subcommand);
        assert!(args.iter().any(|x| x.contains("context-server")));
    }

    #[test]
    fn app_server_carrega_catalogo_de_plugins_antes_do_subcomando() {
        let mut r = req(Permission::Padrao);
        r.tool_gateway = Some(crate::tool_gateway::GatewayConfig {
            server_bin: "/app/frota".into(),
            socket: "/tmp/mc-tools.sock".into(),
        });
        let cmd = app_server_command(&r);
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        let subcommand = args.iter().position(|arg| arg == "app-server").unwrap();
        let config = args
            .iter()
            .position(|arg| arg.contains("mcp_servers.mc-tools.command"))
            .unwrap();
        assert!(config < subcommand);
        assert!(args.iter().any(|arg| arg.contains("tool-server")));
        assert!(args.iter().any(|arg| arg.contains("/tmp/mc-tools.sock")));
    }

    #[test]
    fn app_server_carrega_profile_mcp_gerenciado_antes_do_subcomando() {
        let mut r = req(Permission::Padrao);
        r.mcp_plan = crate::mcp_control::McpRunPlan {
            managed: true,
            selected: vec![crate::mcp_control::McpRuntimeServer {
                runtime_name: "mcx-project-db".into(),
                display_name: "Database".into(),
                launch: crate::mcp_control::McpLaunchConfig {
                    transport: "stdio".into(),
                    command: Some("/opt/mcp/database".into()),
                    args: vec!["serve".into()],
                    ..Default::default()
                },
                tool_names: Vec::new(),
            }],
            disabled_codex_names: vec!["global-db".into()],
            ..Default::default()
        };
        let cmd = app_server_command(&r);
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|x| x.to_string_lossy().into_owned())
            .collect();
        let subcommand = args.iter().position(|arg| arg == "app-server").unwrap();
        let disable = args
            .iter()
            .position(|arg| arg == "mcp_servers.global-db.enabled=false")
            .unwrap();
        let runtime = args
            .iter()
            .position(|arg| arg.contains("mcp_servers.mcx-project-db.command"))
            .unwrap();
        assert!(disable < subcommand);
        assert!(runtime < subcommand);
    }

    #[test]
    fn thread_resume_carrega_o_thread_id() {
        let mut r = req(Permission::Padrao);
        r.resume = Some("th-123".into());
        let p = thread_params(&r, r.resume.as_deref());
        assert_eq!(p["threadId"], "th-123");
        assert_eq!(p["cwd"], "/repo");
        assert_eq!(p["sandbox"], "workspace-write");
    }

    #[test]
    fn turn_leva_prompt_modelo_effort_e_anexos() {
        let mut r = req(Permission::Padrao);
        r.attachments = vec![Attachment {
            path: "/tmp/a.png".into(),
            name: "a.png".into(),
            kind: AttachmentKind::Image,
            mime: "image/png".into(),
            bytes: 10,
        }];
        let p = turn_params("t1", &r, "prompt final");
        assert_eq!(p["input"][0]["type"], "text");
        assert_eq!(p["input"][0]["text"], "prompt final");
        assert_eq!(p["input"][1]["type"], "localImage");
        assert_eq!(p["input"][1]["path"], "/tmp/a.png");
        assert_eq!(p["model"], "gpt-5.5");
        assert_eq!(p["effort"], "high");
    }

    /// Payload REAL capturado do app-server 0.144.6 → o card que a UI já sabe
    /// desenhar (mesmo shape do ApprovalData do Claude).
    #[test]
    fn pedido_de_comando_vira_card_de_aprovacao() {
        let params = json!({
            "threadId": "th", "turnId": "tu", "itemId": "call_1",
            "command": "/bin/zsh -lc 'rm -rf alvo'",
            "cwd": "/repo", "reason": null
        });
        let (kind, data) = approval_card("item/commandExecution/requestApproval", &params).unwrap();
        assert_eq!(kind, "approval");
        assert_eq!(data["tool_name"], "Bash");
        assert_eq!(data["command"], "/bin/zsh -lc 'rm -rf alvo'");
        assert_eq!(data["input"]["cwd"], "/repo");
    }

    #[test]
    fn pedido_desconhecido_nao_vira_card() {
        assert!(approval_card("mcpServer/elicitation/request", &json!({})).is_none());
    }

    /// Negar é `decline` (turno segue), NUNCA `cancel` (mataria o turno inteiro).
    #[test]
    fn resposta_do_usuario_vira_decision() {
        assert_eq!(decision(&json!({ "allow": true }))["decision"], "accept");
        assert_eq!(decision(&json!({ "allow": false }))["decision"], "decline");
        // fail-closed: resposta sem `allow` (ou malformada) NEGA.
        assert_eq!(decision(&json!({}))["decision"], "decline");
    }

    #[test]
    fn thread_started_vira_session_com_o_modelo_do_custo() {
        let mut st = StreamState::new(Some("gpt-5.5".into()));
        let evs = map_notification(
            "thread/started",
            &json!({ "thread": { "id": "th-9" } }),
            &mut st,
        );
        match &evs[0] {
            AgentEvent::Session {
                session_id, model, ..
            } => {
                assert_eq!(session_id, "th-9");
                assert_eq!(model.as_deref(), Some("gpt-5.5"));
            }
            _ => panic!("esperava Session"),
        }
    }

    /// A regressão que o `streamed` evita: com delta + item/completed o texto
    /// sairia DUAS vezes (streaming + bloco inteiro).
    #[test]
    fn texto_streamado_fecha_a_bolha_sem_duplicar() {
        let mut st = StreamState::new(None);
        let d = map_notification(
            "item/agentMessage/delta",
            &json!({ "itemId": "m1", "delta": "oi" }),
            &mut st,
        );
        assert!(matches!(d[0], AgentEvent::TextDelta { .. }));
        let c = map_notification(
            "item/completed",
            &json!({ "item": { "type": "agentMessage", "id": "m1", "text": "oi" } }),
            &mut st,
        );
        assert_eq!(c.len(), 1);
        assert!(matches!(c[0], AgentEvent::TextStop));
    }

    #[test]
    fn texto_sem_delta_sai_inteiro_no_completed() {
        let mut st = StreamState::new(None);
        let c = map_notification(
            "item/completed",
            &json!({ "item": { "type": "agentMessage", "id": "m2", "text": "resposta" } }),
            &mut st,
        );
        match &c[0] {
            AgentEvent::Text { text } => assert_eq!(text, "resposta"),
            _ => panic!("esperava Text"),
        }
    }

    #[test]
    fn comando_concluido_vira_par_tool_mais_resultado() {
        let mut st = StreamState::new(None);
        let evs = map_notification(
            "item/completed",
            &json!({ "item": {
                "type": "commandExecution", "id": "call_1",
                "command": "ls -la", "exitCode": 0, "aggregatedOutput": "a\nb\n"
            }}),
            &mut st,
        );
        assert_eq!(evs.len(), 2);
        match (&evs[0], &evs[1]) {
            (AgentEvent::Tool { name, input, .. }, AgentEvent::ToolResult { ok, lines, .. }) => {
                assert_eq!(name, "Bash");
                assert_eq!(input["command"], "ls -la");
                assert!(ok);
                assert_eq!(*lines, 2);
            }
            _ => panic!("esperava Tool + ToolResult"),
        }
    }

    /// B1: mcpToolCall com CallToolResult de imagem → arquivo em disco + path
    /// no evento; o texto do cartão vem dos blocos `text` (nunca o JSON cru
    /// com base64 dentro).
    #[test]
    fn mcp_tool_call_com_imagem_vira_evidencia_em_disco() {
        const PNG_1X1_B64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
        let dir =
            std::env::temp_dir().join(format!("mc-appserver-evidence-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let mut st = StreamState::new(None);
        st.evidence = Some(crate::evidence::EvidenceSink::new(
            dir.clone(),
            "evidence/conv-x".to_string(),
        ));
        let evs = map_notification(
            "item/completed",
            &json!({ "item": {
                "type": "mcpToolCall", "id": "call_shot",
                "tool": "browser_take_screenshot",
                "arguments": {},
                "result": { "content": [
                    { "type": "text", "text": "Screenshot saved" },
                    { "type": "image", "data": PNG_1X1_B64, "mimeType": "image/png" }
                ] }
            }}),
            &mut st,
        );
        match &evs[1] {
            AgentEvent::ToolResult {
                ok, text, images, ..
            } => {
                assert!(ok);
                assert_eq!(text, "Screenshot saved");
                assert_eq!(images, &vec!["evidence/conv-x/call_shot-0.png".to_string()]);
            }
            _ => panic!("esperava ToolResult"),
        }
        assert!(dir.join("call_shot-0.png").is_file());
        let wire = serde_json::to_string(&evs[1]).unwrap();
        assert!(!wire.contains(PNG_1X1_B64));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn comando_com_exit_nao_zero_marca_falha() {
        let mut st = StreamState::new(None);
        let evs = map_notification(
            "item/completed",
            &json!({ "item": { "type": "commandExecution", "id": "c", "command": "x", "exitCode": 2 }}),
            &mut st,
        );
        assert!(matches!(evs[1], AgentEvent::ToolResult { ok: false, .. }));
    }

    /// O `turn/completed` do app-server NÃO traz usage — o Result se monta com o
    /// último `thread/tokenUsage/updated`. Sem isso todo turno sairia custando 0.
    #[test]
    fn usage_do_stream_alimenta_o_result_do_fim() {
        let mut st = StreamState::new(Some("gpt-5.5".into()));
        let ctx = map_notification(
            "thread/tokenUsage/updated",
            &json!({ "tokenUsage": {
                "last": {
                    "inputTokens": 21459, "cachedInputTokens": 13056, "outputTokens": 309
                },
                "modelContextWindow": 258400
            }}),
            &mut st,
        );
        assert!(matches!(
            ctx[0],
            AgentEvent::ContextUsage {
                tokens: 21459,
                window_tokens: Some(258400)
            }
        ));
        let end = map_notification("turn/completed", &json!({}), &mut st);
        match &end[0] {
            AgentEvent::Result {
                input_tokens,
                output_tokens,
                cache_read,
                ..
            } => {
                assert_eq!(*input_tokens, 21459);
                assert_eq!(*output_tokens, 309);
                assert_eq!(*cache_read, 13056);
            }
            _ => panic!("esperava Result"),
        }
    }

    #[test]
    fn fim_sem_usage_declara_contexto_indisponivel() {
        let mut st = StreamState::new(None);
        let end = map_notification("turn/completed", &json!({}), &mut st);
        assert!(matches!(end[0], AgentEvent::ContextUnavailable));
        assert!(matches!(end[1], AgentEvent::Result { .. }));
    }

    #[test]
    fn rollout_usa_last_e_janela_do_mesmo_snapshot_nunca_o_total() {
        let tail = [
            json!({
                "type": "event_msg",
                "payload": { "type": "token_count", "info": {
                    "total_token_usage": { "input_tokens": 1_540_542 },
                    "last_token_usage": { "input_tokens": 211_547 },
                    "model_context_window": 258_400
                }}
            }),
            json!({ "type": "event_msg", "payload": { "type": "task_complete" } }),
        ]
        .into_iter()
        .map(|v| v.to_string())
        .collect::<Vec<_>>()
        .join("\n");
        assert_eq!(
            parse_thread_context(&tail),
            Some(ThreadContext {
                tokens: 211_547,
                window_tokens: 258_400,
            })
        );
    }

    #[test]
    fn rollout_real_mede_o_total_da_ultima_chamada_como_o_codex_compara() {
        // Linha real de rollout (08/09/2026): entrada 27.577 + saída 558.
        let tail = include_str!("../testdata/codex-0.154.0/rollout-token-count-2026-09-08.jsonl");
        assert_eq!(
            parse_thread_context(tail),
            Some(ThreadContext {
                tokens: 28_135,
                window_tokens: 258_400,
            })
        );
    }

    #[test]
    fn rollout_sem_last_confiavel_nao_promove_total_acumulado() {
        let tail = json!({
            "type": "event_msg",
            "payload": { "type": "token_count", "info": {
                "total_token_usage": { "input_tokens": 1_540_542 },
                "last_token_usage": null,
                "model_context_window": 258_400
            }}
        })
        .to_string();
        assert_eq!(parse_thread_context(&tail), None);
    }

    #[test]
    fn ruido_de_infra_do_app_server_nao_vira_evento() {
        let mut st = StreamState::new(None);
        for m in [
            "mcpServer/startupStatus/updated",
            "account/rateLimits/updated",
            "thread/status/changed",
            "hook/started",
            "turn/started",
        ] {
            assert!(
                map_notification(m, &json!({}), &mut st).is_empty(),
                "{m} vazou"
            );
        }
    }

    #[test]
    fn erro_estruturado_le_a_mensagem() {
        assert_eq!(
            error_message(&json!({ "error": { "message": "usage limit reached" } })),
            "usage limit reached"
        );
        assert_eq!(error_message(&json!({})), "o turno do codex falhou");
    }

    #[test]
    fn codex_avisa_quando_compacta_sozinho() {
        // Descoberto no binário 0.149 (24/08/2026): o system prompt do codex diz
        // "when you run out of context, the conversation is automatically
        // summarized for you", e o item chega como `ContextCompactionItem`.
        //
        // Isto caía no `_ => vec![]`: a conversa era compactada e você não
        // ficava sabendo. Só o claude avisava, e a diferença entre motores era
        // invisível — a mesma família do `enforcement` antes do sandbox.
        let evs = map_item_started(&json!({ "id": "i1", "type": "contextCompaction" }));
        assert!(
            evs.iter().any(|e| matches!(e, AgentEvent::Notice { message } if message.contains("resumiu a conversa"))),
            "sem aviso de compactação"
        );
    }

    #[test]
    fn codex_sem_compactacao_nao_inventa_aviso() {
        let evs = map_item_started(&json!({ "id": "i1", "type": "webSearch", "query": "x" }));
        assert!(!evs.iter().any(|e| matches!(e, AgentEvent::Notice { .. })));
    }
}
