//! Aprovação GRANULAR inline (autonomia, Dimensão 1) sem matar o turno.
//!
//! ARQUITETURA (loop completo claude → MCP → app → UI → volta):
//!   1. No modo `Padrao`, o ClaudeAdapter registra ESTE binário como um MCP server
//!      stdio (subcomando `approval-server`) via `--mcp-config` + aponta
//!      `--permission-prompt-tool mcp__mc-approval__approval_prompt`.
//!   2. Quando o `claude -p` quer usar uma tool que precisa de OK (ex. um Bash não
//!      auto-aprovado em acceptEdits), ele CHAMA `approval_prompt` e BLOQUEIA
//!      esperando a resposta (turno vivo, sem timeout).
//!   3. O MCP server (subprocesso) lê o path do socket em `MYCOCKPIT_APPROVAL_SOCK`,
//!      conecta, manda o pedido {id, tool_name, input} e espera a decisão
//!      {allow, updated_input?, message?}.
//!   4. O app Tauri escuta esse socket POR-RUN: ao receber um pedido emite o evento
//!      global `approval://request` pro front (modal Aprovar/Negar) e guarda um
//!      canal p/ a resposta. O comando `answer_approval` destrava esse canal.
//!   5. A decisão volta pelo socket → o MCP server responde ao claude → o turno segue.
//!
//! Cleanup: o socket é criado no início do run e o `ApprovalListener` (RAII) o
//! remove + destrava todos os pedidos pendentes com `deny` no fim/cancelamento do
//! run, para que o claude nunca fique pendurado esperando uma UI que morreu.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::oneshot;

/// Nome do server MCP e da tool — precisam casar com `--mcp-config` e
/// `--permission-prompt-tool mcp__mc-approval__approval_prompt`.
pub const MCP_SERVER_NAME: &str = "mc-approval";
pub const APPROVAL_TOOL: &str = "approval_prompt";
/// Env que carrega o path do socket do app → MCP server (subprocesso do claude).
pub const SOCK_ENV: &str = "MYCOCKPIT_APPROVAL_SOCK";

/// Pedido de aprovação (app → front) e resposta (front → app), espelhado em TS
/// (`ApprovalRequest`/`answer_approval`). `id` correlaciona pedido↔resposta.
#[derive(Clone, Serialize)]
pub struct ApprovalRequest {
    pub id: String,
    pub run_id: String,
    /// Nome da tool que o claude quer usar (ex. "Bash", "Write").
    pub tool_name: String,
    /// Comando extraído do input p/ Bash (conveniência da UI); vazio p/ outras.
    pub command: String,
    /// Input CRU da tool (a UI mostra o detalhe; poderia sanitizar antes de aprovar).
    pub input: serde_json::Value,
}

/// Decisão do usuário (front → app → socket → MCP server → claude).
#[derive(Clone, Deserialize)]
pub struct ApprovalDecision {
    pub allow: bool,
    /// Input possivelmente sanitizado (só usado no allow; None = usa o original).
    #[serde(default)]
    pub updated_input: Option<serde_json::Value>,
    /// Motivo do deny, mostrado ao claude (opcional).
    #[serde(default)]
    pub message: Option<String>,
}

/// Registro GLOBAL de pedidos pendentes: id → canal p/ entregar a decisão à
/// conexão do socket que está esperando. Vive no State do Tauri.
#[derive(Default)]
pub struct PendingApprovals(pub Mutex<HashMap<String, oneshot::Sender<ApprovalDecision>>>);

/// Gera um path de socket único por-run (dir temporário do SO). Curto de
/// propósito: o limite de sun_path do Unix socket é ~104 bytes no macOS.
pub fn socket_path(run_id: &str) -> PathBuf {
    // usa só um prefixo do run_id (uuid) p/ caber no limite de sun_path.
    let short: String = run_id.chars().take(8).collect();
    std::env::temp_dir().join(format!("mc-appr-{short}.sock"))
}

