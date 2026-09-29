//! Testes do `adapters.rs`: Claude Code. Os auxiliares moram em `adapters_tests.rs`.

use super::*;
use super::tests::*;

// ---- claude ----

#[test]
fn claude_plan_first_troca_permission_mode_por_plan() {
    for perm in [Permission::Padrao, Permission::Liberado] {
        let mut a = ClaudeAdapter::default();
        let args = argv(&a.build_command(&req(perm, true)).unwrap());
        assert!(has_pair(&args, "--permission-mode", "plan"));
        assert!(!args.contains(&"acceptEdits".to_string()));
        assert!(!args.contains(&"bypassPermissions".to_string()));
        // uma única --permission-mode (plan substitui, não acumula)
        assert_eq!(args.iter().filter(|x| *x == "--permission-mode").count(), 1);
        // built-ins interativos seguem no disallow (ExitPlanMode erra no -p)
        assert!(args.iter().any(|x| x.contains("ExitPlanMode")));
    }
}

#[test]
fn claude_sem_plan_first_mantem_modo_do_turno() {
    let mut a = ClaudeAdapter::default();
    let args = argv(&a.build_command(&req(Permission::Padrao, false)).unwrap());
    assert!(has_pair(&args, "--permission-mode", "acceptEdits"));
    let mut a = ClaudeAdapter::default();
    let args = argv(&a.build_command(&req(Permission::Liberado, false)).unwrap());
    assert!(has_pair(&args, "--permission-mode", "bypassPermissions"));
}

#[test]
fn claude_auto_usa_permission_mode_auto_sem_prompt_tool() {
    let mut a = ClaudeAdapter::default();
    let args = argv(&a.build_command(&req(Permission::Auto, false)).unwrap());
    assert!(has_pair(&args, "--permission-mode", "auto"));
    assert!(!args.contains(&"acceptEdits".to_string()));
    assert!(!args.contains(&"bypassPermissions".to_string()));
    // Auto se autogoverna: NÃO leva o gate granular (só o Padrão precisa).
    assert!(!args.iter().any(|x| x == "--permission-prompt-tool"));
}

#[test]
fn claude_registra_context_gateway_e_allowlist_read_only() {
    let mut r = req(Permission::Leitura, false);
    r.context_gateway = Some(crate::context_gateway::GatewayConfig {
        server_bin: "/app/frota".into(),
        root: "/repo".into(),
        conv_id: "c1".into(),
        db_path: Some("/data/frota.db".into()), citadas: Default::default(),
    });
    let mut a = ClaudeAdapter::default();
    let args = argv(&a.build_command(&r).unwrap());
    let mcp = args
        .windows(2)
        .find(|w| w[0] == "--mcp-config")
        .map(|w| &w[1])
        .expect("mcp config");
    assert!(mcp.contains(crate::context_gateway::MCP_SERVER_NAME));
    assert!(mcp.contains("context-server"));
    let allowed = args
        .windows(2)
        .find(|w| w[0] == "--allowedTools")
        .map(|w| &w[1])
        .expect("allowlist interna");
    assert!(allowed.contains(crate::context_gateway::MANIFEST_TOOL));
    assert!(allowed.contains(crate::context_gateway::SEARCH_TOOL));
    assert!(allowed.contains(crate::context_gateway::READ_TOOL));
}

#[test]
fn claude_registra_catalogo_de_plugins_sem_autoaprovar_tools() {
    let mut r = req(Permission::Padrao, false);
    r.tool_gateway = Some(crate::tool_gateway::GatewayConfig {
        server_bin: "/app/frota".into(),
        socket: "/tmp/frota-tools.sock".into(),
    });
    let mut a = ClaudeAdapter::default();
    let args = argv(&a.build_command(&r).unwrap());
    let config = args
        .windows(2)
        .find(|pair| pair[0] == "--mcp-config")
        .map(|pair| &pair[1])
        .expect("config MCP efêmero");
    assert!(config.contains(crate::tool_gateway::MCP_SERVER_NAME));
    assert!(config.contains("tool-server"));
    assert!(config.contains("/tmp/frota-tools.sock"));
    assert!(
        !args
            .windows(2)
            .filter(|pair| pair[0] == "--allowedTools")
            .any(|pair| pair[1].contains(crate::tool_gateway::MCP_SERVER_NAME)),
        "estar no catálogo não equivale a autoaprovação no provider"
    );
}

