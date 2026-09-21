//! Proxy MCP local autenticado (fase A2 do `mcp-auth-plan.md`).
//!
//! Injetar `Authorization: Bearer …` num config efêmero ou em argv vazaria o
//! token (aparece em `ps`, em arquivo temporário e em log de spawn). Em vez
//! disso o app vira PROXY:
//!
//! ```text
//! agent (claude/codex) ──MCP local──► mycockpit ──HTTPS + Bearer──► MCP remoto
//! ```
//!
//! O agent recebe um server local **sem credencial nenhuma**; o token nunca sai
//! do processo do app. O substrato é EXATAMENTE o dos MCPs internos
//! (`work_gateway.rs`): socket unix + o próprio binário do app como server
//! stdio, porque é o que já funciona nos dois motores.
//!
//! O proxy repassa e esquece: nenhum payload de request ou response é
//! guardado.

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::process::Command;

use crate::mcp_auth::{self, OauthConfig, StoredTokens};

/// Subcomando do próprio binário, no mesmo padrão de `work-server`.
pub const SUBCOMANDO: &str = "mcp-proxy-server";
pub const SOCK_ENV: &str = "FROTA_MCP_PROXY_SOCK";

/// Versão do protocolo anunciada pelo proxy ao agent local. É a mesma que o
/// health check HTTP do control plane já usa.
const PROTOCOL_VERSION: &str = "2025-06-18";

// ---- configuração entregue ao agent ---------------------------------------

/// O que o agent recebe: um stdio local, sem URL e sem credencial.
#[derive(Clone, Debug)]
pub struct ProxyConfig {
    pub server_bin: String,
    pub socket: String,
}

impl ProxyConfig {
    /// Launch config equivalente, para entrar no plano do run como qualquer
    /// outro MCP stdio. Repare que não há `url`, `env` nem header algum.
    pub fn launch(&self) -> crate::mcp_control::McpLaunchConfig {
        crate::mcp_control::McpLaunchConfig {
            transport: "stdio".into(),
            command: Some(self.server_bin.clone()),
            args: vec![SUBCOMANDO.to_string()],
            env: [(SOCK_ENV.to_string(), self.socket.clone())]
                .into_iter()
                .collect(),
            ..Default::default()
        }
    }
}

// ---- peças puras -----------------------------------------------------------

/// Headers da chamada ao MCP remoto.
///
/// O `Authorization` é montado AQUI, dentro do processo do app, e some junto
/// com a request. Função separada para o teste provar que o header existe e que
/// o token não escapa para nenhum outro lugar.
pub fn montar_headers(
    token: &str,
    session_id: Option<&str>,
    protocol_version: Option<&str>,
) -> Vec<(String, String)> {
    let mut headers = vec![
        ("Authorization".to_string(), format!("Bearer {token}")),
        (
            "Accept".to_string(),
            "application/json, text/event-stream".to_string(),
        ),
    ];
    // Streamable HTTP: o servidor pode abrir sessão no `initialize` e exigir o
    // eco do id nas chamadas seguintes.
    if let Some(id) = session_id {
        headers.push(("Mcp-Session-Id".to_string(), id.to_string()));
    }
    if let Some(versao) = protocol_version {
        headers.push(("MCP-Protocol-Version".to_string(), versao.to_string()));
    }
    headers
}

/// Esconde o token em qualquer texto que possa virar log ou mensagem de erro.
///
/// O proxy nunca deve registrar o header inteiro; se um detalhe de erro do
/// curl citar a linha, ela sai redigida.
pub fn sem_segredo(texto: &str) -> String {
    let mut saida = String::with_capacity(texto.len());
    for parte in texto.split_inclusive(|c: char| c == '\n') {
        let minusculo = parte.to_ascii_lowercase();
        if let Some(pos) = minusculo.find("bearer ") {
            saida.push_str(&parte[..pos]);
            saida.push_str("Bearer ***");
            if parte.ends_with('\n') {
                saida.push('\n');
            }
        } else {
            saida.push_str(parte);
        }
    }
    saida
}

