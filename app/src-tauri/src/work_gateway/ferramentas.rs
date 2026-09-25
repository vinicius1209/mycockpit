//! O que o agente enxerga do `frota-work`: a lista de tools (com o esquema de
//! cada uma) e a instrução que a apresenta no prompt. Saiu do `work_gateway.rs`
//! (no teto da catraca) quando entrou a tool de título (ADR-246): as duas
//! coisas mudam juntas, e o listener em si não precisa saber do texto.

use serde_json::{json, Value};

use super::{
    MCP_SERVER_NAME, PROCESS_POLL_TOOL, PROCESS_START_TOOL, PROCESS_STOP_TOOL, WORK_PLAN_TOOL,
    WORK_UPDATE_TOOL,
};

/// O agente nomeia a conversa no primeiro turno (ADR-246). Sem helper
/// configurado a conversa ficava com a primeira frase crua para sempre, e o
/// agente já leu o pedido: ele é quem sabe dizer o assunto.
pub const CONVERSATION_TITLE_TOOL: &str = "conversation_title";

/// Aqui só se recusa o que não é título (vazio, várias linhas, parágrafo). O
/// corte na régua da lista (44) e a limpeza fina são do front (`parseTitulo`),
/// que já é o único dono delas.
const TITULO_MAX: usize = 80;

/// O título que veio do agente, ou o motivo de recusar.
pub fn titulo(args: &Value) -> Result<String, String> {
    let t = args
        .get("title")
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("");
    if t.is_empty() {
        return Err("title ausente".into());
    }
    if t.chars().count() > TITULO_MAX || t.contains('\n') {
        return Err("title longo demais: use de 3 a 6 palavras".into());
    }
    Ok(t.to_string())
}

/// A seção do prompt que apresenta o `frota-work`. Genérica de motor: quem a
/// monta é o `agent.rs`, para todo adapter com o gateway de trabalho. O pedido
/// de título vai só no primeiro turno, que é o único em que ele serve.
pub fn instrucao(first_turn: bool) -> String {
    let mut s = format!(
        "TELEMETRIA DE TRABALHO: em tarefas com várias etapas, use o MCP `{MCP_SERVER_NAME}` para publicar e atualizar o plano. Para processos longos (dev servers, watchers, containers), use `{PROCESS_START_TOOL}` quando disponível neste modo de permissão. Publique o plano por `{WORK_PLAN_TOOL}` e mantenha cada etapa atualizada ao iniciar/concluir por `{WORK_UPDATE_TOOL}`. Se usar a checklist nativa do provider, atualize os estados equivalentes também. Isso dá ao usuário visibilidade e controles honestos na Frota."
    );
    if first_turn {
        s.push(' ');
        s.push_str(&pedido_de_titulo(CONVERSATION_TITLE_TOOL));
    }
    s
}

/// O pedido de título, com o nome da tool como o motor a enxerga. Um texto
/// só para os dois caminhos: o Claude recebe as instruções pelo canal de
/// sistema (nomes qualificados, `instrucao_qualificada`), e esse caminho ficou
/// sem o pedido na ADR-246. Nenhuma conversa do Claude chegou a ser nomeada
/// (24/09/2026).
pub fn pedido_de_titulo(tool: &str) -> String {
    format!(
        "Esta é a primeira mensagem da conversa: chame `{tool}` UMA vez, logo no início, com um título de 3 a 6 palavras em pt-BR que nomeie o assunto (\"Timer do watchdog\", nunca \"Conversa sobre bug\"), sem aspas nem ponto final."
    )
}

/// A mesma apresentação para o motor que recebe instruções pelo canal de
/// sistema e vê as tools com o nome qualificado (`mcp__frota-work__…`).
pub fn instrucao_qualificada(first_turn: bool) -> String {
    let q = |tool: &str| format!("mcp__{MCP_SERVER_NAME}__{tool}");
    let mut s = format!(
        "Use {} para dev servers, watchers, containers e outros processos longos quando disponível neste modo de permissão; isso mantém PID, saída e controle na Frota. Publique planos vivos com {} quando a tarefa tiver várias etapas e marque cada início/conclusão com {}. Se usar a checklist nativa, atualize os estados equivalentes também.",
        q(PROCESS_START_TOOL),
        q(WORK_PLAN_TOOL),
        q(WORK_UPDATE_TOOL),
    );
    if first_turn {
        s.push(' ');
        s.push_str(&pedido_de_titulo(&q(CONVERSATION_TITLE_TOOL)));
    }
    s
}

