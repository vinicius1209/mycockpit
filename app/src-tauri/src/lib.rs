use tauri::Manager;
use tauri_plugin_decorum::WebviewWindowExt;
use tauri_plugin_sql::{Builder as SqlBuilder, Migration, MigrationKind};

/// Inset Y dos semáforos p/ centrá-los no header de 56px (h-14). Calibrado por
/// medição no app real (o inset do decorum não é o centro geométrico do botão).
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHTS_Y: f32 = 37.0;

mod acp;
mod adapters;
mod agent;
mod agy_recovery;
mod approval;
mod attachments;
mod browser;
mod browser_cdp;
mod browser_panel;
mod catalog;
mod claude_usage;
mod codex_appserver;
mod codex_resume_guard;
mod companion;
mod context;
mod context_gateway;
mod desktop;
mod despertador;
mod detect;
mod editor;
mod evidence;
mod experience_broker;
mod fsx;
mod git;
mod github;
mod hook_gateway;
mod hook_sessions;
mod hooks_install;
mod hud;
mod mcp_auth;
mod mcp_control;
mod mcp_instalacao;
mod mcp_proxy;
mod model_list;
mod model_smoke;
mod modes;
mod mycockpit;
mod notch;
mod opencode_acp;
mod opencode_auth;
mod osnotify;
mod path;
mod plugin_contributions;
mod plugin_control;
mod plugin_grants;
mod plugin_manifest;
mod plugin_mcp;
mod plugin_protocol;
mod plugin_runtime;
mod pricing;
mod proc;
mod processos;
mod provider_mcp_inventory;
mod quit;
mod resource_broker;
mod run_manifest;
mod run_processes;
mod run_resources;
mod sandbox;
pub mod scope_guidance;
mod sdd;
mod skills;
mod sources;
mod statusline_install;
mod stt;
mod tool_gateway;
mod tray;
mod update;
mod usage_window;
mod utility;
mod work_gateway;

/// Ponto de entrada do subcomando `approval-server`: ESTE binário rodando como
/// MCP server stdio quando o `claude -p` o spawna (aprovação granular inline).
/// Chamado pelo `main.rs` ANTES do Tauri subir; nunca retorna ao app normal.
pub fn run_approval_server() {
    approval::run_mcp_server();
}

/// Ponto de entrada do MCP read-only de memória/contexto. Diferente do server
/// de aprovação, este contrato é igual para qualquer provider que fale MCP.
pub fn run_context_server() {
    context_gateway::run_mcp_server();
}

/// Ponto de entrada do proxy MCP autenticado (A2): repassa JSON-RPC pro
/// endpoint remoto através do socket do app, que é quem guarda o token. Este
/// processo nunca recebe credencial.
pub fn run_mcp_proxy_server() {
    mcp_proxy::run_mcp_server();
}

/// Ponto de entrada do MCP de trabalho/processos, compartilhado por todo
/// provider que fale MCP.
pub fn run_work_server() {
    work_gateway::run_mcp_server();
}

/// Materializador MCP do Tool Catalog. O subprocesso só fala pelo socket do
/// run; grants, recursos e workers continuam pertencendo ao app.
pub fn run_tool_server() {
    tool_gateway::run_mcp_server();
}

/// Launcher supervisionado de um MCP stdio contribuído. O descriptor efêmero
/// é revalidado antes de qualquer byte do pacote ser executado.
pub fn run_plugin_mcp_server() {
    plugin_mcp::run_mcp_server();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
/// Backup rotativo do banco no boot (rede de segurança contra perda de dados).
/// Copia db + WAL + SHM (snapshot consistente: roda antes do plugin SQL abrir)
/// para app_data_dir/backups/mycockpit-{1..3}.db, no máx. 1x a cada ~20h.
fn backup_database(app: &tauri::AppHandle) -> Result<(), String> {
    let data = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("sem app_data_dir: {e}"))?;
    let db = data.join("mycockpit.db");
    if !db.exists() {
        return Ok(()); // primeira execução: nada a proteger ainda
    }
    let dir = data.join("backups");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // já tem backup fresco (<20h)? então não gira (1 backup por dia de uso).
    let newest = dir.join("mycockpit-1.db");
    if let Ok(meta) = std::fs::metadata(&newest) {
        if let Ok(modified) = meta.modified() {
            if let Ok(age) = std::time::SystemTime::now().duration_since(modified) {
                if age < std::time::Duration::from_secs(20 * 60 * 60) {
                    return Ok(());
                }
            }
        }
    }

    // rotação 2→3, 1→2 (o 3 mais antigo cai), depois copia o atual pro 1.
    for (from, to) in [(2u8, 3u8), (1, 2)] {
        for ext in ["db", "db-wal", "db-shm"] {
            let src = dir.join(format!("mycockpit-{from}.{ext}"));
            if src.exists() {
                let _ = std::fs::rename(&src, dir.join(format!("mycockpit-{to}.{ext}")));
            }
        }
    }
    for ext in ["db", "db-wal", "db-shm"] {
        let src = data.join(format!("mycockpit.{ext}"));
        let dst = dir.join(format!("mycockpit-1.{ext}"));
        if src.exists() {
            std::fs::copy(&src, &dst).map_err(|e| e.to_string())?;
        } else {
            let _ = std::fs::remove_file(&dst); // não deixa WAL órfão de outra era
        }
    }
    log::info!("backup do banco atualizado em {}", dir.display());
    Ok(())
}

