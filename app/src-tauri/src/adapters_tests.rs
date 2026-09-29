//! Testes do `adapters.rs`: registry de capabilities, montagem de comando e
//! mapeamento de stream de cada motor.

use super::*;

/// RunRequest mínimo p/ testar build_command (sem spawnar nada).
pub(super) fn req(permission: Permission, plan_first: bool) -> RunRequest {
    RunRequest {
        prompt: "faça X".to_string(),
        system_prompt: None,
        cwd: ".".to_string(),
        resume: None,
        memory_fallback: None,
        permission,
        model: None,
        effort: None,
        attachments: Vec::new(),
        extra_dirs: Vec::new(),
        approval: None,
        context_gateway: None,
        work_gateway: None,
        browser_gateway: None,
        desktop_gateway: None,
        denied_mcp_servers: Vec::new(),
        tool_gateway: None,
        mcp_plan: crate::mcp_control::McpRunPlan::default(),
        plan_first,
        usage_baseline: None,
        cost_baseline: None,
    }
}

/// argv do Command montado (só os args; o programa fica de fora).
pub(super) fn argv(cmd: &Command) -> Vec<String> {
    cmd.as_std()
        .get_args()
        .map(|a| a.to_string_lossy().into_owned())
        .collect()
}

/// O par `--flag valor` aparece no argv (adjacente, na ordem)?
pub(super) fn has_pair(args: &[String], flag: &str, value: &str) -> bool {
    args.windows(2).any(|w| w[0] == flag && w[1] == value)
}

/// Confere o contrato declarado contra os argumentos REAIS, sem achatar o
/// `argv` numa string (espaços e quebras dentro do prompt são um argumento só).
pub(super) fn assert_prompt_contract(
    agent: &str,
    contract: CliPromptContract,
    args: &[String],
    prompt: &str,
) {
    let positions: Vec<_> = args
        .iter()
        .enumerate()
        .filter_map(|(index, arg)| (arg == prompt).then_some(index))
        .collect();
    assert_eq!(
        positions.len(),
        1,
        "{agent}: o prompt precisa aparecer exatamente uma vez no argv; veio {args:?}"
    );
    let index = positions[0];
    let previous = index.checked_sub(1).and_then(|i| args.get(i));

    match contract {
        CliPromptContract::TrailingAfterSeparator(separator) => {
            assert_eq!(
                index + 1,
                args.len(),
                "{agent}: nenhuma flag pode vir depois do prompt; veio {args:?}"
            );
            assert_eq!(
                previous.map(String::as_str),
                Some(separator),
                "{agent}: o prompt precisa vir imediatamente após {separator:?}; veio {args:?}"
            );
        }
        CliPromptContract::AfterFlagBeforeTrailingArgs(flag) => {
            assert_eq!(
                previous.map(String::as_str),
                Some(flag),
                "{agent}: o prompt precisa vir imediatamente após {flag:?}; veio {args:?}"
            );
            assert!(
                index + 1 < args.len(),
                "{agent}: o contrato exige argumentos depois do prompt; veio {args:?}"
            );
        }
    }
}

/// X2 — todo adapter registrado declara a convenção de prompt, e a linha
/// montada precisa obedecer à declaração. O marcador contém espaços,
/// quebra e texto parecido com flag para impedir teste por `join`.
#[test]
fn contrato_de_posicao_do_prompt_por_agent() {
    const PROMPT: &str = "--- PROMPT X2 com espaços\n-p continua sendo texto";

    for agent in registered_agents() {
        let mut r = req(Permission::Padrao, false);
        r.prompt = PROMPT.to_string();
        let mut adapter = resolve(agent).unwrap();
        let contract = adapter.cli_prompt_contract();
        let args = argv(&adapter.build_validated_command(&r).unwrap());
        assert_prompt_contract(agent, contract, &args, PROMPT);
    }
}

/// A guarda de produção é fail-closed: forma divergente não chega ao spawn.
#[test]
fn guarda_recusa_forma_que_diverge_do_contrato_de_prompt() {
    let mut trailing = Command::new("motor");
    trailing.args(["--", "pedido", "--json"]);
    assert!(CliPromptContract::TrailingAfterSeparator("--")
        .validate("motor", &trailing)
        .is_err());

    let mut middle = Command::new("motor");
    middle.args(["--json", "-p", "pedido"]);
    assert!(CliPromptContract::AfterFlagBeforeTrailingArgs("-p")
        .validate("motor", &middle)
        .is_err());
}

