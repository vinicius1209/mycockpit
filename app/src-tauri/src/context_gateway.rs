//! MCP read-only de memória/contexto da Frota.
//!
//! O prompt recebe só um working set compacto. Esta camada é o "pull": qualquer
//! provider que fale MCP pode consultar o manifesto, buscar no histórico SQLite
//! da conversa corrente e ler uma referência do mesmo cwd. Não expõe SQL, não
//! atravessa a raiz e aplica caps de resultado — memória durável sem despejar
//! tudo na janela de contexto.

use rusqlite::{Connection, OpenFlags, OptionalExtension};
use serde_json::{json, Value};
use std::cmp::Ordering;
use std::path::{Path, PathBuf};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;

pub const MCP_SERVER_NAME: &str = "frota-context";
pub const MANIFEST_TOOL: &str = "context_manifest";
pub const SEARCH_TOOL: &str = "context_search";
pub const READ_TOOL: &str = "context_read";

pub const ROOT_ENV: &str = "FROTA_CONTEXT_ROOT";
pub const CONV_ENV: &str = "FROTA_CONTEXT_CONV_ID";
pub const DB_ENV: &str = "FROTA_CONTEXT_DB";

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
    // Mesma resolução do app, e não um literal: o gateway roda em OUTRO
    // processo, e se ele não enxergasse `.frota/` o agente perderia o handoff
    // exatamente nos projetos já migrados (ADR-222).
    let path = crate::frota_dir::pasta_da_frota(root)
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

/// Quantos candidatos o índice entrega ao ranqueador. 800 é o joelho medido
/// (docs/evidence/busca-no-fio): 200 dá 89% de fidelidade contra a varredura,
/// 400 dá 93,3%, 800 dá 95,7%, e acima disso não sobe mais — o resto é o teto
/// estrutural do índice de tokens, que não alcança match no MEIO da palavra.
const CANDIDATOS_DO_INDICE: usize = 4000;

/// Stopwords pt-BR/en. GÊMEA de `src/lib/recall.ts` (`STOPWORDS`): mudou lá,
/// muda aqui. Não é preciosismo de qualidade — é desempenho. Sem cortá-las, o
/// prefixo de um termo curto explode: `de*` casa 7.976 documentos e fazia
/// "erro de build" custar 16ms FIXOS, independentes do tamanho da conversa.
const STOPWORDS: &[&str] = &[
    "a", "o", "os", "as", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das", "e", "ou",
    "que", "com", "sem", "por", "para", "pra", "pro", "no", "na", "nos", "nas", "em", "ao", "aos",
    "se", "ser", "foi", "the", "of", "to", "in", "on", "for", "and", "or", "with", "isso", "este",
    "esta", "esse", "essa", "mais", "menos",
];

/// A fórmula de relevância, em UM lugar só. Os dois caminhos de busca (índice e
/// varredura) chamam esta função: é o que garante que ligar o índice muda a
/// VELOCIDADE e não o que a pessoa vê. Trocar por BM25 foi medido e recusado —
/// 30x mais rápido e só 32% de sobreposição no top-10 (ADR-213).
fn pontuar(text: &str, index: usize, total: f64, query_lower: &str, terms: &[String]) -> Option<f64> {
    if text.is_empty() {
        return None;
    }
    let lower = text.to_lowercase();
    let matched = terms.iter().filter(|t| lower.contains(t.as_str())).count();
    if matched == 0 && !lower.contains(query_lower) {
        return None;
    }
    let exact = if lower.contains(query_lower) { 8.0 } else { 0.0 };
    let coverage = matched as f64 / terms.len().max(1) as f64;
    let recency = index as f64 / total;
    Some(exact + coverage * 6.0 + recency)
}

fn resultado(text: &str, kind: &str, index: usize, score: f64) -> Value {
    json!({
        "ref": format!("conversation:item:{index}"),
        "kind": kind,
        "summary": truncate_chars(text, 500),
        "score": (score * 100.0).round() / 100.0
    })
}

fn ordenar_e_cortar(mut hits: Vec<(f64, Value)>, limit: usize) -> Vec<Value> {
    hits.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(Ordering::Equal));
    hits.into_iter()
        .take(limit.clamp(1, MAX_SEARCH_RESULTS))
        .map(|(_, item)| item)
        .collect()
}

