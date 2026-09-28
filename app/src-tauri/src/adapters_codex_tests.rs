//! Testes do `adapters.rs`: Codex (exec). Os auxiliares moram em `adapters_tests.rs`.

use super::*;
use super::tests::*;

// ---- codex ----

#[test]
fn codex_plan_first_forca_sandbox_read_only() {
    // até no Liberado (danger-full-access) o turno de plano vira read-only
    for perm in [Permission::Padrao, Permission::Liberado] {
        let mut a = CodexAdapter::default();
        let args = argv(&a.build_command(&req(perm, true)).unwrap());
        assert!(has_pair(&args, "-s", "read-only"));
    }
    // sem plan_first, o mapeamento do modo segue valendo
    let mut a = CodexAdapter::default();
    let args = argv(&a.build_command(&req(Permission::Padrao, false)).unwrap());
    assert!(has_pair(&args, "-s", "workspace-write"));
}

#[test]
fn codex_auto_workspace_write_e_approval_never() {
    let mut a = CodexAdapter::default();
    let args = argv(&a.build_command(&req(Permission::Auto, false)).unwrap());
    assert!(has_pair(&args, "-s", "workspace-write"));
    assert!(has_pair(&args, "-c", "approval_policy=never"));
}

#[test]
fn codex_context_gateway_vem_antes_do_exec_e_nao_toca_config_global() {
    let mut r = req(Permission::Padrao, false);
    r.context_gateway = Some(crate::context_gateway::GatewayConfig {
        server_bin: "/app/frota".into(),
        root: "/repo".into(),
        conv_id: "c1".into(),
        db_path: None,
    });
    let mut a = CodexAdapter::default();
    let args = argv(&a.build_command(&r).unwrap());
    let exec = args.iter().position(|x| x == "exec").unwrap();
    let cfg = args
        .iter()
        .position(|x| x.contains("mcp_servers.frota-context.command"))
        .unwrap();
    assert!(cfg < exec);
    assert!(args.iter().any(|x| x.contains("context-server")));
}

#[test]
fn codex_catalogo_de_plugins_vem_antes_do_exec() {
    let mut r = req(Permission::Padrao, false);
    r.tool_gateway = Some(crate::tool_gateway::GatewayConfig {
        server_bin: "/app/frota".into(),
        socket: "/tmp/frota-tools.sock".into(),
    });
    let mut a = CodexAdapter::default();
    let args = argv(&a.build_command(&r).unwrap());
    let exec = args.iter().position(|arg| arg == "exec").unwrap();
    let config = args
        .iter()
        .position(|arg| arg.contains("mcp_servers.frota-tools.command"))
        .unwrap();
    assert!(config < exec);
    assert!(args.iter().any(|arg| arg.contains("tool-server")));
    assert!(args.iter().any(|arg| arg.contains("/tmp/frota-tools.sock")));
}

#[test]
fn codex_managed_mcp_desliga_origem_e_injeta_runtime_antes_do_exec() {
    let mut r = req(Permission::Padrao, false);
    r.mcp_plan = crate::mcp_control::McpRunPlan {
        managed: true,
        selected: vec![external_mcp()],
        disabled_codex_names: vec!["paper".into()],
        ..Default::default()
    };
    let mut a = CodexAdapter::default();
    let args = argv(&a.build_command(&r).unwrap());
    let exec = args.iter().position(|arg| arg == "exec").unwrap();
    let disable = args
        .iter()
        .position(|arg| arg == "mcp_servers.paper.enabled=false")
        .unwrap();
    let runtime = args
        .iter()
        .position(|arg| arg.contains("mcp_servers.mcx-claude-hostinger.command"))
        .unwrap();
    assert!(disable < exec);
    assert!(runtime < exec);
    assert!(args
        .iter()
        .any(|arg| arg.contains("/opt/mcp/hostinger-wrapper")));
}

