//! Testes do `adapters.rs`: Antigravity, canal stream-json (2 de 2). Os auxiliares moram em `adapters_tests.rs`.

use super::*;
use super::tests::*;

/// O anel de contexto é NÍVEL: o footprint do ÚLTIMO `agent_response`
/// (input + cache lido = 4793 + 12209), não a soma dos steps e não o
/// `checkpoint` (121 tokens, chamada auxiliar que derrubaria o anel).
#[test]
fn contexto_e_o_nivel_do_ultimo_agent_response() {
    let mut a = AgyAdapter::default();
    for linha in [
        AGY_INIT,
        AGY_STEP_NARRACAO,
        AGY_STEP_RESP_DONE,
        AGY_STEP_CHECKPOINT,
    ] {
        agy_linha(&mut a, linha);
    }
    let ctx = agy_linha(&mut a, AGY_RESULT)
        .iter()
        .find_map(|e| match e {
            AgentEvent::ContextUsage { tokens, .. } => Some(*tokens),
            _ => None,
        })
        .expect("o anel de contexto tem número");
    assert_eq!(ctx, 4793 + 12209);
}

/// O agy NÃO reporta USD em evento nenhum (medido 14/08/2026), então o
/// custo é ESTIMADO por tokens — e SEM modelo escolhido não há tabela pra
/// consultar: sai `Unknown` e a UI mostra só tokens, em vez de um número
/// inventado.
#[test]
fn custo_sem_modelo_escolhido_e_desconhecido_em_vez_de_chutado() {
    assert!(!AGY_CAPS.reports_cost, "nenhum evento do agy traz dólar");
    let mut a = AgyAdapter::default();
    agy_linha(&mut a, AGY_INIT);
    let evs = agy_linha(&mut a, AGY_RESULT);
    match evs.iter().find(|e| matches!(e, AgentEvent::Result { .. })) {
        Some(AgentEvent::Result {
            cost_usd,
            cost_source,
            ..
        }) => {
            assert_eq!(*cost_usd, None);
            assert!(matches!(cost_source, CostSource::Unknown));
        }
        _ => panic!("esperava Result"),
    }
}

/// O agy IGNORA `--conversation <ID>` inexistente: escreve
/// `warning: conversation "…" not found` no stderr e abre conversa NOVA em
/// silêncio (exit 0, medido 14/08/2026). Sem comparar o id pedido com o do
/// `init`, o app entregaria uma resposta SEM o contexto que o usuário
/// pediu e ainda acharia que retomou. Aqui o run é abandonado na primeira
/// linha e o run_agent recomeça com o recap.
#[test]
fn resume_ignorado_pelo_agy_vira_sessao_nao_encontrada() {
    let mut a = AgyAdapter::default();
    let mut r = req(Permission::Padrao, false);
    r.resume = Some("00000000-0000-0000-0000-000000000000".to_string());
    let args = argv(&a.build_command(&r).unwrap());
    assert!(has_pair(
        &args,
        "--conversation",
        "00000000-0000-0000-0000-000000000000"
    ));

    // o `init` volta com OUTRO id: o agy trocou de conversa por conta.
    let evs = agy_linha(&mut a, AGY_INIT);
    match &evs[..] {
        [AgentEvent::SessionNotFound { message }] => {
            assert!(
                message.contains("00000000-0000-0000-0000-000000000000"),
                "{message}"
            );
        }
        _ => panic!("esperava SÓ SessionNotFound"),
    }
    // …e NADA do turno abandonado chega ao fio (seria resposta sem o
    // contexto pedido, o oposto de estado real).
    for linha in [AGY_STEP_NARRACAO, AGY_STEP_RESP_DONE, AGY_RESULT] {
        assert!(
            agy_linha(&mut a, linha).is_empty(),
            "run abandonado é silencioso"
        );
    }
    // rede de segurança: a frase literal do stderr também classifica.
    assert!(a.is_session_not_found(
        r#"warning: conversation "00000000-0000-0000-0000-000000000000" not found"#
    ));
}