pub fn run() {
    // ANTES de tudo: hidrata o PATH (apps GUI do macOS herdam um PATH mínimo e
    // não acham claude/codex/agy). Precisa rodar antes de qualquer spawn de CLI.
    path::hydrate_path();

    let migrations = vec![
        Migration {
            version: 1,
            description: "create_projects",
            sql: "CREATE TABLE IF NOT EXISTS projects ( \
                    id TEXT PRIMARY KEY, \
                    name TEXT NOT NULL, \
                    path TEXT NOT NULL UNIQUE, \
                    created_at INTEGER NOT NULL, \
                    has_claude_md INTEGER NOT NULL DEFAULT 0, \
                    has_agents_md INTEGER NOT NULL DEFAULT 0 \
                  );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_conversations",
            sql: "CREATE TABLE IF NOT EXISTS conversations ( \
                    project_id TEXT PRIMARY KEY, \
                    session_id TEXT, \
                    items TEXT NOT NULL, \
                    updated_at INTEGER NOT NULL \
                  );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "projects_permission_mode",
            sql: "ALTER TABLE projects ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'padrao';",
            kind: MigrationKind::Up,
        },
        // Multi-conversa (Sprint 2): conversa vira entidade com id próprio.
        // Split em 5 migrações de 1 statement, tauri-plugin-sql roda 1 por vez.
        Migration {
            version: 4,
            description: "conversations_v2_create",
            sql: "CREATE TABLE conversations_new ( \
                    id TEXT PRIMARY KEY, \
                    project_id TEXT NOT NULL, \
                    title TEXT, \
                    session_id TEXT, \
                    items TEXT NOT NULL, \
                    created_at INTEGER NOT NULL, \
                    updated_at INTEGER NOT NULL \
                  );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "conversations_v2_migrate",
            sql: "INSERT INTO conversations_new (id, project_id, title, session_id, items, created_at, updated_at) \
                  SELECT lower(hex(randomblob(16))), project_id, NULL, session_id, items, updated_at, updated_at \
                  FROM conversations;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "conversations_v2_drop_old",
            sql: "DROP TABLE conversations;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "conversations_v2_rename",
            sql: "ALTER TABLE conversations_new RENAME TO conversations;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "conversations_project_idx",
            sql: "CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "conversations_suggestions",
            sql: "ALTER TABLE conversations ADD COLUMN suggestions TEXT NOT NULL DEFAULT '[]';",
            kind: MigrationKind::Up,
        },
        // v0.2.x, persiste o agent + modelo + effort por conversa (cross-restart),
        // p/ o resume usar o CLI certo e a UI refletir o que travou no 1º run.
        Migration {
            version: 10,
            description: "conversations_agent",
            sql: "ALTER TABLE conversations ADD COLUMN agent TEXT NOT NULL DEFAULT 'claude-code';",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 11,
            description: "conversations_req_model",
            sql: "ALTER TABLE conversations ADD COLUMN req_model TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 12,
            description: "conversations_effort",
            sql: "ALTER TABLE conversations ADD COLUMN effort TEXT;",
            kind: MigrationKind::Up,
        },
        // Conserta conversas legadas (pré-persistência de agent): a v10 jogou
        // 'claude-code' em TODAS, inclusive as do Codex. Sessão uuid-v7 (15ª
        // char='7') = Codex; uuid-v4 ('4') = Claude. Reetiqueta só as v7 ainda
        // marcadas claude-code, senão o resume usa o CLI errado.
        Migration {
            version: 13,
            description: "fix_legacy_codex_agent",
            sql: "UPDATE conversations SET agent = 'codex' WHERE agent = 'claude-code' AND substr(session_id, 15, 1) = '7';",
            kind: MigrationKind::Up,
        },
        // v0.3 Fusion, arquiva cada disputa (auditável pós-restart; alimenta "ver disputa").
        Migration {
            version: 14,
            description: "fusion_runs",
            sql: "CREATE TABLE IF NOT EXISTS fusion_runs (id TEXT PRIMARY KEY, conv_id TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL);",
            kind: MigrationKind::Up,
        },
        // v15, `pending`=1 marca uma disputa esperando DECISÃO (caso 2): sobrevive
        // ao restart até o usuário escolher o vencedor. Confirmar/descartar zera.
        Migration {
            version: 15,
            description: "fusion_runs_pending",
            sql: "ALTER TABLE fusion_runs ADD COLUMN pending INTEGER NOT NULL DEFAULT 0;",
            kind: MigrationKind::Up,
        },
        // v16, soft delete de projeto (deleted_at NULL = ativo): restaurar + métricas.
        Migration {
            version: 16,
            description: "projects_deleted_at",
            sql: "ALTER TABLE projects ADD COLUMN deleted_at INTEGER;",
            kind: MigrationKind::Up,
        },
        // v17/v18, rótulo de cor (hex ou NULL) por conversa e por projeto.
        Migration {
            version: 17,
            description: "conversations_color",
            sql: "ALTER TABLE conversations ADD COLUMN color TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 18,
            description: "projects_color",
            sql: "ALTER TABLE projects ADD COLUMN color TEXT;",
            kind: MigrationKind::Up,
        },
        // v19, worktree isolado por conversa (NULL = compartilha a pasta do projeto).
        Migration {
            version: 19,
            description: "conversations_worktree_path",
            sql: "ALTER TABLE conversations ADD COLUMN worktree_path TEXT;",
            kind: MigrationKind::Up,
        },
        // v20/21, custo por ENTREGA: cada etapa SDD dirigida pelo cockpit vira
        // uma linha (o join com o manifest responde "quanto custou a feature").
        Migration {
            version: 20,
            description: "stage_runs",
            sql: "CREATE TABLE IF NOT EXISTS stage_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, slug TEXT NOT NULL, skill TEXT NOT NULL, agent TEXT NOT NULL, model TEXT, ok INTEGER NOT NULL, cost_usd REAL, cost_source TEXT, duration_ms INTEGER, created_at INTEGER NOT NULL);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 21,
            description: "stage_runs_idx",
            sql: "CREATE INDEX IF NOT EXISTS idx_stage_runs_plan ON stage_runs(project_id, slug);",
            kind: MigrationKind::Up,
        },
        // v22, ledger de custo POR TURNO de chat linear (o gasto real que o strip
        // "hoje/7d" não via — só missões gravavam deliveries). run_id como PK:
        // o CLI emite results parciais na mesma invocação; o REPLACE por run_id
        // colapsa nos totais finais do turno (mesmo racional do reducer do chat).
        Migration {
            version: 22,
            description: "turn_costs",
            sql: "CREATE TABLE IF NOT EXISTS turn_costs (run_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, conv_id TEXT NOT NULL, agent TEXT NOT NULL, model TEXT, cost_usd REAL, cost_source TEXT, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cache_tokens INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 23,
            description: "turn_costs_time_idx",
            sql: "CREATE INDEX IF NOT EXISTS idx_turn_costs_time ON turn_costs(created_at);",
            kind: MigrationKind::Up,
        },
        // P2 da auditoria de modelos: persiste o modelo RESOLVIDO da sessão
        // (o que o CLI reportou no init), distinto do req_model (o pedido).
        // TitleBar/histórico sobrevivem ao restart sem degradar pro rótulo do
        // agent, e a validação pedido×resolvido segue válida pós-reload.
        Migration {
            version: 24,
            description: "conversations_model",
            sql: "ALTER TABLE conversations ADD COLUMN model TEXT;",
            kind: MigrationKind::Up,
        },
        // Sprint 3 (E2, Agent Presets): a conversa carimba QUAL preset a
        // iniciou (preset_id) e a versão exata dele via digest (preset_digest),
        // padrão role_ref+role_digest do MyPeople. A tabela agent_presets em si
        // nasce do frontend (ensureAgentPresetTables no db.ts); aqui só o
        // carimbo em conversations. v25/v26 reservadas no plano pra isto.
        Migration {
            version: 25,
            description: "conversations_preset_id",
            sql: "ALTER TABLE conversations ADD COLUMN preset_id TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 26,
            description: "conversations_preset_digest",
            sql: "ALTER TABLE conversations ADD COLUMN preset_digest TEXT;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 27,
            description: "mcp_registry",
            sql: "CREATE TABLE IF NOT EXISTS mcp_servers ( \
                    id TEXT PRIMARY KEY, \
                    name TEXT NOT NULL, \
                    source TEXT NOT NULL, \
                    scope TEXT NOT NULL, \
                    source_agent TEXT, \
                    transport TEXT NOT NULL, \
                    locator TEXT NOT NULL, \
                    env_keys_json TEXT NOT NULL DEFAULT '[]', \
                    fingerprint TEXT NOT NULL, \
                    managed INTEGER NOT NULL DEFAULT 1, \
                    portable INTEGER NOT NULL DEFAULT 0, \
                    source_enabled INTEGER NOT NULL DEFAULT 1, \
                    last_seen_at INTEGER NOT NULL \
                  );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 28,
            description: "mcp_bindings",
            sql: "CREATE TABLE IF NOT EXISTS mcp_bindings ( \
                    project_id TEXT NOT NULL, \
                    server_id TEXT NOT NULL, \
                    agent TEXT NOT NULL, \
                    required INTEGER NOT NULL DEFAULT 0, \
                    fallback TEXT NOT NULL DEFAULT 'ask', \
                    updated_at INTEGER NOT NULL, \
                    PRIMARY KEY (project_id, server_id, agent) \
                  );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 29,
            description: "mcp_health",
            sql: "CREATE TABLE IF NOT EXISTS mcp_health ( \
                    project_id TEXT NOT NULL, \
                    server_id TEXT NOT NULL, \
                    agent TEXT NOT NULL, \
                    status TEXT NOT NULL, \
                    detail TEXT, \
                    tool_names_json TEXT NOT NULL DEFAULT '[]', \
                    checked_at INTEGER NOT NULL, \
                    PRIMARY KEY (project_id, server_id, agent) \
                  );",
            kind: MigrationKind::Up,
        },
        // Sidebar S1.2 (docs/sidebar-plan.md) — reordenação manual. v30-v33
        // registradas no plano. `sort_order` é a ordem do USUÁRIO; os backfills
        // preservam a ordem de exibição vigente (projetos: created_at DESC;
        // conversas: created_at ASC dentro do projeto), com desempate por id
        // pra ranking estável quando dois created_at empatam.
        Migration {
            version: 30,
            description: "projects_sort_order",
            sql: "ALTER TABLE projects ADD COLUMN sort_order INTEGER;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 31,
            description: "projects_sort_order_backfill",
            sql: "UPDATE projects SET sort_order = ( \
                    SELECT COUNT(*) FROM projects p2 \
                     WHERE p2.created_at > projects.created_at \
                        OR (p2.created_at = projects.created_at AND p2.id < projects.id) \
                  );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 32,
            description: "conversations_sort_order",
            sql: "ALTER TABLE conversations ADD COLUMN sort_order INTEGER;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 33,
            description: "conversations_sort_order_backfill",
            sql: "UPDATE conversations SET sort_order = ( \
                    SELECT COUNT(*) FROM conversations c2 \
                     WHERE c2.project_id = conversations.project_id \
                       AND (c2.created_at < conversations.created_at \
                        OR (c2.created_at = conversations.created_at AND c2.id < conversations.id)) \
                  );",
            kind: MigrationKind::Up,
        },
        // ADR-033: até aqui, TODA linha de turn_costs de um motor com usage
        // acumulado por thread (codex) guardava o ACUMULADO como se fosse do
        // turno. A coluna carimba a base de cada linha: 'delta' = gasto do
        // turno (o correto, gravado da correção em diante), 'recomputed' =
        // reconstruída pela manutenção das Configurações, NULL = linha antiga,
        // base desconhecida. Sem ela não dá pra distinguir histórico inflado de
        // linha sã, e a reconstrução comeria as linhas certas.
        Migration {
            version: 34,
            description: "turn_costs_usage_basis",
            sql: "ALTER TABLE turn_costs ADD COLUMN usage_basis TEXT;",
            kind: MigrationKind::Up,
        },
        // B2.2 (docs/browser-plan.md): o binding marca quais MCPs dirigem o
        // NAVEGADOR DO PROJETO (o Chromium que o app possui). Propriedade do
        // binding, nunca do nome do fornecedor: o plano efêmero injeta
        // `--cdp-endpoint` só em quem foi marcado, e o default é desligado.
        Migration {
            version: 35,
            description: "mcp_bindings_browser",
            sql: "ALTER TABLE mcp_bindings ADD COLUMN browser INTEGER NOT NULL DEFAULT 0;",
            kind: MigrationKind::Up,
        },
        // O anel de contexto do composer (ContextRing.tsx) só vivia em memória
        // (evento context_usage do motor) — fechar o app ou trocar de conversa
        // e voltar apagava o número, mesmo numa conversa com contexto pesado
        // de verdade. NULL = nunca rodou turno nesta linha (nada a mostrar,
        // não é zero).
        Migration {
            version: 36,
            description: "conversations_context_tokens",
            sql: "ALTER TABLE conversations ADD COLUMN context_tokens INTEGER;",
            kind: MigrationKind::Up,
        },
        // M3 dos modos de sessão: o modo passa a ser da CONVERSA, e o do
        // projeto vira o DEFAULT de quem nasce. NULL = herda o projeto (não é
        // "sem modo"), e é por isso que a coluna nasce nullable em vez de com
        // um default: um valor aqui significa "esta conversa decidiu".
        //
        // De quebra conserta um sumiço silencioso: o "Planejar primeiro" só
        // vivia em memória (não havia coluna), então ligar e reiniciar o app
        // desligava sozinho.
        Migration {
            version: 37,
            description: "conversations_session_mode",
            sql: "ALTER TABLE conversations ADD COLUMN session_mode TEXT;",
            kind: MigrationKind::Up,
        },
        // Janela efetiva da sessão, quando o próprio runtime a informa. Nunca
        // é derivada do consumo (foi essa inferência que fabricou "1M").
        Migration {
            version: 38,
            description: "conversations_context_window",
            sql: "ALTER TABLE conversations ADD COLUMN context_window INTEGER;",
            kind: MigrationKind::Up,
        },
        // Procedência do snapshot: `last_call` ou `unavailable`. NULL é
        // deliberadamente legado/não confiável — context_tokens gravado antes
        // desta migração pode ser o total processado no turno do Codex.
        Migration {
            version: 39,
            description: "conversations_context_basis",
            sql: "ALTER TABLE conversations ADD COLUMN context_basis TEXT;",
            kind: MigrationKind::Up,
        },
        // Rascunho é entidade própria: não entra no fio até o gesto de enviar,
        // mas texto e anexos sobrevivem à troca de conversa e ao restart.
        Migration {
            version: 40,
            description: "create_conversation_drafts",
            sql: "CREATE TABLE IF NOT EXISTS conversation_drafts ( \
                    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE, \
                    text TEXT NOT NULL DEFAULT '', \
                    attachments TEXT NOT NULL DEFAULT '[]', \
                    updated_at INTEGER NOT NULL DEFAULT 0 \
                  );",
            kind: MigrationKind::Up,
        },
        // Plugins só ficam disponíveis depois de uma decisão humana sobre o
        // fingerprint e o conjunto exato de capabilities. Atualizar qualquer
        // arquivo do pacote torna o grant antigo obsoleto, sem executar código.
        Migration {
            version: 41,
            description: "create_plugin_grants",
            sql: "CREATE TABLE IF NOT EXISTS plugin_grants ( \
                    plugin_key TEXT PRIMARY KEY, \
                    fingerprint TEXT NOT NULL, \
                    capabilities_json TEXT NOT NULL, \
                    enabled INTEGER NOT NULL DEFAULT 1, \
                    reviewed_at INTEGER NOT NULL, \
                    updated_at INTEGER NOT NULL \
                  );",
            kind: MigrationKind::Up,
        },
        // Trilha curta e sanitizada das decisões e execuções. Não guarda input,
        // output, credenciais nem paths; serve para explicar estado e falhas.
        Migration {
            version: 42,
            description: "create_plugin_audit_events",
            sql: "CREATE TABLE IF NOT EXISTS plugin_audit_events ( \
                    id INTEGER PRIMARY KEY AUTOINCREMENT, \
                    plugin_key TEXT NOT NULL, \
                    event TEXT NOT NULL, \
                    outcome TEXT NOT NULL, \
                    detail TEXT, \
                    fingerprint TEXT, \
                    created_at INTEGER NOT NULL \
                  );",
            kind: MigrationKind::Up,
        },
        // Linhagem e agrupamento de forks na sidebar/mesa (forks-e-linhagem-agrupada-plan.md).
        // Registra a conversa de origem quando uma conversa nasce de um fork ou duplicata.
        Migration {
            version: 43,
            description: "add_parent_id_to_conversations",
            sql: "ALTER TABLE conversations ADD COLUMN parent_id TEXT REFERENCES conversations(id) ON DELETE SET NULL;",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 44,
            description: "create_conversation_maps",
            sql: "CREATE TABLE IF NOT EXISTS conversation_maps ( \
                    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE, \
                    schema_version INTEGER NOT NULL, prompt_version INTEGER NOT NULL, \
                    payload_json TEXT NOT NULL, summarized_through_item_id TEXT, \
                    summarized_through_ts INTEGER, input_digest TEXT NOT NULL, \
                    source_kind TEXT NOT NULL, source_id TEXT NOT NULL, \
                    source_fingerprint TEXT, generation_mode TEXT NOT NULL, \
                    generated_at INTEGER NOT NULL, latency_ms INTEGER, \
                    turns_since_rebase INTEGER NOT NULL DEFAULT 0, cost_usd REAL, \
                    cost_source TEXT \
                  );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 45,
            description: "create_conversation_map_pins",
            sql: "CREATE TABLE IF NOT EXISTS conversation_map_pins ( \
                    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE, \
                    schema_version INTEGER NOT NULL, revision INTEGER NOT NULL, \
                    pins_json TEXT NOT NULL, updated_at INTEGER NOT NULL \
                  );",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 46,
            description: "create_utility_usage_daily",
            sql: "CREATE TABLE IF NOT EXISTS utility_usage_daily ( \
                    day TEXT NOT NULL, task TEXT NOT NULL, source_id TEXT NOT NULL, \
                    calls INTEGER NOT NULL DEFAULT 0, successes INTEGER NOT NULL DEFAULT 0, \
                    unpriced_calls INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, \
                    input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, \
                    last_latency_ms INTEGER, updated_at INTEGER NOT NULL, \
                    PRIMARY KEY (day, task, source_id) \
                  );",
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        // Logs precisam existir também na release: sem isso, uma falha do
        // WebView deixava só a janela preta e o Frota.log parado na build de
        // debug anterior. O teto + rotação limitam o disco a ~4 MB.
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .max_file_size(1_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(3))
                .build(),
        )
        .plugin(tauri_plugin_decorum::init())
        .setup(|app| {
            // Backup rotativo do banco ANTES de qualquer escrita da sessão (o
            // plugin SQL só abre depois, então db+wal+shm estão quiescentes).
            // Rede de segurança contra corrupção/perda: nunca bloqueia o boot.
            if let Err(e) = backup_database(app.handle()) {
                log::warn!("backup do banco falhou (seguindo sem): {e}");
            }

            // Catálogo de preços (models.dev): registra onde fica o cache em
            // disco p/ o pricing achar preços dinâmicos já na 1ª consulta.
            catalog::init(app.handle());

            // Titlebar overlay (decorum): visual unificado + traffic lights encaixados +
            // drag funcionando (sem o bug do Overlay nativo).
            let main_window = app
                .get_webview_window("main")
                .ok_or("janela main ausente")?;
            main_window.create_overlay_titlebar()?;
            // Semáforos centrados no header de 56px (h-14). Valor calibrado por
            // medição no app (o inset do decorum NÃO é o centro do botão).
            // O decorum reaplica a CONSTANTE (y=16) no observer de resize dele →
            // reaplicamos o nosso a cada evento de janela (ver on_window_event),
            // que roda DEPOIS (o delegate do decorum chama super = Tauri).
            #[cfg(target_os = "macos")]
            main_window.set_traffic_lights_inset(18.0, TRAFFIC_LIGHTS_Y)?;

            // Tray: o app vive na barra de menu com a janela fechada (as
            // automações agendadas continuam); só "Sair" encerra de verdade.
            tray::create(app.handle())?;
            // Presenter do instrumento: carrega a preferência nativa, mede a
            // tela e só então decide entre popover clássico e HUD flutuante.
            // Falha mantém o popover clássico utilizável.
            if let Err(error) = hud::initialize(app.handle()) {
                log::warn!("HUD indisponível no boot: {error}");
            }

            // H0 — receptor local de hooks/statusline (loopback, porta
            // efêmera, token por boot). Falha degrada com log, nunca derruba
            // o boot: o medidor de janela ainda funciona por poll (codex).
            hook_gateway::start(app.handle());

            Ok(())
        })
        // Fechar a janela = esconder (app segue vivo no tray). Cmd+Q / "Sair"
        // do tray NÃO passam por aqui (viram ExitRequested) e encerram normal.
        .on_window_event(|window, event| {
            if window.label() == "main" {
                // Reaplica o inset dos semáforos DEPOIS do decorum (que reseta
                // pra y=16 no resize dele): resize/move/foco durante o boot ou
                // pelo usuário reposicionavam os botões pro topo, desalinhando.
                #[cfg(target_os = "macos")]
                if matches!(
                    event,
                    tauri::WindowEvent::Resized(_)
                        | tauri::WindowEvent::Moved(_)
                        | tauri::WindowEvent::Focused(true)
                ) {
                    if let Some(w) = window.app_handle().get_webview_window("main") {
                        let _ = w.set_traffic_lights_inset(18.0, TRAFFIC_LIGHTS_Y);
                    }
                }
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    if tray::should_keep_in_tray(window.app_handle()) {
                        if let Err(error) = tray::hide_main_window(window) {
                            log::warn!("não consegui manter a janela em background: {error}");
                        }
                        tray::notify_window_hidden(window.app_handle());
                    } else {
                        quit::request_quit(window.app_handle(), quit::QuitOrigin::CloseWindow);
                    }
                }
            } else if window.label() == tray::POPOVER_LABEL {
                match event {
                    tauri::WindowEvent::Focused(false) => {
                        tray::mark_popover_blur_hidden(window.app_handle());
                        hud::collapse_after_blur(window.app_handle());
                    }
                    // Cmd+W (menu padrão do macOS) DESTRUIRIA o webview e o
                    // popover nunca é recriado (create só roda no setup).
                    tauri::WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        hud::collapse_after_blur(window.app_handle());
                    }
                    _ => {}
                }
            } else if window.label().starts_with("browser-panel-") {
                if matches!(event, tauri::WindowEvent::Destroyed) {
                    browser_panel::close_panel(window.app_handle(), window.label());
                }
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // Só pra LER a área de transferência no "Colar" do nosso menu de
        // contexto (ADR-042). No WKWebView, `navigator.clipboard.readText()`
        // devolve NotAllowedError pra conteúdo que a página não escreveu, e
        // `execCommand("paste")` devolve false — sem isto aqui, "Colar" seria
        // item morto. Escrita continua pelo `navigator.clipboard`, que
        // funciona: a capability libera SÓ `allow-read-text`.
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            SqlBuilder::default()
                .add_migrations("sqlite:mycockpit.db", migrations)
                .build(),
        )
        .manage(agent::RunRegistry::default())
        .manage(std::sync::Arc::new(work_gateway::ProcessRegistry::default()))
        .manage(std::sync::Arc::new(
            plugin_runtime::PluginRuntimeRegistry::default(),
        ))
        .manage(std::sync::Arc::new(
            resource_broker::ResourceLeaseRegistry::default(),
        ))
        .manage(std::sync::Arc::new(
            experience_broker::ExperienceBroker::default(),
        ))
        // Navegador POR PROJETO (B2.1): só o mapa projeto → sessão viva. O
        // processo em si mora no ProcessRegistry acima, então o kill_all do
        // quit já o alcança.
        .manage(std::sync::Arc::new(browser::BrowserRegistry::default()))
        .manage(std::sync::Arc::new(
            browser_cdp::BrowserPreviewRegistry::default(),
        ))
        .manage(browser_panel::BrowserPanelRegistry::default())
        .manage(hud::HudState::default())
        .manage(tray::TrayState::default())
        .manage(quit::QuitCoordinator::default())
        // Medidor de janela de uso: snapshots vivos por agent (fonte única
        // que o front hidrata no boot; ingest da statusline + poll gravam aqui).
        .manage(usage_window::UsageState::default())
        .manage(hook_sessions::ExternalSessions::default())
        .manage(attachments::ActiveConvs::default())
        .manage(stt::SttSession::default())
        .manage(std::sync::Arc::new(utility::UtilityState::new()))
        .manage(companion::CompanionState::default())
        // aprovação granular inline: registro compartilhado (listener por-run +
        // comando answer_approval) dos pedidos pendentes. Arc: o mesmo mapa é lido
        // pelas conexões do socket e pelo comando que entrega a decisão do usuário.
        .manage(std::sync::Arc::new(approval::PendingApprovals::default()))
        // jobs de update dos CLIs (update.rs): um job `running` por agent, com
        // dedupe no backend — a trava real contra N `brew upgrade` concorrentes.
        .manage(std::sync::Arc::new(update::UpdateJobs::default()))
        .invoke_handler(tauri::generate_handler![
            agent::run_agent,
            agent::cancel_agent,
            approval::answer_interaction,
            approval::answer_approval,
            osnotify::notify_via_osascript,
            agent::suggest,
            agent::judge,
            utility::utility_probe,
            utility::utility_generate,
            utility::utility_cancel,
            context::read_project_context,
            detect::detect_agents,
            opencode_auth::opencode_credentials,
            opencode_auth::opencode_login_api_key,
            opencode_auth::opencode_login_oauth,
            opencode_auth::opencode_logout,
            update::update_agent,
            update::update_jobs,
            usage_window::usage_snapshots,
            usage_window::usage_fetch,
            model_list::model_list,
            model_smoke::model_smoke,
            model_smoke::model_smoke_history,
            plugin_control::inspect_plugins,
            plugin_control::approve_plugin,
            plugin_control::set_plugin_enabled,
            plugin_control::revoke_plugin_grant,
            plugin_control::stop_plugin_runtime,
            statusline_install::usage_statusline_status,
            statusline_install::usage_statusline_install,
            statusline_install::usage_statusline_uninstall,
            hooks_install::hooks_status,
            hooks_install::hooks_install,
            hooks_install::hooks_uninstall,
            hook_sessions::hook_sessions,
            catalog::refresh_models_catalog,
            catalog::get_models_catalog,
            pricing::model_price,
            mycockpit::read_mycockpit_config,
            mycockpit::write_mycockpit_config,
            mycockpit::read_project_doctrine,
            mycockpit::write_project_doctrine,
            mycockpit::read_doctrine_seed,
            mycockpit::read_agent_defs,
            mycockpit::write_agent_def,
            mycockpit::delete_agent_def,
            mycockpit::export_conv_context,
            mycockpit::export_context_bundle,
            sources::read_project_sources,
            sources::read_text_file,
            sources::read_project_file_bytes,
            sources::read_project_commands,
            sources::list_project_files,
            sources::write_mission_state,
            sources::list_mission_files,
            sdd::read_sdd_plans,
            sdd::pr_info,
            sdd::sdd_ready,
            sdd::seed_sdd,
            sdd::approve_prd,
            sdd::create_plan,
            sdd::set_plan_stage,
            skills::write_skill,
            git::git_diff,
            git::git_worktree_pulse,
            git::create_worktree,
            git::remove_worktree,
            git::list_worktrees,
            git::delete_worktree_branch,
            editor::detect_editors,
            editor::open_in_editor,
            modes::detect_modes,
            sandbox::sandbox_confinamento,
            git::git_commit,
            git::git_status,
            git::git_stage_file,
            git::git_unstage_file,
            git::git_stage_all,
            git::git_unstage_all,
            git::git_discard_file,
            git::git_discard_all,
            git::git_diff_staged,
            git::git_create_pr,
            git::pr_context,
            github::gh_pr_view,
            github::gh_pr_merge,
            github::gh_status,
            github::gh_switch_account,
            mcp_control::discover_mcp_servers,
            mcp_control::set_mcp_binding,
            mcp_control::install_mcp_in_agent,
            mcp_control::check_mcp_server,
            mcp_control::mcp_bindings_summary,
            mcp_auth::mcp_oauth_login,
            mcp_auth::mcp_oauth_status,
            mcp_auth::mcp_oauth_logout,
            browser::browser_start,
            browser::browser_stop,
            browser::browser_status,
            work_gateway::managed_process_stop,
            work_gateway::managed_process_retry,
            work_gateway::managed_process_start,
            tray::set_tray_snapshot,
            tray::get_tray_snapshot,
            tray::set_tray_preferences,
            tray::tray_action,
            notch::get_notch_geometry,
            notch::get_screen_geometries,
            hud::hud_status,
            hud::set_hud_preferences,
            hud::set_hud_expanded,
            experience_broker::browser_pilot_status,
            experience_broker::browser_pilot_acquire,
            experience_broker::browser_pilot_heartbeat,
            experience_broker::browser_pilot_release,
            desktop::desktop_capability_status,
            desktop::desktop_permission_request,
            browser_cdp::browser_pages,
            browser_cdp::browser_preview_start,
            browser_cdp::browser_preview_frame,
            browser_cdp::browser_preview_stop,
            browser_cdp::browser_input,
            browser_panel::browser_panel_open,
            browser_panel::browser_panel_context,
            despertador::set_keep_awake,
            stt::stt_devices,
            stt::stt_start,
            stt::stt_stop,
            stt::stt_cancel,
            attachments::save_attachment,
            attachments::attach_path,
            attachments::delete_attachment,
            attachments::read_attachment,
            attachments::gc_attachments,
            attachments::wipe_conv_attachments,
            processos::listar_processos_de_motor,
            processos::matar_processo_de_motor,
            processos::conferir_pastas,
            attachments::save_note_attachment,
            attachments::wipe_note_attachments,
            evidence::read_evidence,
            evidence::open_conv_image,
            evidence::reveal_conv_image,
            companion::companion_start,
            companion::companion_stop,
            companion::companion_status,
            companion::companion_revoke_token,
            companion::companion_list_devices,
            companion::companion_pair_decide,
            companion::companion_revoke_device,
            companion::set_companion_snapshot,
            companion::companion_conv_updated,
            companion::companion_action_result
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // No macOS, o AppKit também considera o HUD auxiliar uma janela
            // visível. Clicar no Dock sempre expressa a intenção de restaurar
            // `main`, mesmo quando `has_visible_windows` vier verdadeiro.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen {
                has_visible_windows,
                ..
            } = &event
            {
                tray::handle_reopen(app_handle, *has_visible_windows);
            }
            // A primeira passagem é sempre interceptada. Depois da decisão e
            // do teardown, o coordenador marca Committed e chama exit(0), cuja
            // segunda passagem é a única autorizada a encerrar o processo.
            if let tauri::RunEvent::ExitRequested { api, .. } = &event {
                if !quit::allows_exit(app_handle) {
                    api.prevent_exit();
                    quit::request_quit(app_handle, quit::QuitOrigin::Native);
                }
            }
        });
}