#[test]
fn claude_managed_mcp_usa_config_estrita_sem_autoaprovar_tool_externa() {
    let mut r = req(Permission::Padrao, false);
    r.mcp_plan = crate::mcp_control::McpRunPlan {
        managed: true,
        selected: vec![external_mcp()],
        ..Default::default()
    };
    let mut a = ClaudeAdapter::default();
    let args = argv(&a.build_command(&r).unwrap());
    assert!(args.iter().any(|arg| arg == "--strict-mcp-config"));
    let config = args
        .windows(2)
        .find(|pair| pair[0] == "--mcp-config")
        .map(|pair| &pair[1])
        .expect("config MCP efêmero");
    assert!(config.contains("mcx-claude-hostinger"));
    assert!(config.contains("/opt/mcp/hostinger-wrapper"));
    assert!(
        !args
            .windows(2)
            .filter(|pair| pair[0] == "--allowedTools")
            .any(|pair| pair[1].contains("mcx-claude-hostinger")),
        "tool externa não pode ganhar auto-allow por estar no registry"
    );
}

#[test]
fn claude_recebe_mcp_contribuido_sem_transformar_config_legada_em_gerenciada() {
    let mut server = external_mcp();
    server.runtime_name = "plugin__acme_quality__docs".into();
    let mut r = req(Permission::Padrao, false);
    r.mcp_plan = crate::mcp_control::McpRunPlan {
        contributed: vec![server],
        ..Default::default()
    };
    let mut a = ClaudeAdapter::default();
    let args = argv(&a.build_command(&r).unwrap());
    assert!(!args.iter().any(|arg| arg == "--strict-mcp-config"));
    let config = args
        .windows(2)
        .find(|pair| pair[0] == "--mcp-config")
        .map(|pair| &pair[1])
        .expect("config MCP contribuída");
    assert!(config.contains("plugin__acme_quality__docs"));
    assert!(config.contains("/opt/mcp/hostinger-wrapper"));
}

#[test]
fn claude_anuncia_runtime_dos_mcps_externos_no_system_prompt() {
    let mut r = req(Permission::Padrao, false);
    r.mcp_plan = crate::mcp_control::McpRunPlan {
        managed: true,
        selected: vec![external_mcp()],
        ..Default::default()
    };
    let mut a = ClaudeAdapter::default();
    let args = argv(&a.build_command(&r).unwrap());
    let nudge = args
        .windows(2)
        .find(|pair| pair[0] == "--append-system-prompt")
        .map(|pair| pair[1].clone())
        .expect("system prompt anexado");
    assert!(nudge.contains("Ferramentas MCP desta sessão:"));
    // O nome de RUNTIME (não só o display) precisa chegar ao modelo: é
    // ele que aparece no prefixo mcp__<nome>__<tool> das chamadas.
    assert!(nudge.contains("- mcx-claude-hostinger: Hostinger (MCP roteado pela Frota)"));
}

#[test]
fn claude_result_is_error_termina_com_erro_acionavel() {
    let mut a = ClaudeAdapter::default();
    let evs = a.map_line(&serde_json::json!({
        "type": "result",
        "is_error": true,
        "result": "API indisponível",
        "errors": []
    }));
    assert!(matches!(
        &evs[0],
        AgentEvent::Result {
            ok: false,
            text: None,
            ..
        }
    ));
    assert!(matches!(
        &evs[1],
        AgentEvent::Error { message } if message.contains("API indisponível")
    ));
}

