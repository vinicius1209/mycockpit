//! O stream do OpenCode, linha a linha: as linhas são o stream REAL
//! capturado em 26/08/2026. Saiu de `adapters.rs` pela catraca de tamanho,
//! no mesmo molde de `adapters_claude_tail_tests.rs`.
use super::*;

// ── OpenCode: as linhas abaixo são o stream REAL capturado em 26/08/2026
//    (`opencode run --format json -m google/gemini-2.5-flash-lite`).
fn oc_linha(j: &str) -> serde_json::Value {
    serde_json::from_str(j).unwrap()
}

const OC_STEP_FINISH: &str = r#"{"type":"step_finish","timestamp":1787707798576,"sessionID":"ses_x","part":{"id":"prt_1","reason":"stop","messageID":"msg_1","sessionID":"ses_x","type":"step-finish","tokens":{"total":41932,"input":5499,"output":1,"reasoning":212,"cache":{"write":0,"read":36220}},"cost":0.0009973}}"#;

#[test]
fn opencode_soma_o_cache_no_input() {
    // O `input` do opencode EXCLUI o cache (medido: total 41932 =
    // input 5499 + cache.read 36220 + output 1 + reasoning 212), e o nosso
    // contrato INCLUI. Sem a soma, o ledger subestimaria o turno em 36k.
    let mut a = OpenCodeAdapter::default();
    a.map_line(&oc_linha(OC_STEP_FINISH));
    let ev = a.on_close();
    match &ev[0] {
        AgentEvent::Result {
            input_tokens,
            cache_read,
            output_tokens,
            ..
        } => {
            assert_eq!(*input_tokens, 5499 + 36220);
            assert_eq!(*cache_read, 36220);
            assert_eq!(*output_tokens, 1);
        }
        _ => panic!("esperava Result"),
    }
}

#[test]
fn opencode_reporta_custo_e_a_escrita_de_cache() {
    let mut a = OpenCodeAdapter::default();
    a.map_line(&oc_linha(OC_STEP_FINISH));
    match &a.on_close()[0] {
        AgentEvent::Result {
            cost_usd,
            cost_source,
            cache_creation,
            ..
        } => {
            assert_eq!(*cost_usd, Some(0.0009973));
            assert!(matches!(cost_source, CostSource::Reported));
            // `cache.write` existe e é 0 aqui; nenhum outro motor entrega
            // este campo, e é ele que alimenta o "+N reconstruído".
            assert_eq!(*cache_creation, 0);
        }
        _ => panic!("esperava Result"),
    }
}

#[test]
fn opencode_nao_acumula_entre_turnos() {
    // Medido em dois turnos da mesma sessão: cada step_finish traz o total
    // DAQUELE turno. `cumulative_usage: None` é o que impede o front de
    // subtrair baseline que não existe.
    let mut a = OpenCodeAdapter::default();
    a.map_line(&oc_linha(OC_STEP_FINISH));
    match &a.on_close()[0] {
        AgentEvent::Result {
            cumulative_usage, ..
        } => assert!(cumulative_usage.is_none()),
        _ => panic!("esperava Result"),
    }
}

/// Linha REAL medida em 26/08/2026 rodando `opencode run --format json`
/// num projeto com `{"permission":{"bash":"ask"}}`. O CLI não perguntou:
/// escreveu `permission requested: bash (echo oi-frota); auto-rejecting`
/// no stderr e gravou a recusa no turno como se fosse do humano.
const OC_TOOL_REJEITADA: &str = r#"{"type":"tool_use","timestamp":1,"sessionID":"ses_x","part":{"type":"tool","tool":"bash","callID":"MOAVmRhdsF528uLA","state":{"status":"error","input":{"command":"echo oi-frota"},"error":"The user rejected permission to use this specific tool call.","time":{"start":1,"end":2}}}}"#;

#[test]
fn opencode_nao_deixa_a_rejeicao_automatica_passar_calada() {
    // Antes deste braço o `tool_use` caía no `_ => vazio`: nenhum evento
    // nascia, nenhum `erro` era marcado, e o turno fechava `ok:true` com
    // TODA ferramenta barrada. É o sucesso falso que a casa não aceita.
    let mut a = OpenCodeAdapter::default();
    a.bypass = false;
    let evs = a.map_line(&oc_linha(OC_TOOL_REJEITADA));
    let AgentEvent::Error { message } = &evs[0] else {
        panic!("esperava Error")
    };
    assert!(message.contains("bash"), "diz QUAL ferramenta: {message}");
    assert!(
        message.contains("sem perguntar"),
        "desmente a frase do fornecedor: {message}"
    );
    match &a.on_close()[0] {
        AgentEvent::Result { ok, .. } => assert!(!ok, "turno barrado não é sucesso"),
        _ => panic!("esperava Result"),
    }
}