/// Resume que DEU certo: o `init` devolve o MESMO id, nada é abandonado.
#[test]
fn resume_bem_sucedido_segue_o_turno_normalmente() {
    let mut a = AgyAdapter::default();
    let mut r = req(Permission::Padrao, false);
    r.resume = Some("a165239c-dde9-493c-a60c-ccf5ac0ccffb".to_string());
    a.build_command(&r).unwrap();
    match &agy_linha(&mut a, AGY_INIT)[..] {
        [AgentEvent::Session {
            session_id, tools, ..
        }] => {
            assert_eq!(session_id, "a165239c-dde9-493c-a60c-ccf5ac0ccffb");
            assert_eq!(*tools, 56, "as 56 tools do init");
        }
        _ => panic!("esperava Session"),
    }
    assert!(!agy_linha(&mut a, AGY_STEP_RESP_DONE).is_empty());
}

/// Evento que o adapter não conhece (o `command_result` do `/credits`, e o
/// que o agy inventar amanhã) é SURFAÇADO como Unknown, nunca descartado —
/// regra de ouro do agent-runner.
#[test]
fn evento_desconhecido_vira_unknown_em_vez_de_sumir() {
    let mut a = AgyAdapter::default();
    for linha in [AGY_COMMAND_RESULT, r#"{"event":"invencao_futura","x":1}"#] {
        let evs = agy_linha(&mut a, linha);
        assert!(
            evs.iter().any(|e| matches!(e, AgentEvent::Unknown { .. })),
            "{linha} tinha que virar Unknown"
        );
    }
}

/// O comando montado pede o canal estruturado. Sem esta flag o agy volta ao
/// texto puro e o bug do inglês colado volta junto — por isso é teste, não
/// confiança.
#[test]
fn agy_pede_o_canal_estruturado_no_comando() {
    let mut a = AgyAdapter::default();
    let args = argv(&a.build_command(&req(Permission::Padrao, false)).unwrap());
    assert!(has_pair(&args, "--output-format", "stream-json"));
}

/// O teto de 5 MINUTOS que matava todo turno longo do agy (incidente
/// 2026-08-16). O default do `--print-timeout` é 5m0s e a gente nunca
/// passava a flag: 305s e 304s morreram com exit 1, 113s/158s/257s
/// passaram. Este teste existe pra que a flag não caia fora de novo —
/// perder o argumento aqui não quebra nada visível, só ressuscita o teto
/// em silêncio no primeiro turno de mais de 5 min.
#[test]
fn agy_manda_o_teto_de_print_mode_em_todo_turno() {
    let mut a = AgyAdapter::default();
    for (perm, plan) in [
        (Permission::Padrao, false),
        (Permission::Leitura, false),
        (Permission::Padrao, true),
    ] {
        let args = argv(&a.build_command(&req(perm, plan)).unwrap());
        assert!(
            has_pair(&args, "--print-timeout", "60m"),
            "sem --print-timeout o agy volta ao default de 5m0s: {args:?}"
        );
    }
}

/// Os OUTROS motores não têm a mesma classe de bug, e isso é declarado
/// aqui pra não virar folclore: `claude --help` (2.1.220) e
/// `codex exec --help` (0.147) não expõem NENHUMA flag de timeout
/// (conferido nesta máquina em 16/08/2026 — o único teto do claude é
/// `--max-budget-usd`, que é dinheiro, não tempo). Se um dia algum deles
/// ganhar teto de duração, o comando montado dele vai precisar da mesma
/// passada — e é este teste que vai estar errado primeiro.
#[test]
fn so_o_agy_tem_teto_de_duracao_a_desarmar() {
    let mut claude = ClaudeAdapter::default();
    let args = argv(
        &claude
            .build_command(&req(Permission::Padrao, false))
            .unwrap(),
    );
    assert!(!args.iter().any(|a| a.contains("timeout")));
    let mut codex = CodexAdapter::default();
    let args = argv(
        &codex
            .build_command(&req(Permission::Padrao, false))
            .unwrap(),
    );
    assert!(!args.iter().any(|a| a.contains("timeout")));
}

