//! Testes do `adapters.rs`: Antigravity, canal stream-json (1 de 2). Os auxiliares moram em `adapters_tests.rs`.

use super::*;
use super::tests::*;

// ---- agy: canal estruturado (`--output-format stream-json`) ----
//
// TODAS as fixtures abaixo são linhas CRUAS de runs REAIS do agy 1.1.13
// nesta máquina em 14/08/2026 (ADR-016: fixture inventada esconde bug). O
// run que virou os `AGY_*` de um turno é o MESMO do começo ao fim —
// narração, ferramenta, resposta partida no meio da palavra e o `result`
// com o blob concatenado.
//
// Únicas edições, todas cosméticas: o `cwd` longo do sandbox virou
// "/private/tmp/agyprobe" e os links `file://` do markdown da resposta
// saíram, pra linha caber na tela. NENHUM campo, número, nome de chave,
// ordem ou emenda de texto foi tocado — é neles que os testes mexem.

/// O BUG que motivou a troca de transporte (conversa `b770e13f` do usuário,
/// 2026-07): em texto puro a resposta chegava assim, numa bolha só —
/// "I am analyzing the repository directory to locate files… I will read
/// the conversation context memory file… I will read the
/// `docs/STYLEGUIDE.md`… Se eu pudesse suspender temporariamente o viés…"
/// Quatro linhas de narração em inglês coladas no português pedido, porque
/// o stdout era a CONCATENAÇÃO de tudo que o modelo falou.
///
/// Com o stream-json a narração continua existindo (o modelo é o mesmo, e
/// não há filtro de idioma nenhum aqui) — mas ela sai amarrada ao SEU
/// step, fechada por TextStop, e o cartão da ferramenta entra entre ela e a
/// resposta. Deixa de ser cabeçalho da resposta e vira o que sempre foi:
/// o que o agent disse antes de agir.
#[test]
fn agy_avisa_quando_compacta_sozinho() {
    // Os TRÊS motores auto-compactam (medido nos binários em 24/08/2026),
    // mas só o claude avisava. A conversa perdia detalhe em silêncio nos
    // outros dois, e você só descobria quando o agente "esquecia" algo.
    let mut a = AgyAdapter::default();
    let eventos = agy_linha(&mut a, AGY_STEP_COMPACTADO);
    assert!(
        eventos.iter().any(|e| matches!(e, AgentEvent::Notice { message } if message.contains("resumiu a conversa"))),
        "sem aviso de compactação (eventos: {})", eventos.len()
    );
}

#[test]
fn agy_avisa_UMA_vez_por_run() {
    // O `compaction_info` acompanha os steps SEGUINTES: sem dedupe, o fio
    // ganharia uma linha idêntica por step até o fim do turno.
    let mut a = AgyAdapter::default();
    let n1 = agy_linha(&mut a, AGY_STEP_COMPACTADO)
        .iter()
        .filter(|e| matches!(e, AgentEvent::Notice { .. }))
        .count();
    let n2 = agy_linha(&mut a, AGY_STEP_COMPACTADO)
        .iter()
        .filter(|e| matches!(e, AgentEvent::Notice { .. }))
        .count();
    assert_eq!((n1, n2), (1, 0), "o aviso repetiu");
}

#[test]
fn agy_compactacao_real_avisa_com_antes_e_depois() {
    // agy 1.2.4, fork da conversa "nuvem": leitura de arquivo empurrou a
    // estimativa acima de 256.000, `checkpoint` de 14,9s, resposta com
    // 5.915 + 16.298 de cache. Antes disso a Frota nunca avisou nenhuma.
    assert_eq!(
        avisos_do_stream(AGY_COMPACTACAO_REAL),
        vec!["Contexto cheio: o Antigravity resumiu a conversa sozinho · 250.647 → 22.213 tokens."]
    );
}

#[test]
fn agy_compactacao_no_inicio_do_turno_avisa_so_o_depois() {
    // O run começou pelo checkpoint (a mensagem nova cruzou o limite): o
    // nível anterior é de outro processo, então só o depois é afirmado.
    assert_eq!(
        avisos_do_stream(AGY_COMPACTACAO_NO_INICIO),
        vec!["Contexto cheio: o Antigravity resumiu a conversa sozinho · agora 22.217 tokens."]
    );
}