#[test]
fn opencode_com_bypass_nao_reescreve_recusa_que_e_do_motor() {
    // Com `--dangerously-skip-permissions` ligado, uma recusa que chegue
    // veio de regra do próprio opencode. Aí a frase dele está de pé, e
    // inventar "ninguém te perguntou" seria o app mentindo na outra
    // direção. Guarda dos DOIS lados.
    let mut a = OpenCodeAdapter::default();
    a.bypass = true;
    assert!(a.map_line(&oc_linha(OC_TOOL_REJEITADA)).is_empty());
    match &a.on_close()[0] {
        AgentEvent::Result { ok, .. } => assert!(ok),
        _ => panic!("esperava Result"),
    }
}

#[test]
fn opencode_ferramenta_que_deu_certo_nao_vira_erro() {
    // Só a recusa SEM pergunta é reescrita; `tool_use` normal segue mudo.
    let ok_json = r#"{"type":"tool_use","timestamp":1,"sessionID":"ses_x","part":{"type":"tool","tool":"bash","callID":"c1","state":{"status":"completed","input":{"command":"echo oi"},"output":"oi"}}}"#;
    let mut a = OpenCodeAdapter::default();
    a.bypass = false;
    assert!(a.map_line(&oc_linha(ok_json)).is_empty());
    assert!(a.erro.is_none());
}

#[test]
fn opencode_desfecho_vem_do_evento_nao_do_exit_code() {
    // O CLI foi medido saindo com **exit 0 numa falha real** (banco local
    // fora de sincronia). Se o `ok` viesse do processo, a falha passaria
    // por sucesso com texto vazio.
    let erro = r#"{"type":"error","timestamp":1,"sessionID":"ses_x","error":{"name":"APIError","data":{"message":"Insufficient balance.","statusCode":401,"isRetryable":false}}}"#;
    let mut a = OpenCodeAdapter::default();
    let evs = a.map_line(&oc_linha(erro));
    assert!(
        matches!(&evs[0], AgentEvent::Error { message } if message.contains("Insufficient"))
    );
    match &a.on_close()[0] {
        AgentEvent::Result { ok, .. } => assert!(!ok),
        _ => panic!("esperava Result"),
    }
}

#[test]
fn opencode_429_vira_limite_acionavel() {
    // Resposta REAL do NVIDIA NIM no teste do Kimi K3 (28/08/2026).
    let erro =
        r#"{"type":"error","error":{"data":{"message":"AI_APICallError: Too Many Requests"}}}"#;
    let mut adapter = OpenCodeAdapter::default();
    let events = adapter.map_line(&oc_linha(erro));
    assert!(
        matches!(&events[0], AgentEvent::LimitReached { message, .. } if message.contains("Too Many Requests"))
    );
}

#[test]
fn opencode_junta_o_texto_dos_blocos() {
    let mut a = OpenCodeAdapter::default();
    for t in ["ok", " e mais"] {
        let j = format!(
            r#"{{"type":"text","timestamp":1,"sessionID":"ses_x","part":{{"type":"text","text":"{t}"}}}}"#
        );
        a.map_line(&oc_linha(&j));
    }
    match &a.on_close()[0] {
        AgentEvent::Result { text, .. } => assert_eq!(text.as_deref(), Some("ok e mais")),
        _ => panic!("esperava Result"),
    }
}

#[test]
fn opencode_turno_sem_step_finish_nao_inventa_numero() {
    // Turno que morre antes de reportar: zero é o que sabemos, e o custo
    // fica Unknown em vez de US$ 0,00 (que seria "de graça").
    let mut a = OpenCodeAdapter::default();
    match &a.on_close()[0] {
        AgentEvent::Result {
            cost_usd,
            cost_source,
            input_tokens,
            ..
        } => {
            assert_eq!(*cost_usd, None);
            assert!(matches!(cost_source, CostSource::Unknown));
            assert_eq!(*input_tokens, 0);
        }
        _ => panic!("esperava Result"),
    }
}
