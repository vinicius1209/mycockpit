//! Tradução do **ACP** (Agent Client Protocol) para o vocabulário da casa.
//!
//! ACP é JSON-RPC 2.0 sobre stdio, e **não é dialeto de um fornecedor só**: é o
//! protocolo que o Zed usa para dirigir agentes (foi assim que ele apareceu
//! aqui, num processo `opencode acp` que sobrou de uma sessão do Zed). Por isso
//! este módulo fala ACP, não "opencode": quem falar o mesmo protocolo entra
//! sem código novo de tradução.
//!
//! **Por que ele existe:** o `opencode run --format json` é estruturalmente
//! incapaz de pedir permissão. Medido em 26/08/2026: sem o bypass ele
//! **auto-rejeita** toda ferramenta e grava a recusa como se fosse do humano
//! (ADR-099). O ACP resolve isso de verdade, e foi medido ponta a ponta no
//! mesmo dia: o turno PARA num `session/request_permission`, espera a resposta
//! e segue quando ela chega.
//!
//! O que o ACP entrega e o `run` não: pedido de permissão real, streaming de
//! texto, bloco de raciocínio, ferramenta com status e saída, `stopReason`
//! honesto e usage com cache separado.

// allow(dead_code): esta é a camada PURA do transporte, entregue antes do
// spawn de propósito. A tradução é onde os erros de protocolo moram (foi
// tratar `session/request_permission` como notificação que pendurou o turno na
// primeira tentativa), e ela pode ser testada contra payload REAL sem subir
// processo nenhum. O consumidor entra na fase seguinte.
#![allow(dead_code)]

use crate::agent::AgentEvent;
use serde_json::Value;

/// O que o agente mandou. ACP mistura três coisas no mesmo cano, e confundi-las
/// é o erro clássico: **`session/request_permission` tem `id`**, ou seja, é
/// PEDIDO e exige resposta. Tratá-lo como notificação pendura o turno para
/// sempre, esperando um humano que nunca foi chamado.
#[derive(Debug, PartialEq)]
pub enum MensagemAcp {
    /// Pedido do AGENTE para o cliente (tem `id` e `method`). Precisa resposta.
    Pedido {
        id: Value,
        metodo: String,
        params: Value,
    },
    /// Resposta a algo que NÓS pedimos (tem `id`, não tem `method`).
    Resposta {
        id: Value,
        result: Option<Value>,
        erro: Option<Value>,
    },
    /// Aviso sem resposta (tem `method`, não tem `id`).
    Notificacao { metodo: String, params: Value },
    /// Linha que não é JSON-RPC. Não é erro fatal: alguns CLIs escrevem banner
    /// no mesmo cano, e derrubar o turno por causa disso seria desproporcional.
    Ruido,
}

pub fn classificar(v: &Value) -> MensagemAcp {
    let tem_id = v.get("id").is_some_and(|x| !x.is_null());
    let metodo = v.get("method").and_then(|m| m.as_str());
    match (tem_id, metodo) {
        (true, Some(m)) => MensagemAcp::Pedido {
            id: v["id"].clone(),
            metodo: m.to_string(),
            params: v.get("params").cloned().unwrap_or(Value::Null),
        },
        (true, None) => MensagemAcp::Resposta {
            id: v["id"].clone(),
            result: v.get("result").cloned(),
            erro: v.get("error").cloned(),
        },
        (false, Some(m)) => MensagemAcp::Notificacao {
            metodo: m.to_string(),
            params: v.get("params").cloned().unwrap_or(Value::Null),
        },
        (false, None) => MensagemAcp::Ruido,
    }
}