/// REGRESSÃO (codex 0.147, 13/08/2026): `-c` depois do subcomando `exec`
/// SUBSTITUI os overrides globais em vez de somar — e leva junto a tabela
/// `mcp_servers`. O turno rodava sem frota-work e sem frota-context, e o agente
/// respondia "o MCP frota-work não está exposto nesta sessão" (bug real do
/// usuário, conversa do prime-sales-hub). Provado isolando a variável: com
/// `-c model_reasoning_effort` DEPOIS de `exec`, zero MCP server sobe;
/// antes, os dois sobem e o effort segue aplicado. Este teste vale por
/// TODO `-c`, inclusive os que ainda não existem.
#[test]
fn codex_nenhum_override_de_config_depois_do_subcomando_exec() {
    let mut r = req(Permission::Auto, false);
    r.effort = Some("high".into());
    r.model = Some("gpt-5.6-sol".into());
    r.context_gateway = Some(crate::context_gateway::GatewayConfig {
        server_bin: "/app/frota".into(),
        root: "/repo".into(),
        conv_id: "c1".into(),
        db_path: None,
    });
    r.work_gateway = Some(crate::work_gateway::GatewayConfig {
        server_bin: "/app/frota".into(),
        socket: "/tmp/frota-work-regressao.sock".into(),
    });
    let mut a = CodexAdapter::default();
    let args = argv(&a.build_command(&r).unwrap());
    let exec = args.iter().position(|x| x == "exec").unwrap();
    let depois: Vec<&String> = args
        .iter()
        .skip(exec)
        .enumerate()
        .filter(|(i, arg)| *arg == "-c" || (*i > 0 && arg.starts_with("mcp_servers.")))
        .map(|(_, arg)| arg)
        .collect();
    assert!(
        depois.is_empty(),
        "nenhum -c pode vir depois de `exec` (os MCPs evaporam): {depois:?}"
    );
    // e os dois overrides continuam existindo — ANTES do subcomando.
    assert!(has_pair(&args, "-c", "model_reasoning_effort=high"));
    assert!(has_pair(&args, "-c", "approval_policy=never"));
    let effort = args
        .iter()
        .position(|x| x == "model_reasoning_effort=high")
        .unwrap();
    assert!(effort < exec, "o effort tem que vir antes do subcomando");
}

#[test]
fn codex_auto_com_plan_first_nao_emite_approval_never() {
    // plan_first força read-only e não deve carregar o approval=never do Auto.
    let mut a = CodexAdapter::default();
    let args = argv(&a.build_command(&req(Permission::Auto, true)).unwrap());
    assert!(has_pair(&args, "-s", "read-only"));
    assert!(!has_pair(&args, "-c", "approval_policy=never"));
}

#[test]
fn codex_command_completed_emite_tool_e_resultado() {
    let item = serde_json::json!({
        "id": "item-1",
        "type": "command_execution",
        "command": "/bin/zsh -lc \"bun test\"",
        "aggregated_output": "2 testes passaram\npronto",
        "exit_code": 0,
        "status": "completed"
    });
    let events = map_codex_item(&item, None);
    assert_eq!(events.len(), 2);
    match &events[0] {
        AgentEvent::Tool { id, name, .. } => {
            assert_eq!(id, "item-1");
            assert_eq!(name, "Bash");
        }
        _ => panic!("esperava Tool"),
    }
    match &events[1] {
        AgentEvent::ToolResult {
            id,
            ok,
            text,
            lines,
            images,
        } => {
            assert_eq!(id, "item-1");
            assert!(images.is_empty());
            assert!(*ok);
            assert_eq!(text, "2 testes passaram\npronto");
            assert_eq!(*lines, 2);
        }
        _ => panic!("esperava ToolResult"),
    }
}