pub(super) fn tool_specs() -> Vec<Value> {
    vec![
        json!({
            "name": PROCESS_START_TOOL,
            "description": "Inicia um processo externo de longa duração sob controle da Frota. Use para dev servers, watchers, containers e comandos que precisam continuar enquanto o turno segue.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "command": { "type": "string" },
                    "label": { "type": "string" }
                },
                "required": ["command"]
            }
        }),
        json!({
            "name": PROCESS_POLL_TOOL,
            "description": "Consulta estado, PID e tail de um processo gerenciado.",
            "inputSchema": {
                "type": "object",
                "properties": { "process_id": { "type": "string" } },
                "required": ["process_id"]
            }
        }),
        json!({
            "name": PROCESS_STOP_TOOL,
            "description": "Interrompe um processo gerenciado e o seu grupo de filhos.",
            "inputSchema": {
                "type": "object",
                "properties": { "process_id": { "type": "string" } },
                "required": ["process_id"]
            }
        }),
        json!({
            "name": WORK_PLAN_TOOL,
            "description": "Publica o plano/to-do vivo do turno para a Frota.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tasks": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "id": { "type": "string" },
                                "title": { "type": "string" },
                                "description": { "type": "string" },
                                "status": { "type": "string", "enum": ["pending", "in_progress", "completed"] }
                            },
                            "required": ["id", "title"]
                        }
                    }
                },
                "required": ["tasks"]
            }
        }),
        json!({
            "name": WORK_UPDATE_TOOL,
            "description": "Atualiza uma tarefa publicada no plano vivo.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" },
                    "title": { "type": "string" },
                    "description": { "type": "string" },
                    "status": { "type": "string", "enum": ["pending", "in_progress", "completed"] }
                },
                "required": ["id", "status"]
            }
        }),
        json!({
            "name": CONVERSATION_TITLE_TOOL,
            "description": "Dá à conversa um título curto, uma vez, no primeiro turno. O título aparece na lista de conversas da Frota; se a pessoa já renomeou, ele é ignorado.",
            "inputSchema": {
                "type": "object",
                "properties": { "title": { "type": "string", "description": "De 3 a 6 palavras, em pt-BR, nomeando o assunto" } },
                "required": ["title"]
            }
        }),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn titulo_aceita_o_curto_e_recusa_o_que_nao_e_titulo() {
        assert_eq!(titulo(&json!({ "title": "  Barra lateral enxuta " })).unwrap(), "Barra lateral enxuta");
        assert!(titulo(&json!({})).is_err());
        assert!(titulo(&json!({ "title": "   " })).is_err());
        assert!(titulo(&json!({ "title": "linha um\nlinha dois" })).is_err());
        assert!(titulo(&json!({ "title": "x".repeat(81) })).is_err());
    }

    #[test]
    fn o_canal_de_sistema_tambem_pede_o_titulo_no_primeiro_turno() {
        // O caminho do Claude ficou sem o pedido na ADR-246: nenhuma conversa
        // dele foi nomeada. Os dois caminhos agora dizem o mesmo.
        let primeiro = instrucao_qualificada(true);
        assert!(primeiro.contains("mcp__frota-work__conversation_title"));
        assert!(primeiro.contains(&pedido_de_titulo("mcp__frota-work__conversation_title")));
        assert!(!instrucao_qualificada(false).contains(CONVERSATION_TITLE_TOOL));
        assert!(instrucao_qualificada(false).contains("mcp__frota-work__work_plan"));
    }

    #[test]
    fn o_pedido_de_titulo_vai_so_no_primeiro_turno() {
        assert!(instrucao(true).contains(CONVERSATION_TITLE_TOOL));
        assert!(!instrucao(false).contains(CONVERSATION_TITLE_TOOL));
        // e o resto da telemetria segue igual nos dois
        assert!(instrucao(false).starts_with("TELEMETRIA DE TRABALHO"));
        assert!(instrucao(true).starts_with(&instrucao(false)));
    }
}