/// Um pedido de permissão já lido, com o que a tela precisa mostrar.
#[derive(Debug, PartialEq)]
pub struct PedidoDePermissao {
    /// `id` do JSON-RPC. É por ele que a resposta volta, e perdê-lo é pendurar
    /// o turno.
    pub id: Value,
    pub tool_call_id: String,
    /// Frase curta que o agente já formatou ("echo oi-frota").
    pub titulo: String,
    /// `execute`, `read`, `edit`… vocabulário do ACP, repassado como veio.
    pub tipo: String,
    /// Opções OFERECIDAS, na ordem em que vieram. O app não inventa botão que o
    /// agente não ofereceu, nem assume que "once/always/reject" sempre existem.
    pub opcoes: Vec<OpcaoDePermissao>,
}

#[derive(Debug, PartialEq, Clone)]
pub struct OpcaoDePermissao {
    pub id: String,
    /// `allow_once`, `allow_always`, `reject_once`… serve pra UI escolher o
    /// peso visual sem depender do texto.
    pub tipo: String,
    pub rotulo: String,
}

/// Lê um `session/request_permission`. `None` quando falta o essencial: sem
/// `toolCallId` ou sem opção nenhuma não há o que perguntar, e inventar
/// resposta seria decidir no lugar do humano.
pub fn ler_pedido_de_permissao(id: &Value, params: &Value) -> Option<PedidoDePermissao> {
    let tc = params.get("toolCall")?;
    let opcoes: Vec<OpcaoDePermissao> = params
        .get("options")?
        .as_array()?
        .iter()
        .filter_map(|o| {
            Some(OpcaoDePermissao {
                id: o.get("optionId")?.as_str()?.to_string(),
                tipo: o
                    .get("kind")
                    .and_then(|k| k.as_str())
                    .unwrap_or("")
                    .to_string(),
                rotulo: o
                    .get("name")
                    .and_then(|n| n.as_str())
                    .unwrap_or("")
                    .to_string(),
            })
        })
        .collect();
    if opcoes.is_empty() {
        return None;
    }
    Some(PedidoDePermissao {
        id: id.clone(),
        tool_call_id: tc.get("toolCallId")?.as_str()?.to_string(),
        titulo: tc
            .get("title")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string(),
        tipo: tc
            .get("kind")
            .and_then(|k| k.as_str())
            .unwrap_or("")
            .to_string(),
        opcoes,
    })
}

/// A resposta que destrava o turno. Forma medida em 26/08/2026: respondendo
/// isto, a ferramenta executou e o turno seguiu até `stopReason: end_turn`.
pub fn resposta_de_permissao(id: &Value, opcao: &str) -> Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": { "outcome": { "outcome": "selected", "optionId": opcao } }
    })
}

/// A recusa por CANCELAMENTO nosso (o humano fechou, ou a missão foi abortada).
/// É diferente de "o humano escolheu rejeitar", e o ACP tem palavra própria pra
/// isso: misturar as duas faria o registro dizer que alguém decidiu quando
/// ninguém decidiu, que é o defeito do ADR-099 de novo.
pub fn resposta_de_cancelamento(id: &Value) -> Value {
    serde_json::json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": { "outcome": { "outcome": "cancelled" } }
    })
}

/// A resposta do humano (contrato da UI, `{allow, message?}`) virando escolha
/// ACP, DENTRO do que o agente ofereceu.
///
/// A regra que faz esta função existir: **o app não inventa `optionId`**. Os
/// nomes `once`/`always`/`reject` são o que este binário oferece hoje, não uma
/// garantia do protocolo — o ACP manda a lista justamente porque ela varia.
/// Mandar um id que não estava na lista é pedir um erro do agente no meio do
/// turno, com o humano já tendo decidido.
///
/// Quando nada corresponde, o desfecho é `cancelled`, não um "allow" qualquer:
/// escolher por conta própria seria decidir no lugar de quem foi perguntado.
pub fn escolher_opcao(answer: &Value, opcoes: &[OpcaoDePermissao]) -> Value {
    let allow = answer
        .get("allow")
        .and_then(|x| x.as_bool())
        .unwrap_or(false);
    // Preferência EXATA primeiro, e só depois a família. `allow_once` é o
    // default deliberado do "sim": conceder para sempre é decisão maior, e
    // ninguém pediu isso ao clicar em permitir uma vez.
    let exato = if allow { "allow_once" } else { "reject_once" };
    let familia = if allow { "allow" } else { "reject" };
    let escolhida = opcoes
        .iter()
        .find(|o| o.tipo == exato)
        .or_else(|| opcoes.iter().find(|o| o.tipo.starts_with(familia)));
    match escolhida {
        Some(o) => serde_json::json!({ "outcome": "selected", "optionId": o.id }),
        None => serde_json::json!({ "outcome": "cancelled" }),
    }
}