/// ADR-226, payload REAL do claude 2.1.280 (23/09/2026): a 2ª chamada
/// retomando a sessão reportou o acumulado (0,0143604) com o usage só do
/// turno. O fio e o ledger recebem o custo do turno; o cru volta à parte.
#[test]
fn claude_retomado_grava_o_custo_do_turno_e_devolve_o_acumulado() {
    const SESSAO: &str = "9e659501-d9ef-4df3-ac2a-0b0bd602bb9f";
    let resultado: serde_json::Value = serde_json::from_str(r#"{"type": "result", "subtype": "success", "is_error": false, "session_id": "9e659501-d9ef-4df3-ac2a-0b0bd602bb9f", "total_cost_usd": 0.0143604, "usage": {"input_tokens": 10, "cache_creation_input_tokens": 90, "cache_read_input_tokens": 6524, "output_tokens": 46, "service_tier": "standard"}, "result": "dois"}"#).unwrap();
    let custo = |resume: &str, base: Option<f64>| {
        let mut a = ClaudeAdapter::default();
        let mut r = req(Permission::Padrao, false);
        r.resume = Some(resume.into());
        r.cost_baseline = base;
        a.build_command(&r).unwrap();
        a.map_line(&serde_json::json!({
            "type": "system", "subtype": "init", "session_id": SESSAO,
            "model": "claude-haiku-4-5-20251001", "tools": []
        }));
        match a.map_line(&resultado).remove(0) {
            AgentEvent::Result { cost_usd, reported_cost_total, .. } => (cost_usd.unwrap(), reported_cost_total),
            _ => panic!("esperava Result"),
        }
    };
    let (turno, cru) = custo(SESSAO, Some(0.013288));
    assert!((turno - 0.0010724).abs() < 1e-6, "custo do turno: {turno}");
    assert_eq!(cru, Some(0.0143604));
    // Retomada que abriu OUTRA sessão: a base antiga não vale.
    assert_eq!(custo("outra-sessao", Some(0.013288)).0, 0.0143604);
    // Sem base (1º turno da sessão): o reportado é o do turno.
    assert_eq!(custo(SESSAO, None).0, 0.0143604);
}

#[test]
fn claude_session_limit_real_vira_um_terminal_com_reset_e_preserva_telemetria() {
    let mut a = ClaudeAdapter::default();
    let payload = "You've hit your session limit · resets 1:50pm (America/Sao_Paulo)";
    let evs = a.map_line(&serde_json::json!({
        "type": "result",
        "is_error": true,
        "result": payload,
        "errors": [],
        "total_cost_usd": 35.16,
        "usage": {
            "input_tokens": 2200,
            "output_tokens": 4,
            "cache_read_input_tokens": 37000,
            "cache_creation_input_tokens": 0
        }
    }));

    assert_eq!(evs.len(), 2, "telemetria + um único incidente terminal");
    assert!(matches!(
        &evs[0],
        AgentEvent::Result {
            ok: false,
            text: None,
            cost_usd: Some(cost),
            input_tokens: 2200,
            output_tokens: 4,
            cache_read: 37000,
            ..
        } if (*cost - 35.16).abs() < f64::EPSILON
    ));
    assert!(matches!(
        &evs[1],
        AgentEvent::LimitReached {
            message,
            reset_hint: Some(reset),
        } if message == payload && reset == "1:50pm (America/Sao_Paulo)"
    ));
    assert!(!evs.iter().any(|ev| matches!(ev, AgentEvent::Error { .. })));
}

#[test]
fn codex_limite_de_uso_real_traz_o_horario_de_volta() {
    // Payload REAL do fio (conversa do Codex, 14/09/2026 13:50).
    let msg = "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 19th, 2026 10:12 AM.";
    let hit = codex_limit(msg).expect("é limite de uso");
    assert_eq!(hit.reset_hint.as_deref(), Some("Sep 19th, 2026 10:12 AM"));
    // O formato do Claude segue igual.
    let claude = extract_reset_hint("You've hit your session limit · resets 2:10pm (America/Sao_Paulo)");
    assert_eq!(claude.as_deref(), Some("2:10pm (America/Sao_Paulo)"));
}

#[test]
fn claude_preserva_ponteiro_e_retorno_do_subagente() {
    let mut a = ClaudeAdapter::default();
    let evs = a.map_line(&serde_json::json!({
        "type": "assistant",
        "parent_tool_use_id": "task-root",
        "message": {
            "content": [
                { "type": "text", "text": "Subagente terminou." },
                {
                    "type": "tool_use",
                    "id": "bash-child",
                    "name": "Bash",
                    "input": { "command": "cargo test" }
                }
            ]
        }
    }));
    assert!(matches!(
        &evs[0],
        AgentEvent::SubagentText { parent_tool_id, text }
            if parent_tool_id == "task-root" && text.contains("terminou")
    ));
    assert!(matches!(
        &evs[1],
        AgentEvent::Tool { parent_tool_id: Some(parent), .. }
            if parent == "task-root"
    ));
}

/// AUTO-COMPACT: a linha `system/compact_boundary` do stream-json existe (48
/// ocorrências no binário 2.1.219) e caía no `vec![]` — a conversa era
/// compactada em silêncio. Agora tem que virar Notice visível no fio.
#[test]
fn claude_compact_boundary_vira_aviso_visivel() {
    let mut a = ClaudeAdapter::default();
    let linha = serde_json::json!({
        "type": "system",
        "subtype": "compact_boundary",
        "session_id": "s1"
    });
    let evs = a.map_line(&linha);
    assert_eq!(evs.len(), 1);
    match &evs[0] {
        AgentEvent::Notice { message } => {
            assert!(message.contains("compactou"), "mensagem: {message}");
        }
        _ => panic!("esperava Notice"),
    }
}

#[test]
fn claude_microcompact_avisa_mais_discreto() {
    let mut a = ClaudeAdapter::default();
    let evs = a.map_line(&serde_json::json!({
        "type": "system", "subtype": "microcompact_boundary"
    }));
    match &evs[0] {
        AgentEvent::Notice { message } => assert!(message.contains("podou")),
        _ => panic!("esperava Notice"),
    }
}

// ---- trabalho diferido (deferred-work-plan, D1.1) ----
// Payloads REAIS capturados no spike D0 (claude 2.1.219) e no incidente
// deep-research — lição do ADR-016: fixture irreal esconde bug.

#[test]
fn claude_task_started_vira_deferred_running_com_vinculo_ao_workflow() {
    let mut a = ClaudeAdapter::default();
    let evs = a.map_line(&serde_json::json!({
        "type": "system", "subtype": "task_started",
        "task_id": "wnz619fti",
        "tool_use_id": "toolu_01MmPxeoK9vhakStdhGbVywn",
        "description": "spike D0: dois agentes triviais",
        "task_type": "local_workflow",
        "workflow_name": "spike-ping",
        "prompt": "<script do workflow>"
    }));
    assert_eq!(evs.len(), 1);
    match &evs[0] {
        AgentEvent::DeferredWork {
            id,
            tool_use_id,
            kind,
            name,
            status,
            ..
        } => {
            assert_eq!(id, "wnz619fti");
            assert_eq!(
                tool_use_id.as_deref(),
                Some("toolu_01MmPxeoK9vhakStdhGbVywn")
            );
            assert_eq!(*kind, Some(DeferredKind::Workflow));
            // workflow_name vence a description como nome humano
            assert_eq!(name.as_deref(), Some("spike-ping"));
            assert!(matches!(status, DeferredStatus::Running));
        }
        _ => panic!("esperava DeferredWork"),
    }
}

#[test]
fn claude_background_tasks_changed_lista_vira_running() {
    let mut a = ClaudeAdapter::default();
    let evs = a.map_line(&serde_json::json!({
        "type": "system", "subtype": "background_tasks_changed",
        "tasks": [{
            "task_id": "wnz619fti",
            "task_type": "local_workflow",
            "description": "spike D0: dois agentes triviais"
        }],
        "session_id": "s1"
    }));
    assert_eq!(evs.len(), 1);
    match &evs[0] {
        AgentEvent::DeferredWork {
            id, status, name, ..
        } => {
            assert_eq!(id, "wnz619fti");
            assert!(matches!(status, DeferredStatus::Running));
            assert_eq!(name.as_deref(), Some("spike D0: dois agentes triviais"));
        }
        _ => panic!("esperava DeferredWork"),
    }
    // lista VAZIA = nada pendente: sem evento (não há o que desenhar)
    assert!(a
        .map_line(&serde_json::json!({
            "type": "system", "subtype": "background_tasks_changed",
            "tasks": [], "session_id": "s1"
        }))
        .is_empty());
}

#[test]
fn claude_task_progress_vira_progress_sem_sobrescrever_nome() {
    let mut a = ClaudeAdapter::default();
    let evs = a.map_line(&serde_json::json!({
        "type": "system", "subtype": "task_progress",
        "task_id": "wnz619fti",
        "tool_use_id": "toolu_x",
        "description": "Ping: Responda apenas com a palavra: ping",
        "usage": {"total_tokens": 15324, "tool_uses": 0, "duration_ms": 1419},
        "workflow_progress": [
            {"type": "workflow_phase", "index": 1, "title": "Ping"}
        ]
    }));
    match &evs[0] {
        AgentEvent::DeferredWork {
            status,
            name,
            summary,
            progress,
            ..
        } => {
            assert!(matches!(status, DeferredStatus::Progress));
            // a description do progress é o PASSO corrente, não o workflow
            assert!(name.is_none());
            assert_eq!(
                summary.as_deref(),
                Some("Ping: Responda apenas com a palavra: ping")
            );
            let p = progress.as_ref().expect("progress cru");
            assert!(p.get("workflow_progress").is_some());
            assert!(p.get("usage").is_some());
        }
        _ => panic!("esperava DeferredWork"),
    }
}

#[test]
fn claude_task_updated_e_notification_viram_terminais() {
    let mut a = ClaudeAdapter::default();
    let evs = a.map_line(&serde_json::json!({
        "type": "system", "subtype": "task_updated",
        "task_id": "wnz619fti",
        "patch": {"status": "completed", "end_time": 1785512821607u64}
    }));
    assert!(matches!(
        &evs[0],
        AgentEvent::DeferredWork { id, status: DeferredStatus::Completed, .. }
            if id == "wnz619fti"
    ));
    // patch SEM status terminal conhecido → nada (fail-open)
    assert!(a
        .map_line(&serde_json::json!({
            "type": "system", "subtype": "task_updated",
            "task_id": "wnz619fti", "patch": {"end_time": 1u64}
        }))
        .is_empty());
    let evs = a.map_line(&serde_json::json!({
        "type": "system", "subtype": "task_notification",
        "task_id": "wnz619fti",
        "tool_use_id": "toolu_x",
        "status": "completed",
        "output_file": "/tmp/tasks/wnz619fti.output",
        "summary": "Dynamic workflow \"spike D0: dois agentes triviais\" completed",
        "usage": {}
    }));
    match &evs[0] {
        AgentEvent::DeferredWork {
            status,
            summary,
            output_file,
            ..
        } => {
            assert!(matches!(status, DeferredStatus::Completed));
            assert!(summary.as_deref().unwrap().contains("completed"));
            // resultado em DISCO é primeira classe: o caminho não pode
            // se perder no progress cru (lição do incidente)
            assert_eq!(output_file.as_deref(), Some("/tmp/tasks/wnz619fti.output"));
        }
        _ => panic!("esperava DeferredWork"),
    }
}

/// A `<task-notification>` injetada no `--resume` chega como mensagem
/// `user` de texto plano — payload REAL do incidente deep-research.
#[test]
fn claude_task_notification_injetada_no_resume_vira_deferred_stopped() {
    let mut a = ClaudeAdapter::default();
    let payload = "<task-notification>\n<task-id>wpue6int0</task-id>\n<tool-use-id>toolu_01TCWmKSAySRPCGsQhHuffaV</tool-use-id>\n<status>stopped</status>\n<summary>No completion record was found for background workflow \"deep-research\" from the previous session. It may have been stopped (via the UI or TaskStop — these leave no transcript marker), or it may have been running when the previous Claude Code process exited. To pick up where it left off, relaunch with Workflow({scriptPath, resumeFromRunId: \"wf_3f484d03-7ff\"}) — completed agent() calls return cached.</summary>\n</task-notification>";
    // forma 1: content como string direta
    let evs = a.map_line(&serde_json::json!({
        "type": "user",
        "message": { "content": payload }
    }));
    assert_eq!(evs.len(), 1);
    match &evs[0] {
        AgentEvent::DeferredWork {
            id,
            tool_use_id,
            status,
            summary,
            ..
        } => {
            assert_eq!(id, "wpue6int0");
            assert_eq!(
                tool_use_id.as_deref(),
                Some("toolu_01TCWmKSAySRPCGsQhHuffaV")
            );
            assert!(matches!(status, DeferredStatus::Stopped));
            assert!(summary.as_deref().unwrap().contains("No completion record"));
        }
        _ => panic!("esperava DeferredWork"),
    }
    // forma 2: content como bloco text
    let evs = a.map_line(&serde_json::json!({
        "type": "user",
        "message": { "content": [{ "type": "text", "text": payload }] }
    }));
    assert_eq!(evs.len(), 1);
    assert!(matches!(
        &evs[0],
        AgentEvent::DeferredWork {
            status: DeferredStatus::Stopped,
            ..
        }
    ));
    // prompt comum do usuário NÃO vira evento (nem com "<" no meio)
    assert!(a
        .map_line(&serde_json::json!({
            "type": "user",
            "message": { "content": [{ "type": "text", "text": "oi, use <div> aqui" }] }
        }))
        .is_empty());
    // status desconhecido na notificação injetada → fail-open (nada)
    assert!(a
        .map_line(&serde_json::json!({
            "type": "user",
            "message": { "content": "<task-notification>\n<task-id>x1</task-id>\n<status>exploded</status>\n</task-notification>" }
        }))
        .is_empty());
}

#[test]
fn claude_tool_result_com_background_bash_emite_deferred_work_com_output_file() {
    let mut a = ClaudeAdapter::default();
    // Payload REAL do incidente do build test:
    let raw_output = "Command running in background with ID: b3pbaal2v. Output is being written to: /private/tmp/claude-501/-Users-viniciusmachado-projetos-mycockpit/c03399e2-c987-48b7-bfb3-8d393f14c82a/tasks/b3pbaal2v.output. You will be notified when it completes. To check interim output, use Read on that file path.";
    let evs = a.map_line(&serde_json::json!({
        "type": "user",
        "message": {
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": "toolu_01T3cSiZKnzUhyzaVHiNbtMa",
                    "content": raw_output,
                    "is_error": false
                }
            ]
        }
    }));
    assert_eq!(evs.len(), 2);
    match &evs[0] {
        AgentEvent::ToolResult { id, ok, .. } => {
            assert_eq!(id, "toolu_01T3cSiZKnzUhyzaVHiNbtMa");
            assert!(*ok);
        }
        _ => panic!("esperava ToolResult"),
    }
    match &evs[1] {
        AgentEvent::DeferredWork {
            id,
            tool_use_id,
            kind,
            output_file,
            status,
            ..
        } => {
            assert_eq!(id, "b3pbaal2v");
            assert_eq!(
                tool_use_id.as_deref(),
                Some("toolu_01T3cSiZKnzUhyzaVHiNbtMa")
            );
            assert_eq!(*kind, Some(DeferredKind::Terminal));
            assert_eq!(
                output_file.as_deref(),
                Some("/private/tmp/claude-501/-Users-viniciusmachado-projetos-mycockpit/c03399e2-c987-48b7-bfb3-8d393f14c82a/tasks/b3pbaal2v.output")
            );
            assert!(matches!(status, DeferredStatus::Running));
        }
        _ => panic!("esperava DeferredWork"),
    }
}