#[test]
fn agy_acima_de_256k_reais_sem_checkpoint_nao_avisa() {
    // 257.274 tokens reais na API sem compactar: o agy decide pela
    // estimativa dele (255.444 ali), e o aviso só vem do fato.
    assert!(avisos_do_stream(AGY_SEM_COMPACTACAO_ACIMA_256K).is_empty());
}

#[test]
fn agy_checkpoint_auxiliar_com_usage_nao_avisa() {
    let mut a = AgyAdapter::default();
    let mut evs = Vec::new();
    for linha in [AGY_STEP_NARRACAO, AGY_STEP_CHECKPOINT, AGY_STEP_RESP_DONE, AGY_RESULT] {
        evs.extend(agy_linha(&mut a, linha));
    }
    assert!(!evs.iter().any(|e| matches!(e, AgentEvent::Notice { .. })));
}

#[test]
fn agy_sem_compactacao_nao_inventa_aviso() {
    // Aviso que aparece sem o fato é pior que ausência: ensina a ignorar.
    let mut a = AgyAdapter::default();
    let evs = agy_linha(&mut a, AGY_STEP_NARRACAO);
    assert!(!evs.iter().any(|e| matches!(e, AgentEvent::Notice { .. })));
}

#[test]
fn narracao_de_acao_nao_cola_na_resposta() {
    let mut a = AgyAdapter::default();
    let mut evs = Vec::new();
    for linha in [
        AGY_INIT,
        AGY_STEP_USER_INPUT,
        AGY_STEP_INFRA,
        AGY_STEP_NARRACAO,
        AGY_STEP_TOOL_ACTIVE,
        AGY_STEP_TOOL_DONE,
        AGY_STEP_CHECKPOINT,
        AGY_STEP_RESP_ACTIVE,
        AGY_STEP_RESP_DONE,
    ] {
        evs.extend(agy_linha(&mut a, linha));
    }
    let forma: Vec<&str> = evs
        .iter()
        .map(|e| match e {
            AgentEvent::Session { .. } => "session",
            AgentEvent::TextDelta { .. } => "texto",
            AgentEvent::TextStop => "fim-do-bloco",
            AgentEvent::Tool { .. } => "ferramenta",
            AgentEvent::ToolResult { .. } => "resultado",
            _ => "outro",
        })
        .collect();
    assert_eq!(
        forma,
        vec![
            "session",
            "texto",        // a narração
            "fim-do-bloco", // …fecha ANTES da ferramenta
            "ferramenta",
            "resultado",
            "texto", // a resposta, em bloco PRÓPRIO
            "texto",
            "fim-do-bloco",
        ],
        "a narração tem que ficar do lado da ferramenta, não do lado da resposta"
    );
    // steps de infra (user_input, unknown, checkpoint) não pintam cartão.
    assert!(!forma.contains(&"outro"));
}

/// A resposta vem PARTIDA NO MEIO DA PALAVRA entre o ACTIVE e o DONE do
/// mesmo step ("…scratc" + "h`]…"): a emenda tem que ser exata, e o
/// TextStop só pode fechar quando o step encerra. Se o adapter fechasse o
/// bloco a cada delta, a UI mostraria a palavra rachada.
#[test]
fn texto_partido_no_meio_da_palavra_emenda_sem_costura() {
    let mut a = AgyAdapter::default();
    agy_linha(&mut a, AGY_INIT);
    let mut texto = String::new();
    let mut fechamentos = 0;
    for linha in [AGY_STEP_RESP_ACTIVE, AGY_STEP_RESP_DONE] {
        for e in agy_linha(&mut a, linha) {
            match e {
                AgentEvent::TextDelta { text } => texto.push_str(&text),
                AgentEvent::TextStop => fechamentos += 1,
                _ => panic!("só texto neste trecho"),
            }
        }
    }
    assert!(
        texto.contains("antigravity-cli/scratch)):"),
        "a palavra rachada tem que voltar inteira: {texto}"
    );
    assert_eq!(fechamentos, 1, "um TextStop por step, no fim dele");
}