/// Corpo de resposta do Streamable HTTP: JSON puro ou um frame SSE.
///
/// Servidor de Streamable HTTP costuma responder `text/event-stream` mesmo para
/// uma única resposta. Ler só JSON quebraria contra servidor real.
pub fn extrair_resposta(corpo: &str) -> Option<Value> {
    let limpo = corpo.trim();
    if limpo.is_empty() {
        return None;
    }
    if let Ok(valor) = serde_json::from_str::<Value>(limpo) {
        return Some(valor);
    }
    // Frame SSE: junta as linhas `data:` do primeiro evento com payload.
    let mut dados = String::new();
    for linha in limpo.lines() {
        if let Some(resto) = linha.strip_prefix("data:") {
            dados.push_str(resto.trim_start());
        } else if !dados.is_empty() && linha.trim().is_empty() {
            break;
        }
    }
    serde_json::from_str(&dados).ok()
}

/// Id de sessão devolvido pelo servidor, para ecoar nas próximas chamadas.
pub fn extrair_session_id(headers: &str) -> Option<String> {
    headers
        .lines()
        .find(|linha| linha.to_ascii_lowercase().starts_with("mcp-session-id:"))
        .and_then(|linha| linha.split_once(':'))
        .map(|(_, valor)| valor.trim().to_string())
        .filter(|valor| !valor.is_empty())
}

/// Recusa fail-closed com motivo legível.
///
/// O modelo recebe uma resposta JSON-RPC bem formada explicando o que houve, em
/// vez de erro cru ou silêncio — o agent não fica achando que a tool existe e
/// falhando no meio da tarefa.
pub fn erro_jsonrpc(id: Option<&Value>, mensagem: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id.cloned().unwrap_or(Value::Null),
        "error": { "code": -32001, "message": sem_segredo(mensagem) }
    })
}

/// Uma chamada `tools/call` que falha vira conteúdo de erro da própria tool,
/// não erro de protocolo: é assim que o modelo lê o motivo e decide.
pub fn erro_de_tool(id: &Value, mensagem: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id.clone(),
        "result": {
            "content": [{ "type": "text", "text": sem_segredo(mensagem) }],
            "isError": true
        }
    })
}

fn eh_notificacao(mensagem: &Value) -> bool {
    mensagem.get("id").is_none_or(Value::is_null)
}

// ---- estado do proxy -------------------------------------------------------

struct EstadoProxy {
    server_id: String,
    endpoint: String,
    config: OauthConfig,
    session_id: Mutex<Option<String>>,
}

impl EstadoProxy {
    fn session(&self) -> Option<String> {
        self.session_id.lock().ok().and_then(|guard| guard.clone())
    }

    fn guardar_session(&self, headers: &str) {
        if let Some(id) = extrair_session_id(headers) {
            if let Ok(mut guard) = self.session_id.lock() {
                *guard = Some(id);
            }
        }
    }
}

/// Credencial pronta para uso: renova antes de gastar a chamada quando o token
/// já venceu.
async fn credencial(estado: &EstadoProxy) -> Result<StoredTokens, String> {
    let tokens = mcp_auth::load_tokens(&estado.server_id)?.ok_or_else(|| {
        "sem login da Frota neste MCP; entre em Configurações → Integrações MCP".to_string()
    })?;
    if tokens.expirado(agora_secs()) {
        return mcp_auth::refresh(&estado.server_id, &estado.config, &tokens).await;
    }
    Ok(tokens)
}

