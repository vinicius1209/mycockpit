//! MCP read-only de memória/contexto do MyCockpit.
//!
//! O prompt recebe só um working set compacto. Esta camada é o "pull": qualquer
//! provider que fale MCP pode consultar o manifesto, buscar no histórico SQLite
//! da conversa corrente e ler uma referência do mesmo cwd. Não expõe SQL, não
//! atravessa a raiz e aplica caps de resultado — memória durável sem despejar
//! tudo na janela de contexto.

use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

pub const MCP_SERVER_NAME: &str = "mc-context";
pub const MANIFEST_TOOL: &str = "context_manifest";
pub const SEARCH_TOOL: &str = "context_search";
pub const READ_TOOL: &str = "context_read";

pub const ROOT_ENV: &str = "MYCOCKPIT_CONTEXT_ROOT";
pub const CONV_ENV: &str = "MYCOCKPIT_CONTEXT_CONV_ID";
pub const DB_ENV: &str = "MYCOCKPIT_CONTEXT_DB";

const MCP_PROTOCOL_VERSION: &str = "2024-11-05";
const MCP_KNOWN_VERSIONS: [&str; 3] = ["2024-11-05", "2025-03-26", "2025-06-18"];
const MAX_MANIFEST_BYTES: u64 = 256 * 1024;
const DEFAULT_READ_CHARS: usize = 12_000;
const MAX_READ_CHARS: usize = 24_000;
const DEFAULT_READ_LINES: usize = 200;
const MAX_READ_LINES: usize = 400;
const MAX_SEARCH_RESULTS: usize = 10;

/// Configuração por-run. O runner resolve os paths uma vez; adapters só
/// traduzem como registrar o mesmo server em cada CLI.
#[derive(Clone, Debug)]
pub struct GatewayConfig {
    pub server_bin: String,
    pub root: String,
    pub conv_id: String,
    pub db_path: Option<String>,
}

impl GatewayConfig {
    pub fn apply_env(&self, cmd: &mut Command) {
        cmd.env(ROOT_ENV, &self.root).env(CONV_ENV, &self.conv_id);
        if let Some(db) = &self.db_path {
            cmd.env(DB_ENV, db);
        }
    }

    /// Entrada do `--mcp-config` do Claude.
    pub fn claude_server_json(&self) -> Value {
        let mut env = serde_json::Map::new();
        env.insert(ROOT_ENV.into(), json!(self.root));
        env.insert(CONV_ENV.into(), json!(self.conv_id));
        if let Some(db) = &self.db_path {
            env.insert(DB_ENV.into(), json!(db));
        }
        json!({
            "type": "stdio",
            "command": self.server_bin,
            "args": ["context-server"],
            "env": env,
        })
    }

    /// Overrides efêmeros do Codex — não escreve no config global do usuário.
    /// JSON string/array também são TOML válidos para estes valores.
    pub fn configure_codex(&self, cmd: &mut Command) {
        let command = serde_json::to_string(&self.server_bin).unwrap_or_else(|_| "\"\"".into());
        cmd.arg("-c")
            .arg(format!("mcp_servers.{}.command={command}", MCP_SERVER_NAME));
        cmd.arg("-c").arg(format!(
            "mcp_servers.{}.args=[\"context-server\"]",
            MCP_SERVER_NAME
        ));
        // O Codex não herda o ambiente arbitrário do processo pai ao spawnar
        // MCPs. Declare cada valor também no bloco `env` do server; os
        // overrides continuam efêmeros e o CLI mascara os valores em `mcp get`.
        for (key, value) in [
            (ROOT_ENV, Some(self.root.as_str())),
            (CONV_ENV, Some(self.conv_id.as_str())),
            (DB_ENV, self.db_path.as_deref()),
        ] {
            if let Some(value) = value {
                let value = serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into());
                cmd.arg("-c")
                    .arg(format!("mcp_servers.{}.env.{key}={value}", MCP_SERVER_NAME));
            }
        }
        self.apply_env(cmd);
    }
}

/// Ponto de entrada do subcomando `context-server`.
pub fn run_mcp_server() {
    let rt = match tokio::runtime::Runtime::new() {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("context-server: sem runtime tokio: {e}");
            std::process::exit(1);
        }
    };
    rt.block_on(mcp_loop());
}