#[test]
fn codex_command_started_e_updated_ficam_visiveis_sem_duplicar_identidade() {
    // Linha real do dialeto `codex exec --json` 0.147, reduzida apenas nos
    // campos que o adapter consome. O status/exit_code nulos são como o CLI
    // publica enquanto a ação ainda está em andamento.
    let line = serde_json::json!({
        "type": "item.started",
        "item": {
            "id": "item_0",
            "type": "command_execution",
            "command": "/bin/zsh -lc 'bun test'",
            "aggregated_output": "",
            "exit_code": null,
            "status": "in_progress"
        }
    });
    let mut adapter = CodexAdapter::default();
    for kind in ["item.started", "item.updated"] {
        let mut event = line.clone();
        event["type"] = serde_json::Value::String(kind.into());
        let events = adapter.on_stdout_line(&event.to_string());
        assert!(matches!(
            events.as_slice(),
            [AgentEvent::Tool { id, name, .. }]
                if id == "item_0" && name == "Bash"
        ));
    }
}

#[test]
fn codex_item_started_desconhecido_degrada_para_unknown() {
    let events = map_codex_item_activity(&serde_json::json!({
        "id": "item-new",
        "type": "future_action"
    }));
    assert!(matches!(events.as_slice(), [AgentEvent::Unknown { .. }]));
}

// ---- ADR-033: usage do codex é ACUMULADO DA THREAD ----

#[test]
fn codex_segundo_turno_cobra_o_delta_e_nao_o_acumulado_da_thread() {
    // Modelo EXPLÍCITO nos dois turnos: desde que o adapter parou de
    // chutar "gpt-5.5" sem fonte, `CodexAdapter::default()` + `req()` sem
    // `.model` dão `self.model: None` o turno inteiro → custo sai sem
    // preço, o que mascararia a asserção de DELTA que este teste existe
    // pra provar. O que se testa aqui é a subtração do baseline (ADR-033),
    // não a resolução de modelo — essa tem teste próprio.
    // Turno 1: thread nova, sem baseline → o acumulado É o turno.
    let mut a1 = CodexAdapter::default();
    let mut r1 = req(Permission::Padrao, false);
    r1.model = Some("gpt-5.5".to_string());
    a1.build_command(&r1).unwrap();
    a1.map_line(&serde_json::json!({ "type": "thread.started", "thread_id": "t-1" }));
    let evs1 = a1.map_line(&turn_completed(TURNO_1));
    let (i1, o1, c1, usd1, cum1) = result_of(&evs1);
    assert_eq!((i1, c1, o1), (17494, 9984, 6));
    assert_eq!(cum1.map(|c| c.input), Some(17494));

    // Turno 2: MESMA thread via resume, com o acumulado do turno 1 como
    // baseline (é o que o front persistiu do `cumulative_usage`).
    let mut a2 = CodexAdapter::default();
    let mut r = req(Permission::Padrao, false);
    r.model = Some("gpt-5.5".to_string());
    r.resume = Some("t-1".to_string());
    r.usage_baseline = Some(crate::agent::CumulativeUsage {
        input: TURNO_1.0,
        cached_input: TURNO_1.1,
        output: TURNO_1.2,
    });
    a2.build_command(&r).unwrap();
    a2.map_line(&serde_json::json!({ "type": "thread.started", "thread_id": "t-1" }));
    let evs2 = a2.map_line(&turn_completed(TURNO_2));
    let (i2, o2, c2, usd2, cum2) = result_of(&evs2);
    assert_eq!(
        (i2, c2, o2),
        (17511, 17152, 6),
        "o 2º turno tem que reportar o DELTA (35005-17494), não o acumulado"
    );
    // o acumulado cru volta intacto pro front persistir.
    assert_eq!(
        cum2.map(|c| (c.input, c.cached_input, c.output)),
        Some(TURNO_2)
    );
    // custo do delta ≈ US$0,0106 (gpt-5.5); pelo acumulado seriam ~US$0,053.
    assert!(
        usd2 < 0.02,
        "custo do 2º turno saiu do acumulado (US$ {usd2:.4}); esperado ~US$ 0,0106"
    );
    assert!(usd1 > 0.0 && usd2 > 0.0);
    // O delta é gasto DO TURNO e pode somar várias chamadas. Não vira
    // ContextUsage: o runner lê o footprint da última chamada no rollout.
    assert!(!evs1
        .iter()
        .any(|e| matches!(e, AgentEvent::ContextUsage { .. })));
    assert!(!evs2
        .iter()
        .any(|e| matches!(e, AgentEvent::ContextUsage { .. })));
}

