//! O stream do OpenCode, linha a linha: as linhas são o stream REAL
//! capturado em 26/08/2026. Saiu de `adapters.rs` pela catraca de tamanho,
//! no mesmo molde de `adapters_claude_tail_tests.rs`.
use super::*;
use super::tests::{argv, has_pair, req, req_com_anexo};

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
            // output 1 + reasoning 212: o raciocínio é cobrado como saída.
            assert_eq!(*output_tokens, 1 + 212);
        }
        _ => panic!("esperava Result"),
    }
}

/// Os sete `step_finish` REAIS de um turno do incidente de 26/09/2026
/// (opencode 1.18.32, `opencode/kimi-k3`), tirados do banco do próprio
/// opencode e conferidos contra o log do gateway, request a request.
const OC_TURNO_DE_SETE_STEPS: [&str; 7] = [
    r#"{"type":"step_finish","timestamp":1790431903131,"sessionID":"ses_f21f805bbffeKqfuZn15YvQing","part":{"reason":"tool-calls","snapshot":"2d3fd63c3d8c293c986970c61bddf34ff352ba1c","type":"step-finish","tokens":{"total":22061,"input":20629,"output":844,"reasoning":588,"cache":{"write":0,"read":0}},"cost":0.083367}}"#,
    r#"{"type":"step_finish","timestamp":1790431979525,"sessionID":"ses_f21f805bbffeKqfuZn15YvQing","part":{"reason":"tool-calls","snapshot":"2d3fd63c3d8c293c986970c61bddf34ff352ba1c","type":"step-finish","tokens":{"total":58753,"input":33915,"output":262,"reasoning":3968,"cache":{"write":0,"read":20608}},"cost":0.1713774}}"#,
    r#"{"type":"step_finish","timestamp":1790431989577,"sessionID":"ses_f21f805bbffeKqfuZn15YvQing","part":{"reason":"tool-calls","snapshot":"2d3fd63c3d8c293c986970c61bddf34ff352ba1c","type":"step-finish","tokens":{"total":61803,"input":7024,"output":111,"reasoning":268,"cache":{"write":0,"read":54400}},"cost":0.043077}}"#,
    r#"{"type":"step_finish","timestamp":1790431995701,"sessionID":"ses_f21f805bbffeKqfuZn15YvQing","part":{"reason":"tool-calls","snapshot":"2d3fd63c3d8c293c986970c61bddf34ff352ba1c","type":"step-finish","tokens":{"total":62091,"input":671,"output":108,"reasoning":0,"cache":{"write":0,"read":61312}},"cost":0.0220266}}"#,
    r#"{"type":"step_finish","timestamp":1790432001068,"sessionID":"ses_f21f805bbffeKqfuZn15YvQing","part":{"reason":"tool-calls","snapshot":"2d3fd63c3d8c293c986970c61bddf34ff352ba1c","type":"step-finish","tokens":{"total":62645,"input":567,"output":126,"reasoning":0,"cache":{"write":0,"read":61952}},"cost":0.0221766}}"#,
    r#"{"type":"step_finish","timestamp":1790432005876,"sessionID":"ses_f21f805bbffeKqfuZn15YvQing","part":{"reason":"tool-calls","snapshot":"2d3fd63c3d8c293c986970c61bddf34ff352ba1c","type":"step-finish","tokens":{"total":63122,"input":588,"output":70,"reasoning":0,"cache":{"write":0,"read":62464}},"cost":0.0215532}}"#,
    r#"{"type":"step_finish","timestamp":1790432076249,"sessionID":"ses_f21f805bbffeKqfuZn15YvQing","part":{"reason":"stop","snapshot":"2d3fd63c3d8c293c986970c61bddf34ff352ba1c","type":"step-finish","tokens":{"total":68548,"input":1499,"output":2749,"reasoning":1324,"cache":{"write":0,"read":62976}},"cost":0.0844848}}"#,
];