/// As três camadas de `codex_cost_model` — o buraco que deixava "gpt-5.5"
/// entrar sem fonte nenhuma (medido 17/08/2026).
#[test]
fn codex_cost_model_pedido_venceconfig_venceninguem_nao_inventa() {
    // As três camadas de `codex_cost_model`, numa função só (SEQUENCIAL —
    // `CODEX_HOME` é var de AMBIENTE do processo inteiro; duas dessas
    // asserções em testes separados rodando em paralelo correriam). Nunca
    // aponta pro `~/.codex/` real do usuário: sempre um dir de scratch.
    let dir = std::env::temp_dir().join(format!(
        "frota-codex-cost-model-{}-{:?}",
        std::process::id(),
        std::thread::current().id()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let antigo = std::env::var("CODEX_HOME").ok();
    unsafe {
        std::env::set_var("CODEX_HOME", &dir);
    }

    // 1. Nem requisitado, nem config.toml (arquivo não existe): None —
    //    nunca "gpt-5.5" chutado (o bug real, incidente medido 17/08/2026).
    assert_eq!(codex_cost_model(None), None);

    // 2. Sem requisição, config.toml TEM `model`: usa o do arquivo.
    std::fs::write(dir.join("config.toml"), "model = \"gpt-5.6\"\n").unwrap();
    assert_eq!(codex_cost_model(None), Some("gpt-5.6".to_string()));

    // 3. Requisitado vence o config, mesmo com os dois presentes.
    assert_eq!(
        codex_cost_model(Some("gpt-5.4")),
        Some("gpt-5.4".to_string())
    );

    // 4. config.toml existe mas SEM a chave `model`: ainda None, não chuta.
    std::fs::write(dir.join("config.toml"), "outra_chave = 1\n").unwrap();
    assert_eq!(codex_cost_model(None), None);

    unsafe {
        match antigo {
            Some(v) => std::env::set_var("CODEX_HOME", v),
            None => std::env::remove_var("CODEX_HOME"),
        }
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn codex_add_dir_vem_antes_do_subcomando_resume() {
    let mut adapter = CodexAdapter::default();
    let mut r = req(Permission::Liberado, false);
    r.resume = Some("thread-123".into());
    r.extra_dirs = vec!["/extra/pasta".into()];
    let cmd = adapter.build_command(&r).unwrap();
    let args = argv(&cmd);
    assert!(has_pair(&args, "--add-dir", "/extra/pasta"));
    let add_dir = args.iter().position(|a| a == "--add-dir").unwrap();
    let resume = args.iter().position(|a| a == "resume").unwrap();
    assert!(
        add_dir < resume,
        "--add-dir precisa vir ANTES do subcomando resume: {args:?}"
    );
    // e o resume continua com o thread logo em seguida
    assert!(has_pair(&args, "resume", "thread-123"));
}

pub(super) fn external_mcp() -> crate::mcp_control::McpRuntimeServer {
    crate::mcp_control::McpRuntimeServer {
        runtime_name: "mcx-claude-hostinger".into(),
        display_name: "Hostinger".into(),
        launch: crate::mcp_control::McpLaunchConfig {
            transport: "stdio".into(),
            command: Some("/opt/mcp/hostinger-wrapper".into()),
            args: vec!["serve".into()],
            ..Default::default()
        },
        tool_names: Vec::new(),
    }
}

/// PNG 1×1 real em base64 (o mesmo fixture do evidence.rs).
pub(super) const PNG_1X1_B64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

/// Sequência REAL medida no codex 0.146 (04/08/2026): dois turnos triviais
/// na MESMA thread, o 2º via `exec resume`. O acumulado praticamente dobra
/// com o mesmo prompt — ler isso como gasto do turno é o bug que inflou o
/// ledger em ~20x.
pub(super) const TURNO_1: (u64, u64, u64) = (17494, 9984, 6);

pub(super) const TURNO_2: (u64, u64, u64) = (35005, 27136, 12);

pub(super) fn turn_completed(usage: (u64, u64, u64)) -> serde_json::Value {
    serde_json::json!({
        "type": "turn.completed",
        "usage": {
            "input_tokens": usage.0,
            "cached_input_tokens": usage.1,
            "output_tokens": usage.2
        }
    })
}

/// Telemetria do Result (tokens, custo, acumulado devolvido).
pub(super) fn result_of(
    evs: &[AgentEvent],
) -> (u64, u64, u64, f64, Option<crate::agent::CumulativeUsage>) {
    match evs.iter().find(|e| matches!(e, AgentEvent::Result { .. })) {
        Some(AgentEvent::Result {
            input_tokens,
            output_tokens,
            cache_read,
            cost_usd,
            cumulative_usage,
            ..
        }) => (
            *input_tokens,
            *output_tokens,
            *cache_read,
            cost_usd.unwrap_or(0.0),
            *cumulative_usage,
        ),
        _ => panic!("esperava Result"),
    }
}

/// RunRequest com um anexo (o path é o que vai pro prompt; nada é lido).
pub(super) fn req_com_anexo(kind: AttachmentKind, path: &str, mime: &str) -> RunRequest {
    let mut r = req(Permission::Padrao, false);
    r.attachments = vec![Attachment {
        path: path.to_string(),
        name: "anexo".to_string(),
        kind,
        mime: mime.to_string(),
        bytes: 10,
    }];
    r
}

/// `init` — id da conversa, cwd e as 56 tools que o agy expõe.
pub(super) const AGY_INIT: &str = r#"{"event":"init","conversation_id":"a165239c-dde9-493c-a60c-ccf5ac0ccffb","init":{"cwd":"/private/tmp/agyprobe","tools":["ask_permission","ask_question","browser_click_element","browser_drag_pixel_to_pixel","browser_get_dom","browser_get_network_request","browser_input","browser_list_network_requests","browser_mouse_down","browser_mouse_up","browser_move_mouse","browser_press_key","browser_refresh_page","browser_resize_window","browser_scroll","browser_scroll_dom","browser_select_option","browser_subagent","call_mcp_tool","capture_browser_console_logs","capture_browser_screenshot","click_browser_pixel","command_status","define_subagent","delete_knowledge","execute_browser_javascript","find_by_name","finish","generate_image","grep_search","invoke_subagent","list_browser_pages","list_dir","list_permissions","list_resources","manage_inbox","manage_subagents","manage_task","multi_replace_file_content","notebook_edit","notebook_execution","open_browser_url","read_browser_page","read_resource","read_url_content","replace_file_content","run_command","schedule","search_web","sed_file","send_command_input","send_message","view_file","wait","wait_5_seconds","write_to_file"],"permission_mode":"request-review"}}"#;

/// Steps de infra do começo do turno: não pintam nada na UI.
/// Step com `compaction_info`: o agy compactou a conversa sozinho. O campo
/// vem do protobuf `CompactionInfo` (`json:"compaction_info,omitempty"`,
/// binário 1.1.19).
pub(super) const AGY_STEP_COMPACTADO: &str = r#"{"event":"step_update","step_update":{"conversation_id":"a1","step_index":9,"state":"DONE","step_type":"agent_response","text_delta":"ok","compaction_info":{"compacted_at_step_indices":[3,4,5]}}}"#;

pub(super) const AGY_STEP_USER_INPUT: &str = r#"{"event":"step_update","step_update":{"conversation_id":"a165239c-dde9-493c-a60c-ccf5ac0ccffb","step_index":0,"state":"DONE","step_type":"user_input"}}"#;

pub(super) const AGY_STEP_INFRA: &str = r#"{"event":"step_update","step_update":{"conversation_id":"a165239c-dde9-493c-a60c-ccf5ac0ccffb","step_index":1,"state":"DONE","step_type":"unknown","duration_seconds":0.001105}}"#;

/// A NARRAÇÃO: fala que ANTECEDE a ferramenta. Em texto puro era isto que
/// colava no topo da resposta (o "I am analyzing the repository…" do
/// incidente); aqui ela vem no step 2, e o step 3 é a ferramenta.
pub(super) const AGY_STEP_NARRACAO: &str = r#"{"event":"step_update","step_update":{"conversation_id":"a165239c-dde9-493c-a60c-ccf5ac0ccffb","step_index":2,"state":"DONE","step_type":"agent_response","text_delta":"Vou listar o conteúdo do diretório `/Users/viniciusmachado/.gemini/antigravity-cli/scratch` para verificar a quantidade de arquivos nele.\n","duration_seconds":2.85021,"usage":{"input_tokens":15897,"output_tokens":965,"thinking_tokens":878,"cache_read_tokens":0,"total_tokens":16862}}}"#;

pub(super) const AGY_STEP_TOOL_ACTIVE: &str = r#"{"event":"step_update","step_update":{"conversation_id":"a165239c-dde9-493c-a60c-ccf5ac0ccffb","step_index":3,"state":"ACTIVE","step_type":"tool","tool_name":"list_dir","tool_info":{"name":"list_dir","parameters":{"DirectoryPath":"/Users/viniciusmachado/.gemini/antigravity-cli/scratch"}}}}"#;

pub(super) const AGY_STEP_TOOL_DONE: &str = r#"{"event":"step_update","step_update":{"conversation_id":"a165239c-dde9-493c-a60c-ccf5ac0ccffb","step_index":3,"state":"DONE","step_type":"tool","tool_name":"list_dir","duration_seconds":0.006099,"tool_info":{"name":"list_dir","parameters":{"DirectoryPath":"/Users/viniciusmachado/.gemini/antigravity-cli/scratch"},"output":"doc.pdf\nshape.png\nsmall-circle.png"}}}"#;

/// `checkpoint` é uma chamada AUXILIAR minúscula (121 tokens) — se ela
/// medisse o anel de contexto, o anel despencaria no fim de todo turno.
pub(super) const AGY_STEP_CHECKPOINT: &str = r#"{"event":"step_update","step_update":{"conversation_id":"a165239c-dde9-493c-a60c-ccf5ac0ccffb","step_index":4,"state":"DONE","step_type":"checkpoint","duration_seconds":0.57305,"usage":{"input_tokens":121,"output_tokens":7,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":128}}}"#;

/// A RESPOSTA, partida no meio da palavra "scratc|h" entre ACTIVE e DONE.
pub(super) const AGY_STEP_RESP_ACTIVE: &str = r#"{"event":"step_update","step_update":{"conversation_id":"a165239c-dde9-493c-a60c-ccf5ac0ccffb","step_index":5,"state":"ACTIVE","step_type":"agent_response","text_delta":"Existem exatamente 3 arquivos no diretório de trabalho padrão ([`/Users/viniciusmachado/.gemini/antigravity-cli/scratc"}}"#;

pub(super) const AGY_STEP_RESP_DONE: &str = r#"{"event":"step_update","step_update":{"conversation_id":"a165239c-dde9-493c-a60c-ccf5ac0ccffb","step_index":5,"state":"DONE","step_type":"agent_response","text_delta":"h`](file:///Users/viniciusmachado/.gemini/antigravity-cli/scratch)):\n\n1. doc.pdf\n2. shape.png\n3. small-circle.png\n","duration_seconds":1.788865,"usage":{"input_tokens":4793,"output_tokens":619,"thinking_tokens":467,"cache_read_tokens":12209,"total_tokens":5412}}}"#;

/// O `result` do MESMO run: repare no `response` — narração + resposta
/// concatenadas, que é EXATAMENTE o blob do modo texto puro.
pub(super) const AGY_RESULT: &str = r#"{"event":"result","result":{"conversation_id":"a165239c-dde9-493c-a60c-ccf5ac0ccffb","status":"SUCCESS","response":"Vou listar o conteúdo do diretório `/Users/viniciusmachado/.gemini/antigravity-cli/scratch` para verificar a quantidade de arquivos nele.\nExistem exatamente 3 arquivos no diretório de trabalho padrão ([`/Users/viniciusmachado/.gemini/antigravity-cli/scratch`](file:///Users/viniciusmachado/.gemini/antigravity-cli/scratch)):\n\n1. doc.pdf\n2. shape.png\n3. small-circle.png\n","duration_seconds":4.87077,"num_turns":1,"usage":{"input_tokens":20811,"output_tokens":1591,"thinking_tokens":1345,"cache_read_tokens":12209,"total_tokens":22402}}}"#;

/// Ferramenta que FALHOU (outro run real, mesmo dia): o motivo está em
/// `tool_info.error.message`, não em `output`.
pub(super) const AGY_STEP_TOOL_ERROR: &str = r#"{"event":"step_update","step_update":{"conversation_id":"4f102d41-414f-4def-a5d2-362c33b61ed5","step_index":3,"state":"ERROR","step_type":"tool","tool_name":"list_dir","duration_seconds":0.061392,"tool_info":{"name":"list_dir","parameters":{"DirectoryPath":"/Users/viniciusmachado/.gemini/antigravity-cli"},"error":{"type":"TOOL_ERROR","message":"Permission denied for read_file(/Users/viniciusmachado/.gemini/antigravity-cli). Matches hardcoded system protection boundary rule."}}}}"#;

/// `/comando` nativo (o `agy -p "/credits"`): não é turno de modelo.
pub(super) const AGY_COMMAND_RESULT: &str = r#"{"event":"command_result","command":{"name":"credits","data":{"remaining_credits":0,"upgrade_uri":"https://antigravity.google/g1-upgrade"}}}"#;

/// Roda uma linha CRUA pelo mesmo caminho do runner (`on_stdout_line`).
pub(super) fn agy_linha(a: &mut AgyAdapter, raw: &str) -> Vec<AgentEvent> {
    a.on_stdout_line(raw)
}

pub(super) const AGY_COMPACTACAO_REAL: &str =
    include_str!("../testdata/agy-1.2.4/compactacao-checkpoint.jsonl");

pub(super) const AGY_COMPACTACAO_NO_INICIO: &str =
    include_str!("../testdata/agy-1.2.4/compactacao-no-inicio-do-turno.jsonl");

pub(super) const AGY_SEM_COMPACTACAO_ACIMA_256K: &str =
    include_str!("../testdata/agy-1.2.4/sem-compactacao-acima-de-256k-real.jsonl");

pub(super) fn avisos_do_stream(stream: &str) -> Vec<String> {
    let mut a = AgyAdapter::default();
    stream
        .lines()
        .flat_map(|l| agy_linha(&mut a, l))
        .filter_map(|e| match e {
            AgentEvent::Notice { message } if message.contains("resumiu a conversa") => Some(message),
            _ => None,
        })
        .collect()
}

/// Linha `result` REAL de um desfecho de ERRO do print mode, capturada em
/// 16/08/2026 forçando `--print-timeout 2s` num turno de verdade (exit 1,
/// stderr VAZIO). É a prova que faltava no §5.1 do incidente 2026-08-16:
/// o `response` vem vazio MESMO, e a razão está em `error`.
pub(super) const AGY_RESULT_ERRO: &str = r#"{"event":"result","result":{"conversation_id":"83fedb99-22c9-408c-83a4-b550c705aa55","status":"ERROR","response":"","error":"timeout waiting for response","duration_seconds":0.041688,"num_turns":1,"usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":0}}}"#;

// ---- fronteira do slug de modelo (regressão de 14/08/2026) ----

/// O erro REAL que o usuário viu, com o slug exatamente como saiu do
/// parser podre: `--model "gemini-3.7-flash-high\tGemini 3.7 Flash (High)"`
/// → "model … is not recognized as a known model". A fronteira recusa
/// ANTES do spawn e a mensagem diz qual é o id certo.
#[test]
fn slug_com_rotulo_colado_e_recusado_na_fronteira() {
    let sujo = "gemini-3.7-flash-high\tGemini 3.7 Flash (High)";
    let erro = validate_model_slug(Some(sujo)).expect_err("slug com TAB não pode passar");
    assert!(
        erro.contains("gemini-3.7-flash-high"),
        "a mensagem aponta o id limpo: {erro}"
    );
    assert!(
        erro.contains("seletor"),
        "a mensagem diz o que fazer: {erro}"
    );
}

#[test]
fn slug_com_espaco_ou_quebra_de_linha_tambem_e_recusado() {
    // rótulo colado por espaço (outra listagem, mesmo estrago) e sobra de
    // linha inteira: nenhum dos dois é o VALOR de uma flag.
    assert!(validate_model_slug(Some("Gemini 3.7 Flash (High)")).is_err());
    assert!(validate_model_slug(Some("gemini-3.7-flash-low\n")).is_err());
    assert!(validate_model_slug(Some("   ")).is_err());
}

#[test]
fn slug_limpo_e_ausencia_de_modelo_passam() {
    // sem modelo = default do CLI, que é um estado legítimo (não é erro).
    assert!(validate_model_slug(None).is_ok());
    for limpo in [
        "gemini-3.7-flash-high",
        "claude-opus-5[1m]",
        "gpt-5.6-sol",
        "default",
    ] {
        assert!(
            validate_model_slug(Some(limpo)).is_ok(),
            "{limpo} é slug válido"
        );
    }
}

// ---- registry de capabilities (G1, capability-registry-plan) ----

/// Gêmeo de `agents.mcpEscopo.test.ts`: é por este eixo que a tela diz por
/// onde o navegador da Frota chega a cada motor (ADR-224 §4).
#[test]
fn matriz_mcp_escopo_por_agent() {
    for (agent, escopo) in [
        ("claude-code", "por-run"),
        ("codex", "por-run"),
        ("agy", "global"),
        ("opencode", "por-projeto"),
    ] {
        assert_eq!(capabilities_of(agent).unwrap().mcp_escopo.rotulo(), escopo, "{agent}");
    }
}

/// Gêmeo de `agents.runMcpDeny.test.ts`. Só quem PROVOU negar um MCP do
/// cadastro global por run declara `true`; o resto nomeia e segue.
#[test]
fn matriz_run_mcp_deny_por_agent() {
    for (agent, nega) in [
        ("claude-code", true),
        ("codex", false),
        ("agy", false),
        ("opencode", false),
    ] {
        assert_eq!(capabilities_of(agent).unwrap().run_mcp_deny, nega, "{agent}");
    }
}

#[test]
fn regra_do_claude_casa_o_prefixo_que_ele_da_as_tools() {
    assert_eq!(claude_mcp_rule("playwright"), "mcp__playwright");
    assert_eq!(claude_mcp_rule("chrome-devtools"), "mcp__chrome-devtools");
    assert_eq!(claude_mcp_rule("claude.ai Gmail"), "mcp__claude_ai_Gmail");
}

#[test]
fn negar_mcp_so_chega_ao_argv_de_quem_declara_a_capability() {
    for agent in registered_agents() {
        let caps = capabilities_of(agent).unwrap();
        let mut r = req(Permission::Padrao, false);
        r.denied_mcp_servers = vec!["playwright".into()];
        let mut a = resolve(agent).unwrap();
        let args = argv(&a.build_command(&r).unwrap());
        let negou = args
            .windows(2)
            .any(|par| par[0] == "--disallowedTools" && par[1].split(',').any(|t| t == "mcp__playwright"));
        assert_eq!(negou, caps.run_mcp_deny, "{agent}");
    }
}

#[test]
fn claude_negado_nem_sobe_o_servidor() {
    let mut r = req(Permission::Padrao, false);
    r.denied_mcp_servers = vec!["playwright".into()];
    let args = argv(&resolve("claude-code").unwrap().build_command(&r).unwrap());
    let settings = args
        .windows(2)
        .find(|par| par[0] == "--settings")
        .map(|par| par[1].clone())
        .expect("settings com o servidor negado");
    let v: serde_json::Value = serde_json::from_str(&settings).unwrap();
    assert_eq!(v, serde_json::json!({ "deniedMcpServers": [{ "serverName": "playwright" }] }));
    // sem negado, nenhum settings a mais
    let limpo = argv(&resolve("claude-code").unwrap().build_command(&req(Permission::Padrao, false)).unwrap());
    assert!(!limpo.iter().any(|a| a == "--settings"));
}

#[test]
fn matriz_work_mcp_por_agent() {
    for (agent, work, global) in [
        ("claude-code", true, false),
        ("codex", true, false),
        ("agy", true, true),
        ("opencode", false, false),
    ] {
        let caps = capabilities_of(agent).unwrap();
        assert_eq!((caps.work_mcp, caps.work_mcp_global_env), (work, global));
    }
}

#[test]
fn canal_global_sem_gateway_ou_em_fusion_nao_herda_socket_ambiental() {
    for permission in [Permission::Padrao, Permission::FusionRo] {
        let mut r = req(permission, false);
        if matches!(permission, Permission::FusionRo) {
            r.work_gateway = Some(crate::work_gateway::GatewayConfig {
                server_bin: "/app/frota".into(),
                socket: "/tmp/socket-proibido".into(),
            });
        }
        let command = AgyAdapter::default().build_command(&r).unwrap();
        assert_eq!(
            command
                .as_std()
                .get_envs()
                .find(|(name, _)| *name == crate::work_gateway::SOCK_ENV),
            Some((std::ffi::OsStr::new(crate::work_gateway::SOCK_ENV), None))
        );
    }
}

/// G1.4 — teste de CONTRATO: para CADA agent registrado, num loop (nunca
/// um teste copiado por agent), a capability declarada tem que corresponder
/// ao comportamento do build_command / on_stdout_line. É o teste que impede
/// o próximo vazamento: agent novo declara capabilities e este loop cobra.
/// (reports_cost é de DIALETO de stream, coberto pelos testes de map_line
/// por adapter; deferred_work idem no stream, e no build_command ganha o
/// contrato do FusionRo abaixo (G3.1); command_sources tem contrato
/// próprio em sources.rs; native_slash é consumido no espelho TS, lá.)
#[test]
fn contrato_capabilities_x_comportamento_por_agent() {
    for agent in registered_agents() {
        let caps = capabilities_of(agent).expect("agent registrado tem capabilities");
        // RunRequest "cheio": tudo oferecido; o adapter só monta o que declara.
        let mut r = req(Permission::Padrao, false);
        r.resume = Some("sessao-do-contrato".to_string());
        r.model = Some("modelo-do-contrato".to_string());
        r.system_prompt = Some("DOUTRINA-DO-CONTRATO".to_string());
        r.context_gateway = Some(crate::context_gateway::GatewayConfig {
            server_bin: "/app/frota".into(),
            root: "/repo".into(),
            conv_id: "c-contrato".into(),
            db_path: None, citadas: Default::default(),
        });
        r.work_gateway = Some(crate::work_gateway::GatewayConfig {
            server_bin: "/app/frota".into(),
            socket: "/tmp/frota-work-contrato.sock".into(),
        });
        r.approval = Some((
            "/app/frota".into(),
            "/tmp/frota-approval-contrato.sock".into(),
        ));
        r.mcp_plan = crate::mcp_control::McpRunPlan {
            managed: true,
            selected: vec![external_mcp()],
            ..Default::default()
        };
        let mut a = resolve(agent).unwrap();
        assert!(
            std::ptr::eq(a.capabilities(), caps),
            "{agent}: capabilities_of e o adapter têm que apontar pra MESMA declaração"
        );
        let command = a.build_command(&r).unwrap();
        let inherited_work = command
            .as_std()
            .get_envs()
            .find(|(name, _)| *name == crate::work_gateway::SOCK_ENV)
            .and_then(|(_, value)| value);
        assert_eq!(
            inherited_work,
            caps.work_mcp_global_env
                .then(|| std::ffi::OsStr::new("/tmp/frota-work-contrato.sock")),
            "{agent}: socket global precisa chegar exatamente pelo ambiente do filho",
        );
        let args = argv(&command);
        // H1 — canal system: o conteúdo de sistema pedido pelo app aparece
        // no argv do canal (--append-system-prompt) SSE o motor declara a
        // capability; e NUNCA vaza pro corpo do prompt. Motor sem canal
        // IGNORA o campo (o route_system_prompt do runner já dobrou no
        // corpo antes do build_command — testado à parte).
        let system_blob = args
            .windows(2)
            .filter(|pair| pair[0] == "--append-system-prompt")
            .map(|pair| pair[1].clone())
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(
            system_blob.contains("DOUTRINA-DO-CONTRATO"),
            caps.system_channel,
            "{agent}: system_channel declarado ≠ system prompt no canal do comando"
        );
        let prompt_arg = args
            .iter()
            .find(|arg| arg.contains("faça X"))
            .expect("o prompt sempre chega ao comando");
        assert_prompt_contract(agent, a.cli_prompt_contract(), &args, prompt_arg);
        assert!(
            !prompt_arg.contains("DOUTRINA-DO-CONTRATO"),
            "{agent}: o adapter nunca dobra system prompt no corpo (isso é papel do runner)"
        );
        let blob = args.join(" ");
        assert_eq!(
            blob.contains("sessao-do-contrato"),
            caps.session_resume,
            "{agent}: session_resume declarado ≠ resume no comando montado"
        );
        // native_compact: o caminho nativo do /compactar É "resume +
        // prompt /compact" — declarar compactação nativa sem resume seria
        // prometer um alvo que o build_command não sabe mirar.
        assert!(
            !caps.native_compact || caps.session_resume,
            "{agent}: native_compact declarado exige session_resume (o /compact viaja via resume)"
        );
        // ADR-033: usage acumulado da THREAD só é problema porque os turnos
        // seguintes retomam a mesma thread. Sem resume, todo run é thread
        // nova e o acumulado JÁ é o do turno — declarar cumulative_usage aí
        // prometeria um baseline que o app nunca teria como montar.
        assert!(
            !caps.cumulative_usage || caps.session_resume,
            "{agent}: cumulative_usage declarado exige session_resume (o acumulado só cresce entre turnos da MESMA thread)"
        );
        // Medidor de janela de uso: perguntar só faz sentido pra quem tem
        // medidor, e PUSH não se pergunta (a statusline chega sozinha; o
        // `usage_fetch` com ela viraria um probe que não existe).
        assert!(
            caps.usage_window_poll.is_none() || caps.usage_window.is_some(),
            "{agent}: usage_window_poll declarado sem usage_window (poll de um medidor que não existe)"
        );
        assert!(
            caps.usage_window_poll != Some(UsageWindowSource::ClaudeStatusline),
            "{agent}: statusline é PUSH, não pode ser o dialeto do poll"
        );
        // M1 do model-autonomy-plan: perguntar ao CLI quais modelos ele
        // conhece só serve pra motor que ACEITA a escolha de modelo no
        // comando — sonda alimentando um seletor que não chega ao spawn
        // seria lista decorativa. É IMPLICAÇÃO, não igualdade: o claude
        // aceita `--model` e mesmo assim declara `lists_models: None`
        // (nenhuma fonte viva existe lá), que é a degradação honesta.
        assert!(
            caps.lists_models.is_none() || blob.contains("modelo-do-contrato"),
            "{agent}: lists_models declarado, mas o modelo escolhido não chega ao comando montado"
        );
        // M2: a fumaça testa UM slug — ela só existe pra motor que aceita
        // a escolha de modelo no comando. Mesmo racional do lists_models.
        assert!(
            caps.model_smoke.is_none() || blob.contains("modelo-do-contrato"),
            "{agent}: model_smoke declarado, mas o modelo escolhido não chega ao comando montado"
        );
        // …e listar sem saber testar deixaria o candidato listado sem
        // veredito possível: a fonte viva (M1) responde "existe?", a
        // fumaça (M2) responde "funciona com a SUA auth?". A recíproca é
        // falsa de propósito — o claude testa e não lista.
        assert!(
            caps.lists_models.is_none() || caps.model_smoke.is_some(),
            "{agent}: lists_models declarado sem model_smoke (lista sem como verificar)"
        );
        assert_eq!(
            blob.contains(crate::work_gateway::MCP_SERVER_NAME) || inherited_work.is_some(),
            caps.work_mcp,
            "{agent}: work_mcp declarado ≠ injeção do frota-work no comando"
        );
        assert_eq!(
            blob.contains(crate::context_gateway::MCP_SERVER_NAME),
            caps.context_mcp,
            "{agent}: context_mcp declarado ≠ injeção do frota-context no comando"
        );
        assert_eq!(
            blob.contains(crate::approval::MCP_SERVER_NAME),
            caps.inline_interaction,
            "{agent}: inline_interaction declarado ≠ frota-approval no comando"
        );
        assert_eq!(
            blob.contains("mcx-claude-hostinger"),
            caps.mcp_escopo.por_run(),
            "{agent}: escopo por-run declarado ≠ MCP externo do plano no comando"
        );
        // O contrato do `sandbox_proprio`: quem declara confinar sozinho
        // TEM que passar flag de sandbox pro próprio binário. Sem isto a
        // capability seria uma promessa — e ela é o que TIRA o envelope da
        // Frota, então uma promessa falsa aqui deixa o turno SEM
        // confinamento nenhum (fail-open no eixo de segurança).
        //
        // É a metade que faltava no incidente de 04–09/09/2026, ao
        // contrário: lá o problema era o envelope somado ao sandbox do
        // motor; aqui é o envelope retirado de quem não tem sandbox.
        let leitura_blob = argv(
            &resolve(agent)
                .unwrap()
                .build_command(&req(Permission::Leitura, false))
                .unwrap(),
        )
        .join(" ");
        if caps.sandbox_proprio.dispensa_envelope() {
            assert!(
                leitura_blob.contains("read-only") || leitura_blob.contains("--sandbox"),
                "{agent}: declara confinar sozinho e não passa flag de sandbox em Leitura — \
                 a Frota vai TIRAR o envelope e o turno fica sem confinamento: {leitura_blob}"
            );
        }
        // G3.1 — a arena do Fusion não renderiza trabalho diferido: motor
        // com `deferred_work` tem a tool Workflow SUPRIMIDA no spawn do
        // candidato (task órfão em silêncio é pior que a tool ausente).
        // Decisão por capability, cobrada aqui pra TODO agent registrado.
        let fusion_blob = argv(
            &resolve(agent)
                .unwrap()
                .build_command(&req(Permission::FusionRo, false))
                .unwrap(),
        )
        .join(" ");
        assert_eq!(
            fusion_blob.contains("Workflow"),
            caps.deferred_work,
            "{agent}: deferred_work declarado ≠ supressão do Workflow no FusionRo"
        );
        // structured_output: linha crua não-JSON vira Unknown (estruturado)
        // ou texto do assistente (não-estruturado) — NUNCA some em silêncio.
        let evs = resolve(agent)
            .unwrap()
            .on_stdout_line("linha crua que não é JSON");
        let unknown = evs.iter().any(|e| matches!(e, AgentEvent::Unknown { .. }));
        let texto = evs
            .iter()
            .any(|e| matches!(e, AgentEvent::TextDelta { .. } | AgentEvent::Text { .. }));
        assert_eq!(
            unknown, caps.structured_output,
            "{agent}: structured_output"
        );
        assert_eq!(
            texto, !caps.structured_output,
            "{agent}: adapter não-estruturado degrada a linha pra texto"
        );
        assert!(
            unknown || texto,
            "{agent}: linha crua não pode ser descartada (regra de ouro)"
        );
    }
}

/// A factory canonicaliza "" → claude-code (conversas antigas) e recusa
/// desconhecido; capabilities_of segue a MESMA regra (fonte única).
#[test]
fn registry_canonicaliza_vazio_e_recusa_desconhecido() {
    assert!(std::ptr::eq(
        capabilities_of("").unwrap(),
        capabilities_of("claude-code").unwrap()
    ));
    assert!(capabilities_of("aider").is_none());
    assert!(resolve("aider").is_err());
    // validação de fronteira NÃO canonicaliza: "" não é binding válido.
    assert!(!is_registered(""));
    assert!(is_registered("claude-code"));
    // A lista é EXATA de propósito: motor novo não entra sem alguém
    // reparar. O opencode entrou em 26/08/2026 (ADR-095).
    assert_eq!(
        registered_agents().collect::<Vec<_>>(),
        vec!["claude-code", "codex", "agy", "opencode"]
    );
}

/// A tabela de escopo de MCP, medida motor a motor em 26/08/2026.
///
/// Está aqui porque o bool que existia antes (`managed_mcp`) colapsava
/// estas quatro respostas em duas, e a tela passou a mentir duas vezes
/// (ADR-100 e ADR-101). Se alguém mudar um valor destes sem medir de novo,
/// este teste quebra e pede a medição junto.
#[test]
fn o_escopo_de_mcp_de_cada_motor_e_o_que_foi_medido() {
    use McpEscopo::*;
    let escopo = |a: &str| capabilities_of(a).unwrap().mcp_escopo;
    // Config injetada no spawn: morre com o run, missões não se veem.
    assert_eq!(escopo("claude-code"), PorRun);
    assert_eq!(escopo("codex"), PorRun);
    // `opencode.json` do DIRETÓRIO (provado dos dois lados: dentro do
    // projeto o `opencode mcp list` vê, fora não).
    assert_eq!(escopo("opencode"), PorProjeto);
    // `agy mcp add` não tem flag de escopo; config por projeto foi testada
    // e é IGNORADA. Vale para todos os projetos, e dura.
    assert_eq!(escopo("agy"), Global);

    // O control plane só opera com isolamento por run, e é isso que os
    // portões continuam perguntando. Nada mudou de comportamento aqui.
    assert!(escopo("claude-code").por_run() && escopo("codex").por_run());
    assert!(!escopo("agy").por_run() && !escopo("opencode").por_run());

    // A distinção que o bool não tinha, e que a copy atropelava: NÃO
    // rotear pelo app é diferente de não falar MCP. Os quatro falam.
    for agent in registered_agents() {
        assert!(
            escopo(agent).cli_fala_mcp(),
            "{agent}: nenhum motor do registry pode ser chamado de 'não suporta MCP'"
        );
    }
}

#[test]
fn materializadores_de_tools_preservam_escopo_e_forca_de_controle() {
    use CapabilityScope::*;
    use PolicyEnforceability::*;
    use ToolInventoryEvidence::*;
    use ToolMaterializerKind::*;

    for agent in registered_agents() {
        let caps = capabilities_of(agent).unwrap();
        let materializers = caps.tool_materializers();
        let native = materializers
            .iter()
            .find(|item| item.kind == ProviderNative)
            .expect("todo adapter declara a superfície nativa");
        assert_eq!(native.scope, Run, "{agent}: tool nativa vive no run");
        assert_eq!(native.enforceability, Advisory);
        assert!(!native.filters_per_run);

        let external = materializers
            .iter()
            .find(|item| item.kind == ExternalMcp)
            .expect("os quatro CLIs auditados falam MCP");
        let expected_scope = match caps.mcp_escopo {
            McpEscopo::PorRun => Run,
            McpEscopo::PorProjeto => Project,
            McpEscopo::Global => Global,
            McpEscopo::Nenhum => panic!("motor desta matriz fala MCP"),
        };
        assert_eq!(external.scope, expected_scope, "{agent}: escopo MCP");
        assert_eq!(external.inventory, Probe);
        assert_eq!(
            external.enforceability,
            if expected_scope == Run {
                Hard
            } else {
                Advisory
            }
        );
        assert_eq!(external.filters_per_run, expected_scope == Run);
    }

    assert_eq!(CLAUDE_CAPS.native_tool_inventory, RuntimeCount);
    assert_eq!(AGY_CAPS.native_tool_inventory, RuntimeCount);
    assert_eq!(CODEX_CAPS.native_tool_inventory, Opaque);
    assert_eq!(OPENCODE_CAPS.native_tool_inventory, Opaque);
}