#[test]
fn agy_task_notification_e_background_task_viram_deferred_work() {
    let mut a = AgyAdapter::default();
    // Payload REAL do Antigravity / Agy ao colocar tarefa em background:
    let agy_bg_output = "Tool is running as a background task with task id: 62333af1-d9f9-4f27-a291-69323f63b1be/task-2\nTask Description: sleep 25 && echo terminou-o-sleep\nTask logs are available at: file:///tmp/task-2.log\n";
    let tool_line = serde_json::json!({
        "event": "step_update",
        "step_update": {
            "step_index": 10,
            "step_type": "tool",
            "state": "DONE",
            "tool_name": "run_command",
            "tool_info": {
                "output": agy_bg_output
            }
        }
    });
    let evs = a.map_line(&tool_line);
    assert!(evs.iter().any(|e| matches!(
        e,
        AgentEvent::DeferredWork { id, status: DeferredStatus::Running, .. } if id == "62333af1-d9f9-4f27-a291-69323f63b1be/task-2"
    )));

    // Payload REAL de notificação de conclusão de tarefa do Agy:
    let notif_payload = "[Message] timestamp=2026-09-17T13:08:05Z sender=62333af1-d9f9-4f27-a291-69323f63b1be/task-2 priority=MESSAGE_PRIORITY_HIGH content=Task id \"62333af1-d9f9-4f27-a291-69323f63b1be/task-2\" finished with result:\n\nThe command exited with code 0.\nOutput:\nterminou-o-sleep\n\nLog: file:///tmp/task-2.log";
    let user_line = serde_json::json!({
        "event": "step_update",
        "step_update": {
            "step_index": 11,
            "step_type": "system_message",
            "state": "DONE",
            "message": notif_payload
        }
    });
    let evs2 = a.map_line(&user_line);
    assert!(evs2.iter().any(|e| matches!(
        e,
        AgentEvent::DeferredWork { id, status: DeferredStatus::Completed, .. } if id == "62333af1-d9f9-4f27-a291-69323f63b1be/task-2"
    )));

    // Payload REAL de notificação de cancelamento:
    let cancel_payload = "Task id \"62333af1-d9f9-4f27-a291-69323f63b1be/task-2\" was canceled with result:\nTool execution was canceled";
    let cancel_line = serde_json::json!({
        "event": "step_update",
        "step_update": {
            "step_index": 12,
            "step_type": "user_input",
            "state": "DONE",
            "message": cancel_payload
        }
    });
    let evs3 = a.map_line(&cancel_line);
    assert!(evs3.iter().any(|e| matches!(
        e,
        AgentEvent::DeferredWork { id, status: DeferredStatus::Stopped, .. } if id == "62333af1-d9f9-4f27-a291-69323f63b1be/task-2"
    )));
}

/// No desfecho de ERRO, a última coisa que o CLI tem a dizer chega ao fio.
/// Antes o `Result` saía com `text: None` sempre e o usuário ficava só com
/// "o agent `agy` saiu com código 1" (incidente 2026-08-16) — e como o
/// stderr veio VAZIO, não havia nada a mostrar naquele caminho. Havia
/// neste.
#[test]
fn desfecho_de_erro_do_agy_leva_a_razao_dele_pro_fio() {
    let cru: serde_json::Value = serde_json::from_str(AGY_RESULT_ERRO).unwrap();
    assert_eq!(
        cru.pointer("/result/response").unwrap().as_str(),
        Some(""),
        "a fixture só serve se o `response` do ERROR for mesmo vazio"
    );
    let mut a = AgyAdapter::default();
    agy_linha(&mut a, AGY_INIT);
    let evs = agy_linha(&mut a, AGY_RESULT_ERRO);
    let (ok, text) = evs
        .iter()
        .find_map(|e| match e {
            AgentEvent::Result { ok, text, .. } => Some((*ok, text.clone())),
            _ => None,
        })
        .expect("o result fecha o turno");
    assert!(!ok);
    assert_eq!(text.as_deref(), Some("timeout waiting for response"));
}

