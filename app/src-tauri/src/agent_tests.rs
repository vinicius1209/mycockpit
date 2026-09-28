//! Testes do `agent.rs` (runner): preâmbulo de MCP, retomada, validação do
//! conteúdo do run e o one-shot do Claude.

use super::{
    claude_oneshot, compose_mcp_preamble, process_failure_fallback, restart_prompt,
    validate_run_content, AgentEvent, Outcome,
};

/// X2 — vazio significa ausência de conteúdo efetivo, não ausência de
/// texto: a Frota aceita uma imagem/PDF como a mensagem inteira.
#[test]
fn pedido_vazio_so_passa_quando_ha_anexo_util() {
    assert!(validate_run_content("faça X", 0).is_ok());
    assert!(validate_run_content("", 1).is_ok());
    assert!(validate_run_content("  \n\t", 2).is_ok());
    assert!(validate_run_content("", 0).is_err());
    assert!(validate_run_content("  \n\t", 0).is_err());
}

/// S4 (revisão D1): `--tools ""` NÃO cobre MCP — o one-shot com
/// `no_mcp=true` TEM que carregar o strict-mcp-config vazio, senão um MCP
/// server de escopo user com tools de efeito colateral deixaria o lead
/// agendado AGIR sem humano olhando.
#[test]
fn oneshot_no_mcp_estripa_todo_mcp() {
    let cmd = claude_oneshot("haiku", "/tmp", "oi", "text", true);
    let args: Vec<String> = cmd
        .as_std()
        .get_args()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    assert!(args.iter().any(|a| a == "--strict-mcp-config"));
    let pos = args.iter().position(|a| a == "--mcp-config").unwrap();
    assert_eq!(args[pos + 1], "{\"mcpServers\":{}}");
    // e segue sem tools nativas também
    let tools = args.iter().position(|a| a == "--tools").unwrap();
    assert_eq!(args[tools + 1], "");
}

/// Regressão do fantasma (hooks-plan §4.7): TODA meta-tarefa `claude -p`
/// (juiz do Fusion, sugestões) tem que carregar FROTA_RUN_ID — senão,
/// com hooks de status instalados, o POST chega ao gateway sem o header e
/// o Painel/tray mostram uma sessão EXTERNA fantasma na pasta do projeto
/// (dupla contagem da própria meta-tarefa do app). Vale pros dois formatos.
#[test]
fn oneshot_carrega_run_env_pra_nao_virar_sessao_fantasma() {
    for format in ["json", "text"] {
        let cmd = claude_oneshot("haiku", "/tmp", "oi", format, true);
        let env = cmd
            .as_std()
            .get_envs()
            .find(|(k, _)| *k == std::ffi::OsStr::new(crate::hook_sessions::RUN_ENV))
            .and_then(|(_, v)| v)
            .map(|v| v.to_string_lossy().into_owned());
        assert_eq!(
            env.as_deref(),
            Some("oneshot"),
            "meta-tarefa {format} sem RUN_ENV vira fantasma no Painel"
        );
    }
}

/// 15/09/2026: o helper utilitário tinha 0 sucessos em semanas porque cada
/// one-shot pagava os hooks globais do usuário e, no helper, o raciocínio do
/// modelo. Todo one-shot desliga hooks; só o helper desliga o raciocínio.
#[test]
fn oneshot_sem_hooks_e_helper_sem_raciocinio() {
    let args_de = |cmd: &tokio::process::Command| -> Vec<String> {
        cmd.as_std().get_args().map(|a| a.to_string_lossy().into_owned()).collect()
    };
    let env_de = |cmd: &tokio::process::Command, chave: &str| -> Option<String> {
        cmd.as_std()
            .get_envs()
            .find(|(k, _)| *k == std::ffi::OsStr::new(chave))
            .and_then(|(_, v)| v)
            .map(|v| v.to_string_lossy().into_owned())
    };
    let juiz = claude_oneshot("opus", "/tmp", "decida", "json", true);
    let args = args_de(&juiz);
    let pos = args.iter().position(|a| a == "--settings").expect("one-shot sem hooks");
    assert_eq!(args[pos + 1], "{\"disableAllHooks\":true}");
    assert_eq!(env_de(&juiz, "MAX_THINKING_TOKENS"), None, "o juiz mantém o raciocínio");

    let helper = crate::agent::utility_helper_command("haiku", "/tmp", "commit");
    assert!(args_de(&helper).iter().any(|a| a == "--settings"));
    assert_eq!(env_de(&helper, "MAX_THINKING_TOKENS").as_deref(), Some("0"));
}