/// Guarda RAII do listener do socket por-run. Enquanto vivo, aceita conexões do
/// MCP server e transforma cada pedido em evento `approval://request`. No Drop
/// (fim/cancel do run): aborta a task, remove o arquivo do socket, e nega TODOS
/// os pedidos ainda pendentes (senão o claude ficaria pendurado p/ sempre).
pub struct ApprovalListener {
    path: PathBuf,
    task: tokio::task::JoinHandle<()>,
    pending: Arc<PendingApprovals>,
    ids: Arc<Mutex<Vec<String>>>,
}

impl ApprovalListener {
    /// Cria o socket e sobe a task que aceita conexões. `run_id` marca cada pedido
    /// (a UI liga ao run certo). Retorna None (degrada p/ o comportamento antigo,
    /// sem aprovação) se não conseguir criar o socket — nunca derruba o run.
    pub fn spawn(
        app: tauri::AppHandle,
        run_id: String,
        pending: Arc<PendingApprovals>,
    ) -> Option<Self> {
        let path = socket_path(&run_id);
        // socket órfão de um crash anterior no mesmo path: remove antes de bindar.
        let _ = std::fs::remove_file(&path);
        let listener = match UnixListener::bind(&path) {
            Ok(l) => l,
            Err(e) => {
                log::warn!("aprovação: não consegui criar o socket ({e}); seguindo sem gate inline");
                return None;
            }
        };
        let ids: Arc<Mutex<Vec<String>>> = Arc::default();
        let task = {
            let pending = pending.clone();
            let ids = ids.clone();
            tokio::spawn(async move {
                // cada Ok = um pedido de aprovação, tratado em paralelo (o claude
                // pode encadear tools; cada uma abre a sua conexão). Err (listener
                // fechado no drop) encerra a task.
                while let Ok((stream, _)) = listener.accept().await {
                    let app = app.clone();
                    let run_id = run_id.clone();
                    let pending = pending.clone();
                    let ids = ids.clone();
                    tokio::spawn(async move {
                        handle_conn(stream, app, run_id, pending, ids).await;
                    });
                }
            })
        };
        Some(Self { path, task, pending, ids })
    }
}

impl Drop for ApprovalListener {
    fn drop(&mut self) {
        self.task.abort();
        let _ = std::fs::remove_file(&self.path);
        // destrava qualquer pedido pendente com deny: o claude está bloqueado
        // esperando a decisão e o run acabou/foi cancelado → não pode pendurar.
        if let Ok(ids) = self.ids.lock() {
            if let Ok(mut map) = self.pending.0.lock() {
                for id in ids.iter() {
                    if let Some(tx) = map.remove(id) {
                        let _ = tx.send(ApprovalDecision {
                            allow: false,
                            updated_input: None,
                            message: Some("run encerrado antes da decisão".to_string()),
                        });
                    }
                }
            }
        }
    }
}

/// Trata UMA conexão do MCP server: lê o pedido JSON (1 linha), emite o evento pro
/// front, espera a decisão via oneshot (destravado pelo `answer_approval`) e a
/// escreve de volta na conexão. Uma linha por sentido (protocolo simples).
async fn handle_conn(
    stream: UnixStream,
    app: tauri::AppHandle,
    run_id: String,
    pending: Arc<PendingApprovals>,
    ids: Arc<Mutex<Vec<String>>>,
) {
    let (rd, mut wr) = stream.into_split();
    let mut reader = BufReader::new(rd);
    let mut line = String::new();
    if reader.read_line(&mut line).await.is_err() || line.trim().is_empty() {
        return;
    }
    // pedido cru do MCP server: {id, tool_name, input}. id gerado pelo server.
    let req: serde_json::Value = match serde_json::from_str(line.trim()) {
        Ok(v) => v,
        Err(_) => return,
    };
    let id = req
        .get("id")
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string();
    if id.is_empty() {
        return;
    }
    let tool_name = req
        .get("tool_name")
        .and_then(|x| x.as_str())
        .unwrap_or("tool")
        .to_string();
    let input = req.get("input").cloned().unwrap_or(serde_json::Value::Null);
    // conveniência: extrai o comando p/ Bash (a UI mostra em destaque).
    let command = input
        .get("command")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();

    // registra o canal da decisão ANTES de emitir o evento (evita perder um
    // answer_approval que chegasse instantaneamente).
    let (tx, rx) = oneshot::channel::<ApprovalDecision>();
    {
        if let Ok(mut map) = pending.0.lock() {
            map.insert(id.clone(), tx);
        }
        if let Ok(mut v) = ids.lock() {
            v.push(id.clone());
        }
    }

    let _ = app.emit(
        "approval://request",
        ApprovalRequest {
            id: id.clone(),
            run_id,
            tool_name,
            command,
            input,
        },
    );

    // espera a decisão do usuário (sem timeout por padrão: turno vivo). Se o canal
    // for dropado (run encerrado → o Drop do listener negou), cai no deny seguro.
    let decision = rx.await.unwrap_or(ApprovalDecision {
        allow: false,
        updated_input: None,
        message: Some("aprovação cancelada".to_string()),
    });
    // limpa o registro (o Drop do listener também tenta, idempotente).
    if let Ok(mut map) = pending.0.lock() {
        map.remove(&id);
    }

    // resposta de volta ao MCP server (1 linha JSON).
    let out = serde_json::json!({
        "allow": decision.allow,
        "updated_input": decision.updated_input,
        "message": decision.message,
    });
    let mut buf = out.to_string();
    buf.push('\n');
    let _ = wr.write_all(buf.as_bytes()).await;
    let _ = wr.flush().await;
}