/// Os termos que valem a pergunta, UMA vez, para os dois caminhos.
///
/// Stopword não pode ser o motivo de um item casar. Medido no corpus real: a
/// varredura respondia "revezamento de motor" com os dez itens mais recentes
/// porque casava só o `de` e desempatava por recência — nenhum deles falava do
/// assunto. Isso é ruído ordenado por recência vestido de resultado, e é o
/// contrário de "estado real, nunca teatro".
///
/// Query feita SÓ de stopwords ainda merece resposta (procurar literalmente
/// "de" é um pedido legítimo), então nesse caso valem os termos crus.
fn termos_uteis(query_lower: &str) -> Vec<String> {
    let brutos = tokens(query_lower);
    let uteis: Vec<String> = brutos
        .iter()
        .filter(|t| t.chars().count() >= 3 && !STOPWORDS.contains(&t.as_str()))
        .cloned()
        .collect();
    if uteis.is_empty() { brutos } else { uteis }
}

/// Comprimento mínimo de termo que o índice `trigram` sabe procurar. Abaixo
/// disso ele devolve zero EM SILÊNCIO, que é o pior desfecho possível: a busca
/// pareceria ter respondido "não achei" quando na verdade nem procurou.
const MINIMO_DO_TRIGRAM: usize = 3;

/// Monta a expressão do FTS5. Com o tokenizador `trigram`, `"termo"` já é busca
/// por SUBSTRING — a mesma semântica do `contains` da varredura —, então não há
/// prefixo `*` a colocar.
///
/// `None` = o índice não pode responder esta pergunta e quem chama deve varrer.
/// Acontece quando algum termo é curto demais para o trigram: devolver os
/// resultados dos termos longos apenas seria pior, porque a pontuação cobra
/// COBERTURA sobre todos os termos, e o item que casa o termo curto ficaria de
/// fora sem ninguém saber.
fn expressao_fts(query_lower: &str) -> Option<String> {
    let escolhidos = termos_uteis(query_lower);
    if escolhidos.is_empty() {
        return None;
    }
    if escolhidos
        .iter()
        .any(|t| t.chars().count() < MINIMO_DO_TRIGRAM)
    {
        return None;
    }
    let partes: Vec<String> = escolhidos
        .iter()
        // O tokenizador já só devolve alfanumérico, `_` e `-`, então não há aspas
        // para escapar aqui; o filtro abaixo é cinto de segurança, não etiqueta.
        .filter(|t| !t.contains('"'))
        .map(|t| format!("\"{t}\""))
        .collect();
    if partes.is_empty() {
        None
    } else {
        Some(partes.join(" OR "))
    }
}