/// Matriz de anexo dos TRÊS adapters, num lugar só. GÊMEO do teste TS
/// `agents.caps.test.ts` — a capacidade mora em dois lugares (aqui é o gate
/// REAL; lá é o espelho que a UI usa pra validar antes do envio) e ligar só
/// um lado estraga: só Rust ⇒ o front bloqueia o que o backend aceitaria;
/// só TS ⇒ pior, o chip promete e o anexo some no spawn. Mexeu aqui, mexa lá.
#[test]
fn matriz_de_anexo_por_agent() {
    let claude = ClaudeAdapter::default();
    assert!(claude.supports_attachment(&AttachmentKind::Image));
    assert!(claude.supports_attachment(&AttachmentKind::Pdf));

    let codex = CodexAdapter::default();
    assert!(codex.supports_attachment(&AttachmentKind::Image));
    // PDF no `-i` do codex NÃO dá erro: exit 0, stderr vazio, e o arquivo
    // vira o literal "image content" no rollout. O bloqueio é nosso.
    assert!(!codex.supports_attachment(&AttachmentKind::Pdf));

    let agy = AgyAdapter::default();
    assert!(agy.supports_attachment(&AttachmentKind::Image));
    assert!(agy.supports_attachment(&AttachmentKind::Pdf));

    let opencode = OpenCodeAdapter::default();
    assert!(opencode.supports_attachment(&AttachmentKind::Image));
    assert!(!opencode.supports_attachment(&AttachmentKind::Pdf));
}

/// Teste-GÊMEO do espelho TS (src/lib/agents.slash.test.ts) — mesma
/// disciplina da matriz de anexos: `native_slash`/`command_sources` moram
/// em DOIS lugares. Aqui é a VERDADE auditada do CLI; o TS
/// (AgentDef.nativeSlash/nativeCommandSource) é o que a expansão app-side
/// e o popover "/" consultam. Correspondência: "claude" ↔ ClaudeDirs,
/// "codex" ↔ CodexPrompts, null ↔ lista vazia. Mexeu aqui, mexa lá.
#[test]
fn matriz_native_slash_e_fontes_por_agent() {
    let claude = capabilities_of("claude-code").unwrap();
    assert!(
        claude.native_slash,
        "claude-code interpreta /comando nativo"
    );
    assert_eq!(
        claude.command_sources,
        &[CommandSource::ClaudeDirs, CommandSource::ClaudePlugins]
    );
    // claude 2.1.270: o `system/init` anuncia o inventário (ADR-189).
    assert_eq!(claude.command_inventory, Some(CommandInventory::ClaudeRunInit));
    let builtins: Vec<&str> = claude.builtin_commands.iter().map(|b| b.name).collect();
    assert_eq!(builtins, vec!["context", "usage", "skill-doctor", "list-agents"]);
    assert!(claude.builtin_commands.iter().all(|b| b.source == "claude"));

    let codex = capabilities_of("codex").unwrap();
    // `codex exec` NÃO interpreta /prompt — a expansão é app-side; a
    // convenção ~/.codex/prompts segue existindo pro inventário do "/".
    assert!(!codex.native_slash);
    assert_eq!(
        codex.command_sources,
        &[CommandSource::CodexPrompts, CommandSource::CodexSkills]
    );
    // codex 0.154.0: `skills/list` no app-server, sem turno (ADR-189).
    assert_eq!(codex.command_inventory, Some(CommandInventory::CodexSkillsList));
    assert!(codex.builtin_commands.is_empty(), "builtins do codex não auditados");

    let agy = capabilities_of("agy").unwrap();
    assert!(!agy.native_slash);
    assert!(agy.command_sources.is_empty(), "agy só enxerga a casa");
    // agy 1.2.2: o `init` só traz cwd/permission_mode/tools; sem canal.
    assert_eq!(agy.command_inventory, None);
    assert!(agy.builtin_commands.is_empty());
}