/// Comando Tauri: o front entrega a decisão do usuário (Aprovar/Negar). Destrava
/// a conexão do socket que está esperando (via o oneshot registrado em pending).
#[tauri::command]
pub fn answer_approval(
    id: String,
    allow: bool,
    updated_input: Option<serde_json::Value>,
    message: Option<String>,
    pending: tauri::State<'_, Arc<PendingApprovals>>,
) {
    let tx = pending.0.lock().ok().and_then(|mut m| m.remove(&id));
    if let Some(tx) = tx {
        let _ = tx.send(ApprovalDecision {
            allow,
            updated_input,
            message,
        });
    }
}

// ----------------------------------------------------------------------------
// MCP server stdio (subcomando `approval-server`): rodado pelo `claude`.
// ----------------------------------------------------------------------------

/// Ponto de entrada do subcomando `approval-server` (chamado pelo `main.rs` ANTES
/// do Tauri subir). Implementa o mínimo do protocolo MCP stdio (JSON-RPC 2.0 por
/// linha): initialize, notifications/initialized, tools/list, tools/call. No
/// tools/call de `approval_prompt`, encaminha o pedido ao app pelo socket
/// (`MYCOCKPIT_APPROVAL_SOCK`) e espera a decisão. Bloqueia por natureza — é o que
/// segura o turno do claude vivo. Roda num runtime tokio dedicado (o main é sync).
pub fn run_mcp_server() {
    let rt = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("approval-server: sem runtime tokio: {e}");
            std::process::exit(1);
        }
    };
    rt.block_on(mcp_loop());
}

/// Protocolo MCP: mais atual e amplamente suportado. O claude negocia mas aceita.
const MCP_PROTOCOL_VERSION: &str = "2024-11-05";

async fn mcp_loop() {
    let stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let mut reader = BufReader::new(stdin).lines();

    while let Ok(Some(line)) = reader.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let msg: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let method = msg.get("method").and_then(|x| x.as_str()).unwrap_or("");
        let id = msg.get("id").cloned();
        // Notificações (sem id) não recebem resposta.
        match method {
            "initialize" => {
                let resp = rpc_result(
                    id,
                    serde_json::json!({
                        "protocolVersion": MCP_PROTOCOL_VERSION,
                        "capabilities": { "tools": {} },
                        "serverInfo": { "name": MCP_SERVER_NAME, "version": "0.1.0" }
                    }),
                );
                write_line(&mut stdout, &resp).await;
            }
            "notifications/initialized" | "initialized" => { /* sem resposta */ }
            "tools/list" => {
                let resp = rpc_result(
                    id,
                    serde_json::json!({
                        "tools": [{
                            "name": APPROVAL_TOOL,
                            "description": "Solicita aprovação humana p/ uma tool que precisa de OK.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {
                                    "tool_name": { "type": "string" },
                                    "input": { "type": "object" }
                                },
                                "required": ["tool_name", "input"]
                            }
                        }]
                    }),
                );
                write_line(&mut stdout, &resp).await;
            }
            "tools/call" => {
                let params = msg.get("params");
                let tool = params
                    .and_then(|p| p.get("name"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("");
                let args = params
                    .and_then(|p| p.get("arguments"))
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                let payload = if tool == APPROVAL_TOOL {
                    ask_app(&args).await
                } else {
                    // tool desconhecida: nega por segurança (fail-closed).
                    serde_json::json!({ "behavior": "deny", "message": "tool desconhecida" })
                };
                // O resultado da tool de permissão é um content block de TEXTO com o
                // JSON {behavior, updatedInput?|message?} stringificado (protocolo do
                // --permission-prompt-tool do Claude Code).
                let resp = rpc_result(
                    id,
                    serde_json::json!({
                        "content": [{ "type": "text", "text": payload.to_string() }]
                    }),
                );
                write_line(&mut stdout, &resp).await;
            }
            _ => {
                // método não suportado: responde erro só se tinha id (request).
                if id.is_some() {
                    let resp = serde_json::json!({
                        "jsonrpc": "2.0",
                        "id": id,
                        "error": { "code": -32601, "message": "method not found" }
                    });
                    write_line(&mut stdout, &resp).await;
                }
            }
        }
    }
}

