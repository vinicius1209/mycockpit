//! Testes da fumaça de modelos: as saídas REAIS de cada CLI. Saíram de
//! `model_smoke.rs` pela catraca de tamanho.
use super::*;

/// claude 2.1.220, `--model claude-naoexiste-9-9` (recortado nos campos
/// que a classificação lê).
const CLAUDE_SLUG_INVALIDO: &str = r#"{"is_error":true,"duration_api_ms":0,"num_turns":1,"stop_reason":"stop_sequence","session_id":"98b60080-efbe-40d4-8b5b-8af07c14d62f","total_cost_usd":0,"modelUsage":{},"terminal_reason":"api_error","subtype":"success","api_error_status":404,"result":"There's an issue with the selected model (claude-naoexiste-9-9). It may not exist or you may not have access to it. Run --model to pick a different model.","type":"result","duration_ms":778}"#;

/// claude 2.1.220, `--model haiku --tools ""` — a rodada de $0,00055.
const CLAUDE_SLUG_VALIDO: &str = r#"{"is_error":false,"duration_api_ms":1465,"num_turns":1,"stop_reason":"end_turn","session_id":"78fb5f4e-06a1-4548-ac03-32acfcd0c883","total_cost_usd":0.000548,"usage":{"input_tokens":163,"output_tokens":77},"modelUsage":{"claude-haiku-4-5-20251001":{"inputTokens":163,"outputTokens":77,"costUSD":0.000548,"contextWindow":200000,"maxOutputTokens":32000,"canonicalModel":"claude-haiku-4-5","provider":"firstParty"}},"terminal_reason":"completed","subtype":"success","api_error_status":null,"result":"k","type":"result","duration_ms":2153}"#;