/// Traduz um `session/update` para os eventos da casa. Vazio = update que não
/// tem correspondente aqui (o ACP tem mais vocabulário que a nossa timeline, e
/// silêncio é melhor que evento inventado).
pub fn mapear_update(params: &Value) -> Vec<AgentEvent> {
    let Some(u) = params.get("update") else {
        return Vec::new();
    };
    let tipo = u
        .get("sessionUpdate")
        .and_then(|t| t.as_str())
        .unwrap_or("");
    match tipo {
        "agent_message_chunk" => texto_do_chunk(u)
            .map(|text| vec![AgentEvent::TextDelta { text }])
            .unwrap_or_default(),
        // Raciocínio NÃO vira texto do assistente: misturar os dois faria o
        // pensamento aparecer como resposta, que é o defeito que a casa já
        // separou nos outros motores.
        "agent_thought_chunk" => Vec::new(),
        "tool_call" => {
            let Some(id) = u.get("toolCallId").and_then(|x| x.as_str()) else {
                return Vec::new();
            };
            vec![AgentEvent::Tool {
                id: id.to_string(),
                name: u
                    .get("kind")
                    .and_then(|k| k.as_str())
                    .unwrap_or("tool")
                    .to_string(),
                input: u.get("rawInput").cloned().unwrap_or(Value::Null),
                parent_tool_id: None,
            }]
        }
        "tool_call_update" => {
            let Some(id) = u.get("toolCallId").and_then(|x| x.as_str()) else {
                return Vec::new();
            };
            let status = u.get("status").and_then(|s| s.as_str()).unwrap_or("");
            // Só o DESFECHO vira ToolResult. `in_progress` chega várias vezes
            // com a saída crescendo; emitir a cada uma encheria a timeline de
            // resultados parciais que se contradizem.
            if status != "completed" && status != "failed" {
                return Vec::new();
            }
            let texto = texto_do_conteudo(u.get("content"));
            vec![AgentEvent::ToolResult {
                id: id.to_string(),
                ok: status == "completed",
                lines: texto.lines().count() as u64,
                text: texto,
                images: Vec::new(),
            }]
        }
        _ => Vec::new(),
    }
}

fn texto_do_chunk(u: &Value) -> Option<String> {
    let c = u.get("content")?;
    let t = c.get("text")?.as_str()?;
    (!t.is_empty()).then(|| t.to_string())
}

/// O `content` do `tool_call_update` é uma LISTA de blocos, cada um com o texto
/// aninhado em `content.text`. Vem `null` enquanto a ferramenta não produziu
/// nada, e tratar null como "" evita `unwrap` num campo que legitimamente falta.
pub fn texto_do_conteudo(c: Option<&Value>) -> String {
    let Some(arr) = c.and_then(|x| x.as_array()) else {
        return String::new();
    };
    arr.iter()
        .filter_map(|b| b.get("content")?.get("text")?.as_str())
        .collect::<Vec<_>>()
        .join("")
}