async fn mcp_loop() {
    let stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let mut reader = BufReader::new(stdin).lines();

    while let Ok(Some(line)) = reader.next_line().await {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let msg: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
        let id = msg.get("id").cloned().filter(|v| !v.is_null());
        match method {
            "initialize" => {
                let requested = msg
                    .pointer("/params/protocolVersion")
                    .and_then(Value::as_str);
                let version = requested
                    .filter(|v| MCP_KNOWN_VERSIONS.contains(v))
                    .unwrap_or(MCP_PROTOCOL_VERSION);
                write_opt(
                    &mut stdout,
                    rpc_result(
                        id,
                        json!({
                            "protocolVersion": version,
                            "capabilities": { "tools": {} },
                            "serverInfo": { "name": MCP_SERVER_NAME, "version": "1.0.0" }
                        }),
                    ),
                )
                .await;
            }
            "notifications/initialized" | "initialized" => {}
            "ping" => {
                write_opt(&mut stdout, rpc_result(id, json!({}))).await;
            }
            "tools/list" => {
                write_opt(
                    &mut stdout,
                    rpc_result(id, json!({ "tools": tool_specs() })),
                )
                .await;
            }
            "tools/call" => {
                if id.is_none() {
                    continue;
                }
                let name = msg
                    .pointer("/params/name")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let args = msg
                    .pointer("/params/arguments")
                    .cloned()
                    .unwrap_or_else(|| json!({}));
                let result = call_tool(name, &args);
                write_opt(&mut stdout, rpc_result(id, result)).await;
            }
            _ => {
                if let Some(id) = id {
                    write_line(
                        &mut stdout,
                        &json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "error": { "code": -32601, "message": "method not found" }
                        }),
                    )
                    .await;
                }
            }
        }
    }
}

fn tool_specs() -> Vec<Value> {
    // Sem estas annotations, clientes conservadores (Codex inclusive) assumem
    // que uma tool MCP pode escrever e pedem aprovação. Em headless isso vira
    // cancelamento. O gateway não possui nenhuma operação mutante.
    let read_only = || {
        json!({
            "readOnlyHint": true,
            "destructiveHint": false,
            "idempotentHint": true,
            "openWorldHint": false
        })
    };
    vec![
        json!({
            "name": MANIFEST_TOOL,
            "description": "Lê o índice compacto do handoff atual: objetivo, decisões, falha de origem, arquivos alterados e ponteiros. Use primeiro ao assumir uma conversa de outro agent.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": read_only()
        }),
        json!({
            "name": SEARCH_TOOL,
            "description": "Busca sob demanda somente no histórico SQLite da conversa atual. Retorna referências compactas; use context_read para expandir apenas as relevantes.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "query": { "type": "string", "description": "Termos ou frase a localizar." },
                    "limit": { "type": "integer", "minimum": 1, "maximum": MAX_SEARCH_RESULTS }
                },
                "required": ["query"],
                "additionalProperties": false
            },
            "annotations": read_only()
        }),
        json!({
            "name": READ_TOOL,
            "description": "Expande uma referência retornada pelo manifesto/busca ou lê um arquivo relativo ao cwd, com limites rígidos de linhas e caracteres.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ref": { "type": "string", "description": "conversation:item:N, manifest ou path relativo ao cwd." },
                    "start_line": { "type": "integer", "minimum": 1 },
                    "max_lines": { "type": "integer", "minimum": 1, "maximum": MAX_READ_LINES },
                    "max_chars": { "type": "integer", "minimum": 256, "maximum": MAX_READ_CHARS }
                },
                "required": ["ref"],
                "additionalProperties": false
            },
            "annotations": read_only()
        }),
    ]
}

