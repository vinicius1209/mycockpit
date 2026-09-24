//! As ferramentas do agy no contrato comum (ADR-253).
//!
//! Pedido de 24/09/2026: "demorou 3min até ele mostrar alguma coisa além de
//! executar ferramentas". O agy entregava cada passo ao vivo, e a Frota
//! carimbava cada um na hora; mas o nome e os parâmetros eram os DELE
//! (`run_command {CommandLine}`, `view_file {AbsolutePath}`…), e o fio, que
//! fala o contrato (`Bash {command}`, `Read {file_path}`…), desenhava tudo como
//! "Usar run_command". Num turno real: 32 ferramentas, 3min25s, e o grupo só
//! sabia dizer "Usou 32 ferramentas".
//!
//! Mesma saída do Codex (`command_execution` vira `Bash`): cada adaptador traduz
//! o vocabulário do seu motor, e a tela nunca compara nome de motor. Só entram
//! aqui as ferramentas com equivalente EXATO no contrato; o resto segue com o
//! nome do agy, e a tela o mostra como ferramenta genérica, sem inventar verbo.
//! Formatos colhidos das conversas reais do agy 1.2.x na Frota (fixtures nos
//! testes abaixo).

use serde_json::{json, Map, Value};

fn texto<'a>(p: &'a Value, chave: &str) -> Option<&'a str> {
    p.get(chave).and_then(|x| x.as_str()).filter(|s| !s.is_empty())
}

/// Os `Arguments` do `call_mcp_tool` chegam como TEXTO, às vezes JSON, às
/// vezes dicionário do Python (`{'url': 'https://…'}`, visto nas conversas
/// reais). Tenta os dois; o que não se deixa ler vai cru, sem perder nada.
fn argumentos_do_mcp(bruto: &Value) -> Value {
    let Some(s) = bruto.as_str() else {
        return bruto.clone();
    };
    if let Ok(v) = serde_json::from_str::<Value>(s) {
        return v;
    }
    let pythonico = s
        .replace('\'', "\"")
        .replace(": True", ": true")
        .replace(": False", ": false")
        .replace(": None", ": null");
    serde_json::from_str::<Value>(&pythonico).unwrap_or_else(|_| json!({ "arguments": s }))
}

/// O nome e a entrada no contrato. Puro.
pub(crate) fn no_contrato(nome: &str, p: Value) -> (String, Value) {
    let caminho = |chave: &str| texto(&p, chave).map(str::to_string);
    let traduzido = match nome {
        "run_command" => texto(&p, "CommandLine").map(|c| ("Bash", json!({ "command": c }))),
        "view_file" => caminho("AbsolutePath").map(|f| ("Read", json!({ "file_path": f }))),
        "replace_file_content" | "multi_replace_file_content" => {
            caminho("TargetFile").map(|f| ("Edit", json!({ "file_path": f })))
        }
        "write_to_file" => caminho("TargetFile").map(|f| ("Write", json!({ "file_path": f }))),
        "grep_search" => texto(&p, "Query").map(|q| {
            let mut e = Map::new();
            e.insert("pattern".into(), json!(q));
            if let Some(dir) = texto(&p, "SearchPath") {
                e.insert("path".into(), json!(dir));
            }
            ("Grep", Value::Object(e))
        }),
        "find_by_name" => texto(&p, "Pattern").map(|pad| {
            let mut e = Map::new();
            e.insert("pattern".into(), json!(pad));
            if let Some(dir) = texto(&p, "SearchDirectory") {
                e.insert("path".into(), json!(dir));
            }
            ("Glob", Value::Object(e))
        }),
        "search_web" => texto(&p, "query").map(|q| ("WebSearch", json!({ "query": q }))),
        // Sem uso nas conversas reais; o nome do parâmetro vem do schema no
        // binário do agy 1.2.10 (`json:"Url"`, "URL to read content from").
        "read_url_content" => texto(&p, "Url").map(|u| ("WebFetch", json!({ "url": u }))),
        "call_mcp_tool" => match (texto(&p, "ServerName"), texto(&p, "ToolName")) {
            (Some(servidor), Some(tool)) => {
                let entrada = p.get("Arguments").map(argumentos_do_mcp).unwrap_or(Value::Null);
                return (format!("mcp__{servidor}__{tool}"), entrada);
            }
            _ => None,
        },
        _ => None,
    };
    match traduzido {
        Some((canonico, entrada)) => (canonico.to_string(), entrada),
        // Sem equivalente, ou sem o parâmetro que o identifica: fica como veio.
        None => (nome.to_string(), p),
    }
}

