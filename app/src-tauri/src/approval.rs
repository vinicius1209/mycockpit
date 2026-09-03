//! Interação PENDENTE inline (autonomia + perguntas estruturadas) sem matar o turno.
//!
//! Padrão UNIFICADO ("interação pendente") — ver docs/interactive-input.md §Contrato.
//! Dois `kind`s hoje, sob o MESMO MCP server stdio + socket + evento:
//!   - `approval` (tool de PERMISSÃO `approval_prompt`, via `--permission-prompt-tool`,
//!     só no modo Padrão): o claude quer usar uma tool que precisa de OK.
//!   - `question` (tool de CONTEÚDO `ask_user`, listada em tools/list e chamada
//!     DIRETAMENTE pelo modelo, em TODOS os modos com MCP ligado): o modelo faz uma
//!     pergunta estruturada (espelho do AskUserQuestion built-in, que é desabilitado).
//!
//! ⚠️ `ask_user` NÃO é uma tool de permissão. É conteúdo normal: o RESULTADO da tool
//! (content block de texto com o JSON das respostas) É a resposta ao modelo. Por isso
//! ela NÃO entra no `--permission-prompt-tool` e NÃO marca requiresUserInteraction.
//!
//! ARQUITETURA (loop completo claude → MCP → app → UI → volta):
//!   1. O ClaudeAdapter registra ESTE binário como um MCP server stdio (subcomando
//!      `approval-server`) via `--mcp-config`. No modo Padrão aponta também
//!      `--permission-prompt-tool mcp__mc-approval__approval_prompt`.
//!   2. Quando o claude precisa de você (aprovar OU perguntar), ele CHAMA a tool
//!      correspondente e BLOQUEIA esperando a resposta (turno vivo, sem timeout).
//!   3. O MCP server (subprocesso) lê o path do socket em `MYCOCKPIT_APPROVAL_SOCK`,
//!      conecta, manda o pedido {id, kind, data} e espera a resposta {id, answer}.
//!   4. O app Tauri escuta esse socket POR-RUN: ao receber um pedido emite o evento
//!      global `interaction://request` pro front e guarda um canal p/ a resposta. O
//!      comando `answer_interaction` (alias `answer_approval`) destrava esse canal.
//!   5. A resposta volta pelo socket → o MCP server responde ao claude → o turno segue.
//!
//! Cleanup: o socket é criado no início do run e o `ApprovalListener` (RAII) o
//! remove + destrava todos os pedidos pendentes (deny p/ approval, cancelado p/
//! question) no fim/cancelamento do run, para que o claude nunca fique pendurado.
//!
//! LIMITE DE CONFIANÇA do socket (M2 — decisão consciente, não bug silencioso):
//! o Unix socket é same-uid, sem autenticação de peer. Um comando Bash JÁ APROVADO
//! (ou qualquer processo do mesmo usuário) PODE remover/substituir o socket e se
//! passar pelo app. Mas nesse ponto o atacante já executa código arbitrário como o
//! usuário — o gate de aprovação já foi vencido por definição; auto-aprovar pedidos
//! futuros não lhe dá nada que ele já não tenha. A fronteira de segurança REAL é o
//! usuário do SO, não este socket. Endurecer aqui (peer creds, token) só mudaria a
//! estética, não o modelo de ameaça.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::oneshot;

/// Nome do server MCP — casa com `--mcp-config` e os nomes `mcp__mc-approval__*`.
pub const MCP_SERVER_NAME: &str = "mc-approval";
/// Tool de PERMISSÃO (vai no `--permission-prompt-tool`, só no modo Padrão).
pub const APPROVAL_TOOL: &str = "approval_prompt";
/// Tool de CONTEÚDO (listada em tools/list, chamada direta pelo modelo). Registrada
/// em TODOS os modos com MCP ligado. NÃO vai no `--permission-prompt-tool`.
pub const ASK_USER_TOOL: &str = "ask_user";
/// Env que carrega o path do socket do app → MCP server (subprocesso do claude).
pub const SOCK_ENV: &str = "MYCOCKPIT_APPROVAL_SOCK";

