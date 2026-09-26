//! As ferramentas do OpenCode no contrato comum, para o fio dizer "Ler",
//! "Executar", "Editar" em vez do "está trabalhando…" genérico.
//!
//! Pedido de 26/09/2026: num turno de 7 minutos o fio só mostrou "está
//! trabalhando". O `opencode run` entregava cada ferramenta no `tool_use`, e o
//! adapter só olhava a linha para achar recusa. Mesma saída do agy (ADR-253):
//! cada adaptador traduz o vocabulário do seu motor, e a tela nunca compara
//! nome de motor. Só entram aqui as ferramentas com equivalente EXATO no
//! contrato; o resto (`todowrite`, `skill`, MCP) segue com o nome do opencode.
//!
//! Nomes e parâmetros colhidos das 981 chamadas reais no banco do opencode
//! desta máquina (1.18.32): `read {filePath, offset, limit}`, `bash {command,
//! description, workdir, timeout}`, `edit {filePath, oldString, newString,
//! replaceAll}`, `write {filePath, content}`, `grep {pattern, path, include}`,
//! `glob {pattern, path}`, `webfetch {url, format}`, `websearch {query,
//! numResults}`, `task {description, prompt, subagent_type}`.

use crate::agent::AgentEvent;
use serde_json::{Map, Value};

/// O nome e a entrada no contrato. Puro.
pub fn no_contrato(nome: &str, p: &Value) -> (String, Value) {
    // (chave do opencode, chave do contrato)
    let pares: &[(&str, &str)] = match nome {
        "read" => &[
            ("filePath", "file_path"),
            ("offset", "offset"),
            ("limit", "limit"),
        ],
        "bash" => &[("command", "command"), ("description", "description")],
        "edit" => &[
            ("filePath", "file_path"),
            ("oldString", "old_string"),
            ("newString", "new_string"),
            ("replaceAll", "replace_all"),
        ],
        "write" => &[("filePath", "file_path"), ("content", "content")],
        "grep" => &[
            ("pattern", "pattern"),
            ("path", "path"),
            ("include", "glob"),
        ],
        "glob" => &[("pattern", "pattern"), ("path", "path")],
        "webfetch" => &[("url", "url")],
        "websearch" => &[("query", "query")],
        "task" => &[
            ("description", "description"),
            ("prompt", "prompt"),
            ("subagent_type", "subagent_type"),
        ],
        _ => return (nome.to_string(), p.clone()),
    };
    let contrato = match nome {
        "read" => "Read",
        "bash" => "Bash",
        "edit" => "Edit",
        "write" => "Write",
        "grep" => "Grep",
        "glob" => "Glob",
        "webfetch" => "WebFetch",
        "websearch" => "WebSearch",
        _ => "Task",
    };
    let mut e = Map::new();
    for (de, para) in pares {
        if let Some(v) = p.get(*de).filter(|v| !v.is_null()) {
            e.insert((*para).to_string(), v.clone());
        }
    }
    (contrato.to_string(), Value::Object(e))
}

/// Quantas linhas o resultado tem. O `read` do opencode embrulha o arquivo
/// (`<path>…</path><type>file</type><content>1: …(End of file - total N
/// lines)</content>`, visto no stream real): contar as linhas do embrulho
/// errava por cinco. Quando o total vem escrito, vale ele; só com o marcador
/// inteiro, porque um `ls -la` também escreve "total 16".
fn linhas(saida: &str) -> u64 {
    let total = saida
        .rsplit_once("(End of file - total ")
        .and_then(|(_, r)| r.split_once(" line"))
        .and_then(|(n, _)| n.trim().parse::<u64>().ok());
    total.unwrap_or_else(|| {
        let t = saida.trim();
        if t.is_empty() {
            0
        } else {
            t.lines().count() as u64
        }
    })
}

/// O desfecho de uma ferramenta, com o mesmo teto de 600 caracteres dos
/// outros adaptadores.
pub fn resultado(id: &str, ok: bool, saida: &str) -> AgentEvent {
    let mut text: String = saida.chars().take(600).collect();
    if saida.chars().count() > 600 {
        text.push('…');
    }
    AgentEvent::ToolResult {
        id: id.to_string(),
        ok,
        lines: linhas(saida),
        text,
        images: Vec::new(),
    }
}

/// Um `tool_use` do `opencode run`. Ele só chega quando a ferramenta já
/// terminou (medido: nenhum `running` no stream), então sai o par inteiro:
/// a chamada e o desfecho.
pub fn do_tool_use(part: &Value) -> Vec<AgentEvent> {
    let Some(id) = part.get("callID").and_then(Value::as_str) else {
        return Vec::new();
    };
    let nome = part.get("tool").and_then(Value::as_str).unwrap_or("tool");
    let st = part.get("state");
    let entrada = st
        .and_then(|s| s.get("input"))
        .cloned()
        .unwrap_or(Value::Null);
    let (name, input) = no_contrato(nome, &entrada);
    let mut out = vec![AgentEvent::Tool {
        id: id.to_string(),
        name,
        input,
        parent_tool_id: None,
    }];
    let status = st.and_then(|s| s.get("status")).and_then(Value::as_str);
    let texto = |k: &str| st.and_then(|s| s.get(k)).and_then(Value::as_str);
    match status {
        Some("completed") => out.push(resultado(id, true, texto("output").unwrap_or(""))),
        Some("error") => out.push(resultado(id, false, texto("error").unwrap_or(""))),
        _ => {}
    }
    out
}