#[test]
fn codex_thread_nova_descarta_o_baseline_em_vez_de_zerar_o_turno() {
    let mut a = CodexAdapter::default();
    let mut r = req(Permission::Padrao, false);
    // modelo explícito: sem chute de default, custo sem modelo sai sem
    // preço, e a asserção `usd > 0.0` deste teste é sobre o RESET do
    // baseline, não sobre resolução de modelo.
    r.model = Some("gpt-5.5".to_string());
    r.resume = Some("t-antiga".to_string());
    r.usage_baseline = Some(crate::agent::CumulativeUsage {
        input: 500_000,
        cached_input: 400_000,
        output: 9_000,
    });
    a.build_command(&r).unwrap();
    // o resume falhou lá atrás e o CLI abriu OUTRA thread: o contador
    // recomeça do zero, o baseline antigo não descreve mais nada.
    a.map_line(&serde_json::json!({ "type": "thread.started", "thread_id": "t-nova" }));
    let evs = a.map_line(&turn_completed(TURNO_1));
    let (i, o, c, usd, _) = result_of(&evs);
    assert_eq!(
        (i, c, o),
        (17494, 9984, 6),
        "1º turno da thread nova vale inteiro"
    );
    assert!(usd > 0.0);
}

#[test]
fn codex_contador_menor_que_o_baseline_nunca_vira_negativo() {
    // Sem `thread.started` (linha perdida/CLI mudo) e com acumulado MENOR
    // que o baseline: clamp em 0. Subcontar é honesto; supercontar é o bug.
    let mut a = CodexAdapter::default();
    let mut r = req(Permission::Padrao, false);
    r.resume = Some("t-1".to_string());
    r.usage_baseline = Some(crate::agent::CumulativeUsage {
        input: TURNO_2.0,
        cached_input: TURNO_2.1,
        output: TURNO_2.2,
    });
    a.build_command(&r).unwrap();
    let evs = a.map_line(&turn_completed(TURNO_1));
    let (i, o, c, usd, cum) = result_of(&evs);
    assert_eq!((i, c, o), (0, 0, 0));
    assert_eq!(usd, 0.0);
    // e o acumulado cru continua indo pro front (a verdade do provider).
    assert_eq!(cum.map(|c| c.input), Some(TURNO_1.0));
    assert!(!evs
        .iter()
        .any(|e| matches!(e, AgentEvent::ContextUsage { .. })));
}

/// O Claude reporta usage E custo POR TURNO: dois results idênticos
/// continuam idênticos (nada de delta) e nunca devolvem acumulado.
#[test]
fn claude_reported_fica_intocado_pela_correcao_do_codex() {
    let mut a = ClaudeAdapter::default();
    let linha = serde_json::json!({
        "type": "result",
        "is_error": false,
        "result": "pronto",
        "total_cost_usd": 0.42,
        "usage": {
            "input_tokens": 1200,
            "output_tokens": 300,
            "cache_read_input_tokens": 900,
            "cache_creation_input_tokens": 100
        }
    });
    for _ in 0..2 {
        let evs = a.map_line(&linha);
        match &evs[0] {
            AgentEvent::Result {
                input_tokens,
                output_tokens,
                cache_read,
                cost_usd,
                cumulative_usage,
                ..
            } => {
                assert_eq!(
                    (*input_tokens, *output_tokens, *cache_read),
                    (1200, 300, 900)
                );
                assert_eq!(*cost_usd, Some(0.42));
                assert!(cumulative_usage.is_none());
            }
            _ => panic!("esperava Result"),
        }
    }
}