/// codex 0.147, `-m gpt-9.9-naoexiste` (JSONL literal).
const CODEX_SLUG_INVALIDO: &str = r#"{"type":"thread.started","thread_id":"01a0009e-f7b4-7622-9f79-bbf2ebb90bb1"}
{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Model metadata for `gpt-9.9-naoexiste` not found. Defaulting to fallback metadata; this can degrade performance and cause issues."}}
{"type":"turn.started"}
{"type":"error","message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'gpt-9.9-naoexiste' model is not supported when using Codex with a ChatGPT account.\"}}"}
{"type":"turn.failed","error":{"message":"{\"type\":\"error\",\"status\":400,\"error\":{\"type\":\"invalid_request_error\",\"message\":\"The 'gpt-9.9-naoexiste' model is not supported when using Codex with a ChatGPT account.\"}}"}}"#;

/// codex 0.147, `-m gpt-5.6-luna` (JSONL literal).
const CODEX_SLUG_VALIDO: &str = r#"{"type":"thread.started","thread_id":"01a0009f-737e-7cf2-80fd-2b32b3b34529"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"Got it. What would you like to work on?"}}
{"type":"turn.completed","usage":{"input_tokens":11652,"cached_input_tokens":8960,"output_tokens":15}}"#;

/// agy 1.1.13, `--model gemini-9.9-naoexiste` (recusa LOCAL, custo zero).
const AGY_SLUG_INVALIDO: &str = r#"{"conversation_id":"","status":"ERROR","response":"","error":"invalid model selection (--model \"gemini-9.9-naoexiste\" --effort \"\"): model gemini-9.9-naoexiste is not recognized as a known model or custom model in settings\nAvailable models:\n  Gemini 3.7 Flash (High)\n  Gemini 3.7 Flash (Medium)","duration_seconds":0,"num_turns":0,"usage":{"input_tokens":0,"output_tokens":0}}"#;

/// agy 1.1.13, `--model gemini-3.7-flash-low`.
const AGY_SLUG_VALIDO: &str = r#"{"conversation_id":"6aeb464b-f4e3-4a89-99de-9ed6f96e2a72","status":"SUCCESS","response":"How can I help you today? Feel free to share what project or task you'd like to work on!\n","duration_seconds":3.475172,"num_turns":1,"usage":{"input_tokens":15969,"output_tokens":28,"total_tokens":15997}}"#;

fn result(agent: &str, model: &str, outcome: SmokeOutcome) -> SmokeResult {
    SmokeResult {
        agent: agent.into(),
        model: model.into(),
        outcome,
        detail: "detalhe".into(),
        cli_version: Some("0.0.0".into()),
        context_window: None,
        catalog_context: None,
        canonical_model: None,
        checked_at: 1_000,
    }
}

#[test]
fn claude_slug_inexistente_e_404_vira_unknown_slug_com_a_frase_do_cli() {
    let r = read_claude(CLAUDE_SLUG_INVALIDO);
    assert_eq!(r.outcome, SmokeOutcome::UnknownSlug);
    assert!(r.detail.contains("claude-naoexiste-9-9"));
    assert_eq!(r.context_window, None);
}

#[test]
fn claude_slug_valido_vira_ok_e_traz_contexto_e_slug_canonico() {
    let r = read_claude(CLAUDE_SLUG_VALIDO);
    assert_eq!(r.outcome, SmokeOutcome::Ok);
    assert_eq!(r.context_window, Some(200_000));
    assert_eq!(r.canonical_model.as_deref(), Some("claude-haiku-4-5"));
}

#[test]
fn claude_401_e_403_falam_de_autenticacao_e_status_estranho_e_nao_sei() {
    let com_status =
        |s: &str| format!(r#"{{"is_error":true,"api_error_status":{s},"result":"recusado"}}"#);
    assert_eq!(
        read_claude(&com_status("401")).outcome,
        SmokeOutcome::AuthRejected
    );
    assert_eq!(
        read_claude(&com_status("403")).outcome,
        SmokeOutcome::AuthRejected
    );
    // 500 não diz nada sobre o slug: "não sei", nunca veredito.
    assert_eq!(
        read_claude(&com_status("500")).outcome,
        SmokeOutcome::Unreachable
    );
}

#[test]
fn codex_avisa_que_nao_conhece_o_slug_antes_de_chamar_e_isso_vence_o_400() {
    // O MESMO 400 aparece pro slug inexistente e pro ID de API puro
    // (`gpt-5.6`): o que separa os dois de uma recusa de auth é o aviso de
    // metadata. Sem essa leitura, tudo viraria "auth-rejected" errado.
    let r = read_codex(CODEX_SLUG_INVALIDO);
    assert_eq!(r.outcome, SmokeOutcome::UnknownSlug);
    assert!(r.detail.contains("Model metadata for"));
}

#[test]
fn codex_turno_concluido_vira_ok() {
    assert_eq!(read_codex(CODEX_SLUG_VALIDO).outcome, SmokeOutcome::Ok);
}

#[test]
fn codex_recusa_400_sem_aviso_de_metadata_e_a_sua_autenticacao() {
    // Slug que o CLI CONHECE mas o servidor recusa: é a auth que não
    // alcança — a frase que o M3 vai mostrar pro humano.
    let jsonl = r#"{"type":"turn.started"}
{"type":"turn.failed","error":{"message":"{\"type\":\"error\",\"status\":400,\"error\":{\"message\":\"The 'gpt-5.5' model is not supported when using Codex with a ChatGPT account.\"}}"}}"#;
    let r = read_codex(jsonl);
    assert_eq!(r.outcome, SmokeOutcome::AuthRejected);
    assert!(r.detail.contains("ChatGPT account"));
}

#[test]
fn codex_sem_desfecho_reconhecivel_e_nao_sei() {
    assert_eq!(
        read_codex("{\"type\":\"thread.started\"}").outcome,
        SmokeOutcome::Unreachable
    );
    assert_eq!(read_codex("").outcome, SmokeOutcome::Unreachable);
}

#[test]
fn agy_recusa_local_de_slug_vira_unknown_slug_sem_a_lista_inteira_no_detalhe() {
    let r = read_agy(AGY_SLUG_INVALIDO);
    assert_eq!(r.outcome, SmokeOutcome::UnknownSlug);
    assert!(r.detail.contains("is not recognized as a known model"));
    // O agy despeja a lista de modelos no erro; o detalhe fica na 1ª linha.
    assert!(!r.detail.contains("Gemini 3.7 Flash"));
}

#[test]
fn agy_success_vira_ok() {
    assert_eq!(read_agy(AGY_SLUG_VALIDO).outcome, SmokeOutcome::Ok);
}

#[test]
fn saida_que_nao_e_json_nunca_vira_veredito() {
    // Fail-open na leitura: CLI que cuspiu lixo não condena slug nenhum.
    for r in [
        read_claude("Segmentation fault"),
        read_agy("<html>502</html>"),
    ] {
        assert_eq!(r.outcome, SmokeOutcome::Unreachable);
        assert!(!r.outcome.is_verdict());
    }
}

#[test]
fn contexto_diferente_do_catalogo_vira_context_mismatch() {
    let base = read_claude(CLAUDE_SLUG_VALIDO);
    // O caso do plano: o CLI diz um teto, o catálogo (API) diz outro.
    let r = apply_context_check(base.clone(), Some(1_000_000));
    assert_eq!(r.outcome, SmokeOutcome::ContextMismatch);
    assert!(r.detail.contains("200000") && r.detail.contains("1000000"));
    // Igual = segue ok; sem número dos dois lados, nada muda.
    assert_eq!(
        apply_context_check(base.clone(), Some(200_000)).outcome,
        SmokeOutcome::Ok
    );
    assert_eq!(apply_context_check(base, None).outcome, SmokeOutcome::Ok);
}

#[test]
fn contexto_nao_transforma_uma_recusa_em_mismatch() {
    let recusa = read_claude(CLAUDE_SLUG_INVALIDO);
    assert_eq!(
        apply_context_check(recusa, Some(1_000_000)).outcome,
        SmokeOutcome::UnknownSlug
    );
}

#[test]
fn unreachable_nao_promove_nem_rebaixa_um_veredito_gravado() {
    let mut rows = vec![result("codex", "gpt-5.4", SmokeOutcome::Ok)];
    record_result(
        &mut rows,
        result("codex", "gpt-5.4", SmokeOutcome::Unreachable),
    );
    assert_eq!(rows.len(), 1);
    assert_eq!(
        rows[0].outcome,
        SmokeOutcome::Ok,
        "\"não sei\" não apaga o que se sabia"
    );

    // …mas um veredito NOVO substitui o antigo (o slug foi aposentado).
    record_result(
        &mut rows,
        result("codex", "gpt-5.4", SmokeOutcome::UnknownSlug),
    );
    assert_eq!(rows[0].outcome, SmokeOutcome::UnknownSlug);
}

#[test]
fn tentativa_sem_veredito_anterior_e_gravada_em_vez_de_sumir() {
    let mut rows: Vec<SmokeResult> = Vec::new();
    record_result(
        &mut rows,
        result("agy", "gemini-9", SmokeOutcome::Unreachable),
    );
    assert_eq!(rows.len(), 1, "\"tentamos e não deu\" também é estado");
    assert!(!rows[0].outcome.is_verdict());
}

#[test]
fn resultado_de_outro_motor_nao_sobrescreve_o_mesmo_slug() {
    let mut rows = vec![result("agy", "claude-sonnet-4-6", SmokeOutcome::Ok)];
    record_result(
        &mut rows,
        result(
            "claude-code",
            "claude-sonnet-4-6",
            SmokeOutcome::UnknownSlug,
        ),
    );
    assert_eq!(rows.len(), 2, "o veredito é do par (motor, slug)");
}

#[test]
fn rodada_seguida_e_barrada_pelo_freio_anti_laco() {
    assert!(
        round_allowed(None, 10_000),
        "a primeira rodada sempre passa"
    );
    assert!(!round_allowed(Some(10_000), 10_000 + ROUND_COOLDOWN_MS - 1));
    assert!(round_allowed(Some(10_000), 10_000 + ROUND_COOLDOWN_MS));
}

#[test]
fn so_o_unreachable_deixa_de_ser_veredito() {
    for o in [
        SmokeOutcome::Ok,
        SmokeOutcome::AuthRejected,
        SmokeOutcome::UnknownSlug,
        SmokeOutcome::ContextMismatch,
    ] {
        assert!(o.is_verdict(), "{o:?} decide algo sobre o slug");
    }
    assert!(!SmokeOutcome::Unreachable.is_verdict());
}

/// Prova MANUAL da fumaça de ponta a ponta (spawna o CLI de verdade e
/// gasta um token por candidato — por isso `#[ignore]`, mesma disciplina
/// do `fetch_real_da_conta` em claude_usage.rs). É a forma reprodutível de
/// re-auditar o dialeto quando um CLI mudar de saída:
///
///   cargo test -- --ignored --nocapture fumaca_real
///
/// Desfechos observados em 14/08/2026 (as fixtures acima vieram DESTA
/// rodada): claude haiku → Ok (contexto 200000), claude-naoexiste-9-9 →
/// UnknownSlug; codex gpt-5.6-luna → Ok, gpt-9.9-naoexiste → UnknownSlug;
/// agy gemini-3.7-flash-low → Ok, gemini-9.9-naoexiste → UnknownSlug.
#[tokio::test]
#[ignore = "spawna os CLIs reais e gasta um token por candidato"]
async fn fumaca_real_nesta_maquina() {
    let cwd = std::env::temp_dir();
    let casos: [(&str, &str); 8] = [
        ("claude-code", "haiku"),
        ("claude-code", "claude-naoexiste-9-9"),
        ("codex", "gpt-5.6-luna"),
        ("codex", "gpt-9.9-naoexiste"),
        ("agy", "gemini-3.7-flash-low"),
        ("agy", "gemini-9.9-naoexiste"),
        // OpenCode usa o dialeto `provider/model`, então o par de teste
        // precisa do provedor junto — slug sem provedor nem chega ao motor.
        ("opencode", "google/gemini-2.5-flash-lite"),
        ("opencode", "google/modelo-que-nao-existe"),
    ];
    for (agent, model) in casos {
        let dialect = capabilities_of(agent)
            .and_then(|c| c.model_smoke)
            .expect("motor declara dialeto de fumaça");
        let r = match dialect {
            ModelSmokeDialect::ClaudePrintJson => smoke_claude(model).await,
            ModelSmokeDialect::CodexExecJson => smoke_codex(model, &cwd).await,
            ModelSmokeDialect::AgyPrintJson => smoke_agy(model).await,
            ModelSmokeDialect::OpenCodeRunJson => smoke_opencode(model).await,
        };
        eprintln!(
            "{agent:<12} {model:<24} → {:?}  ctx={:?}  canonical={:?}\n             {}",
            r.outcome,
            r.context_window,
            r.canonical_model,
            primeira_linha(&r.detail)
        );
    }
}

// ── OpenCode: as três saídas abaixo foram CAPTURADAS na máquina em
//    26/08/2026, não inventadas.
#[test]
fn fumaca_do_opencode_roda_sem_ferramenta_e_sem_o_prompt_do_agente() {
    let args = opencode_smoke_args("opencode/claude-fable-5-1");
    assert!(args
        .windows(2)
        .any(|w| w == ["--agent", OPENCODE_SMOKE_AGENT]));
    assert!(args.contains(&"--pure"));
    assert_eq!(args.last(), Some(&SMOKE_PROMPT));
    let cfg: Value = serde_json::from_str(&opencode_smoke_config()).unwrap();
    let agente = &cfg["agent"][OPENCODE_SMOKE_AGENT];
    assert_eq!(agente["tools"]["*"], false);
    assert_eq!(agente["prompt"], SMOKE_SYSTEM);
}

#[test]
fn opencode_step_finish_e_sucesso() {
    let stdout = r#"{"type":"step_start","sessionID":"ses_x","part":{}}
{"type":"step_finish","sessionID":"ses_x","part":{"reason":"stop","tokens":{"input":5499,"output":1,"reasoning":212,"cache":{"read":36220,"write":0}},"cost":0.0009973}}"#;
    let r = read_opencode(stdout, "");
    assert!(matches!(r.outcome, SmokeOutcome::Ok));
}

#[test]
fn opencode_slug_inexistente_vem_do_STDERR() {
    // O caso que motivou a captura própria: stdout VAZIO e o veredito no
    // stderr. Sem olhar lá, isto viraria "unreachable" (não sei) em vez de
    // "unknown-slug" — e é essa a pergunta que o curador faz.
    let stderr = r#"[08:33:59.261] ERROR (#10945): failed { ref: "err_4670685c", error: { providerID: "google", modelID: "modelo-que-nao-existe", suggestions: [], _tag: "ProviderModelNotFoundError" } }"#;
    let r = read_opencode("", stderr);
    assert!(matches!(r.outcome, SmokeOutcome::UnknownSlug));
}

#[test]
fn opencode_recusa_do_provedor_e_unreachable_nao_slug_ruim() {
    // Saldo zerado no `opencode-go` (401). O slug EXISTE; quem recusou foi
    // o provedor. Marcar como slug ruim tiraria do seletor um modelo bom.
    let stdout = r#"{"type":"error","sessionID":"ses_x","error":{"name":"APIError","data":{"message":"Insufficient balance. Manage your billing here: https://opencode.ai/workspace/x/billing","statusCode":401,"isRetryable":false}}}"#;
    let r = read_opencode(stdout, "");
    assert!(matches!(r.outcome, SmokeOutcome::Unreachable));
    assert!(r.detail.contains("Insufficient balance"));
}

#[test]
fn opencode_sem_saida_nenhuma_nao_acusa_o_slug() {
    let r = read_opencode("", "");
    assert!(matches!(r.outcome, SmokeOutcome::Unreachable));
}

#[test]
fn desfecho_serializa_no_vocabulario_do_plano() {
    // Mexeu aqui, mexa no espelho TS (lib/modelSmoke.ts).
    let json = serde_json::to_string(&vec![
        SmokeOutcome::Ok,
        SmokeOutcome::AuthRejected,
        SmokeOutcome::UnknownSlug,
        SmokeOutcome::ContextMismatch,
        SmokeOutcome::Unreachable,
    ])
    .unwrap();
    assert_eq!(
        json,
        r#"["ok","auth-rejected","unknown-slug","context-mismatch","unreachable"]"#
    );
}