/// Caps de um motor 1º-turno-só (corpo do prompt, com resume): o codex.
fn caps_corpo() -> &'static crate::adapters::Capabilities {
    crate::adapters::capabilities_of("codex").unwrap()
}

fn plano_playwright() -> crate::mcp_control::McpRunPlan {
    crate::mcp_control::McpRunPlan {
        managed: true,
        selected: vec![crate::mcp_control::McpRuntimeServer {
            runtime_name: "playwright".into(),
            display_name: "Playwright".into(),
            launch: Default::default(),
            tool_names: Vec::new(),
        }],
        ..Default::default()
    }
}

#[test]
fn preambulo_sem_plano_gerenciado_e_byte_identico_ao_de_hoje() {
    // Fail-open: run não gerenciado não muda um byte do prompt do 1º turno.
    let plan = crate::mcp_control::McpRunPlan::default();
    assert_eq!(
        compose_mcp_preamble("faça X".into(), false, &plan, caps_corpo(), false, None),
        ("faça X".to_string(), None)
    );
    let (com_work, fp) =
        compose_mcp_preamble("faça X".into(), true, &plan, caps_corpo(), false, None);
    assert!(com_work.starts_with("TELEMETRIA DE TRABALHO: "));
    assert!(com_work.ends_with("\n\n---\n\nfaça X"));
    assert!(!com_work.contains("Ferramentas MCP desta sessão"));
    assert_eq!(fp, None, "sem MCP selecionado não há o que carimbar");
    // Gerenciado mas sem selecionado (tudo caiu em notice): idem.
    let vazio = crate::mcp_control::McpRunPlan {
        managed: true,
        ..Default::default()
    };
    assert_eq!(
        compose_mcp_preamble("faça X".into(), false, &vazio, caps_corpo(), false, None),
        ("faça X".to_string(), None)
    );
}

#[test]
fn cadastro_global_anuncia_ativacao_e_desativacao_em_uma_sessao_retomada() {
    let plan = crate::mcp_control::McpRunPlan::default();
    let caps = &crate::adapters::AGY_CAPS;
    let (first, fp) = compose_mcp_preamble("continue".into(), true, &plan, caps, true, None);
    assert!(first.contains("TELEMETRIA DE TRABALHO"));
    assert_eq!(fp.as_deref(), Some("work-channel:on"));
    let (same, next) =
        compose_mcp_preamble("continue".into(), true, &plan, caps, true, fp.as_deref());
    assert_eq!(same, "continue");
    assert_eq!(next, None);
    let (off, fp) =
        compose_mcp_preamble("continue".into(), false, &plan, caps, true, fp.as_deref());
    assert!(off.contains("frota-work está indisponível"));
    assert!(!off.contains("MCPs externos"));
    assert_eq!(fp.as_deref(), Some("work-channel:off"));
    let (again, _) =
        compose_mcp_preamble("continue".into(), true, &plan, caps, true, fp.as_deref());
    assert!(again.contains("TELEMETRIA DE TRABALHO"));
}

#[test]
fn preambulo_gerenciado_anuncia_runtime_e_display_de_cada_mcp() {
    let plan = plano_playwright();
    let (out, fp) =
        compose_mcp_preamble("faça X".into(), true, &plan, caps_corpo(), false, None);
    assert!(out.starts_with(
        "Ferramentas MCP desta sessão:\n- playwright: Playwright (MCP roteado pela Frota)"
    ));
    // Bloco único: o anúncio e a telemetria do frota-work compartilham o
    // mesmo preâmbulo, com um único separador antes do prompt.
    assert!(out.contains("TELEMETRIA DE TRABALHO: "));
    assert_eq!(out.matches("\n\n---\n\n").count(), 1);
    assert!(out.ends_with("\n\n---\n\nfaça X"));
    assert_eq!(fp, plan.fingerprint(), "anunciou → devolve o carimbo");
}

/// H2 — motor com resume (codex): o 2º turno da MESMA sessão não repete
/// nem o anúncio nem a telemetria (o resume carrega o 1º turno).
#[test]
fn preambulo_com_resume_nao_repete_nudge_nem_anuncio() {
    let plan = plano_playwright();
    let last = plan.fingerprint();
    let (out, fp) = compose_mcp_preamble(
        "continua".into(),
        true,
        &plan,
        caps_corpo(),
        true,
        last.as_deref(),
    );
    assert_eq!(
        out, "continua",
        "corpo limpo: o resume já carrega o preâmbulo"
    );
    assert_eq!(fp, None, "nada anunciado, nada a carimbar");
}