fn call_tool(name: &str, args: &Value) -> Value {
    let result = match name {
        MANIFEST_TOOL => read_manifest_from_env(),
        SEARCH_TOOL => {
            let query = args.get("query").and_then(Value::as_str).unwrap_or("");
            let limit = args
                .get("limit")
                .and_then(Value::as_u64)
                .unwrap_or(6)
                .clamp(1, MAX_SEARCH_RESULTS as u64) as usize;
            search_from_env(query, limit)
        }
        READ_TOOL => {
            let reference = args.get("ref").and_then(Value::as_str).unwrap_or("");
            let start = args.get("start_line").and_then(Value::as_u64).unwrap_or(1) as usize;
            let lines = args
                .get("max_lines")
                .and_then(Value::as_u64)
                .unwrap_or(DEFAULT_READ_LINES as u64)
                .clamp(1, MAX_READ_LINES as u64) as usize;
            let chars = args
                .get("max_chars")
                .and_then(Value::as_u64)
                .unwrap_or(DEFAULT_READ_CHARS as u64)
                .clamp(256, MAX_READ_CHARS as u64) as usize;
            read_ref_from_env(reference, start, lines, chars)
        }
        _ => Err("tool desconhecida".into()),
    };
    match result {
        Ok(text) => json!({ "content": [{ "type": "text", "text": text }] }),
        Err(message) => json!({
            "content": [{ "type": "text", "text": message }],
            "isError": true
        }),
    }
}

fn env_context() -> Result<(PathBuf, String, Option<PathBuf>), String> {
    let root = std::env::var(ROOT_ENV).map_err(|_| "context root ausente".to_string())?;
    let conv = std::env::var(CONV_ENV).map_err(|_| "conversation id ausente".to_string())?;
    safe_conv_id(&conv)?;
    let db = std::env::var(DB_ENV).ok().map(PathBuf::from);
    Ok((PathBuf::from(root), conv, db))
}

fn read_manifest_from_env() -> Result<String, String> {
    let (root, conv, _) = env_context()?;
    read_manifest(&root, &conv)
}

fn read_manifest(root: &Path, conv: &str) -> Result<String, String> {
    safe_conv_id(conv)?;
    let path = root
        .join(".mycockpit")
        .join("context")
        .join(format!("{conv}.handoff.json"));
    let md =
        std::fs::metadata(&path).map_err(|_| "manifesto de handoff não encontrado".to_string())?;
    if md.len() > MAX_MANIFEST_BYTES {
        return Err("manifesto excede o limite de leitura".into());
    }
    std::fs::read_to_string(path).map_err(|e| format!("não consegui ler o manifesto: {e}"))
}

fn search_from_env(query: &str, limit: usize) -> Result<String, String> {
    let (_, conv, db) = env_context()?;
    let db = db.ok_or_else(|| "SQLite da Frota indisponível neste run".to_string())?;
    let rows = search_conversation(&db, &conv, query, limit)?;
    serde_json::to_string_pretty(&json!({
        "query": query,
        "results": rows,
        "hint": "Expanda somente o que for necessário com context_read(ref)."
    }))
    .map_err(|e| e.to_string())
}

fn search_conversation(
    db: &Path,
    conv: &str,
    query: &str,
    limit: usize,
) -> Result<Vec<Value>, String> {
    safe_conv_id(conv)?;
    let query = query.trim();
    if query.len() < 2 {
        return Err("query precisa ter ao menos 2 caracteres".into());
    }
    let conn = Connection::open_with_flags(
        db,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("SQLite indisponível: {e}"))?;
    let items: String = conn
        .query_row(
            "SELECT items FROM conversations WHERE id = ?1",
            [conv],
            |row| row.get(0),
        )
        .map_err(|e| format!("conversa não encontrada no SQLite: {e}"))?;
    let items: Vec<Value> =
        serde_json::from_str(&items).map_err(|e| format!("histórico corrompido: {e}"))?;
    let query_lower = query.to_lowercase();
    let terms = tokens(&query_lower);
    let total = items.len().max(1) as f64;
    let mut hits: Vec<(f64, Value)> = items
        .iter()
        .enumerate()
        .filter_map(|(index, item)| {
            let text = searchable_text(item);
            if text.is_empty() {
                return None;
            }
            let lower = text.to_lowercase();
            let matched = terms.iter().filter(|t| lower.contains(t.as_str())).count();
            if matched == 0 && !lower.contains(&query_lower) {
                return None;
            }
            let exact = if lower.contains(&query_lower) {
                8.0
            } else {
                0.0
            };
            let coverage = matched as f64 / terms.len().max(1) as f64;
            let recency = index as f64 / total;
            let score = exact + coverage * 6.0 + recency;
            let kind = item.get("kind").and_then(Value::as_str).unwrap_or("item");
            Some((
                score,
                json!({
                    "ref": format!("conversation:item:{index}"),
                    "kind": kind,
                    "summary": truncate_chars(&text, 500),
                    "score": (score * 100.0).round() / 100.0
                }),
            ))
        })
        .collect();
    hits.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(Ordering::Equal));
    Ok(hits
        .into_iter()
        .take(limit.clamp(1, MAX_SEARCH_RESULTS))
        .map(|(_, item)| item)
        .collect())
}