/// Teste-GÊMEO do espelho TS (src/lib/agents.channels.test.ts) — mesma
/// disciplina das matrizes de anexo e de slash: `system_channel`/
/// `session_resume`/`context_mcp` moram em DOIS lugares. Aqui é a verdade
/// auditada por versão (§7.1); o TS (AgentDef.systemChannel/sessionResume/
/// contextMcp) é o que ChatPanel/send/handoff consultam pra rotear
/// doutrina, memória sintética e ponteiros de contexto. Mexeu aqui, mexa lá.
#[test]
fn matriz_de_canais_por_agent() {
    let claude = capabilities_of("claude-code").unwrap();
    // claude 2.1.219: --append-system-prompt documentado (já era o canal
    // dos nudges) + resume nativo + frota-context.
    assert!(claude.system_channel);
    assert!(claude.session_resume);
    assert!(claude.context_mcp);

    let codex = capabilities_of("codex").unwrap();
    // codex 0.146: `-c developer_instructions` existe mas NÃO re-aplica no
    // `exec resume` (empírico 03/08/2026) → sem canal são por spawn.
    assert!(!codex.system_channel);
    assert!(codex.session_resume);
    assert!(codex.context_mcp);

    let agy = capabilities_of("agy").unwrap();
    // agy 1.1.13: nenhum canal system além do `-p` (o `--help` não expõe
    // outro), e MCP só por config GLOBAL — nada por-run pra registrar o
    // frota-context. Resume, esse SIM existe: `--conversation <ID>` retomou a
    // conversa (step_index continuou 6→8 e o modelo lembrou o turno
    // anterior, medido 14/08/2026).
    assert!(!agy.system_channel);
    assert!(agy.session_resume);
    assert!(!agy.context_mcp);
}

/// Teste-GÊMEO do espelho TS (src/lib/agents.compact.test.ts) — mesma
/// disciplina das matrizes de anexo/slash/canais: `native_compact` mora em
/// DOIS lugares. Aqui é a verdade auditada por versão (§7.1); o TS
/// (AgentDef.nativeCompact) é o que o `/compactar` builtin consulta pra
/// decidir entre o turno técnico "/compact" (nativo) e a renovação de
/// sessão com recap. Mexeu aqui, mexa lá.
#[test]
fn matriz_native_compact_por_agent() {
    // claude 2.1.220: `-p --resume <sid> "/compact"` processa o comando em
    // print mode (empírico 04/08/2026 — respondeu "Not enough messages to
    // compact"); o compact_boundary resultante já vira aviso (ADR-015).
    assert!(capabilities_of("claude-code").unwrap().native_compact);
    // codex 0.146: `/compact` só no TUI; `codex exec` não expõe.
    assert!(!capabilities_of("codex").unwrap().native_compact);
    // agy 1.1.13: `/compact` não é comando nativo — `agy -p "/compact"`
    // não devolveu `command_result` (o `/credits` devolve), o texto caiu no
    // modelo como prompt qualquer (medido 14/08/2026).
    assert!(!capabilities_of("agy").unwrap().native_compact);
}

/// Teste-GÊMEO de src/lib/agents.pastasExtras.test.ts: o cartão do arquivo
/// solto promete "só neste envio o agente pode ler esta pasta" pelo espelho
/// TS, e é aqui que a promessa vira `extra_dirs` no spawn. Mexeu aqui, mexa lá.
#[test]
fn matriz_pastas_extras_por_agent() {
    assert!(capabilities_of("claude-code").unwrap().pastas_extras);
    assert!(capabilities_of("codex").unwrap().pastas_extras);
    assert!(capabilities_of("agy").unwrap().pastas_extras);
    assert!(!capabilities_of("opencode").unwrap().pastas_extras);
}