// ----------------------------------------------------------------------------
// Contrato do socket + evento: pedido {id, kind, data}, resposta {id, answer}.
// ----------------------------------------------------------------------------

/// Pedido normalizado (socket → app → front, via evento `interaction://request`).
/// `data` varia por `kind`: approval→ApprovalData, question→QuestionData.
#[derive(Clone, Serialize)]
pub struct InteractionRequest {
    pub id: String,
    pub run_id: String,
    /// "approval" | "question".
    pub kind: String,
    /// Payload por kind (a UI escolhe o card).
    pub data: serde_json::Value,
}

/// Decisão de PERMISSÃO (front → app → socket → MCP server → claude).
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

/// Resposta genérica de uma interação (front → app). Para approval, o front manda
/// {allow, updated_input?, message?}; para question, {answers:[{header,selected}]}.
/// Guardamos o JSON cru e a rota por kind traduz.
type Answer = serde_json::Value;

/// Registro GLOBAL de pedidos pendentes: id → canal p/ entregar a resposta à
/// conexão do socket que está esperando. Vive no State do Tauri. O valor guarda o
/// `kind` para o fail-closed do Drop devolver a resposta certa por tipo.
#[derive(Default)]
pub struct PendingApprovals(pub Mutex<HashMap<String, Pending>>);

/// Um pedido pendente: o `kind` (p/ o fail-closed) + o canal da resposta.
pub struct Pending {
    pub kind: String,
    pub tx: oneshot::Sender<Answer>,
}

/// Candidatos de path p/ o socket (M4), únicos por-run (dir temporário do SO):
/// o base + sufixos -1/-2. O prefixo de 8 chars do run_id PODE colidir com um run
/// vivo; nesse caso não podemos apagar o socket dele — tentamos o próximo
/// candidato. Todos CURTOS de propósito: o limite de sun_path é ~104 bytes no
/// macOS. O path realmente bindado sai em `ApprovalListener::path()`.
fn socket_path_candidates(run_id: &str) -> [PathBuf; 3] {
    // usa só um prefixo do run_id (uuid) p/ caber no limite de sun_path.
    let short: String = run_id.chars().take(8).collect();
    let dir = std::env::temp_dir();
    [
        dir.join(format!("mc-appr-{short}.sock")),
        dir.join(format!("mc-appr-{short}-1.sock")),
        dir.join(format!("mc-appr-{short}-2.sock")),
    ]
}

/// Tenta bindar num dos candidatos SEM matar um run vivo (M4): primeiro CONECTA
/// no path — se a conexão funciona, tem alguém vivo escutando (colisão de prefixo)
/// e NÃO apagamos: pulamos pro próximo candidato. Se a conexão falha, o arquivo é
/// stale (crash anterior): aí sim remove e binda.
fn bind_socket(run_id: &str) -> Option<(PathBuf, UnixListener)> {
    for cand in socket_path_candidates(run_id) {
        if cand.exists() {
            if std::os::unix::net::UnixStream::connect(&cand).is_ok() {
                // alguém VIVO neste path — não é nosso p/ apagar; tenta o próximo.
                log::warn!(
                    "interação: socket {} está vivo (colisão de prefixo); tentando alternativo",
                    cand.display()
                );
                continue;
            }
            // conexão falhou → stale de crash: seguro remover.
            let _ = std::fs::remove_file(&cand);
        }
        match UnixListener::bind(&cand) {
            Ok(l) => return Some((cand, l)),
            Err(e) => {
                log::warn!("interação: bind falhou em {} ({e})", cand.display());
            }
        }
    }
    None
}

/// Resposta de fail-closed por kind (Drop do listener, canal dropado): approval=deny,
/// question=cancelado (answers vazio → o modelo recebe "usuário não respondeu").
fn fail_closed_answer(kind: &str, message: &str) -> Answer {
    match kind {
        "question" => serde_json::json!({ "answers": [] }),
        // approval (default): deny seguro.
        _ => serde_json::json!({ "allow": false, "message": message }),
    }
}