/// O nome do opencode a partir do `kind` do ACP, quando o `title` do
/// `tool_call` não é um nome conhecido. Categoria do protocolo, então só
/// entra onde a correspondência é uma só.
pub fn nome_do_kind(kind: &str) -> Option<&'static str> {
    match kind {
        "read" => Some("read"),
        "execute" => Some("bash"),
        "fetch" => Some("webfetch"),
        _ => None,
    }
}

/// Os nomes que `no_contrato` traduz.
pub fn conhecida(nome: &str) -> bool {
    matches!(
        nome,
        "read" | "bash" | "edit" | "write" | "grep" | "glob" | "webfetch" | "websearch" | "task"
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// As duas linhas REAIS do `opencode run --format json` (1.18.32,
    /// 26/09/2026, `opencode/big-pickle`), com o `metadata` podado.
    const READ: &str = r#"{"type":"tool","tool":"read","callID":"call_function_hs5u8edlotbw_1","state":{"status":"completed","input":{"filePath":"/private/tmp/oc-probe/a.txt"},"output":"<path>/private/tmp/oc-probe/a.txt</path>\n<type>file</type>\n<content>\n1: hello\n\n(End of file - total 1 lines)\n</content>","title":"private/tmp/oc-probe/a.txt","time":{"start":1790433909861,"end":1790433909884}},"id":"prt_0de2d5c5d001JiPpfNIlt0DuMg","sessionID":"ses_f21d2b112ffevePRwc9q0v7nD1","messageID":"msg_0de2d501b001pKLanNZ6NQkGoK"}"#;
    const BASH: &str = r#"{"type":"tool","tool":"bash","callID":"call_function_hs5u8edlotbw_2","state":{"status":"completed","input":{"command":"ls"},"output":"a.txt\nchild.json\nerr.txt\nprobe_child.json\ns2.ndjson\nstream.ndjson\n","title":"ls","time":{"start":1790433909867,"end":1790433909921}},"id":"prt_0de2d5c67001p4KrCgye5WpLuK","sessionID":"ses_f21d2b112ffevePRwc9q0v7nD1","messageID":"msg_0de2d501b001pKLanNZ6NQkGoK"}"#;

    fn v(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    #[test]
    fn leitura_vira_read_com_o_total_de_linhas_do_arquivo() {
        let ev = do_tool_use(&v(READ));
        let AgentEvent::Tool { name, input, .. } = &ev[0] else {
            panic!("esperava Tool")
        };
        assert_eq!(name, "Read");
        assert_eq!(
            input,
            &json!({ "file_path": "/private/tmp/oc-probe/a.txt" })
        );
        let AgentEvent::ToolResult { ok, lines, .. } = &ev[1] else {
            panic!("esperava ToolResult")
        };
        assert!(*ok);
        // O embrulho tem 7 linhas; o arquivo, 1.
        assert_eq!(*lines, 1);
    }

    #[test]
    fn comando_vira_bash_e_conta_as_linhas_da_saida() {
        let ev = do_tool_use(&v(BASH));
        let AgentEvent::Tool { name, input, .. } = &ev[0] else {
            panic!("esperava Tool")
        };
        assert_eq!(name, "Bash");
        assert_eq!(input, &json!({ "command": "ls" }));
        let AgentEvent::ToolResult { lines, .. } = &ev[1] else {
            panic!("esperava ToolResult")
        };
        assert_eq!(*lines, 6);
    }

    #[test]
    fn saida_de_ls_com_total_nao_e_confundida_com_o_read() {
        let AgentEvent::ToolResult { lines, .. } = resultado("x", true, "total 16\na\nb") else {
            panic!("esperava ToolResult")
        };
        assert_eq!(lines, 3);
    }

    #[test]
    fn parametros_reais_de_cada_ferramenta_viram_os_do_contrato() {
        let (n, e) = no_contrato(
            "edit",
            &json!({"filePath":"/a.ts","oldString":"x","newString":"y","replaceAll":false}),
        );
        assert_eq!(n, "Edit");
        assert_eq!(
            e,
            json!({"file_path":"/a.ts","old_string":"x","new_string":"y","replace_all":false})
        );
        let (n, e) = no_contrato(
            "grep",
            &json!({"pattern":"foo","path":"/src","include":"*.ts"}),
        );
        assert_eq!(
            (n.as_str(), e),
            ("Grep", json!({"pattern":"foo","path":"/src","glob":"*.ts"}))
        );
        let (n, _) = no_contrato(
            "task",
            &json!({"description":"d","prompt":"p","subagent_type":"explore"}),
        );
        assert_eq!(n, "Task");
    }

    #[test]
    fn ferramenta_sem_equivalente_segue_com_o_nome_do_opencode() {
        let todos = json!({"todos":[{"content":"x","status":"pending","priority":"high"}]});
        assert_eq!(
            no_contrato("todowrite", &todos),
            ("todowrite".to_string(), todos)
        );
    }
}