#[test]
fn parse_claude_background_task_rejeita_path_relativo_ou_invalido() {
    assert!(parse_claude_background_task("Build ok sem background").is_none());
    assert!(parse_claude_background_task("Command running in background with ID: 123. Output is being written to: rel/path.log").is_none());
}

// ---- evidência visual de tool_result (browser-plan B1) ----

/// tool_result com bloco `image` (shape EXATO do stream-json: content array
/// com source base64) → arquivo em disco com nome determinístico + path no
/// evento; o base64 NUNCA aparece no evento serializado.
#[test]
fn claude_tool_result_com_imagem_grava_arquivo_e_emite_path() {
    let dir = std::env::temp_dir().join(format!("mc-adapter-evidence-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let mut a = ClaudeAdapter::default();
    a.set_evidence_sink(crate::evidence::EvidenceSink::new(
        dir.clone(),
        "evidence/conv-b1".to_string(),
    ));
    let evs = a.map_line(&serde_json::json!({
        "type": "user",
        "message": { "content": [{
            "type": "tool_result",
            "tool_use_id": "toolu_01Screenshot",
            "content": [
                { "type": "text", "text": "Took the full page screenshot" },
                { "type": "image", "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "data": PNG_1X1_B64
                } }
            ]
        }] }
    }));
    assert_eq!(evs.len(), 1);
    match &evs[0] {
        AgentEvent::ToolResult {
            id,
            ok,
            text,
            images,
            ..
        } => {
            assert_eq!(id, "toolu_01Screenshot");
            assert!(*ok);
            assert_eq!(text, "Took the full page screenshot");
            assert_eq!(
                images,
                &vec!["evidence/conv-b1/toolu_01Screenshot-0.png".to_string()]
            );
        }
        _ => panic!("esperava ToolResult"),
    }
    // o arquivo existe e é PNG de verdade
    let bytes = std::fs::read(dir.join("toolu_01Screenshot-0.png")).unwrap();
    assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    // nada de base64 no evento serializado (o que iria pro Channel/SQLite)
    let wire = serde_json::to_string(&evs[0]).unwrap();
    assert!(!wire.contains(PNG_1X1_B64));
    assert!(wire.contains("evidence/conv-b1/toolu_01Screenshot-0.png"));
    let _ = std::fs::remove_dir_all(&dir);
}

/// Sem sink (app_data_dir indisponível) ou sem bloco image → comportamento
/// de SEMPRE: evento sem `images` (nem a chave aparece na serialização).
#[test]
fn claude_tool_result_sem_imagem_serializa_identico_ao_de_antes() {
    let mut a = ClaudeAdapter::default();
    let evs = a.map_line(&serde_json::json!({
        "type": "user",
        "message": { "content": [{
            "type": "tool_result",
            "tool_use_id": "toolu_02",
            "content": "saída em texto"
        }] }
    }));
    let wire = serde_json::to_string(&evs[0]).unwrap();
    assert!(!wire.contains("images"));
    // e COM bloco image mas SEM sink: imagem descartada como antes, sem pânico
    let evs = a.map_line(&serde_json::json!({
        "type": "user",
        "message": { "content": [{
            "type": "tool_result",
            "tool_use_id": "toolu_03",
            "content": [{ "type": "image", "source": {
                "type": "base64", "media_type": "image/png", "data": PNG_1X1_B64
            } }]
        }] }
    }));
    assert!(matches!(
        &evs[0],
        AgentEvent::ToolResult { images, .. } if images.is_empty()
    ));
}

/// `system` de subtype desconhecido segue ignorado (não vira ruído no fio) e
/// o `init` continua virando Session — a mudança não pode ter vazado.
#[test]
fn claude_system_desconhecido_segue_ignorado_e_init_intacto() {
    let mut a = ClaudeAdapter::default();
    assert!(a
        .map_line(&serde_json::json!({ "type": "system", "subtype": "outra_coisa" }))
        .is_empty());
    let evs = a.map_line(&serde_json::json!({
        "type": "system", "subtype": "init", "session_id": "s9", "model": "opus"
    }));
    assert!(matches!(&evs[0], AgentEvent::Session { session_id, .. } if session_id == "s9"));
}

#[test]
fn claude_auto_com_plan_first_vira_plan() {
    let mut a = ClaudeAdapter::default();
    let args = argv(&a.build_command(&req(Permission::Auto, true)).unwrap());
    assert!(has_pair(&args, "--permission-mode", "plan"));
    assert!(!args.contains(&"auto".to_string()));
    assert_eq!(args.iter().filter(|x| *x == "--permission-mode").count(), 1);
}

#[test]
fn claude_plan_first_em_leitura_mantem_disallow_de_escrita() {
    let mut a = ClaudeAdapter::default();
    let args = argv(&a.build_command(&req(Permission::Leitura, true)).unwrap());
    assert!(has_pair(&args, "--permission-mode", "plan"));
    assert!(args.iter().any(|x| x.contains("Bash,Edit,Write")));
}