/// H1 — roteamento do conteúdo de sistema por capability (fail-open).
#[test]
fn route_system_prompt_respeita_o_canal_e_nunca_perde_conteudo() {
    let claude = capabilities_of("claude-code").unwrap();
    let codex = capabilities_of("codex").unwrap();
    // com canal: segue separado, corpo intacto.
    assert_eq!(
        route_system_prompt(claude, Some("doutrina".into()), "pedido".into()),
        (Some("doutrina".to_string()), "pedido".to_string())
    );
    // sem canal: DOBRA no corpo (nunca some) e zera o campo.
    assert_eq!(
        route_system_prompt(codex, Some("doutrina".into()), "pedido".into()),
        (None, "doutrina\n\npedido".to_string())
    );
    // vazio/None: corpo byte-idêntico nos dois mundos.
    for caps in [claude, codex] {
        assert_eq!(
            route_system_prompt(caps, None, "pedido".into()),
            (None, "pedido".to_string())
        );
        assert_eq!(
            route_system_prompt(caps, Some("  ".into()), "pedido".into()),
            (None, "pedido".to_string())
        );
    }
}

/// H1 — no claude, o system prompt do app (doutrina/persona) vem ANTES dos
/// nudges de tool no MESMO --append-system-prompt; e sai mesmo sem MCP
/// nenhum (o canal não depende do gate de MCP).
#[test]
fn claude_system_prompt_do_app_vem_antes_dos_nudges_e_fora_do_prompt() {
    let mut r = req(Permission::Padrao, false);
    r.system_prompt = Some("<doutrina>regras</doutrina>".to_string());
    r.work_gateway = Some(crate::work_gateway::GatewayConfig {
        server_bin: "/app/frota".into(),
        socket: "/tmp/frota-work.sock".into(),
    });
    let mut a = ClaudeAdapter::default();
    let args = argv(&a.build_command(&r).unwrap());
    let system = args
        .windows(2)
        .find(|pair| pair[0] == "--append-system-prompt")
        .map(|pair| pair[1].clone())
        .expect("canal system emitido");
    let doutrina = system.find("<doutrina>regras</doutrina>").unwrap();
    let nudge = system.find("frota-work").expect("nudge do frota-work no canal");
    assert!(doutrina < nudge, "identidade/regras antes da telemetria");
    // o corpo (posicional após `--`) segue só o pedido.
    assert_eq!(args.last().unwrap(), "faça X");
    // sem MCP nenhum (FusionRo desliga tudo), o canal ainda carrega a doutrina.
    let mut r2 = req(Permission::FusionRo, false);
    r2.system_prompt = Some("<doutrina>regras</doutrina>".to_string());
    let mut a2 = ClaudeAdapter::default();
    let args2 = argv(&a2.build_command(&r2).unwrap());
    assert!(args2
        .windows(2)
        .any(|pair| pair[0] == "--append-system-prompt"
            && pair[1].contains("<doutrina>regras</doutrina>")));
}

/// A regressão que este teste existe para pegar: no agy o prompt é o VALOR
/// do `-p`. Se o render_attachments rodar DEPOIS do `cmd.arg("-p")`, o
/// comando sai sintaticamente válido e o anexo some SEM ERRO — o pior
/// desfecho possível (é exatamente o que o `codex exec -i file.pdf` faz).
#[test]
fn agy_anexo_entra_no_valor_do_p_e_libera_a_pasta() {
    let mut a = AgyAdapter::default();
    let args = argv(
        &a.build_validated_command(&req_com_anexo(
            AttachmentKind::Image,
            "/tmp/anexos/c1/abc.png",
            "image/png",
        ))
        .unwrap(),
    );
    let i = args.iter().position(|x| x == "-p").unwrap();
    let prompt = &args[i + 1];
    assert!(prompt.starts_with("faça X"), "prompt original preservado");
    assert!(
        prompt.contains("/tmp/anexos/c1/abc.png"),
        "o path tem que estar DENTRO do valor do -p; veio: {prompt}"
    );
    // a pasta do anexo é liberada (senão o view_file não alcança o arquivo)
    assert!(has_pair(&args, "--add-dir", "/tmp/anexos/c1"));
    // e o --add-dir do cwd continua lá (o agy edita o repo real por causa dele)
    assert!(args.iter().filter(|x| *x == "--add-dir").count() >= 2);
}