/// Incidente real de 20/08/2026: `manage_task(kill)` perdeu a corrida para
/// o timer, que já estava DONE. O tool_result continua vermelho e auditável,
/// mas uma resposta final posterior prova que o turno terminou. O agy ainda
/// fechou com ERROR; elevá-lo a falha geral fez o cartão vermelho mentir.
#[test]
fn erro_local_seguido_de_resposta_final_nao_vira_falha_geral() {
    const TOOL_ERROR: &str = r#"{"event":"step_update","step_update":{"step_index":108,"state":"ERROR","step_type":"tool","tool_name":"manage_task","tool_info":{"parameters":{"Action":"kill","TaskId":"task-104"},"error":{"type":"TOOL_ERROR","message":"cannot kill task \"task-104\": task is not running (status: DONE)"}}}}"#;
    const FINAL_DONE: &str = r#"{"event":"step_update","step_update":{"step_index":109,"state":"DONE","step_type":"agent_response","text_delta":"Relatório final entregue.","usage":{"input_tokens":10,"output_tokens":4,"cache_read_tokens":0}}}"#;
    const STICKY_RESULT: &str = r#"{"event":"result","result":{"status":"ERROR","response":"Relatório final entregue.","error":"cannot kill task \"task-104\": task is not running (status: DONE)","usage":{"input_tokens":10,"output_tokens":4,"cache_read_tokens":0}}}"#;

    let mut a = AgyAdapter::default();
    agy_linha(&mut a, AGY_INIT);
    let tool = agy_linha(&mut a, TOOL_ERROR);
    assert!(matches!(
        tool.as_slice(),
        [AgentEvent::ToolResult { ok: false, .. }]
    ));
    agy_linha(&mut a, FINAL_DONE);
    let result = agy_linha(&mut a, STICKY_RESULT);
    assert!(matches!(
        result
            .iter()
            .find(|e| matches!(e, AgentEvent::Result { .. })),
        Some(AgentEvent::Result {
            ok: true,
            text: None,
            ..
        })
    ));
}

/// Nas retomadas seguintes o agy repetiu o erro do timer sem nenhuma nova
/// tool falhar. Resposta DONE deste run vence estado acumulado da conversa.
#[test]
fn erro_sticky_de_turno_anterior_nao_contamina_resposta_nova() {
    const FINAL_DONE: &str = r#"{"event":"step_update","step_update":{"step_index":120,"state":"DONE","step_type":"agent_response","text_delta":"A nova solicitação foi concluída.","usage":{"input_tokens":20,"output_tokens":6,"cache_read_tokens":10}}}"#;
    const STICKY_RESULT: &str = r#"{"event":"result","result":{"status":"ERROR","response":"A nova solicitação foi concluída.","error":"cannot kill task \"task-104\": task is not running (status: DONE)","usage":{"input_tokens":20,"output_tokens":6,"cache_read_tokens":10}}}"#;

    let mut a = AgyAdapter::default();
    agy_linha(&mut a, AGY_INIT);
    agy_linha(&mut a, FINAL_DONE);
    let result = agy_linha(&mut a, STICKY_RESULT);
    assert!(matches!(
        result
            .iter()
            .find(|e| matches!(e, AgentEvent::Result { .. })),
        Some(AgentEvent::Result { ok: true, .. })
    ));
}

/// O contrário do conserto acima, e o risco que ele abriu: uma resposta
/// que FALHOU não é prova de recuperação. O agy fecha o step de resposta em
/// ERROR igual ao de ferramenta, então aceitar "qualquer estado terminal"
/// pintava de verde um turno cortado no meio (rate limit, transporte) sem
/// ferramenta nenhuma envolvida. Cartão vermelho mentindo já era ruim;
/// verde mentindo é pior, porque ninguém volta pra conferir.
#[test]
fn resposta_que_terminou_em_erro_nao_conta_como_recuperacao() {
    const RESP_ERROR: &str = r#"{"event":"step_update","step_update":{"step_index":7,"state":"ERROR","step_type":"agent_response","text_delta":"Comecei a responder e","usage":{"input_tokens":5,"output_tokens":2,"cache_read_tokens":0}}}"#;
    const RESULT: &str = r#"{"event":"result","result":{"status":"ERROR","response":"","error":"resource exhausted","usage":{"input_tokens":5,"output_tokens":2,"cache_read_tokens":0}}}"#;

    let mut a = AgyAdapter::default();
    agy_linha(&mut a, AGY_INIT);
    agy_linha(&mut a, RESP_ERROR);
    let result = agy_linha(&mut a, RESULT);
    assert!(matches!(
        result
            .iter()
            .find(|e| matches!(e, AgentEvent::Result { .. })),
        Some(AgentEvent::Result { ok: false, .. })
    ));
}