/// Busca pelo índice léxico. `Ok(None)` = esta conversa não está na fonte
/// itemizada (ou o índice não existe ainda), e quem chama deve varrer — é o
/// fail-open do PRD: índice ausente nunca vira erro na tela.
fn search_pelo_indice(
    conn: &Connection,
    conv: &str,
    query_lower: &str,
    terms: &[String],
    limit: usize,
) -> Result<Option<Vec<Value>>, String> {
    // A fonte itemizada se anuncia aqui. Busca por PK, não varre.
    //
    // Erro aqui NÃO é erro da busca: banco anterior à migração 48 nem tem a
    // tabela, e conversa nunca itemizada não tem linha. Os dois casos significam
    // "não há índice para esta conversa", e a resposta certa é varrer. Não é
    // catch silencioso — quem chama devolve resultado correto pelo outro caminho,
    // e o único efeito visível é a busca ser mais lenta.
    let total: Option<i64> = conn
        .query_row(
            "SELECT item_count FROM conversation_item_state WHERE conversation_id = ?1",
            [conv],
            |row| row.get(0),
        )
        .optional()
        .unwrap_or(None);
    let Some(total) = total.filter(|n| *n > 0) else {
        return Ok(None);
    };
    let Some(expressao) = expressao_fts(query_lower) else {
        return Ok(None);
    };
    let mut consulta = match conn.prepare(
        "SELECT position, text FROM conversation_item_fts \
         WHERE conversation_item_fts MATCH ?1 AND conversation_id = ?2 \
         ORDER BY rank LIMIT ?3",
    ) {
        Ok(consulta) => consulta,
        // Banco anterior à migração 52: sem índice, varre.
        Err(_) => return Ok(None),
    };
    // Expressão recusada pelo FTS5 (sintaxe) ou índice ilegível também caem na
    // varredura, pelo mesmo motivo acima.
    let Ok(linhas) = consulta.query_map(
        rusqlite::params![expressao, conv, CANDIDATOS_DO_INDICE as i64],
        |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)),
    ) else {
        return Ok(None);
    };
    let total_f = (total as f64).max(1.0);
    let mut hits: Vec<(f64, Value)> = Vec::new();
    for linha in linhas {
        let Ok((position, text)) = linha else {
            return Ok(None);
        };
        let index = position.max(0) as usize;
        if let Some(score) = pontuar(&text, index, total_f, query_lower, terms) {
            // O `kind` sai do próprio texto indexado? Não: o índice guarda o texto
            // já extraído, então o kind vem de uma leitura barata por posição.
            let kind: String = conn
                .query_row(
                    "SELECT coalesce(json_extract(item_json,'$.kind'),'item') \
                     FROM conversation_items WHERE conversation_id = ?1 AND position = ?2",
                    rusqlite::params![conv, position],
                    |row| row.get(0),
                )
                .unwrap_or_else(|_| "item".to_string());
            hits.push((score, resultado(&text, &kind, index, score)));
        }
    }
    Ok(Some(ordenar_e_cortar(hits, limit)))
}