/// Teste-GÊMEO do espelho TS (`agents.usage.test.ts`): quem reporta usage
/// ACUMULADO da thread. Mexeu aqui, mexa lá.
#[test]
fn matriz_cumulative_usage_por_agent() {
    // codex 0.146: `turn.completed.usage` = total da thread (17494 → 35005
    // em dois turnos triviais via resume, medido 04/08/2026).
    assert!(capabilities_of("codex").unwrap().cumulative_usage);
    // claude 2.1.220: o `result` traz usage e USD DO TURNO.
    assert!(!capabilities_of("claude-code").unwrap().cumulative_usage);
    // agy 1.1.13: `result.usage` também é o total da CONVERSA — medido nos
    // dois caminhos de resume em 14/08/2026 (43296 → 45684 com
    // `--continue`, 33000 → 50586 com `--conversation`, e o step novo
    // fechando a diferença ao token). Antes era `false` porque a 1.1.9 não
    // reportava usage nenhum, não porque o número fosse por turno.
    assert!(capabilities_of("agy").unwrap().cumulative_usage);
}

/// Teste-GÊMEO de `agents.contextUsage.test.ts`: de onde vem o footprint
/// da última chamada. A cota da conta (`usage_window`) é outro contrato.
#[test]
fn matriz_context_usage_por_agent() {
    assert_eq!(
        capabilities_of("claude-code").unwrap().context_usage,
        Some(ContextUsageSource::Stream)
    );
    assert_eq!(
        capabilities_of("codex").unwrap().context_usage,
        Some(ContextUsageSource::CodexRollout)
    );
    assert_eq!(
        capabilities_of("agy").unwrap().context_usage,
        Some(ContextUsageSource::Stream)
    );
}

/// Teste-GÊMEO de `agents.contextCeiling.test.ts` (ADR-196): quem diz onde
/// compacta sozinho. Declarar sem resume é prometer uma sessão que a sonda
/// não sabe retomar.
#[test]
fn matriz_context_ceiling_por_agent() {
    assert_eq!(
        capabilities_of("claude-code").unwrap().context_ceiling,
        Some(ContextCeilingProbe::ClaudeControlRequest)
    );
    assert_eq!(
        capabilities_of("codex").unwrap().context_ceiling,
        Some(ContextCeilingProbe::CodexConfigCatalog)
    );
    assert_eq!(
        capabilities_of("agy").unwrap().context_ceiling,
        Some(ContextCeilingProbe::AgyGenerationRecord)
    );
    assert_eq!(capabilities_of("opencode").unwrap().context_ceiling, None);
    for agent in ["claude-code", "codex", "agy", "opencode"] {
        let caps = capabilities_of(agent).unwrap();
        assert!(
            caps.context_ceiling.is_none() || caps.session_resume,
            "{agent}: context_ceiling exige session_resume"
        );
    }
}

/// Teste-GÊMEO do espelho TS (`agents.telemetry.test.ts`): quem narra o
/// turno em EVENTOS (e portanto pode listar ação a ação) e de quem existe
/// custo em DÓLAR. É o par que a superfície de missão consulta pra trocar
/// de componente (feed de ações ↔ bloco de motor calado) e pra decidir
/// entre "—", "não mede" e o número — nunca por nome de agent. Mexeu aqui,
/// mexa lá.
#[test]
fn matriz_telemetria_por_agent() {
    // claude 2.1.220: stream-json com evento por ação + `total_cost_usd`.
    assert!(capabilities_of("claude-code").unwrap().structured_output);
    assert!(capabilities_of("claude-code").unwrap().reports_cost);
    // codex 0.147: `exec --json` é JSONL de eventos, mas sem dólar — o
    // custo do codex sai ESTIMADO por tokens.
    assert!(capabilities_of("codex").unwrap().structured_output);
    assert!(!capabilities_of("codex").unwrap().reports_cost);
    // agy 1.1.13: o `-p` que o app roda agora é
    // `--output-format stream-json` — NDJSON com um step por ação, então
    // existe feed de ações. Dólar segue sem existir em nenhum evento
    // (medido 14/08/2026): o custo do agy sai ESTIMADO por tokens, igual
    // ao codex.
    assert!(capabilities_of("agy").unwrap().structured_output);
    assert!(!capabilities_of("agy").unwrap().reports_cost);
    // COERÊNCIA (a mesma cobrada no espelho TS): dólar por turno chega
    // dentro do evento final do stream; motor que só cospe texto não tem
    // onde entregar número, e prometê-lo seria inventar.
    for agent in registered_agents() {
        let caps = capabilities_of(agent).unwrap();
        assert!(
            !caps.reports_cost || caps.structured_output,
            "{agent}: reports_cost sem structured_output"
        );
    }
}