/// Parse da mensagem emitida pelo Antigravity / Agy ao despachar comando em background
/// (payloads reais em bg-sleep e 22/09/2026:
/// `Tool is running as a background task with task id: <task_id>\n...Task logs are available at: <log_path>`).
pub(crate) fn parse_agy_background_task(text: &str) -> Option<(String, String)> {
    let prefix = "Tool is running as a background task with task id: ";
    let p_idx = text.find(prefix)?;
    let after_prefix = &text[p_idx + prefix.len()..];
    let end_id_idx = after_prefix.find('\n').unwrap_or(after_prefix.len());
    let task_id = after_prefix[..end_id_idx].trim();
    if task_id.is_empty() {
        return None;
    }
    let log_marker = "Task logs are available at: ";
    let log_idx = text.find(log_marker)?;
    let after_log = &text[log_idx + log_marker.len()..];
    let end_log_idx = after_log.find('\n').unwrap_or(after_log.len());
    let mut log_path = after_log[..end_log_idx].trim();
    if let Some(stripped) = log_path.strip_prefix("file://") {
        log_path = stripped;
    }
    if log_path.is_empty() || !log_path.starts_with('/') {
        return None;
    }
    Some((task_id.to_string(), log_path.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Parâmetros REAIS, das conversas do agy 1.2.x rodadas pela Frota.
    fn real(bruto: &str) -> Value {
        serde_json::from_str(bruto).unwrap()
    }

    #[test]
    fn comando_leitura_edicao_e_escrita_viram_o_contrato() {
        assert_eq!(
            no_contrato("run_command", real(r#"{"CommandLine":"git grep -i \"olist\" || true"}"#)),
            ("Bash".into(), json!({ "command": "git grep -i \"olist\" || true" }))
        );
        assert_eq!(
            no_contrato(
                "view_file",
                real(r#"{"AbsolutePath":"/Users/viniciusmachado/projetos/meuingresso3.0/MIGRACAO_STATUS.md"}"#)
            ),
            ("Read".into(), json!({ "file_path": "/Users/viniciusmachado/projetos/meuingresso3.0/MIGRACAO_STATUS.md" }))
        );
        assert_eq!(
            no_contrato(
                "replace_file_content",
                real(r#"{"TargetFile":"/Users/viniciusmachado/projetos/pessoais/the-morning-byte/data/sample-edition.ts"}"#)
            )
            .0,
            "Edit"
        );
        assert_eq!(
            no_contrato("write_to_file", real(r#"{"TargetFile":"/tmp/agy-sonda-UQSI/d.txt"}"#)),
            ("Write".into(), json!({ "file_path": "/tmp/agy-sonda-UQSI/d.txt" }))
        );
    }

    #[test]
    fn busca_e_web_viram_o_contrato() {
        assert_eq!(
            no_contrato(
                "grep_search",
                real(r#"{"Query":"API_URL","SearchPath":"/Users/viniciusmachado/projetos/meu-ingresso/app"}"#)
            ),
            ("Grep".into(), json!({ "pattern": "API_URL", "path": "/Users/viniciusmachado/projetos/meu-ingresso/app" }))
        );
        assert_eq!(
            no_contrato(
                "find_by_name",
                real(r#"{"Pattern":"*","SearchDirectory":"/Users/viniciusmachado/projetos/meu-ingresso/app/src"}"#)
            ),
            ("Glob".into(), json!({ "pattern": "*", "path": "/Users/viniciusmachado/projetos/meu-ingresso/app/src" }))
        );
        assert_eq!(
            no_contrato("search_web", real(r#"{"query":"evertjr Maestri Chat"}"#)),
            ("WebSearch".into(), json!({ "query": "evertjr Maestri Chat" }))
        );
    }

    #[test]
    fn mcp_vira_o_nome_do_contrato_e_os_argumentos_do_python_se_leem() {
        let (nome, entrada) = no_contrato(
            "call_mcp_tool",
            real(r#"{"Arguments":"{'url': 'https://x.com/evertjr/status/2100314752517853193'}","ServerName":"playwright","ToolName":"browser_navigate"}"#),
        );
        assert_eq!(nome, "mcp__playwright__browser_navigate");
        assert_eq!(entrada, json!({ "url": "https://x.com/evertjr/status/2100314752517853193" }));
        let (_, cru) = no_contrato(
            "call_mcp_tool",
            json!({ "Arguments": "não é dicionário", "ServerName": "s", "ToolName": "t" }),
        );
        assert_eq!(cru, json!({ "arguments": "não é dicionário" }), "o que não se lê vai cru, sem perder");
    }

    #[test]
    fn sem_equivalente_ou_sem_parametro_fica_como_veio() {
        let p = real(r#"{"Action":"kill","TaskId":"8d885eb4-aa61-4c85-b319-8c3caa098d40/task-42"}"#);
        assert_eq!(no_contrato("manage_task", p.clone()), ("manage_task".into(), p));
        let dir = real(r#"{"DirectoryPath":"/Users/viniciusmachado/projetos/meuingresso3.0"}"#);
        assert_eq!(no_contrato("list_dir", dir.clone()).0, "list_dir");
        assert_eq!(no_contrato("run_command", json!({})), ("run_command".into(), json!({})));
    }
}