/// Encaminha o pedido de aprovação ao app pelo socket e traduz a decisão no
/// payload que o Claude Code espera do permission-prompt: {behavior, updatedInput?}
/// no allow, {behavior:"deny", message} no deny. Fail-closed em qualquer erro de
/// IPC (sem socket, app fechado): nega, nunca libera às cegas.
async fn ask_app(args: &serde_json::Value) -> serde_json::Value {
    let tool_name = args
        .get("tool_name")
        .and_then(|x| x.as_str())
        .unwrap_or("tool");
    let input = args.get("input").cloned().unwrap_or(serde_json::Value::Null);
    let sock = match std::env::var(SOCK_ENV) {
        Ok(s) => s,
        Err(_) => {
            return serde_json::json!({ "behavior": "deny", "message": "sem canal de aprovação" });
        }
    };
    let decision = request_over_socket(&sock, tool_name, &input).await;
    match decision {
        Some(d) if d.allow => {
            let updated = d.updated_input.unwrap_or(input);
            serde_json::json!({ "behavior": "allow", "updatedInput": updated })
        }
        Some(d) => serde_json::json!({
            "behavior": "deny",
            "message": d.message.unwrap_or_else(|| "negado pelo usuário".to_string())
        }),
        None => serde_json::json!({
            "behavior": "deny",
            "message": "canal de aprovação indisponível"
        }),
    }
}

/// Conecta no socket do app, manda {id, tool_name, input} e lê a decisão (1 linha
/// por sentido). None em qualquer erro de IPC (o caller trata como deny).
async fn request_over_socket(
    sock: &str,
    tool_name: &str,
    input: &serde_json::Value,
) -> Option<ApprovalDecision> {
    let mut stream = UnixStream::connect(sock).await.ok()?;
    // id único do pedido (correlaciona no app e na UI).
    let id = format!(
        "appr-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    let req = serde_json::json!({ "id": id, "tool_name": tool_name, "input": input });
    let mut buf = req.to_string();
    buf.push('\n');
    stream.write_all(buf.as_bytes()).await.ok()?;
    stream.flush().await.ok()?;
    // divide p/ ler a resposta sem largar a escrita (a conexão fica aberta).
    let (rd, _wr) = stream.into_split();
    let mut reader = BufReader::new(rd);
    let mut resp = String::new();
    reader.read_line(&mut resp).await.ok()?;
    serde_json::from_str::<ApprovalDecision>(resp.trim()).ok()
}

/// Monta uma resposta JSON-RPC 2.0 de sucesso.
fn rpc_result(id: Option<serde_json::Value>, result: serde_json::Value) -> serde_json::Value {
    serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

/// Escreve uma mensagem JSON-RPC como UMA linha no stdout (framing por linha).
async fn write_line(stdout: &mut tokio::io::Stdout, msg: &serde_json::Value) {
    let mut buf = msg.to_string();
    buf.push('\n');
    let _ = stdout.write_all(buf.as_bytes()).await;
    let _ = stdout.flush().await;
}