fn agora_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Repassa UMA mensagem JSON-RPC ao MCP remoto, com renovação transparente.
///
/// 401 → refresh → **um único** retry. Falha do refresh não vira erro cru: o
/// motivo legível sobe e o chamador recusa a chamada.
async fn repassar(estado: &EstadoProxy, mensagem: &Value) -> Result<Option<Value>, String> {
    let tokens = credencial(estado).await?;
    let corpo = mensagem.to_string();

    let mut tokens = tokens;
    let mut tentou_renovar = false;
    loop {
        let headers = montar_headers(
            &tokens.access_token,
            estado.session().as_deref(),
            Some(PROTOCOL_VERSION),
        );
        let resposta = mcp_auth::curl_json(&estado.endpoint, &corpo, &headers).await?;

        if resposta.status == 401 && !tentou_renovar {
            // Renovação transparente, uma vez só: sem o limite, um 401
            // persistente viraria laço de refresh contra o servidor.
            tentou_renovar = true;
            tokens = mcp_auth::refresh(&estado.server_id, &estado.config, &tokens).await?;
            continue;
        }
        if resposta.status == 401 {
            return Err(
                "o servidor recusou a credencial mesmo após renovar; entre de novo em Configurações → Integrações MCP".into(),
            );
        }
        if !(200..300).contains(&resposta.status) {
            return Err(format!("o MCP remoto respondeu HTTP {}", resposta.status));
        }
        estado.guardar_session(&resposta.headers);
        // 202 sem corpo é a resposta legítima a uma notificação.
        return Ok(extrair_resposta(&resposta.corpo));
    }
}

// ---- listener (lado do app) ------------------------------------------------

fn socket_candidates(chave: &str) -> [PathBuf; 3] {
    let curto: String = chave.chars().take(12).collect();
    let dir = std::env::temp_dir();
    [
        dir.join(format!("mc-mcpx-{curto}.sock")),
        dir.join(format!("mc-mcpx-{curto}-1.sock")),
        dir.join(format!("mc-mcpx-{curto}-2.sock")),
    ]
}

fn bind_socket(chave: &str) -> Option<(PathBuf, UnixListener)> {
    for path in socket_candidates(chave) {
        if path.exists() {
            if std::os::unix::net::UnixStream::connect(&path).is_ok() {
                continue;
            }
            let _ = std::fs::remove_file(&path);
        }
        if let Ok(listener) = UnixListener::bind(&path) {
            return Some((path, listener));
        }
    }
    None
}

/// Vive enquanto o plano do run viver. Ao cair, remove o socket.
///
/// `Debug` mostra só o caminho do socket: o estado interno carrega credencial
/// e nunca deve cair num log por acidente.
#[derive(Debug)]
pub struct ProxyListener {
    path: PathBuf,
    task: tokio::task::JoinHandle<()>,
}