#[test]
fn opencode_soma_o_custo_de_todos_os_steps_do_turno() {
    // Cada step é um request cobrado à parte. Ficar com o último mostrava
    // US$ 0,084 (só o step final) num turno que custou US$ 0,448: o mesmo
    // total que o opencode grava em `session.cost` e que o gateway cobrou.
    let mut a = OpenCodeAdapter::default();
    for l in OC_TURNO_DE_SETE_STEPS {
        a.map_line(&oc_linha(l));
    }
    match &a.on_close()[0] {
        AgentEvent::Result {
            cost_usd,
            cost_source,
            input_tokens,
            output_tokens,
            cache_read,
            ..
        } => {
            let esperado = 0.083367 + 0.1713774 + 0.043077 + 0.0220266 + 0.0221766 + 0.0215532 + 0.0844848;
            assert!((cost_usd.unwrap() - esperado).abs() < 1e-9, "{cost_usd:?}");
            assert!(matches!(cost_source, CostSource::Reported));
            // input do gateway (sem cache) 64893 + cache lido 323712.
            assert_eq!(*cache_read, 323_712);
            assert_eq!(*input_tokens, 64_893 + 323_712);
            // output 4270 + reasoning 6148, o que o gateway contou como saída.
            assert_eq!(*output_tokens, 4_270 + 6_148);
        }
        _ => panic!("esperava Result"),
    }
}