/// Guarda RAII do listener do socket por-run. Enquanto vivo, aceita conexões do
/// MCP server e transforma cada pedido em evento `interaction://request`. No Drop
/// (fim/cancel do run): aborta a task, remove o arquivo do socket, e resolve TODOS
/// os pedidos ainda pendentes com o fail-closed por kind (senão o claude penduraria).
pub struct ApprovalListener {
    path: PathBuf,
    task: tokio::task::JoinHandle<()>,
    pending: Arc<PendingApprovals>,
    ids: Arc<Mutex<Vec<String>>>,
    /// Setado no Drop ANTES de resolver os pendentes: fecha a race da conexão
    /// aceita-mas-ainda-não-registrada (handle_conn checa antes E depois de
    /// registrar; se true, responde fail-closed na hora e não vaza).
    shutdown: Arc<std::sync::atomic::AtomicBool>,
    /// P/ o Drop avisar o front (`interaction://resolved`) dos cards que ele
    /// resolveu fail-closed — senão o card ficava travado na UI p/ sempre.
    app: tauri::AppHandle,
}

impl ApprovalListener {
    /// Cria o socket e sobe a task que aceita conexões. `run_id` marca cada pedido
    /// (a UI liga ao run certo). Retorna None (degrada p/ o comportamento antigo,
    /// sem interação inline) se não conseguir criar o socket — nunca derruba o run.
    pub fn spawn(
        app: tauri::AppHandle,
        run_id: String,
        pending: Arc<PendingApprovals>,
    ) -> Option<Self> {
        // M4: nunca apaga o socket de um run VIVO (conecta antes de remover);
        // colisão → paths alternativos (-1/-2). O path REAL fica em self.path().
        let (path, listener) = match bind_socket(&run_id) {
            Some(pl) => pl,
            None => {
                log::warn!("interação: não consegui criar o socket; seguindo sem gate inline");
                return None;
            }
        };
        let ids: Arc<Mutex<Vec<String>>> = Arc::default();
        let shutdown = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let task = {
            let pending = pending.clone();
            let ids = ids.clone();
            let app = app.clone();
            let shutdown = shutdown.clone();
            tokio::spawn(async move {
                // cada Ok = um pedido de interação, tratado em paralelo (o claude
                // pode encadear tools; cada uma abre a sua conexão). Err (listener
                // fechado no drop) encerra a task.
                while let Ok((stream, _)) = listener.accept().await {
                    let app = app.clone();
                    let run_id = run_id.clone();
                    let pending = pending.clone();
                    let ids = ids.clone();
                    let shutdown = shutdown.clone();
                    tokio::spawn(async move {
                        handle_conn(stream, app, run_id, pending, ids, shutdown).await;
                    });
                }
            })
        };
        Some(Self {
            path,
            task,
            pending,
            ids,
            shutdown,
            app,
        })
    }

    /// Path REAL do socket bindado (pode ser um alternativo -1/-2 se o base
    /// estava ocupado por um run vivo — M4). É este que vai no SOCK_ENV.
    pub fn path(&self) -> &std::path::Path {
        &self.path
    }
}

impl Drop for ApprovalListener {
    fn drop(&mut self) {
        // shutdown ANTES de resolver: handle_conn em voo (aceita mas ainda não
        // registrada) vê a flag e responde fail-closed sozinha — sem vazamento.
        self.shutdown
            .store(true, std::sync::atomic::Ordering::SeqCst);
        self.task.abort();
        let _ = std::fs::remove_file(&self.path);
        // resolve qualquer pedido pendente com o fail-closed por kind: o claude está
        // bloqueado esperando e o run acabou/foi cancelado → não pode pendurar.
        if let Ok(ids) = self.ids.lock() {
            if let Ok(mut map) = self.pending.0.lock() {
                for id in ids.iter() {
                    if let Some(p) = map.remove(id) {
                        let ans = fail_closed_answer(&p.kind, "run encerrado antes da resposta");
                        let _ = p.tx.send(ans);
                        // avisa o front: o card deste pedido morreu junto com o run
                        // (senão ficava travado na UI dizendo "turno pausado").
                        let _ = self
                            .app
                            .emit("interaction://resolved", serde_json::json!({ "id": id }));
                    }
                }
            }
        }
    }
}