/// Varredura dos itens da conversa (fonte itemizada, ou o blob de quem ainda
/// não entrou nela). É contra ela que a fidelidade do índice é medida, e é
/// para cá que a busca cai quando o índice não responde pela conversa ou pela
/// expressão.
fn search_varrendo(
    conn: &Connection,
    conv: &str,
    query_lower: &str,
    terms: &[String],
    limit: usize,
) -> Result<Vec<Value>, String> {
    let items = crate::conversation_items::itens_da_conversa(conn, conv)?;
    let total = items.len().max(1) as f64;
    let hits: Vec<(f64, Value)> = items
        .iter()
        .enumerate()
        .filter_map(|(index, item)| {
            let text = searchable_text(item);
            let score = pontuar(&text, index, total, query_lower, terms)?;
            let kind = item.get("kind").and_then(Value::as_str).unwrap_or("item");
            Some((score, resultado(&text, kind, index, score)))
        })
        .collect();
    Ok(ordenar_e_cortar(hits, limit))
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
    let query_lower = query.to_lowercase();
    // Os MESMOS termos nos dois caminhos, já sem stopword: antes o índice
    // filtrava para achar candidatos e pontuava com a lista crua, o que fazia a
    // cobertura ser calculada sobre um termo que não gerou candidato nenhum.
    let terms = termos_uteis(&query_lower);
    // Índice primeiro; varredura quando ele não cobre a conversa. Nunca o
    // contrário, e nunca os dois: o score é o mesmo, então misturar não somaria.
    if let Some(hits) = search_pelo_indice(&conn, conv, &query_lower, &terms, limit)? {
        return Ok(hits);
    }
    search_varrendo(&conn, conv, &query_lower, &terms, limit)
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
    let items = crate::conversation_items::itens_da_conversa(&conn, conv)?;
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
        let root = std::env::temp_dir().join(format!("frota-context-{tag}-{}", std::process::id()));
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
        assert!(dbg.contains("mcp_servers.frota-context.command"));
        assert!(dbg.contains("mcp_servers.frota-context.env.FROTA_CONTEXT_ROOT"));
        assert!(dbg.contains("mcp_servers.frota-context.env.FROTA_CONTEXT_CONV_ID"));
        assert!(dbg.contains("mcp_servers.frota-context.env.FROTA_CONTEXT_DB"));
        assert!(dbg.contains("context-server"));
        assert!(dbg.contains(ROOT_ENV));
        assert!(dbg.contains(DB_ENV));
    }

    /// Monta um banco com as DUAS fontes: o blob legado e a fonte itemizada com
    /// o índice. A SQL do índice é a MESMA das migrações (consts de
    /// `conversation_items`), então este teste quebra se a migração mudar.
    fn banco_com_indice(db: &Path, conv: &str, items: &[Value]) {
        let conn = Connection::open(db).unwrap();
        conn.execute(
            "CREATE TABLE conversations (id TEXT PRIMARY KEY, items TEXT NOT NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE conversation_items (conversation_id TEXT NOT NULL, position INTEGER NOT NULL, \
             item_id TEXT NOT NULL, item_json TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, \
             updated_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (conversation_id, position))",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE conversation_item_state (conversation_id TEXT PRIMARY KEY, \
             revision INTEGER NOT NULL, item_count INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
            [],
        )
        .unwrap();
        for sql in [
            crate::conversation_items::FTS_CRIAR_TABELA,
            crate::conversation_items::FTS_TRIGGER_INSERT,
            crate::conversation_items::FTS_TRIGGER_UPDATE,
            crate::conversation_items::FTS_TRIGGER_DELETE,
        ] {
            conn.execute_batch(sql).unwrap();
        }
        conn.execute(
            "INSERT INTO conversations (id, items) VALUES (?1, ?2)",
            (conv, Value::Array(items.to_vec()).to_string()),
        )
        .unwrap();
        for (position, item) in items.iter().enumerate() {
            conn.execute(
                "INSERT INTO conversation_items (conversation_id, position, item_id, item_json) \
                 VALUES (?1, ?2, ?3, ?4)",
                rusqlite::params![
                    conv,
                    position as i64,
                    item.get("id").and_then(Value::as_str).unwrap_or("sem-id"),
                    item.to_string()
                ],
            )
            .unwrap();
        }
        conn.execute(
            "INSERT INTO conversation_item_state (conversation_id, revision, item_count, updated_at) \
             VALUES (?1, 1, ?2, 0)",
            rusqlite::params![conv, items.len() as i64],
        )
        .unwrap();
    }

    /// Itens de FORMATO REAL, com os kinds que o `searchable_text` trata de
    /// jeitos diferentes — inclusive o `tool`, que é onde a gêmea em SQL tem
    /// mais chance de divergir (ADR-016: fixture inventada esconde bug).
    fn itens_de_exemplo() -> Vec<Value> {
        vec![
            json!({"kind":"user","id":"i0","text":"o scroll do fio parou de descer"}),
            json!({"kind":"text","id":"i1","text":"decidimos usar um gateway orientado por capabilities"}),
            // Input de VÁRIAS chaves de propósito: é o que revela que o
            // `serde_json` ordena as chaves (usa BTreeMap) enquanto o SQLite
            // preserva a ordem do documento. Com uma chave só isso fica
            // invisível, e foi assim que passou despercebido.
            json!({"kind":"tool","id":"i2","name":"run_command",
                   "input":{"CommandLine":"grep -rn gateway app/src","cwd":"/tmp","label":"busca"},
                   "result":{"text":"app/src/lib/mcp.ts:12"}}),
            json!({"kind":"error","id":"i3","message":"a migração falhou no gateway"}),
            json!({"kind":"result","id":"i4","text":"o gateway também limita tokens"}),
            json!({"kind":"notice","id":"i5","message":"rolagem automática restabelecida"}),
        ]
    }

    #[test]
    fn indice_e_varredura_devolvem_exatamente_o_mesmo_ranking() {
        let root = temp_root("fidelidade");
        let db = root.join("db.sqlite");
        let items = itens_de_exemplo();
        banco_com_indice(&db, "conv-1", &items);
        let conn = Connection::open_with_flags(&db, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();

        // Mesma entrada nos dois caminhos: o que muda é só COMO se chega neles.
        for query in [
            "gateway",
            "gateway capabilities",
            "scroll",
            "rolagem automatica",
            "migração",
            "run_command",
        ] {
            let ql = query.to_lowercase();
            let terms = tokens(&ql);
            let pelo_indice = search_pelo_indice(&conn, "conv-1", &ql, &terms, 10)
                .unwrap()
                .unwrap_or_else(|| panic!("o índice devia cobrir esta conversa ({query})"));
            let varrendo = search_varrendo(&conn, "conv-1", &ql, &terms, 10).unwrap();
            assert_eq!(
                pelo_indice, varrendo,
                "índice e varredura divergiram em {query:?}"
            );
        }
        drop(conn);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn conversa_fora_da_fonte_itemizada_cai_na_varredura_sem_erro() {
        let root = temp_root("fallback");
        let db = root.join("db.sqlite");
        banco_com_indice(&db, "conv-1", &itens_de_exemplo());
        let conn = Connection::open(&db).unwrap();
        // Conversa que existe só no blob legado, como as que nunca foram tocadas
        // desde a migração 48.
        conn.execute(
            "INSERT INTO conversations (id, items) VALUES ('conv-velha', ?1)",
            [json!([{"kind":"user","text":"gateway antigo"}]).to_string()],
        )
        .unwrap();
        drop(conn);

        let hits = search_conversation(&db, "conv-velha", "gateway", 5).unwrap();
        assert_eq!(hits.len(), 1, "a varredura devia responder mesmo sem índice");
        assert_eq!(hits[0]["ref"], "conversation:item:0");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn o_trigger_acompanha_mudanca_e_remocao_do_item() {
        let root = temp_root("trigger");
        let db = root.join("db.sqlite");
        banco_com_indice(&db, "conv-1", &itens_de_exemplo());
        let conn = Connection::open(&db).unwrap();

        let indexados = |c: &Connection| -> i64 {
            c.query_row("SELECT count(*) FROM conversation_item_fts", [], |r| r.get(0))
                .unwrap()
        };
        let orfas = |c: &Connection| -> i64 {
            c.query_row(
                "SELECT count(*) FROM conversation_item_fts f WHERE NOT EXISTS \
                 (SELECT 1 FROM conversation_items i WHERE i.rowid = f.rowid)",
                [],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(indexados(&conn), 6);

        // Item muda: o índice acompanha, sem duplicar a linha.
        conn.execute(
            "UPDATE conversation_items SET item_json = ?1 WHERE conversation_id='conv-1' AND position=0",
            [json!({"kind":"user","id":"i0","text":"palavraunicaparateste"}).to_string()],
        )
        .unwrap();
        assert_eq!(indexados(&conn), 6, "update não pode duplicar a linha");
        let achou: i64 = conn
            .query_row(
                "SELECT count(*) FROM conversation_item_fts \
                 WHERE conversation_item_fts MATCH 'palavraunicaparateste'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(achou, 1, "o texto novo tinha que estar buscável");

        // Item some: o índice some junto, senão a busca vira teatro.
        conn.execute(
            "DELETE FROM conversation_items WHERE conversation_id='conv-1' AND position >= 4",
            [],
        )
        .unwrap();
        assert_eq!(indexados(&conn), 4);
        assert_eq!(orfas(&conn), 0, "índice não pode apontar para item que não existe");
        drop(conn);
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_expressao_do_fts_corta_stopword_e_busca_substring() {
        // Sem prefixo `*`: no `trigram`, `"termo"` já é substring, que é a mesma
        // semântica do `contains` da varredura.
        assert_eq!(
            expressao_fts("erro de build"),
            Some("\"erro\" OR \"build\"".into())
        );
        assert_eq!(expressao_fts("api do fio"), Some("\"api\" OR \"fio\"".into()));
        // Termo curto convive com termo longo sem estragar nada: `termos_uteis`
        // já o descarta, e a VARREDURA usa a mesma lista, então os dois caminhos
        // continuam perguntando a mesma coisa.
        assert_eq!(expressao_fts("ab watchdog"), Some("\"watchdog\"".into()));
        // Mas quando NÃO sobra termo longo, a lista crua volta e pode ter termo
        // com menos de 3 caracteres: aí o trigram devolveria zero em SILÊNCIO, e
        // a pergunta inteira vai para a varredura.
        assert_eq!(expressao_fts("de do da"), None);
        assert_eq!(expressao_fts("ab"), None);
        // Sem termo utilizável não há o que perguntar ao índice.
        assert_eq!(expressao_fts("!!!"), None);
    }

    #[test]
    fn a_extracao_em_sql_e_gemea_do_searchable_text() {
        // O índice se mantém por trigger, então o texto indexado é produzido em
        // SQL. Se ele divergir do `searchable_text`, o ranking passa a pontuar um
        // texto e a mostrar outro. Este teste é a corda que prende as duas pontas.
        let root = temp_root("gemea");
        let db = root.join("db.sqlite");
        let items = itens_de_exemplo();
        banco_com_indice(&db, "conv-1", &items);
        let conn = Connection::open(&db).unwrap();
        let mut consulta = conn
            .prepare(
                "SELECT f.position, f.text FROM conversation_item_fts f \
                 WHERE f.conversation_id = 'conv-1' ORDER BY f.position",
            )
            .unwrap();
        let linhas: Vec<(i64, String)> = consulta
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(linhas.len(), items.len());
        for (position, do_sql) in linhas {
            let do_rust = searchable_text(&items[position as usize]);
            if do_sql == do_rust {
                continue;
            }
            // Diferença CONHECIDA e aceita: dentro do `input` de uma ferramenta,
            // o `serde_json` serializa as chaves em ordem alfabética (o `Map`
            // dele é um BTreeMap) e o SQLite devolve a ordem do documento. O
            // conteúdo é o mesmo objeto, e o que a busca consome — os termos —
            // é idêntico. O que NÃO pode acontecer é perder ou ganhar termo.
            let termos = |t: &str| {
                let mut v = tokens(&t.to_lowercase());
                v.sort();
                v
            };
            assert_eq!(
                termos(&do_sql),
                termos(&do_rust),
                "a gêmea em SQL mudou os TERMOS na posição {position}, não só a ordem das chaves"
            );
            assert_eq!(
                do_sql.chars().filter(|c| !c.is_whitespace()).count(),
                do_rust.chars().filter(|c| !c.is_whitespace()).count(),
                "tamanho diferente na posição {position}: não é só reordenação de chave"
            );
        }
        drop(consulta);
        drop(conn);
        let _ = std::fs::remove_dir_all(root);
    }

    /// CORPUS DE FIDELIDADE (F2 do PRD da busca no fio).
    ///
    /// Compara, conversa a conversa, o que o ÍNDICE devolve com o que a
    /// VARREDURA devolve, no banco real da pessoa. Não roda no `cargo test`
    /// normal porque depende de um banco que só existe na máquina; é a
    /// ferramenta de revalidar a frente depois de mexer no índice, na gêmea SQL
    /// ou no `pontuar`.
    ///
    /// ```sh
    /// cp "$HOME/Library/Application Support/dev.vinicius.frota/mycockpit.db" /tmp/fid.db
    /// BENCH_DB=/tmp/fid.db cargo test --release fidelidade -- --ignored --nocapture
    /// ```
    ///
    /// Sempre numa CÓPIA: o teste só lê, mas banco vivo de app aberto não é
    /// lugar de experimento.
    #[test]
    #[ignore = "precisa de BENCH_DB apontando para uma cópia do banco real"]
    fn fidelidade_do_indice_contra_a_varredura() {
        let Ok(caminho) = std::env::var("BENCH_DB") else {
            panic!("defina BENCH_DB com o caminho de uma CÓPIA do banco")
        };
        let db = PathBuf::from(caminho);
        let conn = Connection::open_with_flags(&db, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();

        // Termos de vocabulário real do produto, misturando o que casa muito
        // (tool, Bash) com o que casa pouco, acento, maiúscula e frase.
        let queries = [
            "scroll", "rolagem automatica", "composer anexo", "migration sqlite",
            "erro de build", "companion pareamento", "watchdog interval",
            "drag and drop sidebar", "custo do turno", "styleguide elevacao",
            "tauri command async", "teste que quebrou", "migração", "MIGRAÇÃO",
            "índice léxico", "worktree", "revezamento de motor", "ADR",
            "fts5", "conversation_items", "bash", "arquivo não encontrado",
            "o que", "de", "plano aprovado", "gate", "cargo test", "bun run check",
        ];

        let mut consulta = conn
            .prepare("SELECT conversation_id FROM conversation_item_state WHERE item_count > 0")
            .unwrap();
        let convs: Vec<String> = consulta
            .query_map([], |r| r.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert!(!convs.is_empty(), "o banco não tem conversa itemizada");

        // O blob legado (`conversations.items`) pode estar ATRÁS da fonte
        // itemizada: só o `persist` reescreve os dois, enquanto a cauda
        // incremental grava apenas a tabela. Comparar índice contra varredura
        // nessas conversas mede o blob velho, não a fidelidade do índice — por
        // isso elas saem da conta e entram num relatório próprio.
        let defasada = |conv: &str| -> Option<(i64, i64)> {
            let no_blob: i64 = conn
                .query_row(
                    "SELECT json_array_length(items) FROM conversations WHERE id = ?1",
                    [conv],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            let na_tabela: i64 = conn
                .query_row(
                    "SELECT count(*) FROM conversation_items WHERE conversation_id = ?1",
                    [conv],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            (no_blob != na_tabela).then_some((no_blob, na_tabela))
        };

        let (mut pares, mut iguais, mut so_score) = (0usize, 0usize, 0usize);
        let (mut t_indice, mut t_varredura) = (0f64, 0f64);
        let mut pior_indice = 0f64;
        let mut divergencias: Vec<String> = Vec::new();
        let mut defasadas: Vec<String> = Vec::new();
        for conv in &convs {
            if let Some((no_blob, na_tabela)) = defasada(conv) {
                defasadas.push(format!(
                    "{} · blob {} itens, tabela {} itens (blob {} atrás)",
                    &conv[..8.min(conv.len())],
                    no_blob,
                    na_tabela,
                    na_tabela - no_blob,
                ));
                continue;
            }
            for q in queries {
                let ql = q.to_lowercase();
                // `termos_uteis`, NÃO `tokens`: é o que `search_conversation`
                // entrega aos dois caminhos. Usar a lista crua aqui media um
                // cenário que não existe em produção — a varredura casava pelo
                // `do` enquanto o índice já o havia descartado, e a diferença
                // aparecia como se fosse do índice.
                let termos = termos_uteis(&ql);
                let marca = std::time::Instant::now();
                let indexado = search_pelo_indice(&conn, conv, &ql, &termos, 10).unwrap();
                let gasto = marca.elapsed().as_secs_f64() * 1000.0;
                let Some(pelo_indice) = indexado else {
                    continue; // conversa fora do índice: a varredura é a resposta
                };
                t_indice += gasto;
                pior_indice = pior_indice.max(gasto);
                let marca = std::time::Instant::now();
                let varrendo = search_varrendo(&conn, conv, &ql, &termos, 10).unwrap();
                t_varredura += marca.elapsed().as_secs_f64() * 1000.0;
                pares += 1;
                let refs = |v: &Vec<Value>| {
                    v.iter()
                        .map(|x| x["ref"].as_str().unwrap_or("?").to_string())
                        .collect::<Vec<_>>()
                };
                // O que importa é a ORDEM que o agente recebe. O `score` pode
                // diferir no decimal porque a recência divide por totais de
                // fontes diferentes (o índice usa `item_count` da tabela, a
                // varredura o tamanho do blob), e isso não muda o ranking.
                if refs(&pelo_indice) == refs(&varrendo) {
                    iguais += 1;
                    if pelo_indice != varrendo {
                        so_score += 1;
                    }
                    continue;
                }
                divergencias.push(format!(
                    "conv {} · query {:?}\n     índice: {:?}\n  varredura: {:?}",
                    &conv[..8.min(conv.len())],
                    q,
                    refs(&pelo_indice),
                    refs(&varrendo),
                ));
            }
        }

        println!("\n=== fidelidade do índice ===");
        println!(
            "{} conversas itemizadas · {} comparáveis · {} queries · {} pares",
            convs.len(),
            convs.len() - defasadas.len(),
            queries.len(),
            pares
        );
        println!(
            "mesmo ranking: {iguais}/{pares} ({:.1}%)",
            iguais as f64 / pares.max(1) as f64 * 100.0
        );
        if so_score > 0 {
            println!(
                "  destes, {so_score} com score diferente no decimal (recência sobre totais \
                 de fontes diferentes) — mesma ordem, mesmos itens"
            );
        }
        println!(
            "tempo: índice {t_indice:.0}ms · varredura {t_varredura:.0}ms · {:.1}x · \
             pior query do índice {pior_indice:.1}ms",
            t_varredura / t_indice.max(0.001)
        );
        println!("\n--- por query, só na maior conversa ---");
        let maior = conn
            .query_row(
                "SELECT conversation_id FROM conversation_item_state ORDER BY item_count DESC LIMIT 1",
                [],
                |r| r.get::<_, String>(0),
            )
            .unwrap();
        for q in queries {
            let ql = q.to_lowercase();
            let termos = termos_uteis(&ql);
            let (mut ti, mut tv) = (f64::MAX, f64::MAX);
            for _ in 0..5 {
                let m = std::time::Instant::now();
                let _ = search_pelo_indice(&conn, &maior, &ql, &termos, 10).unwrap();
                ti = ti.min(m.elapsed().as_secs_f64() * 1000.0);
                let m = std::time::Instant::now();
                let _ = search_varrendo(&conn, &maior, &ql, &termos, 10).unwrap();
                tv = tv.min(m.elapsed().as_secs_f64() * 1000.0);
            }
            println!("  {q:<24} índice {ti:>7.2}ms · varredura {tv:>7.2}ms · {:>5.1}x", tv / ti.max(0.001));
        }
        if !defasadas.is_empty() {
            println!(
                "\n--- fora da conta: blob legado atrasado ({}) ---",
                defasadas.len()
            );
            for d in &defasadas {
                println!("  {d}");
            }
            println!(
                "  (não é erro do índice: o índice lê a tabela, que está à frente.\n                    A varredura leria a fonte velha, então comparar ali mede o blob.)"
            );
        }
        if !divergencias.is_empty() {
            println!("\n--- divergências ({}) ---", divergencias.len());
            for d in &divergencias {
                println!("  {d}");
            }
        }
        println!();
    }

    #[test]
    fn stopword_sozinha_nao_faz_um_item_casar() {
        // Medido no banco real: "revezamento de motor" devolvia os dez itens
        // mais recentes porque casava só o `de` e desempatava por recência —
        // nenhum falava do assunto. Ruído ordenado por recência vestido de
        // resultado é o oposto de "estado real, nunca teatro".
        let root = temp_root("stopword");
        let db = root.join("db.sqlite");
        let items = vec![
            json!({"kind":"user","id":"i0","text":"onde fica o gate de aprovação"}),
            json!({"kind":"text","id":"i1","text":"depois de tudo, o resto de sempre"}),
            json!({"kind":"text","id":"i2","text":"o revezamento troca o motor da conversa"}),
        ];
        banco_com_indice(&db, "conv-1", &items);

        // Só o item que fala do assunto entra; os que têm apenas `de` ficam fora.
        let hits = search_conversation(&db, "conv-1", "revezamento de motor", 10).unwrap();
        assert_eq!(hits.len(), 1, "stopword não pode arrastar item irrelevante");
        assert_eq!(hits[0]["ref"], "conversation:item:2");

        // Procurar literalmente uma stopword continua valendo: é pedido legítimo,
        // e aí ela é o único termo que existe.
        let so_stopword = search_conversation(&db, "conv-1", "de", 10).unwrap();
        assert!(
            so_stopword.len() >= 2,
            "query só de stopword ainda responde, veio {}",
            so_stopword.len()
        );
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn os_dois_caminhos_usam_os_mesmos_termos() {
        // O defeito que isto tranca: filtrar stopword só para gerar candidatos e
        // pontuar com a lista crua fazia a COBERTURA ser dividida por um termo
        // que não gerou candidato nenhum, baixando o score de quem casou tudo.
        let root = temp_root("mesmos-termos");
        let db = root.join("db.sqlite");
        let items = itens_de_exemplo();
        banco_com_indice(&db, "conv-1", &items);
        let conn = Connection::open_with_flags(&db, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        for query in ["o gateway de capabilities", "erro de build", "a rolagem"] {
            let ql = query.to_lowercase();
            let terms = termos_uteis(&ql);
            let pelo_indice = search_pelo_indice(&conn, "conv-1", &ql, &terms, 10)
                .unwrap()
                .unwrap();
            let varrendo = search_varrendo(&conn, "conv-1", &ql, &terms, 10).unwrap();
            assert_eq!(pelo_indice, varrendo, "divergiram em {query:?}");
        }
        drop(conn);
        let _ = std::fs::remove_dir_all(root);
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