/// Narração anterior à ferramenta não é resposta final. Se a tool
/// falha e o stream termina sem nova resposta, o erro continua terminal.
#[test]
fn erro_de_ferramenta_sem_resposta_posterior_continua_terminal() {
    const RESULT: &str = r#"{"event":"result","result":{"status":"ERROR","response":"","error":"Permission denied for read_file","usage":{"input_tokens":1,"output_tokens":1,"cache_read_tokens":0}}}"#;
    let mut a = AgyAdapter::default();
    agy_linha(&mut a, AGY_INIT);
    agy_linha(&mut a, AGY_STEP_NARRACAO);
    agy_linha(&mut a, AGY_STEP_TOOL_ERROR);
    let result = agy_linha(&mut a, RESULT);
    assert!(matches!(
        result
            .iter()
            .find(|e| matches!(e, AgentEvent::Result { .. })),
        Some(AgentEvent::Result {
            ok: false,
            text: Some(_),
            ..
        })
    ));
}

/// E o extrator não fabrica frase quando o CLI não disse nada.
#[test]
fn erro_sem_texto_nenhum_nao_inventa_motivo() {
    use serde_json::json;
    // ERROR mudo: None honesto (o fallback do exit code é quem fala).
    assert_eq!(agy_result_error(&json!({ "status": "ERROR" })), None);
    assert_eq!(
        agy_result_error(&json!({ "status": "ERROR", "error": "   ", "response": "" })),
        None
    );
    // `response` é a reserva quando o `error` não vem.
    assert_eq!(
        agy_result_error(&json!({ "status": "ERROR", "response": "sem crédito" })).as_deref(),
        Some("sem crédito")
    );
    // SUCCESS nunca entrega o blob por esta porta.
    assert_eq!(
        agy_result_error(&json!({ "status": "SUCCESS", "response": "narração colada" })),
        None
    );
}

/// `result.response` É o blob do incidente (narração + resposta grudadas) —
/// a fixture prova. Por isso o `Result` de SUCESSO sai com `text: None`: o
/// fio já recebeu o texto pelos steps, separado, e reenviar o blob
/// desfaria a separação toda. (No ERRO a regra é outra, e é o caso acima:
/// lá o `response` vem vazio e o que importa é o `error`.)
#[test]
fn blob_do_result_nunca_vira_resposta() {
    let cru: serde_json::Value = serde_json::from_str(AGY_RESULT).unwrap();
    let blob = cru.pointer("/result/response").unwrap().as_str().unwrap();
    assert!(
        blob.starts_with("Vou listar o conteúdo") && blob.contains("Existem exatamente 3"),
        "a fixture só serve se o `response` do agy for mesmo a concatenação"
    );
    let mut a = AgyAdapter::default();
    agy_linha(&mut a, AGY_INIT);
    let evs = agy_linha(&mut a, AGY_RESULT);
    let text = evs.iter().find_map(|e| match e {
        AgentEvent::Result { text, .. } => Some(text.clone()),
        _ => None,
    });
    assert_eq!(text, Some(None), "o Result do agy não carrega o blob");
}

/// Ferramenta = cartão com nome, parâmetros e desfecho. É o conserto do
/// "motor calado" — antes o turno inteiro do agy era uma bolha de texto e
/// a missão não tinha ação nenhuma pra listar.
#[test]
fn ferramenta_vira_cartao_com_parametros_e_saida() {
    let mut a = AgyAdapter::default();
    agy_linha(&mut a, AGY_INIT);
    let abre = agy_linha(&mut a, AGY_STEP_TOOL_ACTIVE);
    match &abre[0] {
        AgentEvent::Tool {
            id, name, input, ..
        } => {
            assert_eq!(name, "list_dir");
            assert_eq!(id, "agy-step-3");
            assert_eq!(
                input.get("DirectoryPath").and_then(|x| x.as_str()),
                Some("/Users/viniciusmachado/.gemini/antigravity-cli/scratch")
            );
        }
        _ => panic!("esperava Tool no ACTIVE"),
    }
    let fecha = agy_linha(&mut a, AGY_STEP_TOOL_DONE);
    match &fecha[0] {
        AgentEvent::ToolResult {
            id,
            ok,
            text,
            lines,
            ..
        } => {
            // MESMO id do abre: é o step_index que casa os dois (o agy não
            // dá id de tool call nenhum).
            assert_eq!(id, "agy-step-3");
            assert!(ok);
            assert_eq!(text, "doc.pdf\nshape.png\nsmall-circle.png");
            assert_eq!(*lines, 3);
        }
        _ => panic!("esperava ToolResult no fechamento"),
    }
}