/// H2 — o PLANO mudou mid-conversa (usuário ligou um binding): o turno com
/// resume re-anuncia SÓ o bloco de MCPs (a telemetria não muda, não volta).
#[test]
fn preambulo_reanuncia_quando_o_plano_de_mcp_muda() {
    let plan = plano_playwright();
    let (out, fp) = compose_mcp_preamble(
        "continua".into(),
        true,
        &plan,
        caps_corpo(),
        true,
        Some("fingerprint-do-plano-antigo"),
    );
    assert!(out.starts_with("Ferramentas MCP desta sessão:"));
    assert!(out.contains("- playwright: Playwright"));
    assert!(
        !out.contains("TELEMETRIA DE TRABALHO"),
        "telemetria é 1º-turno-só: o plano mudar não a traz de volta"
    );
    assert_eq!(fp, plan.fingerprint(), "re-anunciou → carimbo novo");
    // fingerprint desconhecido (restart do app zerou o ledger efêmero):
    // anuncia também — fail-open pra visibilidade, converge em 1 turno.
    let (out2, _) =
        compose_mcp_preamble("continua".into(), false, &plan, caps_corpo(), true, None);
    assert!(out2.starts_with("Ferramentas MCP desta sessão:"));
}

/// H2 (review gate, item 3) — desligar TODOS os bindings também é mudança
/// de plano: N→0 re-anuncia UMA vez ("nenhuma", pro modelo não chamar tool
/// morta) e carimba; 0→0 não repete; e 0 sem histórico (1º turno/restart)
/// segue byte-idêntico ao de sempre (não há anúncio anterior a desmentir).
#[test]
fn preambulo_reanuncia_n_para_zero_e_silencia_zero_para_zero() {
    let cheio = plano_playwright();
    let vazio = crate::mcp_control::McpRunPlan {
        managed: true,
        ..Default::default()
    };
    // N→0: o último carimbo é do plano CHEIO → anuncia o desligamento
    let last_cheio = cheio.fingerprint();
    let (out, fp) = compose_mcp_preamble(
        "continua".into(),
        false,
        &vazio,
        caps_corpo(),
        true,
        last_cheio.as_deref(),
    );
    assert!(out.contains("Ferramentas MCP desta sessão: nenhuma"));
    assert!(out.contains("não chame mais as tools deles"));
    assert_eq!(
        fp,
        vazio.fingerprint(),
        "anunciou o vazio → carimbo do vazio"
    );
    // 0→0: o carimbo já é o do vazio → silêncio
    let last_vazio = vazio.fingerprint();
    let (out2, fp2) = compose_mcp_preamble(
        "continua".into(),
        false,
        &vazio,
        caps_corpo(),
        true,
        last_vazio.as_deref(),
    );
    assert_eq!(out2, "continua");
    assert_eq!(fp2, None);
    // 0 sem histórico (1º turno, ou restart com ledger zerado): sem
    // anúncio — não há anúncio anterior a desmentir, corpo byte-idêntico.
    for resuming in [false, true] {
        let (out3, fp3) =
            compose_mcp_preamble("faça X".into(), false, &vazio, caps_corpo(), resuming, None);
        assert_eq!(out3, "faça X");
        assert_eq!(fp3, None);
    }
    // e 0→algo: ligar um binding depois do desligamento re-anuncia o cheio
    let (out4, fp4) = compose_mcp_preamble(
        "continua".into(),
        false,
        &cheio,
        caps_corpo(),
        true,
        last_vazio.as_deref(),
    );
    assert!(out4.starts_with("Ferramentas MCP desta sessão:\n- playwright"));
    assert_eq!(fp4, cheio.fingerprint());
}

/// H2 — motor com canal system (claude): o corpo fica SEMPRE limpo; o
/// anúncio e a telemetria já viajam no `--append-system-prompt` do adapter,
/// re-enviados a cada spawn.
#[test]
fn preambulo_some_do_corpo_em_motor_com_canal_system() {
    let caps = crate::adapters::capabilities_of("claude-code").unwrap();
    assert!(caps.system_channel);
    let plan = plano_playwright();
    for resuming in [false, true] {
        let (out, fp) =
            compose_mcp_preamble("faça X".into(), true, &plan, caps, resuming, None);
        assert_eq!(out, "faça X");
        assert_eq!(fp, None);
    }
}