/// Teste-GÊMEO do espelho TS (`agents.usageWindow.test.ts`): quem expõe a
/// JANELA DE USO do plano e por qual dialeto. Mexeu aqui, mexa lá.
#[test]
fn matriz_usage_window_por_agent() {
    // claude 2.1.220: statusline pipeia rate_limits por turno (payload
    // real capturado 12/08/2026).
    assert_eq!(
        capabilities_of("claude-code").unwrap().usage_window,
        Some(UsageWindowSource::ClaudeStatusline)
    );
    // codex 0.146: account/rateLimits/read no app-server (provado na mão
    // 12/08/2026).
    assert_eq!(
        capabilities_of("codex").unwrap().usage_window,
        Some(UsageWindowSource::CodexAppServer)
    );
    // agy 1.1.13: era None enquanto a única fonte conhecida era o
    // `/credits` (saldo absoluto, sem percentual nem reset). O `/usage`
    // derrubou o motivo em 16/08/2026: `command.data` traz grupos ×
    // buckets com fração restante, tipo de janela e reset — o contrato
    // inteiro — e sem consumir turno.
    assert_eq!(
        capabilities_of("agy").unwrap().usage_window,
        Some(UsageWindowSource::AgyPrintCommand)
    );

    // …e QUEM O VIGIA PERGUNTA (o poll). O claude diverge de propósito: a
    // statusline é push e só existe em sessão interativa (em `-p` o script
    // nunca roda, empírico 12/08/2026), então o poll fala com a CONTA.
    assert_eq!(
        capabilities_of("claude-code").unwrap().usage_window_poll,
        Some(UsageWindowSource::ClaudeOauth)
    );
    assert_eq!(
        capabilities_of("codex").unwrap().usage_window_poll,
        Some(UsageWindowSource::CodexAppServer)
    );
    // agy: a MESMA fonte responde ao poll — o `-p "/usage"` é a sonda, não
    // há push nenhum a esperar.
    assert_eq!(
        capabilities_of("agy").unwrap().usage_window_poll,
        Some(UsageWindowSource::AgyPrintCommand)
    );
}

/// Teste-GÊMEO do espelho TS (`agents.modelList.test.ts`): quem sabe dizer
/// AGORA quais modelos conhece, e por qual dialeto (M1 do
/// model-autonomy-plan). Mexeu aqui, mexa lá.
#[test]
fn matriz_lista_de_modelos_por_agent() {
    // agy 1.1.13: `agy models` → TSV `slug<TAB>Rótulo` (capturado nesta
    // máquina em 14/08/2026; fixture em model_list.rs).
    assert_eq!(
        capabilities_of("agy").unwrap().lists_models,
        Some(ModelListSource::AgyModelsSubcommand)
    );
    // codex 0.147: `model/list` no app-server read-only, com `hidden` e
    // `upgrade` (aposentadoria anunciada) — capturado 14/08/2026.
    assert_eq!(
        capabilities_of("codex").unwrap().lists_models,
        Some(ModelListSource::CodexAppServer)
    );
    // claude 2.1.220: NÃO existe subcomando de modelos nem lista oficial em
    // disco (help verificado 14/08/2026). Sem fonte confiável ⇒ None, e o
    // catálogo models.dev segue sendo a fonte — degradação honesta, o
    // comportamento de hoje fica intacto.
    assert_eq!(capabilities_of("claude-code").unwrap().lists_models, None);
}