/// Ferramenta que falhou: `state: ERROR` + o motivo em `error.message`.
/// Falha de ferramenta é INFORMAÇÃO (o usuário precisa ver por que o agent
/// não conseguiu), então vira ToolResult com ok=false, nunca cartão vazio.
#[test]
fn ferramenta_com_erro_carrega_o_motivo() {
    let mut a = AgyAdapter::default();
    agy_linha(&mut a, AGY_INIT);
    let evs = agy_linha(&mut a, AGY_STEP_TOOL_ERROR);
    match &evs[0] {
        AgentEvent::ToolResult { ok, text, .. } => {
            assert!(!ok);
            assert!(text.contains("Permission denied for read_file"), "{text}");
        }
        _ => panic!("esperava ToolResult no fechamento"),
    }
}

/// ADR-033 no agy: `result.usage` é o ACUMULADO DA CONVERSA. As duas
/// fixtures são os `result` dos DOIS turnos da MESMA conversa
/// (a8d1cd15…, medidos 14/08/2026): 33000 → 50586 de input, e o step novo
/// do 2º turno custou 17586 — a diferença EXATA. Lido como se fosse do
/// turno, o 2º turno cobraria 50586 e o custo cresceria em quadrado.
#[test]
fn usage_acumulado_da_conversa_vira_gasto_do_turno() {
    const RESULT_T1: &str = r#"{"event":"result","result":{"conversation_id":"a8d1cd15-ea3f-4bf2-ad4b-1dbc311559fc","status":"SUCCESS","response":"…","duration_seconds":3.751145,"num_turns":1,"usage":{"input_tokens":33000,"output_tokens":1335,"thinking_tokens":1158,"cache_read_tokens":0,"total_tokens":34335}}}"#;
    const RESULT_T2: &str = r#"{"event":"result","result":{"conversation_id":"a8d1cd15-ea3f-4bf2-ad4b-1dbc311559fc","status":"SUCCESS","response":"…","duration_seconds":104.625251,"num_turns":2,"usage":{"input_tokens":50586,"output_tokens":1647,"thinking_tokens":1455,"cache_read_tokens":0,"total_tokens":52233}}}"#;

    fn tokens(evs: &[AgentEvent]) -> (u64, u64, Option<crate::agent::CumulativeUsage>) {
        evs.iter()
            .find_map(|e| match e {
                AgentEvent::Result {
                    input_tokens,
                    output_tokens,
                    cumulative_usage,
                    ..
                } => Some((*input_tokens, *output_tokens, *cumulative_usage)),
                _ => None,
            })
            .expect("todo turno fecha com Result")
    }

    // 1º turno: conversa nova, sem baseline → o acumulado JÁ é o do turno.
    let mut t1 = AgyAdapter::default();
    agy_linha(&mut t1, AGY_INIT);
    let (inp1, out1, cum1) = tokens(&agy_linha(&mut t1, RESULT_T1));
    assert_eq!((inp1, out1), (33000, 1335));
    let cum1 = cum1.expect("o acumulado cru volta pro front persistir");

    // 2º turno: MESMA conversa, com o baseline do turno anterior.
    let mut t2 = AgyAdapter::default();
    let mut r = req(Permission::Padrao, false);
    r.resume = Some("a8d1cd15-ea3f-4bf2-ad4b-1dbc311559fc".to_string());
    r.usage_baseline = Some(cum1);
    t2.build_command(&r).unwrap();
    agy_linha(
        &mut t2,
        &AGY_INIT.replace(
            "a165239c-dde9-493c-a60c-ccf5ac0ccffb",
            "a8d1cd15-ea3f-4bf2-ad4b-1dbc311559fc",
        ),
    );
    let (inp2, out2, _) = tokens(&agy_linha(&mut t2, RESULT_T2));
    assert_eq!(
        (inp2, out2),
        (50586 - 33000, 1647 - 1335),
        "o turno paga o DELTA, nunca o acumulado (ADR-033)"
    );
}