/// Claude transporta o anexo por referência dentro do prompt. Além do path,
/// a pasta precisa ser liberada e o prompt final continua atrás de `--`.
#[test]
fn claude_anexo_entra_no_prompt_final_e_libera_a_pasta() {
    let mut a = ClaudeAdapter::default();
    let args = argv(
        &a.build_validated_command(&req_com_anexo(
            AttachmentKind::Image,
            "/tmp/anexos/c1/abc.png",
            "image/png",
        ))
        .unwrap(),
    );
    let prompt = args.last().expect("prompt final do Claude");
    assert!(prompt.starts_with("faça X"), "prompt original preservado");
    assert!(
        prompt.contains("/tmp/anexos/c1/abc.png"),
        "o path precisa chegar dentro do prompt; veio: {prompt}"
    );
    assert!(has_pair(&args, "--add-dir", "/tmp/anexos/c1"));
    assert_eq!(args.get(args.len() - 2).map(String::as_str), Some("--"));
}

/// Codex usa transporte nativo: o path viaja em `-i`, não é injetado no
/// texto, e o `--` impede o `-i` variádico de consumir o prompt.
#[test]
fn codex_anexo_viaja_em_i_sem_mudar_o_prompt_final() {
    let mut a = CodexAdapter::default();
    let args = argv(
        &a.build_validated_command(&req_com_anexo(
            AttachmentKind::Image,
            "/tmp/anexos/c1/abc.png",
            "image/png",
        ))
        .unwrap(),
    );
    assert!(has_pair(&args, "-i", "/tmp/anexos/c1/abc.png"));
    assert_eq!(args.last().map(String::as_str), Some("faça X"));
    assert_eq!(args.get(args.len() - 2).map(String::as_str), Some("--"));
    assert!(
        !args.last().unwrap().contains("/tmp/anexos/c1/abc.png"),
        "o transporte nativo não deve duplicar o path no prompt"
    );
}

#[test]
fn agy_sem_anexo_nao_mexe_no_prompt() {
    let mut a = AgyAdapter::default();
    let args = argv(&a.build_command(&req(Permission::Padrao, false)).unwrap());
    let i = args.iter().position(|x| x == "-p").unwrap();
    assert_eq!(args[i + 1], "faça X", "sem anexo o prompt é intocado");
}

/// Anexo + plan_first: o preâmbulo de planejamento e a lista de anexos
/// convivem no MESMO valor de `-p` (os dois escrevem no prompt).
#[test]
fn agy_anexo_convive_com_plan_first() {
    let mut a = AgyAdapter::default();
    let mut r = req_com_anexo(
        AttachmentKind::Pdf,
        "/tmp/anexos/c1/doc.pdf",
        "application/pdf",
    );
    r.plan_first = true;
    let args = argv(&a.build_command(&r).unwrap());
    let i = args.iter().position(|x| x == "-p").unwrap();
    let prompt = &args[i + 1];
    assert!(prompt.starts_with("MODO PLANEJAMENTO"));
    assert!(prompt.contains("/tmp/anexos/c1/doc.pdf"));
}

#[test]
fn agy_auto_liga_sandbox_como_freio() {
    // agy não tem classificador: o --sandbox é o único freio do Auto (senão
    // Auto = Liberado). skip-permissions segue (print mode trava sem ele).
    let mut a = AgyAdapter::default();
    let args = argv(&a.build_command(&req(Permission::Auto, false)).unwrap());
    assert!(args.contains(&"--sandbox".to_string()));
    assert!(args.contains(&"--dangerously-skip-permissions".to_string()));
}

#[test]
fn agy_model_passa_direto_no_argv() {
    let mut a = AgyAdapter::default();
    let mut request = req(Permission::Padrao, false);
    request.model = Some("gemini-3.6-flash-high".to_string());
    let args = argv(&a.build_command(&request).unwrap());
    assert!(has_pair(&args, "--model", "gemini-3.6-flash-high"));
}