/// Trata UMA conexão do MCP server: lê o pedido JSON (1 linha) no contrato
/// {id, kind, data}, emite o evento pro front, espera a resposta via oneshot
/// (destravado pelo `answer_interaction`) e a escreve de volta na conexão como
/// {answer}. Uma linha por sentido (protocolo simples).
async fn handle_conn(
    stream: UnixStream,
    app: tauri::AppHandle,
    run_id: String,
    pending: Arc<PendingApprovals>,
    ids: Arc<Mutex<Vec<String>>>,
    shutdown: Arc<std::sync::atomic::AtomicBool>,
) {
    let (rd, mut wr) = stream.into_split();
    let mut reader = BufReader::new(rd);
    let mut line = String::new();
    if reader.read_line(&mut line).await.is_err() || line.trim().is_empty() {
        return;
    }
    // pedido cru do MCP server: {id, kind, data}. id/kind gerados pelo server.
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
    // kind: "approval" | "question" (default approval p/ compat de mensagem antiga).
    let kind = req
        .get("kind")
        .and_then(|x| x.as_str())
        .unwrap_or("approval")
        .to_string();
    let data = req.get("data").cloned().unwrap_or(serde_json::Value::Null);

    // helper: responde fail-closed direto na conexão (sem registrar/emitir).
    async fn reply_closed(wr: &mut (impl tokio::io::AsyncWrite + Unpin), kind: &str, why: &str) {
        let out = serde_json::json!({ "answer": fail_closed_answer(kind, why) });
        let mut buf = out.to_string();
        buf.push('\n');
        let _ = wr.write_all(buf.as_bytes()).await;
        let _ = wr.flush().await;
    }

    // race M1 (revisão): conexão aceita mas o run já morreu (Drop em curso) —
    // check ANTES de registrar: responde fail-closed na hora, sem vazar task/entrada.
    if shutdown.load(std::sync::atomic::Ordering::SeqCst) {
        reply_closed(&mut wr, &kind, "run encerrado").await;
        return;
    }

    // registra o canal da resposta ANTES de emitir o evento (evita perder um
    // answer_interaction que chegasse instantaneamente).
    let (tx, rx) = oneshot::channel::<Answer>();
    {
        if let Ok(mut map) = pending.0.lock() {
            map.insert(
                id.clone(),
                Pending {
                    kind: kind.clone(),
                    tx,
                },
            );
        }
        if let Ok(mut v) = ids.lock() {
            v.push(id.clone());
        }
    }

    // double-check DEPOIS de registrar: se o Drop rodou entre os dois pontos, a
    // varredura dele pode já ter passado sem ver este id → desregistra e fecha.
    if shutdown.load(std::sync::atomic::Ordering::SeqCst) {
        if let Ok(mut map) = pending.0.lock() {
            map.remove(&id);
        }
        reply_closed(&mut wr, &kind, "run encerrado").await;
        return;
    }

    let _ = app.emit(
        "interaction://request",
        InteractionRequest {
            id: id.clone(),
            run_id,
            kind: kind.clone(),
            data,
        },
    );

    // espera a resposta do usuário (sem timeout por padrão: turno vivo). Se o canal
    // for dropado (run encerrado → o Drop do listener resolveu), cai no fail-closed.
    let answer = rx
        .await
        .unwrap_or_else(|_| fail_closed_answer(&kind, "interação cancelada"));
    // limpa o registro (o Drop do listener também tenta, idempotente).
    if let Ok(mut map) = pending.0.lock() {
        map.remove(&id);
    }

    // resposta de volta ao MCP server (1 linha JSON): {answer}.
    let out = serde_json::json!({ "answer": answer });
    let mut buf = out.to_string();
    buf.push('\n');
    let _ = wr.write_all(buf.as_bytes()).await;
    let _ = wr.flush().await;
}