fn read_ref_from_env(
    reference: &str,
    start_line: usize,
    max_lines: usize,
    max_chars: usize,
) -> Result<String, String> {
    let (root, conv, db) = env_context()?;
    if reference == "manifest" || reference == "context:manifest" {
        return read_manifest(&root, &conv);
    }
    if let Some(raw) = reference.strip_prefix("conversation:item:") {
        let index = raw
            .parse::<usize>()
            .map_err(|_| "referência de conversa inválida".to_string())?;
        let db = db.ok_or_else(|| "SQLite da Frota indisponível neste run".to_string())?;
        return read_conversation_item(&db, &conv, index, max_chars);
    }
    read_project_file(&root, reference, start_line, max_lines, max_chars)
}

fn read_conversation_item(
    db: &Path,
    conv: &str,
    index: usize,
    max_chars: usize,
) -> Result<String, String> {
    safe_conv_id(conv)?;
    let conn = Connection::open_with_flags(
        db,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| format!("SQLite indisponível: {e}"))?;
    let items: String = conn
        .query_row(
            "SELECT items FROM conversations WHERE id = ?1",
            [conv],
            |row| row.get(0),
        )
        .map_err(|e| format!("conversa não encontrada no SQLite: {e}"))?;
    let items: Vec<Value> =
        serde_json::from_str(&items).map_err(|e| format!("histórico corrompido: {e}"))?;
    let item = items
        .get(index)
        .ok_or_else(|| "referência não existe nesta conversa".to_string())?;
    let text = serde_json::to_string_pretty(item).map_err(|e| e.to_string())?;
    Ok(truncate_chars(&text, max_chars.min(MAX_READ_CHARS)))
}

fn read_project_file(
    root: &Path,
    reference: &str,
    start_line: usize,
    max_lines: usize,
    max_chars: usize,
) -> Result<String, String> {
    if reference.is_empty() || Path::new(reference).is_absolute() {
        return Err("use um path relativo ao diretório do run".into());
    }
    let root = root
        .canonicalize()
        .map_err(|e| format!("raiz de contexto inválida: {e}"))?;
    let target = root
        .join(reference)
        .canonicalize()
        .map_err(|e| format!("referência não encontrada: {e}"))?;
    if !target.starts_with(&root) {
        return Err("referência fora do diretório do run".into());
    }
    if !target.is_file() {
        return Err("referência não é um arquivo".into());
    }
    let text = std::fs::read_to_string(&target)
        .map_err(|e| format!("referência não é texto legível: {e}"))?;
    let start = start_line.max(1);
    let mut out = String::new();
    let mut truncated = false;
    for (idx, line) in text
        .lines()
        .enumerate()
        .skip(start - 1)
        .take(max_lines.min(MAX_READ_LINES))
    {
        let row = format!("{}: {}\n", idx + 1, line);
        if out.chars().count() + row.chars().count() > max_chars.min(MAX_READ_CHARS) {
            truncated = true;
            break;
        }
        out.push_str(&row);
    }
    if text.lines().count() > start.saturating_sub(1) + max_lines {
        truncated = true;
    }
    if truncated {
        out.push_str("… conteúdo restante omitido; peça outro intervalo se necessário.\n");
    }
    Ok(out)
}

fn searchable_text(item: &Value) -> String {
    match item.get("kind").and_then(Value::as_str).unwrap_or("") {
        "user" | "text" | "advice" => item
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        "error" | "notice" | "limit" => item
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        "tool" => {
            let name = item.get("name").and_then(Value::as_str).unwrap_or("tool");
            let input = item.get("input").cloned().unwrap_or(Value::Null);
            let result = item
                .pointer("/result/text")
                .and_then(Value::as_str)
                .unwrap_or("");
            format!("{name} {input} {result}")
        }
        "result" => item
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        _ => String::new(),
    }
}