#[test]
fn opencode_step_sem_custo_nao_apaga_o_custo_dos_outros() {
    let sem_custo = r#"{"type":"step_finish","timestamp":1,"sessionID":"ses_x","part":{"type":"step-finish","tokens":{"input":10,"output":1,"reasoning":0,"cache":{"write":0,"read":0}}}}"#;
    let mut a = OpenCodeAdapter::default();
    a.map_line(&oc_linha(OC_STEP_FINISH));
    a.map_line(&oc_linha(sem_custo));
    match &a.on_close()[0] {
        AgentEvent::Result { cost_usd, .. } => assert_eq!(*cost_usd, Some(0.0009973)),
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
    // A ferramenta aparece com o desfecho falho e a frase do próprio motor;
    // nenhum erro de turno nasce dela.
    let evs = a.map_line(&oc_linha(OC_TOOL_REJEITADA));
    assert!(!evs.iter().any(|e| matches!(e, AgentEvent::Error { .. })));
    assert!(evs.iter().any(|e| matches!(
        e,
        AgentEvent::ToolResult { ok: false, text, .. } if text.contains("rejected permission")
    )));
    match &a.on_close()[0] {
        AgentEvent::Result { ok, .. } => assert!(ok),
        _ => panic!("esperava Result"),
    }
}

#[test]
fn opencode_ferramenta_que_deu_certo_nao_vira_erro() {
    // Só a recusa SEM pergunta é reescrita; `tool_use` normal vira a
    // ferramenta no fio, nunca erro.
    let ok_json = r#"{"type":"tool_use","timestamp":1,"sessionID":"ses_x","part":{"type":"tool","tool":"bash","callID":"c1","state":{"status":"completed","input":{"command":"echo oi"},"output":"oi"}}}"#;
    let mut a = OpenCodeAdapter::default();
    a.bypass = false;
    let evs = a.map_line(&oc_linha(ok_json));
    assert!(!evs.iter().any(|e| matches!(e, AgentEvent::Error { .. })));
    assert!(matches!(&evs[0], AgentEvent::Tool { name, .. } if name == "Bash"));
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

/// O composer aceita uma imagem como mensagem inteira. Os quatro transports
/// suportados precisam conservar um carrier mesmo quando o texto é vazio.
#[test]
fn turno_so_com_anexo_conserva_o_carrier_do_prompt() {
    let mut r = req_com_anexo(AttachmentKind::Image, "/tmp/anexos/c1/abc.png", "image/png");
    r.prompt.clear();

    let mut claude = ClaudeAdapter::default();
    let claude_args = argv(&claude.build_validated_command(&r).unwrap());
    assert!(claude_args
        .last()
        .unwrap()
        .contains("/tmp/anexos/c1/abc.png"));

    let mut codex = CodexAdapter::default();
    let codex_args = argv(&codex.build_validated_command(&r).unwrap());
    assert!(has_pair(&codex_args, "-i", "/tmp/anexos/c1/abc.png"));
    assert_eq!(codex_args.last().map(String::as_str), Some(""));

    let mut agy = AgyAdapter::default();
    let agy_args = argv(&agy.build_validated_command(&r).unwrap());
    let prompt = &agy_args[agy_args.iter().position(|arg| arg == "-p").unwrap() + 1];
    assert!(prompt.contains("/tmp/anexos/c1/abc.png"));

    let mut opencode = OpenCodeAdapter::default();
    let opencode_args = argv(&opencode.build_validated_command(&r).unwrap());
    assert!(has_pair(&opencode_args, "-f", "/tmp/anexos/c1/abc.png"));
    assert_eq!(opencode_args.last().map(String::as_str), Some(" "));
}

#[test]
fn opencode_anexo_preserva_prompt_do_usuario() {
    let mut a = OpenCodeAdapter::default();
    let mut r = req_com_anexo(AttachmentKind::Image, "/tmp/anexos/c1/abc.png", "image/png");
    r.prompt = "analise a imagem".to_string();

    let cmd = a.build_validated_command(&r).unwrap();
    let args = argv(&cmd);
    assert!(has_pair(&args, "-f", "/tmp/anexos/c1/abc.png"));
    assert_eq!(args.last().map(String::as_str), Some("analise a imagem"));
    assert_eq!(args.get(args.len() - 2).map(String::as_str), Some("--"));
}


// ── Subagentes: o stream do `opencode run` não traz nenhum step do filho
//    (medido em 26/09/2026 com um `@explore` real). O `tool_use` do `task` é
//    a linha REAL do incidente, com `state.output` e `input.prompt` podados.
const OC_TASK_DO_INCIDENTE: &str = r#"{"type":"tool_use","timestamp":1790431493327,"sessionID":"ses_f21f805bbffeKqfuZn15YvQing","part":{"type":"tool","tool":"task","callID":"task_3","state":{"status":"completed","input":{"description":"Mapear superfícies de UI da Frota","subagent_type":"explore"},"metadata":{"parentSessionId":"ses_f21f805bbffeKqfuZn15YvQing","sessionId":"ses_f21f78326ffegEmfF17xS34NyU","truncated":false},"title":"Mapear superfícies de UI da Frota","time":{"start":1790431493353,"end":1790431903020}}}}"#;

/// `opencode export` REAL do subagente do incidente: o `info` como veio
/// (sem `permission`, e com o `directory` trocado, que não entra na conta),
/// e as 36 mensagens de fora, porque o total mora no
/// `info` e bateu ao centavo com o gateway (35 requests, US$ 1,6774503).
fn export_do_filho(id: &str) -> Result<String, String> {
    match id {
        "ses_f21f78326ffegEmfF17xS34NyU" => Ok(r#"{"info": {"id": "ses_f21f78326ffegEmfF17xS34NyU", "slug": "stellar-squid", "projectID": "3f77bd85487d2c33ac9dd844ad438c6b7a21d2c5", "directory": "/Users/x/projetos/frota", "path": "", "parentID": "ses_f21f805bbffeKqfuZn15YvQing", "title": "Mapear superfícies de UI da Frota (@explore subagent)", "agent": "explore", "model": {"id": "kimi-k3", "providerID": "opencode", "variant": "default"}, "version": "1.18.32", "cost": 1.6774503, "tokens": {"input": 204397, "output": 12539, "reasoning": 3170, "cache": {"read": 2762081, "write": 0}}, "time": {"created": 1790431493337, "updated": 1790431903022}}, "messages": []}"#.to_string()),
        outro => Err(format!("Session not found: {outro}")),
    }
}

#[test]
fn opencode_soma_o_custo_do_subagente_que_o_stream_nao_mostra() {
    // O incidente: o turno mostrou US$ 0,084 e custou US$ 2,13. Sete steps
    // do pai (US$ 0,448) mais o `@explore` (US$ 1,677), que nunca passou
    // pelo stream.
    let mut a = OpenCodeAdapter {
        exportar: Some(export_do_filho),
        ..Default::default()
    };
    a.map_line(&oc_linha(OC_TASK_DO_INCIDENTE));
    for l in OC_TURNO_DE_SETE_STEPS {
        a.map_line(&oc_linha(l));
    }
    let ev = a.on_close();
    assert_eq!(ev.len(), 1, "sem aviso quando o filho se deixa ler");
    match &ev[0] {
        AgentEvent::Result {
            cost_usd,
            cache_read,
            output_tokens,
            ..
        } => {
            let pai = 0.083367 + 0.1713774 + 0.043077 + 0.0220266 + 0.0221766 + 0.0215532 + 0.0844848;
            assert!((cost_usd.unwrap() - (pai + 1.6774503)).abs() < 1e-9, "{cost_usd:?}");
            assert_eq!(*cache_read, 323_712 + 2_762_081);
            assert_eq!(*output_tokens, 4_270 + 6_148 + 12_539 + 3_170);
        }
        _ => panic!("esperava Result"),
    }
}

#[test]
fn opencode_subagente_ilegivel_avisa_em_vez_de_virar_zero() {
    let mut a = OpenCodeAdapter {
        exportar: Some(|_| Err("Session not found".into())),
        ..Default::default()
    };
    a.map_line(&oc_linha(OC_TASK_DO_INCIDENTE));
    a.map_line(&oc_linha(OC_STEP_FINISH));
    let ev = a.on_close();
    let AgentEvent::Notice { message } = &ev[0] else {
        panic!("esperava o aviso antes do Result")
    };
    assert!(message.contains("incompleto"), "{message}");
    match &ev[1] {
        AgentEvent::Result { cost_usd, .. } => assert_eq!(*cost_usd, Some(0.0009973)),
        _ => panic!("esperava Result"),
    }
}

#[test]
fn opencode_mesmo_subagente_visto_duas_vezes_conta_uma() {
    // O `task` pode chegar mais de uma vez (running e completed); o filho é
    // um só, e o neto que ele disparou também entra, uma vez.
    fn exportar(id: &str) -> Result<String, String> {
        match id {
            "filho" => Ok(r#"{"info":{"cost":1.0,"tokens":{"input":1,"output":1,"reasoning":0,"cache":{"read":0,"write":0}}},"messages":[{"info":{},"parts":[{"type":"tool","tool":"task","state":{"metadata":{"sessionId":"neto"}}}]}]}"#.into()),
            "neto" => Ok(r#"{"info":{"cost":0.5,"tokens":{"input":1,"output":1,"reasoning":0,"cache":{"read":0,"write":0}}},"messages":[]}"#.into()),
            _ => Err("?".into()),
        }
    }
    let task = r#"{"type":"tool_use","sessionID":"ses_x","part":{"type":"tool","tool":"task","state":{"status":"completed","metadata":{"sessionId":"filho"}}}}"#;
    let mut a = OpenCodeAdapter {
        exportar: Some(exportar),
        ..Default::default()
    };
    a.map_line(&oc_linha(task));
    a.map_line(&oc_linha(task));
    match &a.on_close()[0] {
        AgentEvent::Result { cost_usd, .. } => assert_eq!(*cost_usd, Some(1.5)),
        _ => panic!("esperava Result"),
    }
}

/// `step_start` REAL (opencode 1.18.32, 26/09/2026): nenhum campo de modelo.
const OC_STEP_START: &str = r#"{"type":"step_start","timestamp":1790433909173,"sessionID":"ses_f21d2b112ffevePRwc9q0v7nD1","part":{"id":"prt_0de2d59b0001Uev1b2U2jj6utS","messageID":"msg_0de2d501b001pKLanNZ6NQkGoK","sessionID":"ses_f21d2b112ffevePRwc9q0v7nD1","type":"step-start"}}"#;

#[test]
fn opencode_session_leva_o_modelo_pedido() {
    // O `session` com `model: None` apagava o modelo da conversa, e todo
    // turno do OpenCode entrou no ledger sem modelo.
    let mut r = req(Permission::Liberado, false);
    r.model = Some("opencode/kimi-k3".into());
    let mut a = OpenCodeAdapter::default();
    a.build_command(&r).unwrap();
    match &a.map_line(&oc_linha(OC_STEP_START))[0] {
        AgentEvent::Session { model, .. } => {
            assert_eq!(model.as_deref(), Some("opencode/kimi-k3"))
        }
        _ => panic!("esperava Session"),
    }
}

#[test]
fn opencode_devolve_o_acumulado_da_sessao_para_a_base_do_proximo_turno() {
    // Sem isto, um turno em Liberado entre dois turnos em Padrão ficava fora
    // da base, e o ACP cobraria esse turno de novo.
    let mut r = req(Permission::Liberado, false);
    r.resume = Some("ses_x".into());
    r.cost_baseline = Some(1.0);
    let mut a = OpenCodeAdapter::default();
    a.build_command(&r).unwrap();
    a.map_line(&oc_linha(OC_STEP_FINISH));
    match &a.on_close()[0] {
        AgentEvent::Result {
            cost_usd,
            reported_cost_total,
            ..
        } => {
            assert_eq!(*cost_usd, Some(0.0009973));
            assert_eq!(*reported_cost_total, Some(1.0 + 0.0009973));
        }
        _ => panic!("esperava Result"),
    }
    // Retomada sem base: não há acumulado a afirmar.
    r.cost_baseline = None;
    let mut b = OpenCodeAdapter::default();
    b.build_command(&r).unwrap();
    b.map_line(&oc_linha(OC_STEP_FINISH));
    match &b.on_close()[0] {
        AgentEvent::Result {
            reported_cost_total,
            ..
        } => assert_eq!(*reported_cost_total, None),
        _ => panic!("esperava Result"),
    }
}