/// Teste-GÊMEO do espelho TS (`agents.modelSmoke.test.ts`): quem dá pra
/// TESTAR com uma chamada mínima, e por qual dialeto (M2 do
/// model-autonomy-plan). Mexeu aqui, mexa lá.
#[test]
fn matriz_fumaca_de_modelo_por_agent() {
    // Os três motores integrados têm modo print com saída classificável —
    // provado rodando a fumaça de verdade contra um slug válido e um
    // inválido de cada um em 14/08/2026 (fixtures em model_smoke.rs).
    assert_eq!(
        capabilities_of("claude-code").unwrap().model_smoke,
        Some(ModelSmokeDialect::ClaudePrintJson)
    );
    assert_eq!(
        capabilities_of("codex").unwrap().model_smoke,
        Some(ModelSmokeDialect::CodexExecJson)
    );
    assert_eq!(
        capabilities_of("agy").unwrap().model_smoke,
        Some(ModelSmokeDialect::AgyPrintJson)
    );
}

/// Teste-GÊMEO de `agents.modeloLivre.test.ts` (K2): quem aceita id de
/// modelo digitado. Mexeu aqui, mexa lá.
#[test]
fn matriz_modelo_livre_por_agent() {
    assert!(capabilities_of("claude-code").unwrap().modelo_livre);
    assert!(capabilities_of("codex").unwrap().modelo_livre);
    assert!(!capabilities_of("agy").unwrap().modelo_livre);
    assert!(!capabilities_of("opencode").unwrap().modelo_livre);
}

/// Teste-GÊMEO do espelho TS (`agents.hooks.test.ts`): quem emite hooks de
/// ciclo de vida e por qual dialeto (hooks-plan §2). Mexeu aqui, mexa lá.
#[test]
fn matriz_de_hooks_por_agent() {
    // claude 2.1.220: settings.json chave hooks (payloads reais capturados
    // 12/08/2026 — fixtures em hook_sessions.rs).
    let claude = capabilities_of("claude-code").unwrap();
    assert!(claude.hooks_status);
    // H2: PermissionRequest síncrono (docs 12/08/2026 + Xirp vivo [E2]).
    assert!(claude.hooks_permission);
    assert_eq!(claude.hook_dialect, Some(HookDialect::ClaudeSettings));
    // codex 0.146: hooks.json dedicado, schema idêntico, feature stable.
    let codex = capabilities_of("codex").unwrap();
    assert!(codex.hooks_status);
    // H2: mesmo protocolo (wire schema no binário [E6]).
    assert!(codex.hooks_permission);
    assert_eq!(codex.hook_dialect, Some(HookDialect::CodexHooksJson));
    // agy 1.1.12: grupos nomeados em ~/.gemini/config/hooks.json (Stop só
    // roda ≥1.1.10 — gate de versão fica no instalador).
    let agy = capabilities_of("agy").unwrap();
    assert!(agy.hooks_status);
    // H2: permissão via PreToolUse.decision (doc embarcada [E9]).
    assert!(agy.hooks_permission);
    assert_eq!(agy.hook_dialect, Some(HookDialect::AgyConfigHooks));
    // Coerência estrutural pra TODO agent registrado (em loop, nunca
    // copiado): declarar hooks sem dialeto seria prometer uma instalação
    // que hooks_install.rs não sabe fazer — e vice-versa; e o hook de
    // permissão viaja no MESMO script/instalador dos de status.
    for agent in registered_agents() {
        let caps = capabilities_of(agent).unwrap();
        assert_eq!(
            caps.hooks_status,
            caps.hook_dialect.is_some(),
            "{agent}: hooks_status declarado exige hook_dialect (e vice-versa)"
        );
        assert!(
            !caps.hooks_permission || caps.hooks_status,
            "{agent}: hooks_permission exige hooks_status (mesmo script/instalador)"
        );
    }
}

#[test]
fn codex_command_failed_preserva_erro() {
    let item = serde_json::json!({
        "id": "item-2",
        "type": "command_execution",
        "command": "bun test",
        "aggregated_output": "teste falhou",
        "exit_code": 1,
        "status": "failed"
    });
    let events = map_codex_item(&item, None);
    match &events[1] {
        AgentEvent::ToolResult { ok, text, .. } => {
            assert!(!ok);
            assert_eq!(text, "teste falhou");
        }
        _ => panic!("esperava ToolResult"),
    }
}