/// H2 — motor sem canal E sem resume: toda sessão é nova, o preâmbulo
/// volta em todo turno (custo honesto; não há alternativa).
///
/// As capabilities aqui são SINTÉTICAS de propósito. O agy era o exemplo
/// vivo desta terceira cadência até a 1.1.13 destravar
/// `--conversation <ID>` (medido 14/08/2026, ver AGY_CAPS) — e hoje nenhum
/// motor registrado cai neste ramo. O ramo continua no código porque o
/// próximo motor pode cair nele, então continua testado: amarrar o teste a
/// um agent registrado foi o que fez ele quebrar quando a VERDADE do CLI
/// mudou, sendo que o comportamento sob teste não mudou nada.
#[test]
fn preambulo_sem_resume_volta_em_todo_turno() {
    let sem_canal_nem_resume = crate::adapters::Capabilities {
        system_channel: false,
        session_resume: false,
        ..crate::adapters::AGY_CAPS
    };
    let caps = &sem_canal_nem_resume;
    let plan = plano_playwright();
    let last = plan.fingerprint();
    let (out, _) =
        compose_mcp_preamble("continua".into(), true, &plan, caps, true, last.as_deref());
    assert!(out.starts_with("Ferramentas MCP desta sessão:"));
    assert!(out.contains("TELEMETRIA DE TRABALHO"));
}

#[test]
fn restart_sem_fallback_mantem_prompt_original() {
    assert_eq!(
        restart_prompt(None, "continue a tarefa"),
        "continue a tarefa"
    );
}

#[test]
fn restart_com_fallback_prefixa_recap_com_separador() {
    let recap = "Recap: estávamos revisando o adapter do Codex.\nTranscript: .frota/transcripts/abc.jsonl";
    assert_eq!(
        restart_prompt(Some(recap), "continue a tarefa"),
        format!("{recap}\n\n---\n\ncontinue a tarefa")
    );
}

#[test]
fn restart_com_fallback_vazio_ainda_prefixa() {
    // String vazia é responsabilidade do front não mandar; se mandar, o
    // separador ainda delimita (nunca corrompe o prompt original).
    assert_eq!(restart_prompt(Some(""), "oi"), "\n\n---\n\noi");
}

#[test]
fn terminal_estruturado_tem_precedencia_sobre_exit_code_e_stderr() {
    let adapter = crate::adapters::resolve("claude-code").unwrap();
    let outcome = Outcome {
        cancelled: false,
        success: false,
        code: Some(1),
        stderr: "erro secundário do processo".into(),
        stderr_truncated: false,
        emitiu_saida: true,
        sandbox_runner_hint: None,
        session_not_found: false,
        terminal_incident: true,
        session_id: None,
        context_reported: false,
    };

    assert!(process_failure_fallback(&*adapter, "claude-code", &outcome).is_none());
}

#[test]
fn runner_classifica_stderr_no_adapter_quando_stream_nao_teve_terminal() {
    let adapter = crate::adapters::resolve("claude-code").unwrap();
    let outcome = Outcome {
        cancelled: false,
        success: false,
        code: Some(1),
        stderr: "You've hit your session limit · resets 1:50pm (America/Sao_Paulo)".into(),
        stderr_truncated: false,
        emitiu_saida: true,
        sandbox_runner_hint: None,
        session_not_found: false,
        terminal_incident: false,
        session_id: None,
        context_reported: false,
    };

    assert!(matches!(
        process_failure_fallback(&*adapter, "claude-code", &outcome),
        Some(AgentEvent::LimitReached {
            reset_hint: Some(reset),
            ..
        }) if reset == "1:50pm (America/Sao_Paulo)"
    ));
}

#[test]
fn runner_mantem_erro_generico_quando_nao_ha_terminal_nem_limite() {
    let adapter = crate::adapters::resolve("claude-code").unwrap();
    let outcome = Outcome {
        cancelled: false,
        success: false,
        code: Some(17),
        stderr: String::new(),
        stderr_truncated: false,
        emitiu_saida: true,
        sandbox_runner_hint: None,
        session_not_found: false,
        terminal_incident: false,
        session_id: None,
        context_reported: false,
    };

    assert!(matches!(
        process_failure_fallback(&*adapter, "claude-code", &outcome),
        Some(AgentEvent::Error { message })
            if message == "o agent `claude-code` saiu com código 17"
    ));
}