/// Gate de interação DIRETO: mesmo registro, mesmo evento e mesma resposta do
/// socket — sem socket. Serve transportes que já falam com o agent na primeira
/// pessoa (o `codex app-server`, que manda o pedido de aprovação no próprio
/// stream JSON-RPC). Sem isto, o Codex precisaria de um MCP server intermediário
/// que a CLI dele não oferece.
///
/// O ciclo de vida espelha o `ApprovalListener`: `shutdown()` (ou o Drop) resolve
/// fail-closed TODOS os pedidos ainda abertos e avisa o front
/// (`interaction://resolved`), pra nenhum card ficar preso a um run já morto.
pub struct DirectInteractions {
    app: tauri::AppHandle,
    pending: Arc<PendingApprovals>,
    ids: Arc<Mutex<Vec<String>>>,
    shutdown: Arc<std::sync::atomic::AtomicBool>,
}

impl DirectInteractions {
    pub fn new(app: tauri::AppHandle, pending: Arc<PendingApprovals>) -> Self {
        Self {
            app,
            pending,
            ids: Arc::default(),
            shutdown: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    /// Levanta UM pedido e ESPERA a resposta do usuário (sem timeout: o turno do
    /// agent está parado esperando). `id` é do chamador porque ele precisa
    /// correlacionar com o pedido do protocolo dele.
    pub async fn request(
        &self,
        run_id: &str,
        id: &str,
        kind: &str,
        data: serde_json::Value,
    ) -> Answer {
        // run já encerrando → nega na hora, sem registrar nem piscar card.
        if self.shutdown.load(std::sync::atomic::Ordering::SeqCst) {
            return fail_closed_answer(kind, "run encerrado");
        }
        // registra ANTES de emitir (não perde um answer_interaction instantâneo).
        let (tx, rx) = oneshot::channel::<Answer>();
        if let Ok(mut map) = self.pending.0.lock() {
            map.insert(
                id.to_string(),
                Pending {
                    kind: kind.to_string(),
                    tx,
                },
            );
        }
        if let Ok(mut v) = self.ids.lock() {
            v.push(id.to_string());
        }
        // double-check: se o shutdown correu entre o check e o registro, a
        // varredura dele pode já ter passado sem ver este id.
        if self.shutdown.load(std::sync::atomic::Ordering::SeqCst) {
            if let Ok(mut map) = self.pending.0.lock() {
                map.remove(id);
            }
            return fail_closed_answer(kind, "run encerrado");
        }
        let _ = self.app.emit(
            "interaction://request",
            InteractionRequest {
                id: id.to_string(),
                run_id: run_id.to_string(),
                kind: kind.to_string(),
                data,
            },
        );
        let answer = rx
            .await
            .unwrap_or_else(|_| fail_closed_answer(kind, "interação cancelada"));
        if let Ok(mut map) = self.pending.0.lock() {
            map.remove(id);
        }
        answer
    }

    /// Fecha o gate: resolve fail-closed o que sobrou e limpa os cards. Idempotente
    /// (o Drop chama de novo sem efeito).
    pub fn shutdown(&self) {
        self.shutdown
            .store(true, std::sync::atomic::Ordering::SeqCst);
        let drained: Vec<String> = self
            .ids
            .lock()
            .map(|mut v| std::mem::take(&mut *v))
            .unwrap_or_default();
        for id in drained {
            let p = self.pending.0.lock().ok().and_then(|mut m| m.remove(&id));
            if let Some(p) = p {
                let _ = p.tx.send(fail_closed_answer(
                    &p.kind,
                    "run encerrado antes da resposta",
                ));
                let _ = self
                    .app
                    .emit("interaction://resolved", serde_json::json!({ "id": id }));
            }
        }
    }
}

impl Drop for DirectInteractions {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Comando Tauri GENÉRICO: o front entrega a resposta do usuário (aprovação OU
/// perguntas). Destrava a conexão do socket que está esperando (via o oneshot
/// registrado em pending). O shape de `answer` varia por kind — o app repassa cru
/// e a rota do MCP server (`ask_app` / `ask_user`) o interpreta.
#[tauri::command]
pub fn answer_interaction(
    id: String,
    answer: serde_json::Value,
    pending: tauri::State<'_, Arc<PendingApprovals>>,
) {
    let p = pending.0.lock().ok().and_then(|mut m| m.remove(&id));
    if let Some(p) = p {
        let _ = p.tx.send(answer);
    }
}

/// Alias de compat: o front antigo chama `answer_approval(id, allow, updated_input,
/// message)`. Reempacota no shape de aprovação e delega. Pode ser removido quando o
/// front migrar 100% p/ `answer_interaction`.
#[tauri::command]
pub fn answer_approval(
    id: String,
    allow: bool,
    updated_input: Option<serde_json::Value>,
    message: Option<String>,
    pending: tauri::State<'_, Arc<PendingApprovals>>,
) {
    let answer = serde_json::json!({
        "allow": allow,
        "updated_input": updated_input,
        "message": message,
    });
    answer_interaction(id, answer, pending);
}

// ----------------------------------------------------------------------------
// MCP server stdio (subcomando `approval-server`): rodado pelo `claude`.
// ----------------------------------------------------------------------------

/// Ponto de entrada do subcomando `approval-server` (chamado pelo `main.rs` ANTES
/// do Tauri subir). Implementa o mínimo do protocolo MCP stdio (JSON-RPC 2.0 por
/// linha): initialize, notifications/initialized, tools/list, tools/call. Nos
/// tools/call encaminha o pedido ao app pelo socket (`MYCOCKPIT_APPROVAL_SOCK`) e
/// espera a resposta. Bloqueia por natureza — é o que segura o turno vivo. Roda num
/// runtime tokio dedicado (o main é sync).
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

/// Protocolo MCP default (respondido quando o cliente pede uma versão desconhecida).
const MCP_PROTOCOL_VERSION: &str = "2024-11-05";
/// Versões que sabemos falar: se o cliente pedir uma delas no initialize, ECOAMOS
/// a pedida (M5 — o spec manda negociar, não impor a nossa).
const MCP_KNOWN_VERSIONS: [&str; 3] = ["2024-11-05", "2025-03-26", "2025-06-18"];

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
        // B6: mensagens SEM id são notificações (ou requests malformados) — o
        // JSON-RPC manda NÃO responder (jamais responder com "id": null).
        match method {
            "initialize" => {
                // M5: ecoa a protocolVersion pedida se for uma que conhecemos;
                // desconhecida → responde o nosso default (o cliente decide).
                let requested = msg
                    .get("params")
                    .and_then(|p| p.get("protocolVersion"))
                    .and_then(|x| x.as_str());
                let version = requested
                    .filter(|v| MCP_KNOWN_VERSIONS.contains(v))
                    .unwrap_or(MCP_PROTOCOL_VERSION);
                let resp = rpc_result(
                    id,
                    serde_json::json!({
                        "protocolVersion": version,
                        "capabilities": { "tools": {} },
                        "serverInfo": { "name": MCP_SERVER_NAME, "version": "0.1.0" }
                    }),
                );
                write_opt(&mut stdout, resp).await;
            }
            "notifications/initialized" | "initialized" => { /* sem resposta */ }
            "ping" => {
                // M5: ping do spec MCP → result vazio (antes caía no -32601).
                let resp = rpc_result(id, serde_json::json!({}));
                write_opt(&mut stdout, resp).await;
            }
            "tools/list" => {
                // DUAS tools: approval_prompt (permissão) + ask_user (conteúdo).
                // O ask_user espelha o AskUserQuestion built-in (que é desabilitado).
                let resp = rpc_result(
                    id,
                    serde_json::json!({
                        "tools": [
                            {
                                "name": APPROVAL_TOOL,
                                "description": "Ferramenta INTERNA do mecanismo de permissão — não chame diretamente. É invocada automaticamente pelo Claude Code (via --permission-prompt-tool) p/ solicitar aprovação humana de uma tool que precisa de OK.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "tool_name": { "type": "string" },
                                        "input": { "type": "object" }
                                    },
                                    "required": ["tool_name", "input"]
                                }
                            },
                            {
                                "name": ASK_USER_TOOL,
                                "description": "Faz uma ou mais perguntas com opções ao usuário e BLOQUEIA até a resposta. Use SEMPRE que precisar de uma decisão/escolha do usuário, em vez de escrever a pergunta como texto. O resultado traz as opções escolhidas.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "questions": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "header": { "type": "string", "description": "Rótulo curto (≤12 chars) da pergunta." },
                                                    "question": { "type": "string" },
                                                    "multiSelect": { "type": "boolean", "description": "Permite escolher mais de uma opção." },
                                                    "options": {
                                                        "type": "array",
                                                        "items": {
                                                            "type": "object",
                                                            "properties": {
                                                                "label": { "type": "string" },
                                                                "description": { "type": "string" }
                                                            },
                                                            "required": ["label"]
                                                        }
                                                    }
                                                },
                                                "required": ["header", "question", "options"]
                                            }
                                        }
                                    },
                                    "required": ["questions"]
                                }
                            }
                        ]
                    }),
                );
                write_opt(&mut stdout, resp).await;
            }
            "tools/call" => {
                // B6: tools/call sem id (ou id null) é malformado — nem processa
                // (evita bloquear numa interação que ninguém vai correlacionar).
                if id.as_ref().is_none_or(|v| v.is_null()) {
                    continue;
                }
                let params = msg.get("params");
                let tool = params
                    .and_then(|p| p.get("name"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("");
                let args = params
                    .and_then(|p| p.get("arguments"))
                    .cloned()
                    .unwrap_or(serde_json::Value::Null);
                let resp = if tool == APPROVAL_TOOL {
                    // Tool de PERMISSÃO: content block de texto com o JSON
                    // {behavior, updatedInput?|message?} stringificado (protocolo do
                    // --permission-prompt-tool do Claude Code).
                    let payload = ask_app_approval(&args).await;
                    rpc_result(
                        id,
                        serde_json::json!({
                            "content": [{ "type": "text", "text": payload.to_string() }]
                        }),
                    )
                } else if tool == ASK_USER_TOOL {
                    // Tool de CONTEÚDO: o RESULTADO (content block de texto com o JSON
                    // {answers:[{header,selected}]} stringificado) É a resposta que o
                    // modelo lê. Não há behavior/permissão aqui.
                    let payload = ask_app_question(&args).await;
                    rpc_result(
                        id,
                        serde_json::json!({
                            "content": [{ "type": "text", "text": payload.to_string() }]
                        }),
                    )
                } else {
                    // tool desconhecida: erro isError (não é permissão nem conteúdo nosso).
                    rpc_result(
                        id,
                        serde_json::json!({
                            "content": [{ "type": "text", "text": "tool desconhecida" }],
                            "isError": true
                        }),
                    )
                };
                write_opt(&mut stdout, resp).await;
            }
            _ => {
                // método não suportado: responde erro só se tinha id real (request);
                // sem id (ou id null) = notificação/malformado → silêncio (B6).
                if id.as_ref().is_some_and(|v| !v.is_null()) {
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

/// APPROVAL: encaminha o pedido de aprovação ao app pelo socket (kind="approval") e
/// traduz a resposta no payload que o Claude Code espera do permission-prompt:
/// {behavior, updatedInput?} no allow, {behavior:"deny", message} no deny. Fail-closed
/// em qualquer erro de IPC (sem socket, app fechado): nega, nunca libera às cegas.
async fn ask_app_approval(args: &serde_json::Value) -> serde_json::Value {
    let tool_name = args
        .get("tool_name")
        .and_then(|x| x.as_str())
        .unwrap_or("tool");
    let input = args
        .get("input")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    // conveniência p/ a UI: extrai o comando p/ Bash (mostrado em destaque).
    let command = input
        .get("command")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let data = serde_json::json!({
        "tool_name": tool_name,
        "command": command,
        "input": input,
    });
    let answer = match request_over_socket("approval", &data).await {
        Some(a) => a,
        None => {
            return serde_json::json!({ "behavior": "deny", "message": "sem canal de aprovação" });
        }
    };
    // a resposta de aprovação vem no shape {allow, updated_input?, message?}.
    let decision: ApprovalDecision = match serde_json::from_value(answer) {
        Ok(d) => d,
        Err(_) => {
            return serde_json::json!({ "behavior": "deny", "message": "resposta de aprovação inválida" });
        }
    };
    if decision.allow {
        let updated = decision.updated_input.unwrap_or(input);
        serde_json::json!({ "behavior": "allow", "updatedInput": updated })
    } else {
        serde_json::json!({
            "behavior": "deny",
            "message": decision.message.unwrap_or_else(|| "negado pelo usuário".to_string())
        })
    }
}

/// QUESTION: encaminha as perguntas ao app pelo socket (kind="question") e devolve
/// a resposta CRUA {answers:[{header,selected:[labels]}]} — o próprio content block
/// que o modelo lê. Fail-closed (erro de IPC/timeout): answers vazio (cancelado); o
/// modelo recebe que o usuário não respondeu, melhor que pendurar.
async fn ask_app_question(args: &serde_json::Value) -> serde_json::Value {
    // data = o input do ask_user ({questions:[...]}) — repassado ao app pro card.
    let questions = args
        .get("questions")
        .cloned()
        .unwrap_or(serde_json::json!([]));
    let data = serde_json::json!({ "questions": questions });
    match request_over_socket("question", &data).await {
        // o app já devolve {answers:[...]}; repassa como o resultado da tool.
        Some(answer) => answer,
        None => serde_json::json!({ "answers": [] }),
    }
}

/// Conecta no socket do app, manda {id, kind, data} e lê {answer} (1 linha por
/// sentido). None em qualquer erro de IPC (o caller trata como fail-closed por kind).
async fn request_over_socket(kind: &str, data: &serde_json::Value) -> Option<serde_json::Value> {
    let sock = std::env::var(SOCK_ENV).ok()?;
    let mut stream = UnixStream::connect(&sock).await.ok()?;
    // id único do pedido (correlaciona no app e na UI): pid + contador atômico
    // (B3 — SystemTime é não-monotônico e podia colidir; o contador nunca).
    static REQ_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let seq = REQ_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let id = format!("{kind}-{}-{seq}", std::process::id());
    let req = serde_json::json!({ "id": id, "kind": kind, "data": data });
    let mut buf = req.to_string();
    buf.push('\n');
    stream.write_all(buf.as_bytes()).await.ok()?;
    stream.flush().await.ok()?;
    // divide p/ ler a resposta sem largar a escrita (a conexão fica aberta).
    let (rd, _wr) = stream.into_split();
    let mut reader = BufReader::new(rd);
    let mut resp = String::new();
    reader.read_line(&mut resp).await.ok()?;
    let v: serde_json::Value = serde_json::from_str(resp.trim()).ok()?;
    v.get("answer").cloned()
}

/// Monta uma resposta JSON-RPC 2.0 de sucesso. None quando NÃO há id (B6):
/// notificação/malformado não recebe resposta — jamais respondemos "id": null.
fn rpc_result(
    id: Option<serde_json::Value>,
    result: serde_json::Value,
) -> Option<serde_json::Value> {
    let id = id.filter(|v| !v.is_null())?;
    Some(serde_json::json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

/// Escreve a resposta se houver (Some) — o None (sem id) é silêncio por contrato.
async fn write_opt(stdout: &mut tokio::io::Stdout, msg: Option<serde_json::Value>) {
    if let Some(m) = msg {
        write_line(stdout, &m).await;
    }
}

/// Escreve uma mensagem JSON-RPC como UMA linha no stdout (framing por linha).
async fn write_line(stdout: &mut tokio::io::Stdout, msg: &serde_json::Value) {
    let mut buf = msg.to_string();
    buf.push('\n');
    let _ = stdout.write_all(buf.as_bytes()).await;
    let _ = stdout.flush().await;
}