fn tokens(s: &str) -> Vec<String> {
    s.split(|c: char| !c.is_alphanumeric() && c != '_' && c != '-')
        .filter(|x| x.chars().count() >= 2)
        .map(str::to_string)
        .collect()
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
    out.push('…');
    out
}

fn safe_conv_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        return Err("conversation id inválido".into());
    }
    Ok(())
}

fn rpc_result(id: Option<Value>, result: Value) -> Option<Value> {
    id.map(|id| json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

async fn write_opt(stdout: &mut tokio::io::Stdout, msg: Option<Value>) {
    if let Some(msg) = msg {
        write_line(stdout, &msg).await;
    }
}

async fn write_line(stdout: &mut tokio::io::Stdout, msg: &Value) {
    let mut line = msg.to_string();
    line.push('\n');
    let _ = stdout.write_all(line.as_bytes()).await;
    let _ = stdout.flush().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("mc-context-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join(".mycockpit/context")).unwrap();
        root
    }

    #[test]
    fn busca_sqlite_retorna_refs_ranqueadas_e_nao_o_historico_inteiro() {
        let root = temp_root("search");
        let db = root.join("db.sqlite");
        let conn = Connection::open(&db).unwrap();
        conn.execute(
            "CREATE TABLE conversations (id TEXT PRIMARY KEY, items TEXT NOT NULL)",
            [],
        )
        .unwrap();
        let items = json!([
            {"kind":"user","text":"crie uma tela"},
            {"kind":"text","text":"decidimos usar um gateway orientado por capabilities"},
            {"kind":"text","text":"o gateway também limita tokens"}
        ]);
        conn.execute(
            "INSERT INTO conversations (id, items) VALUES (?1, ?2)",
            ("conv-1", items.to_string()),
        )
        .unwrap();
        drop(conn);

        let hits = search_conversation(&db, "conv-1", "gateway capabilities", 2).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0]["ref"], "conversation:item:1");
        assert!(hits[0]["summary"].as_str().unwrap().len() < 600);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn leitura_de_arquivo_fica_na_raiz_e_respeita_caps() {
        let root = temp_root("read");
        std::fs::write(root.join("ok.txt"), "a\nb\nc\nd\n").unwrap();
        let got = read_project_file(&root, "ok.txt", 2, 2, 1_000).unwrap();
        assert_eq!(
            got,
            "2: b\n3: c\n… conteúdo restante omitido; peça outro intervalo se necessário.\n"
        );
        assert!(read_project_file(&root, "../fora", 1, 10, 1_000).is_err());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn configuracao_codex_e_efemera_e_carrega_o_mesmo_server() {
        let cfg = GatewayConfig {
            server_bin: "/Applications/My Cockpit".into(),
            root: "/repo".into(),
            conv_id: "c1".into(),
            db_path: Some("/data/mycockpit.db".into()),
        };
        let mut cmd = Command::new("codex");
        cfg.configure_codex(&mut cmd);
        let dbg = format!("{cmd:?}");
        assert!(dbg.contains("mcp_servers.mc-context.command"));
        assert!(dbg.contains("mcp_servers.mc-context.env.MYCOCKPIT_CONTEXT_ROOT"));
        assert!(dbg.contains("mcp_servers.mc-context.env.MYCOCKPIT_CONTEXT_CONV_ID"));
        assert!(dbg.contains("mcp_servers.mc-context.env.MYCOCKPIT_CONTEXT_DB"));
        assert!(dbg.contains("context-server"));
        assert!(dbg.contains(ROOT_ENV));
        assert!(dbg.contains(DB_ENV));
    }

    #[test]
    fn todas_as_tools_declaram_contrato_read_only() {
        let specs = tool_specs();
        assert_eq!(specs.len(), 3);
        for spec in specs {
            assert_eq!(
                spec.pointer("/annotations/readOnlyHint"),
                Some(&Value::Bool(true))
            );
            assert_eq!(
                spec.pointer("/annotations/destructiveHint"),
                Some(&Value::Bool(false))
            );
            assert_eq!(
                spec.pointer("/annotations/openWorldHint"),
                Some(&Value::Bool(false))
            );
        }
    }
}