/// O `usage` do fim de turno, na ordem do nosso contrato
/// (input, output, cache_read). O ACP reporta `cachedReadTokens` separado, e o
/// `inputTokens` dele **exclui** o cache, igual ao dialeto do `run` medido no
/// ADR-095: por isso soma, em vez de confiar no `totalTokens`.
pub fn ler_usage(result: &Value) -> (u64, u64, u64) {
    let u = result.get("usage");
    let n = |k: &str| {
        u.and_then(|x| x.get(k))
            .and_then(|x| x.as_u64())
            .unwrap_or(0)
    };
    let cache = n("cachedReadTokens");
    (n("inputTokens") + cache, n("outputTokens"), cache)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Payload REAL, capturado falando ACP com `opencode acp` em 26/08/2026.
    const PEDIDO: &str = r#"{"jsonrpc":"2.0","id":0,"method":"session/request_permission","params":{"sessionId":"ses_x","toolCall":{"toolCallId":"Up0RhTbcspfKRKTT","title":"echo oi-frota","kind":"execute","status":"pending","locations":[],"rawInput":{"command":"echo oi-frota"}},"options":[{"optionId":"once","kind":"allow_once","name":"Allow once"},{"optionId":"always","kind":"allow_always","name":"Always allow"},{"optionId":"reject","kind":"reject_once","name":"Reject"}]}}"#;

    fn v(s: &str) -> Value {
        serde_json::from_str(s).unwrap()
    }

    #[test]
    fn permissao_e_PEDIDO_com_id_nao_notificacao() {
        // O erro que pendura o turno para sempre: tratar isto como aviso. Ele
        // tem `id`, logo espera resposta, e sem ela o agente fica parado
        // esperando um humano que nunca foi chamado.
        let MensagemAcp::Pedido { id, metodo, params } = classificar(&v(PEDIDO)) else {
            panic!("permissão tem de ser Pedido")
        };
        assert_eq!(metodo, "session/request_permission");
        assert_eq!(id, json!(0));

        let p = ler_pedido_de_permissao(&id, &params).unwrap();
        assert_eq!(p.titulo, "echo oi-frota");
        assert_eq!(p.tipo, "execute");
        assert_eq!(p.tool_call_id, "Up0RhTbcspfKRKTT");
        // As opções vêm do AGENTE, na ordem dele. O app não inventa botão.
        assert_eq!(
            p.opcoes.iter().map(|o| o.id.as_str()).collect::<Vec<_>>(),
            vec!["once", "always", "reject"]
        );
        assert_eq!(p.opcoes[1].tipo, "allow_always");
    }

    #[test]
    fn a_resposta_que_destrava_o_turno_tem_a_forma_medida() {
        // Esta forma EXATA foi respondida ao binário real e o turno seguiu:
        // a ferramenta executou e o desfecho veio `stopReason: end_turn`.
        assert_eq!(
            resposta_de_permissao(&json!(0), "once"),
            v(
                r#"{"jsonrpc":"2.0","id":0,"result":{"outcome":{"outcome":"selected","optionId":"once"}}}"#
            )
        );
    }

    #[test]
    fn cancelar_nao_e_a_mesma_coisa_que_rejeitar() {
        // "ninguém decidiu" e "a pessoa recusou" são fatos diferentes, e o ACP
        // tem palavra para cada um. Juntar os dois é repetir o defeito do
        // ADR-099, onde o registro dizia que o humano recusou sem terem
        // perguntado a ele.
        let cancel = resposta_de_cancelamento(&json!(7));
        assert_eq!(cancel["result"]["outcome"]["outcome"], "cancelled");
        assert!(cancel["result"]["outcome"]["optionId"].is_null());
    }

    #[test]
    fn pedido_sem_opcao_nao_vira_pergunta_sem_resposta() {
        let params = json!({"toolCall":{"toolCallId":"t1","title":"x"},"options":[]});
        assert!(ler_pedido_de_permissao(&json!(1), &params).is_none());
        // E sem toolCall também não: não há o que mostrar.
        assert!(ler_pedido_de_permissao(&json!(1), &json!({"options":[]})).is_none());
    }

    fn opcoes_reais() -> Vec<OpcaoDePermissao> {
        let params = &v(PEDIDO)["params"];
        ler_pedido_de_permissao(&json!(0), params).unwrap().opcoes
    }

    #[test]
    fn permitir_uma_vez_e_o_default_do_sim() {
        // Conceder PARA SEMPRE é decisão maior, e ninguém pediu isso ao clicar
        // em permitir. O "sim" tem de cair no menor escopo oferecido.
        let e = escolher_opcao(&json!({"allow": true}), &opcoes_reais());
        assert_eq!(e["optionId"], "once");
        assert_eq!(e["outcome"], "selected");

        let e = escolher_opcao(&json!({"allow": false}), &opcoes_reais());
        assert_eq!(e["optionId"], "reject");
    }

    #[test]
    fn o_app_nao_inventa_optionId_que_o_agente_nao_ofereceu() {
        // `once`/`always`/`reject` são o que ESTE binário oferece hoje, não uma
        // garantia do protocolo: o ACP manda a lista justamente porque varia.
        // Mandar id de fora dá erro do agente no meio do turno, com o humano já
        // tendo decidido.
        let so_sempre = vec![OpcaoDePermissao {
            id: "sempre-liberado".into(),
            tipo: "allow_always".into(),
            rotulo: "Always".into(),
        }];
        // Sem `allow_once`, cai na família — mas no id que ELE ofereceu.
        assert_eq!(
            escolher_opcao(&json!({"allow": true}), &so_sempre)["optionId"],
            "sempre-liberado"
        );
        // E negar, sem nenhuma opção de negar, não vira "allow" por descuido.
        let e = escolher_opcao(&json!({"allow": false}), &so_sempre);
        assert_eq!(e["outcome"], "cancelled");
        assert!(
            e["optionId"].is_null(),
            "não escolhe por conta própria: {e}"
        );
    }

    #[test]
    fn resposta_ausente_ou_estranha_nega() {
        // Fail-closed: o contrato da UI é `{allow}`, e o que não afirma "sim"
        // não é "sim". Vale pro shutdown do run, que responde sem `allow`.
        for a in [json!({}), json!({"allow": null}), json!({"allow": "sim"})] {
            assert_eq!(
                escolher_opcao(&a, &opcoes_reais())["optionId"],
                "reject",
                "resposta {a} tinha de negar"
            );
        }
    }

    #[test]
    fn classifica_as_tres_formas_do_cano() {
        assert!(matches!(
            classificar(&v(
                r#"{"jsonrpc":"2.0","id":3,"result":{"stopReason":"end_turn"}}"#
            )),
            MensagemAcp::Resposta { .. }
        ));
        assert!(matches!(
            classificar(&v(
                r#"{"jsonrpc":"2.0","method":"session/update","params":{}}"#
            )),
            MensagemAcp::Notificacao { .. }
        ));
        // Banner no mesmo cano não derruba o turno.
        assert_eq!(classificar(&json!({"oi": 1})), MensagemAcp::Ruido);
    }

    #[test]
    fn texto_streama_e_raciocinio_nao_vira_resposta() {
        let chunk = json!({"update":{"sessionUpdate":"agent_message_chunk",
            "content":{"type":"text","text":"A saída é: "}}});
        let evs = mapear_update(&chunk);
        assert!(matches!(&evs[0], AgentEvent::TextDelta { text } if text == "A saída é: "));

        // Pensamento não pode aparecer como voz do assistente.
        let pensa = json!({"update":{"sessionUpdate":"agent_thought_chunk",
            "content":{"type":"text","text":"vou rodar o comando"}}});
        assert!(mapear_update(&pensa).is_empty());
    }

    #[test]
    fn so_o_desfecho_da_ferramenta_vira_resultado() {
        // Medido: `in_progress` chega VÁRIAS vezes, com a saída crescendo.
        // Emitir a cada uma encheria a timeline de resultados que se
        // contradizem, e o último venceria por acidente.
        let andando = json!({"update":{"sessionUpdate":"tool_call_update","toolCallId":"t1",
            "status":"in_progress","content":[{"type":"content","content":{"type":"text","text":"oi-frota\n"}}]}});
        assert!(mapear_update(&andando).is_empty());

        let pronto = json!({"update":{"sessionUpdate":"tool_call_update","toolCallId":"t1",
            "status":"completed","content":[{"type":"content","content":{"type":"text","text":"oi-frota\n"}}]}});
        let AgentEvent::ToolResult {
            id,
            ok,
            text,
            lines,
            ..
        } = &mapear_update(&pronto)[0]
        else {
            panic!("esperava ToolResult")
        };
        assert_eq!(id, "t1");
        assert!(ok);
        assert_eq!(text, "oi-frota\n");
        assert_eq!(*lines, 1);

        // `failed` também é desfecho, e NÃO é sucesso.
        let falhou = json!({"update":{"sessionUpdate":"tool_call_update","toolCallId":"t1","status":"failed"}});
        let AgentEvent::ToolResult { ok, text, .. } = &mapear_update(&falhou)[0] else {
            panic!("esperava ToolResult")
        };
        assert!(!ok);
        assert_eq!(text, "", "content null não vira pânico nem texto inventado");
    }

    #[test]
    fn aqui_a_frase_do_fornecedor_e_VERDADE_e_nao_se_reescreve() {
        // Fecha o círculo com o ADR-099, e é a razão mais forte pra preferir
        // ACP ao `run`.
        //
        // No `run --format json` o CLI auto-rejeita e grava "The user rejected
        // permission…" sem ter perguntado a ninguém: ali a frase é MENTIRA, e o
        // adapter a reescreve. No ACP o humano foi perguntado de verdade e
        // decidiu, então a MESMA frase é honesta e tem de passar intacta.
        //
        // Esta guarda existe porque a correção do ADR-099 é tentadora de
        // generalizar. Aplicá-la aqui faria o app desmentir uma recusa que o
        // usuário realmente tomou, que é o erro simétrico.
        let negado = json!({"update":{"sessionUpdate":"tool_call_update","toolCallId":"t1","status":"failed",
            "content":[{"type":"content","content":{"type":"text",
            "text":"The user rejected permission to use this specific tool call."}}]}});
        let AgentEvent::ToolResult { ok, text, .. } = &mapear_update(&negado)[0] else {
            panic!("esperava ToolResult")
        };
        assert!(!ok);
        assert_eq!(
            text, "The user rejected permission to use this specific tool call.",
            "no ACP a recusa É do humano: a frase passa como veio"
        );
    }

    #[test]
    fn update_desconhecido_fica_em_silencio() {
        // O ACP tem mais vocabulário que a nossa timeline. Silêncio é melhor
        // que evento inventado.
        let outro = json!({"update":{"sessionUpdate":"available_commands_update"}});
        assert!(mapear_update(&outro).is_empty());
        assert!(mapear_update(&json!({})).is_empty());
    }

    #[test]
    fn o_usage_soma_o_cache_no_input() {
        // Valores REAIS do turno medido. O `inputTokens` do ACP exclui o cache,
        // e o nosso contrato inclui: por isso soma, em vez de acreditar no
        // `totalTokens` (que aqui nem fecha com a soma das partes).
        let r = v(
            r#"{"stopReason":"end_turn","usage":{"inputTokens":5365,"outputTokens":10,"totalTokens":9497,"thoughtTokens":37,"cachedReadTokens":4085}}"#,
        );
        assert_eq!(ler_usage(&r), (5365 + 4085, 10, 4085));
        // Sem usage não inventa número.
        assert_eq!(ler_usage(&json!({})), (0, 0, 0));
    }
}