impl ProxyListener {
    pub fn spawn(server_id: String, endpoint: String, config: OauthConfig) -> Option<Self> {
        let (path, listener) = bind_socket(&format!("{server_id}-{}", std::process::id()))?;
        let estado = Arc::new(EstadoProxy {
            server_id,
            endpoint,
            config,
            session_id: Mutex::new(None),
        });
        let task = tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let estado = estado.clone();
                tokio::spawn(async move {
                    atender(stream, estado).await;
                });
            }
        });
        Some(Self { path, task })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for ProxyListener {
    fn drop(&mut self) {
        self.task.abort();
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Uma conexão = uma mensagem JSON-RPC, no mesmo formato linha-a-linha do
/// `work_gateway`.
async fn atender(stream: UnixStream, estado: Arc<EstadoProxy>) {
    let (rd, mut wr) = stream.into_split();
    let mut linha = String::new();
    let mut reader = BufReader::new(rd);
    if reader.read_line(&mut linha).await.is_err() {
        return;
    }
    let Ok(mensagem) = serde_json::from_str::<Value>(linha.trim()) else {
        return;
    };
    let id = mensagem.get("id").cloned();
    let resposta = match repassar(&estado, &mensagem).await {
        Ok(Some(valor)) => Some(valor),
        Ok(None) => None,
        Err(motivo) => {
            if eh_notificacao(&mensagem) {
                // Notificação não tem para quem responder; o proxy não inventa
                // resposta nem finge sucesso.
                None
            } else {
                let id = id.clone().unwrap_or(Value::Null);
                let metodo = mensagem.get("method").and_then(Value::as_str).unwrap_or("");
                Some(if metodo == "tools/call" {
                    erro_de_tool(&id, &motivo)
                } else {
                    erro_jsonrpc(Some(&id), &motivo)
                })
            }
        }
    };
    if let Some(resposta) = resposta {
        let mut buf = resposta.to_string();
        buf.push('\n');
        let _ = wr.write_all(buf.as_bytes()).await;
        let _ = wr.flush().await;
    }
    // O payload sai de escopo aqui: o proxy repassa e esquece.
}

// ---- server stdio (lado do agent) ------------------------------------------

pub fn run_mcp_server() {
    let rt = tokio::runtime::Runtime::new().expect("mcp-proxy-server: runtime tokio");
    rt.block_on(loop_stdio());
}

async fn loop_stdio() {
    let mut reader = BufReader::new(tokio::io::stdin()).lines();
    let mut stdout = tokio::io::stdout();
    while let Ok(Some(linha)) = reader.next_line().await {
        let Ok(mensagem) = serde_json::from_str::<Value>(linha.trim()) else {
            continue;
        };
        let id = mensagem.get("id").cloned();
        let resposta = pedir_ao_app(&mensagem).await;
        match resposta {
            Some(valor) => escrever(&mut stdout, &valor).await,
            None => {
                // Sem resposta do app numa mensagem que ESPERA resposta, o
                // agent ficaria pendurado. Recusa explícita, fail-closed.
                if !eh_notificacao(&mensagem) {
                    let erro = erro_jsonrpc(id.as_ref(), "Frota indisponível para este MCP");
                    escrever(&mut stdout, &erro).await;
                }
            }
        }
    }
}

async fn pedir_ao_app(mensagem: &Value) -> Option<Value> {
    let socket = std::env::var(SOCK_ENV).ok()?;
    let mut stream = UnixStream::connect(socket).await.ok()?;
    let mut pedido = mensagem.to_string();
    pedido.push('\n');
    stream.write_all(pedido.as_bytes()).await.ok()?;
    stream.flush().await.ok()?;
    let mut linha = String::new();
    BufReader::new(stream).read_line(&mut linha).await.ok()?;
    if linha.trim().is_empty() {
        return None;
    }
    serde_json::from_str(linha.trim()).ok()
}

async fn escrever(stdout: &mut tokio::io::Stdout, valor: &Value) {
    let mut linha = valor.to_string();
    linha.push('\n');
    let _ = stdout.write_all(linha.as_bytes()).await;
    let _ = stdout.flush().await;
}

/// Este launch é um server local do proxy?
pub fn is_proxy_launch(launch: &crate::mcp_control::McpLaunchConfig) -> bool {
    launch.transport == "stdio" && launch.args.first().map(String::as_str) == Some(SUBCOMANDO)
}

/// Overrides do Codex para o server local, no mesmo formato do `work_gateway`.
///
/// Existe porque o `configure_codex` genérico do launch **não** copia o mapa
/// `env` literal — e com razão: ali moram valores de config alheia que não
/// podem viajar pra argv. O socket do proxy não é segredo de terceiro, é
/// endereço que o app acabou de criar, então tem caminho próprio. Sem isto o
/// server subiria no Codex sem saber com quem falar.
pub fn configure_codex_launch(
    runtime_name: &str,
    launch: &crate::mcp_control::McpLaunchConfig,
    cmd: &mut Command,
) {
    let key = format!("mcp_servers.{runtime_name}");
    let aspas = |valor: &str| serde_json::to_string(valor).unwrap_or_else(|_| "\"\"".into());
    cmd.arg("-c").arg(format!("{key}.enabled=true"));
    if let Some(program) = &launch.command {
        cmd.arg("-c")
            .arg(format!("{key}.command={}", aspas(program)));
    }
    cmd.arg("-c").arg(format!("{key}.args=[\"{SUBCOMANDO}\"]"));
    if let Some(socket) = launch.env.get(SOCK_ENV) {
        cmd.arg("-c")
            .arg(format!("{key}.env.{SOCK_ENV}={}", aspas(socket)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn o_agent_recebe_server_local_sem_url_e_sem_credencial() {
        let config = ProxyConfig {
            server_bin: "/Applications/Frota".into(),
            socket: "/tmp/mc-mcpx.sock".into(),
        };
        let launch = config.launch();
        assert_eq!(launch.transport, "stdio");
        assert_eq!(launch.args, vec![SUBCOMANDO]);
        // O que sustenta a garantia central: nada de endpoint remoto, nada de
        // header, nada de token no que o agent enxerga.
        assert_eq!(launch.url, None);
        assert!(launch.http_headers.is_empty());
        assert_eq!(launch.bearer_token_env_var, None);
        assert_eq!(
            launch.env.get(SOCK_ENV).map(String::as_str),
            Some("/tmp/mc-mcpx.sock")
        );
        assert!(!launch
            .env
            .values()
            .any(|v| v.to_lowercase().contains("bearer")));
    }

    #[test]
    fn o_header_de_autorizacao_e_montado_no_app_e_leva_o_bearer() {
        let headers = montar_headers("tok-123", None, None);
        let auth = headers
            .iter()
            .find(|(nome, _)| nome == "Authorization")
            .expect("proxy precisa autorizar a chamada");
        assert_eq!(auth.1, "Bearer tok-123");
        // Streamable HTTP pode responder SSE; o Accept precisa admitir os dois.
        let accept = headers.iter().find(|(nome, _)| nome == "Accept").unwrap();
        assert!(accept.1.contains("text/event-stream"));
    }

    #[test]
    fn sessao_e_versao_de_protocolo_so_vao_quando_existem() {
        let sem = montar_headers("t", None, None);
        assert!(!sem.iter().any(|(nome, _)| nome == "Mcp-Session-Id"));
        let com = montar_headers("t", Some("sess-1"), Some("2025-06-18"));
        assert_eq!(
            com.iter()
                .find(|(nome, _)| nome == "Mcp-Session-Id")
                .map(|(_, v)| v.as_str()),
            Some("sess-1")
        );
    }

    #[test]
    fn o_token_nunca_aparece_em_texto_que_pode_virar_log() {
        let bruto = "curl: falha ao enviar\nAuthorization: Bearer tok-supersecreto\nfim";
        let limpo = sem_segredo(bruto);
        assert!(!limpo.contains("tok-supersecreto"), "vazou: {limpo}");
        assert!(limpo.contains("Bearer ***"));
        // O resto da mensagem continua útil para o humano entender a falha.
        assert!(limpo.contains("curl: falha ao enviar"));
        assert!(limpo.contains("fim"));
    }

    #[test]
    fn a_recusa_fail_closed_nao_vaza_o_token_na_mensagem() {
        let erro = erro_jsonrpc(Some(&json!(7)), "falhou com Bearer tok-secreto no meio");
        let texto = erro.to_string();
        assert!(!texto.contains("tok-secreto"), "vazou: {texto}");
        assert_eq!(erro["id"], json!(7));
        assert_eq!(erro["error"]["code"], json!(-32001));
    }

    #[test]
    fn resposta_em_json_puro_e_em_frame_sse_sao_lidas_igual() {
        let esperado = json!({"jsonrpc": "2.0", "id": 1, "result": {"tools": []}});
        let puro = r#"{"jsonrpc":"2.0","id":1,"result":{"tools":[]}}"#;
        assert_eq!(extrair_resposta(puro), Some(esperado.clone()));
        // Streamable HTTP real costuma devolver a resposta única como SSE.
        let sse =
            "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"tools\":[]}}\n\n";
        assert_eq!(extrair_resposta(sse), Some(esperado));
    }

    #[test]
    fn corpo_vazio_de_notificacao_nao_vira_resposta_inventada() {
        assert_eq!(extrair_resposta(""), None);
        assert_eq!(extrair_resposta("   \n"), None);
    }

    #[test]
    fn o_id_de_sessao_do_servidor_e_capturado_para_as_proximas_chamadas() {
        let headers = "HTTP/2 200\ncontent-type: text/event-stream\nmcp-session-id: abc-123\n";
        assert_eq!(extrair_session_id(headers), Some("abc-123".into()));
        assert_eq!(extrair_session_id("HTTP/2 200\n"), None);
    }

    #[test]
    fn falha_de_tool_vira_conteudo_de_erro_e_nao_erro_de_protocolo() {
        // O modelo precisa LER o motivo e decidir; um -32001 seco encerraria a
        // chamada sem explicar.
        let erro = erro_de_tool(&json!(3), "sem login da Frota neste MCP");
        assert_eq!(erro["result"]["isError"], json!(true));
        assert!(erro["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("sem login"));
    }

    #[test]
    fn notificacao_e_reconhecida_por_id_ausente_ou_nulo() {
        assert!(eh_notificacao(
            &json!({"jsonrpc": "2.0", "method": "notifications/initialized"})
        ));
        assert!(eh_notificacao(&json!({"jsonrpc": "2.0", "id": null})));
        assert!(!eh_notificacao(&json!({"jsonrpc": "2.0", "id": 1})));
    }

    /// O ganho central da A2 é "funciona igual pros dois motores". Se o socket
    /// não chega, o server sobe sem saber com quem falar — foi o que quase
    /// aconteceu: o `configure_codex` genérico NÃO copia o mapa `env`.
    #[test]
    fn os_dois_motores_recebem_o_socket_do_proxy() {
        let config = ProxyConfig {
            server_bin: "/Applications/Frota".into(),
            socket: "/tmp/mc-mcpx-abc.sock".into(),
        };
        let launch = config.launch();

        let claude = launch.claude_json();
        assert_eq!(
            claude["env"][SOCK_ENV].as_str(),
            Some("/tmp/mc-mcpx-abc.sock"),
            "Claude precisa do socket no env"
        );

        let mut cmd = Command::new("codex");
        configure_codex_launch("mcx-proxy", &launch, &mut cmd);
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert!(
            args.iter().any(|arg| arg.contains("/tmp/mc-mcpx-abc.sock")),
            "Codex precisa do socket no override: {args:?}"
        );
    }

    #[test]
    fn o_launch_do_proxy_e_reconhecido_para_ganhar_o_caminho_proprio() {
        let config = ProxyConfig {
            server_bin: "/bin/app".into(),
            socket: "/tmp/s.sock".into(),
        };
        assert!(is_proxy_launch(&config.launch()));
        // Um stdio qualquer segue no caminho genérico.
        let outro = crate::mcp_control::McpLaunchConfig {
            transport: "stdio".into(),
            command: Some("node".into()),
            args: vec!["server.js".into()],
            ..Default::default()
        };
        assert!(!is_proxy_launch(&outro));
    }

    #[test]
    fn overrides_do_codex_apontam_o_mesmo_server_local_sem_segredo() {
        let config = ProxyConfig {
            server_bin: "/Applications/Frota".into(),
            socket: "/tmp/mc-mcpx.sock".into(),
        };
        let mut cmd = Command::new("codex");
        configure_codex_launch("mcx-proxy", &config.launch(), &mut cmd);
        let args: Vec<String> = cmd
            .as_std()
            .get_args()
            .map(|arg| arg.to_string_lossy().into_owned())
            .collect();
        assert!(args.iter().any(|arg| arg.contains(SUBCOMANDO)));
        assert!(args.iter().any(|arg| arg.contains(SOCK_ENV)));
        assert!(!args.iter().any(|arg| arg.to_lowercase().contains("bearer")));
    }
}
