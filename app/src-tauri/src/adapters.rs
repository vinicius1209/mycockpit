//! v0.2-α, abstração de agent. Cada CLI vira um adapter; o LOOP de execução
//! (spawn, leitura linha-a-linha, cancel, stderr, Done) é compartilhado em
//! `agent::run_agent`. O adapter varia só em 2 pontos: montar o `Command` e
//! mapear cada linha JSON → `AgentEvent`. O Claude porta a lógica atual 1:1.

use crate::agent::{AgentEvent, CostSource, DeferredStatus};
use crate::attachments::{Attachment, AttachmentKind};
use std::path::PathBuf;
use tokio::process::Command;

/// Parâmetros de um run, montados pelo `run_agent`, consumidos pelo adapter.
pub struct RunRequest {
    pub prompt: String,
    /// Conteúdo de SISTEMA por-run pedido pelo app (doutrina/persona, H1 do
    /// prompt-hygiene-plan). Só chega preenchido a adapters com a capability
    /// `system_channel` — pra motores sem canal, o `route_system_prompt` do
    /// runner já dobrou o conteúdo no corpo ANTES de qualquer transporte
    /// (fail-open: nada se perde, nem no app-server do codex). O adapter com
    /// canal emite no canal nativo e NUNCA no corpo.
    pub system_prompt: Option<String>,
    pub cwd: String,
    pub resume: Option<String>,
    /// "MyCockpit resume": texto PRONTO montado pelo front (recap + ponteiro pro
    /// transcript), usado SÓ no restart pós-resume-falho (degradação graciosa do
    /// run_agent). Quando o resume nativo funciona, este campo é ignorado. None =
    /// comportamento antigo (recomeça sem contexto).
    pub memory_fallback: Option<String>,
    pub permission: Permission,
    /// Modelo escolhido (None = default do CLI/config).
    pub model: Option<String>,
    /// Nível de esforço de raciocínio (None = default). Valores diferem por agent.
    pub effort: Option<String>,
    /// Anexos JÁ resolvidos: path ABSOLUTO, existente em disco, filtrado por
    /// `supports_attachment` (garantido pelo run_agent). O adapter só decide a sintaxe.
    pub attachments: Vec<Attachment>,
    /// Pastas extras liberadas ao agent (fora do cwd), JÁ resolvidas para paths
    /// absolutos existentes (por `mycockpit::resolve_extra_dirs`). Cada adapter
    /// emite `--add-dir <dir>` — o gate de diretório é fixo no spawn (headless).
    pub extra_dirs: Vec<String>,
    /// Interação inline (só Claude): quando presente, registra o MCP server (socket)
    /// da interação pendente — `ask_user` em TODOS os modos com MCP + o
    /// `--permission-prompt-tool` só no Padrão. `.0` = path do binário do MCP server
    /// (= este app, subcomando `approval-server`); `.1` = path do socket app↔server
    /// (por-run). None = sem interação inline (degrada p/ o comportamento de antes).
    pub approval: Option<(String, String)>,
    /// MCP read-only de memória/contexto. É provider-agnostic: Claude e Codex
    /// registram o mesmo server; Agy degrada pelos ponteiros no próprio prompt.
    pub context_gateway: Option<crate::context_gateway::GatewayConfig>,
    /// MCP de trabalho/processos gerenciado pelo MyCockpit. Mesmo contrato no
    /// Claude e Codex; ausente em providers sem MCP.
    pub work_gateway: Option<crate::work_gateway::GatewayConfig>,
    /// MCPs externos selecionados pelo control plane. Sem bindings explícitos,
    /// `managed=false` preserva os configs nativos dos CLIs.
    pub mcp_plan: crate::mcp_control::McpRunPlan,
    /// "Planejar primeiro" POR TURNO: o agent só planeja, não edita. O default
    /// false vale p/ turnos antigos/sem o campo — o struct não é desserializado
    /// (é montado no run_agent a partir dos params do invoke), então o default
    /// fica na fronteira (`Option<bool>::unwrap_or(false)` no comando tauri).
    /// Cada adapter traduz: claude `--permission-mode plan` (validado 2.1.209,
    /// headless planeja e NÃO edita); codex força `-s read-only` (sandbox de OS);
    /// agy emula por prompt + --sandbox (melhor esforço, ver AgyAdapter).
    pub plan_first: bool,
    /// Quanto a thread retomada JÁ tinha acumulado de tokens (ADR-033). Só faz
    /// sentido pra motor com `cumulative_usage`: o adapter subtrai isto do
    /// acumulado que o provider reporta e emite o gasto DO TURNO. None = thread
    /// nova, primeira vez, ou motor que já reporta por turno.
    pub usage_baseline: Option<crate::agent::CumulativeUsage>,
}

/// Política de permissão POR RUN, parseada UMA vez na fronteira (run_agent).
/// Enum EXAUSTIVO: valor desconhecido é erro na entrada, nunca fail-open
/// (antes um typo caía no `_ =>` dos adapters e ganhava permissão de ESCRITA).
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Permission {
    Leitura,
    Padrao,
    /// "Auto": autonomia sem pausar pra aprovação MAS com o freio de segurança
    /// de cada CLI — claude `--permission-mode auto` (classificador bloqueia o
    /// perigoso), codex `-s workspace-write` + `approval_policy=never` (sandbox
    /// do SO confina, sem pausa), agy skip-permissions + `--sandbox` (confinamento
    /// best-effort). Meio-termo entre Padrão (pede) e Liberado (sem freio).
    Auto,
    Liberado,
    /// Candidato do Fusion: read-only + MCP desligado (sem efeito externo).
    FusionRo,
}

impl Permission {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s {
            "leitura" => Ok(Self::Leitura),
            "padrao" | "" => Ok(Self::Padrao),
            "auto" => Ok(Self::Auto),
            "liberado" => Ok(Self::Liberado),
            "fusion-ro" => Ok(Self::FusionRo),
            other => Err(format!(
                "modo de permissão desconhecido: '{other}' (esperado leitura|padrao|auto|liberado|fusion-ro)"
            )),
        }
    }
}

/// Convenção NATIVA de descoberta de comandos "/" de um motor. A casa
/// (`.mycockpit/commands`) é agnóstica e vale pra todo agent; isto aqui é só o
/// que cada motor soma por conta própria. `sources.rs` consulta a capability
/// `command_sources` e casa NESTE enum — nunca no nome do agent.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CommandSource {
    /// `.claude/commands` + `.claude/skills` (projeto e ~/.claude).
    ClaudeDirs,
    /// `~/.codex/prompts` (custom prompts; a convenção do Codex é SÓ global).
    CodexPrompts,
}

/// Fonte da JANELA DE USO do plano (rate limit: % usado + quando reseta) de um
/// motor. Mesmo padrão do `CommandSource`: o enum confina o "como" (dialeto,
/// consumido SÓ pelo fetcher/receptor/instalador em usage_window.rs e
/// hook_gateway.rs), a capability decide o "se". Nomes carregam o fornecedor de
/// propósito — dialeto É domínio do fornecedor (precedente HookDialect do
/// hooks-plan). Motor sem fonte: `None` e a UI esconde (4 camadas do Orca).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum UsageWindowSource {
    /// claude ≥2.1.80: o comando de statusline recebe `rate_limits` (janela
    /// 5h/7d, % usado, reset) no stdin A CADA TURNO — instala-se um script
    /// encadeado no settings.json que POSTa pro receptor local (H0). PUSH:
    /// dado de carona, nenhuma quota consumida. Payload real capturado
    /// 12/08/2026 (fixture em usage_window.rs).
    ClaudeStatusline,
    /// claude (conta OAuth): `GET api.anthropic.com/api/oauth/usage` com o
    /// bearer que o próprio CLI guarda (Keychain ou `.credentials.json`) —
    /// o mesmo endereço que o `/usage` do CLI consulta. POLL, independente de
    /// sessão, NENHUMA quota consumida (a resposta não traz header de rate
    /// limit e duas chamadas seguidas devolvem os mesmos percentuais).
    /// Existe porque a statusline NÃO dispara em `-p`/headless (provado
    /// 12/08/2026) e o app roda tudo em headless: sem esta fonte, o Claude
    /// nunca aparecia no medidor. Corpo real capturado 12/08/2026 (fixture em
    /// claude_usage.rs, junto do que NÃO se faz: PTY oculto e refresh).
    ClaudeOauth,
    /// codex 0.146: JSON-RPC `account/rateLimits/read` via
    /// `codex -s read-only -a untrusted app-server` (probe local, read-only,
    /// sem quota). POLL: resposta real capturada 12/08/2026 (fixture em
    /// usage_window.rs) — só `primary` (janela 7d), `secondary: null`.
    CodexAppServer,
}

/// Dialeto de instalação/protocolo de HOOKS de um motor (hooks-plan §2).
/// Mesmo padrão do `CommandSource`/`UsageWindowSource`: o enum confina o
/// "como" (formato do config, shape do payload, forma da resposta síncrona —
/// consumido SÓ pelo instalador em hooks_install.rs e pelo receptor em
/// hook_sessions.rs/hook_gateway.rs); a capability decide o "se". Nomes
/// carregam o fornecedor de propósito — dialeto É domínio do fornecedor.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum HookDialect {
    /// claude 2.1.220: `~/.claude/settings.json` chave `hooks`, eventos
    /// PascalCase, stdin snake_case (`hook_event_name`, `session_id`, `cwd`),
    /// resposta síncrona por stdout `hookSpecificOutput`. Payloads reais
    /// capturados 12/08/2026 (fixtures em hook_sessions.rs).
    ClaudeSettings,
    /// codex 0.146: `~/.codex/hooks.json`, MESMO schema/protocolo do
    /// ClaudeSettings (provado nos hooks vivos do Xirp/Orca desta máquina),
    /// mas arquivo dedicado + trust por hook (`trusted_hash` no config.toml —
    /// comando novo/alterado exige re-trust na próxima sessão).
    CodexHooksJson,
    /// agy 1.1.12: `~/.gemini/config/hooks.json`, GRUPOS NOMEADOS, payload
    /// camelCase (`conversationId`, `workspacePaths`), só `type: "command"`,
    /// síncrono (stdout JSON obrigatório). Stop hooks só rodam ≥1.1.10
    /// (changelog) — o instalador confere a versão antes de escrever.
    AgyConfigHooks,
}

/// Capabilities do agent-runner.md §2, materializada (G1.1 do
/// capability-registry-plan). Campos derivados dos achados REAIS da auditoria,
/// não de especulação. Regra de ouro (§7.1): capability declarada tem que ser
/// VERDADEIRA por versão auditada — na dúvida, `false` e degradação honesta.
/// Código GENÉRICO (agent.rs, mcp_control.rs, sources.rs, front) consulta
/// ISTO; nome de agent fica confinado à factory abaixo e à identidade visual.
///
/// allow(dead_code): é um REGISTRY declarativo — parte dos campos é consumida
/// só pelo teste de contrato e pelo espelho TS (lib/agents.ts), e G2/G3 do
/// plano consultam o resto. Declarar tudo agora é o ponto (a dívida do §2).
#[allow(dead_code)]
pub struct Capabilities {
    /// Fala MCP e recebe o `mc-work` (processos longos + planos vivos).
    pub work_mcp: bool,
    /// Recebe o `mc-context` (memória read-only por MCP).
    pub context_mcp: bool,
    /// Roteável pelo control plane de MCPs EXTERNOS (bindings/profiles).
    pub managed_mcp: bool,
    /// O config MCP nativo aceita `cwd` no launch (só o Codex documenta; o
    /// schema JSON do Claude não tem o campo — não prometer o que some).
    pub mcp_launch_cwd: bool,
    /// Interação inline via `mc-approval` (ask_user + permission-prompt-tool).
    pub inline_interaction: bool,
    /// Emite background tasks que sobrevivem ao turno (`system/task_*`,
    /// ADR-028). false = nunca inventar nó diferido pra este motor.
    pub deferred_work: bool,
    /// O CLI interpreta `/comando` nativamente (fonte PRÓPRIA passa crua;
    /// consumido pelo espelho TS em lib/agents.ts — o Rust declara a verdade).
    pub native_slash: bool,
    /// Convenções nativas de descoberta de comando "/" (além da casa).
    pub command_sources: &'static [CommandSource],
    /// Retoma sessão nativa (`--resume` / `exec resume`).
    pub session_resume: bool,
    /// O CLI tem canal SYSTEM são pra instrução por-run (H1 do
    /// prompt-hygiene-plan): doutrina/persona/nudges viajam fora do corpo do
    /// prompt, re-enviados a cada spawn. Verdade por versão auditada (§7.1):
    /// claude ✅ `--append-system-prompt` (documentado, já usado pros nudges);
    /// codex ❌ — `-c developer_instructions=...` EXISTE no 0.146 (achado por
    /// strings no binário, não documentado) e funciona em sessão NOVA do
    /// `exec`, mas no `exec resume` a instrução da sessão original venceu a
    /// nova (verificado empiricamente 03/08/2026) → frágil, sem re-envio são
    /// por spawn = `false`; agy ❌ (nenhum canal além do -p).
    pub system_channel: bool,
    /// stdout é stream JSON estruturado (linha não-JSON vira `Unknown`;
    /// false = a linha crua é TEXTO do assistente, ex. `agy -p`).
    pub structured_output: bool,
    /// Reporta custo em USD (Reported). false = estimado por tokens ou nada.
    pub reports_cost: bool,
    /// O usage do fim de turno é ACUMULADO DA THREAD (não do turno): o adapter
    /// precisa do baseline do run pra emitir o gasto real (ADR-033). Verdade
    /// por versão auditada (§7.1): codex 0.146 ✅ — `turn.completed.usage` de
    /// dois turnos triviais na MESMA thread deu input 17494 → 35005 (medido
    /// 04/08/2026); claude 2.1.220 ❌ (o `result` traz usage e USD do turno);
    /// agy ❌ (não reporta usage). Consumido pelo espelho TS
    /// (`lib/agents.ts`), que decide de qual motor o histórico gravado antes
    /// da correção está inflado.
    pub cumulative_usage: bool,
    /// O CLI compacta a PRÓPRIA sessão em modo headless: um turno com o texto
    /// literal `/compact` via resume é processado (verdade por versão auditada,
    /// §7.1 do agent-runner): claude 2.1.220 ✅ (`claude -p --resume <sid>
    /// "/compact"` processa o comando — teste real 04/08/2026 respondeu "Not
    /// enough messages to compact", e o `compact_boundary` resultante já vira
    /// aviso no fio, ADR-015); codex 0.146 ❌ (`/compact` é só do TUI, o `exec`
    /// não expõe — help verificado); agy ❌ (nada). Motor sem a capability: o
    /// `/compactar` do app degrada pra renovação de sessão com recap
    /// (transplante para si mesmo, lado TS). Coerência cobrada no contrato:
    /// `native_compact` exige `session_resume` (o caminho nativo É "resume +
    /// /compact").
    pub native_compact: bool,
    /// Expõe a JANELA DE USO do plano (% usado + reset, feature "9% used ·
    /// 4h 22m" do estudo do Orca — pipeline SEPARADO do custo em $). `None` =
    /// motor sem fonte auditada: a UI some com pill/toggle (degradação
    /// honesta), nunca inventa percentual. agy 1.1.12: só existe `/credits`
    /// (saldo de créditos, sem % de janela nem reset — verificado 12/08/2026)
    /// → não é janela de uso, `None`. Espelho TS: `usageWindow` em
    /// lib/agents.ts (teste-gêmeo agents.usageWindow.test.ts ↔
    /// `matriz_usage_window_por_agent`).
    pub usage_window: Option<UsageWindowSource>,
    /// Dialeto que o POLL do vigia usa pra PERGUNTAR a janela agora
    /// (`usage_fetch`), quando `usage_window` já disse que o motor tem
    /// medidor. Separado porque as duas coisas divergiram no claude: o que o
    /// usuário INSTALA lá é a statusline (push de carona, `usage_window`), mas
    /// ela só dispara em sessão INTERATIVA — em `-p`/headless o script nunca
    /// roda (empírico 12/08/2026), e o app roda tudo em headless. Quem
    /// realmente alimenta o medidor do claude é o `ClaudeOauth`. `None` = o
    /// motor só recebe push (nada a perguntar); nunca `ClaudeStatusline`
    /// (push não se pergunta — cobrado no contrato). Espelho TS: `usagePoll`
    /// em lib/agents.ts (mesmo teste-gêmeo).
    pub usage_window_poll: Option<UsageWindowSource>,
    /// Emite eventos de CICLO DE VIDA a scripts externos (fire-and-forget,
    /// hooks-plan H1): é o que dá visibilidade de sessões EXTERNAS (abertas no
    /// terminal, fora do app) e status push sem polling. Instalação SEMPRE por
    /// gesto do usuário (hooks_install.rs); quem não tem/não instalou degrada
    /// pro watchdog, que continua existindo pra todos. Espelho TS:
    /// `hooksStatus` em lib/agents.ts (teste-gêmeo agents.hooks.test.ts ↔
    /// `matriz_de_hooks_por_agent`).
    pub hooks_status: bool,
    /// O prompt de permissão do CLI pode ser decidido por um hook SÍNCRONO
    /// (hooks-plan H2): o script segura a resposta e devolve allow/deny/ask
    /// pelo stdout no formato do dialeto. Timeout sem humano ⇒ `ask` (o
    /// prompt nativo aparece no terminal — nunca allow fantasma nem deny que
    /// trava trabalho legítimo). Espelho TS: `hooksPermission` em
    /// lib/agents.ts (mesmo teste-gêmeo `matriz_de_hooks_por_agent`).
    pub hooks_permission: bool,
    /// Como instalar/falar com os hooks deste motor. None = sem hooks: o card
    /// de Configurações nem mostra a opção (degradação honesta).
    pub hook_dialect: Option<HookDialect>,
}

/// claude 2.1.219 (auditado 2026-07): o mais rico — MCP completo, background
/// tasks, resume, stream-json e custo pronto em USD.
pub const CLAUDE_CAPS: Capabilities = Capabilities {
    work_mcp: true,
    context_mcp: true,
    managed_mcp: true,
    mcp_launch_cwd: false,
    inline_interaction: true,
    deferred_work: true,
    native_slash: true,
    command_sources: &[CommandSource::ClaudeDirs],
    session_resume: true,
    system_channel: true,
    structured_output: true,
    reports_cost: true,
    // o `result` do stream-json traz o usage E o USD DO TURNO.
    cumulative_usage: false,
    // claude 2.1.220: `-p --resume <sid> "/compact"` processa o comando em
    // modo print (empírico 04/08/2026; §7.1 do agent-runner).
    native_compact: true,
    // claude 2.1.220: a statusline recebe `rate_limits` no stdin por turno
    // (payload real capturado 12/08/2026 — fixture em usage_window.rs).
    usage_window: Some(UsageWindowSource::ClaudeStatusline),
    // …MAS a statusline não roda em `-p` (o app roda tudo headless), então
    // quem sustenta o medidor é a conta: GET /api/oauth/usage com o bearer do
    // próprio CLI (200 real capturado 12/08/2026, fixture em claude_usage.rs).
    usage_window_poll: Some(UsageWindowSource::ClaudeOauth),
    // claude 2.1.220: hooks maduros — SessionStart/UserPromptSubmit/
    // PreToolUse/PostToolUse/Stop/SessionEnd capturados de verdade nesta
    // máquina em 12/08/2026 (fixtures em hook_sessions.rs); Notification
    // documentado e vivo no settings do usuário (Xirp).
    hooks_status: true,
    // claude 2.1.220: evento `PermissionRequest` com resposta síncrona por
    // stdout `hookSpecificOutput.decision.behavior: allow|deny|ask` (docs
    // oficiais verificadas 12/08/2026 + script síncrono de 30s do Xirp vivo
    // nesta máquina [E2]). Só dispara em sessão INTERATIVA (em `-p` a tool é
    // auto-negada sem prompt — verificado empiricamente 12/08/2026), que é
    // exatamente o alvo do H2: sessões externas do terminal.
    hooks_permission: true,
    hook_dialect: Some(HookDialect::ClaudeSettings),
};

/// codex-cli 0.144.6 (auditado 2026-07): MCP completo (config efêmero via -c),
/// resume de thread, stream JSON — mas sem background task, sem slash nativo
/// no `exec` e sem USD no stream (custo é estimado por tokens × tabela).
pub const CODEX_CAPS: Capabilities = Capabilities {
    work_mcp: true,
    context_mcp: true,
    managed_mcp: true,
    mcp_launch_cwd: true,
    inline_interaction: false,
    deferred_work: false,
    native_slash: false,
    command_sources: &[CommandSource::CodexPrompts],
    session_resume: true,
    // `-c developer_instructions` funciona só em sessão nova; no resume a
    // instrução antiga vence (empírico 0.146) → sem canal são, `false`.
    system_channel: false,
    structured_output: true,
    reports_cost: false,
    // codex 0.146: o `turn.completed.usage` é o total da THREAD (17494 →
    // 35005 em dois turnos triviais via resume, 04/08/2026) → ADR-033.
    cumulative_usage: true,
    // codex 0.146: `/compact` é comando do TUI; `codex exec` não expõe
    // (help verificado 04/08/2026) → compactar = renovação de sessão app-side.
    native_compact: false,
    // codex 0.146: `account/rateLimits/read` no app-server read-only devolve
    // usedPercent + resetsAt (provado na mão 12/08/2026, fixture em
    // usage_window.rs).
    usage_window: Some(UsageWindowSource::CodexAppServer),
    // o mesmo dialeto responde ao poll (não há push nenhum no codex).
    usage_window_poll: Some(UsageWindowSource::CodexAppServer),
    // codex 0.146: `codex features list` → hooks stable/true; hooks.json com
    // schema idêntico ao do claude, trusted e VIVO nesta máquina (Xirp/Orca,
    // auditado 12/08/2026). Trust por hook: o comando referencia só o path
    // estável do script (token rotaciona DENTRO do arquivo apontado).
    hooks_status: true,
    // codex 0.146: MESMO protocolo do claude — o binário embute
    // `PermissionRequestHookSpecificOutputWire` e o Xirp instalou o MESMO
    // script síncrono de 30s, trusted-hasheado [E4][E6].
    hooks_permission: true,
    hook_dialect: Some(HookDialect::CodexHooksJson),
};

/// agy 1.1.9 (re-checado 31/07/2026): sem canal MCP, sem resume exposto no
/// print mode, stdout de texto puro, sem custo. Quase tudo false — e é isso
/// que faz a UI degradar honesta em vez de fingir contrato uniforme (§7.1).
pub const AGY_CAPS: Capabilities = Capabilities {
    work_mcp: false,
    context_mcp: false,
    managed_mcp: false,
    mcp_launch_cwd: false,
    inline_interaction: false,
    deferred_work: false,
    native_slash: false,
    command_sources: &[],
    session_resume: false,
    system_channel: false,
    structured_output: false,
    reports_cost: false,
    // stdout de texto puro: não há usage nenhum, quanto mais acumulado.
    cumulative_usage: false,
    native_compact: false,
    // agy 1.1.12: só `/credits` (saldo, sem % de janela nem reset —
    // verificado 12/08/2026). Saldo de créditos NÃO é janela de uso: None.
    usage_window: None,
    usage_window_poll: None,
    // agy 1.1.12: hooks documentados pelo próprio produto (doc embarcada
    // agy-customizations/docs/hooks.md) e vivos nesta máquina (grupo
    // "orca-status" em ~/.gemini/config/hooks.json, listado por `agy -p
    // "/hooks"` em 12/08/2026). Stop hooks só rodam ≥1.1.10 → o instalador
    // confere a versão e aborta com motivo abaixo disso (gate honesto).
    hooks_status: true,
    // agy 1.1.12: NÃO há evento de permissão separado — o gate é o próprio
    // PreToolUse (stdout `decision: allow|deny|ask|force_ask`, doc embarcada
    // [E9]). O instalador escopa o matcher a `run_command` (a tool que pede
    // a permissão "command") pra não segurar tool call inofensiva.
    hooks_permission: true,
    hook_dialect: Some(HookDialect::AgyConfigHooks),
};

pub trait AgentAdapter: Send {
    /// Id estável (= binário lógico), usado em mensagens de erro.
    fn id(&self) -> &'static str;
    /// Capabilities declaradas (agent-runner.md §2). SEM default de propósito:
    /// agent novo é OBRIGADO a declarar — e o teste de contrato
    /// (`contrato_capabilities_x_comportamento_por_agent`) cobra que a
    /// declaração corresponda ao comando que o build_command monta.
    fn capabilities(&self) -> &'static Capabilities;
    /// Monta o `Command` (binário + flags). O loop compartilhado null-a o stdin
    /// e pipa stdout/stderr, o adapter NÃO cuida disso. `&mut self`: o adapter
    /// pode fixar estado do run (ex. Codex guarda o modelo requisitado p/ custo).
    fn build_command(&mut self, req: &RunRequest) -> Result<Command, String>;
    /// Mapeia uma linha JSON do stream → 0..N eventos normalizados. `&mut self`
    /// permite guardar estado de parsing (correlação begin/end de ferramentas).
    fn map_line(&mut self, v: &serde_json::Value) -> Vec<AgentEvent>;
    /// Destino da evidência VISUAL de tool_result (browser-plan B1): blocos
    /// `image` viram arquivo aqui e o evento carrega só o path. Default no-op:
    /// adapter cujo transporte não reporta imagem degrada honesto (sem sink,
    /// sem evidência — nunca inventa).
    fn set_evidence_sink(&mut self, _sink: crate::evidence::EvidenceSink) {}
    /// Flush de itens pendentes no fim do stream (EOF normal).
    fn on_close(&mut self) -> Vec<AgentEvent> {
        Vec::new()
    }

    /// Como tratar UMA linha CRUA de stdout. Default (adapters ESTRUTURADOS):
    /// trima, pula vazia, parseia JSON → `map_line`; linha não-JSON vira `Unknown`
    /// (regra de ouro: nunca descarta em silêncio). Adapters NÃO-estruturados
    /// (sem stream JSON, ex. `agy -p`) sobrescrevem p/ tratar a linha como TEXTO
    /// do assistente. Preserva o comportamento 1:1 do Claude/Codex.
    fn on_stdout_line(&mut self, line: &str) -> Vec<AgentEvent> {
        let line = line.trim();
        if line.is_empty() {
            return Vec::new();
        }
        match serde_json::from_str::<serde_json::Value>(line) {
            Ok(v) => self.map_line(&v),
            Err(_) => vec![AgentEvent::Unknown {
                raw: serde_json::Value::String(line.to_string()),
            }],
        }
    }

    /// Capacidade declarada por tipo de anexo. Default = NÃO suporta nada → um
    /// agent novo é OBRIGADO a decidir (sem no-op que engole anexo em silêncio).
    fn supports_attachment(&self, _kind: &AttachmentKind) -> bool {
        false
    }

    /// Renderiza os anexos no comando/prompt. INVARIANTE: `atts` chega com path
    /// ABSOLUTO, existente, e já filtrado por `supports_attachment`, o adapter só
    /// decide a SINTAXE (flags/posição). Default no-op.
    fn render_attachments(&self, atts: &[Attachment], cmd: &mut Command, prompt: &mut String) {
        let _ = (atts, cmd, prompt);
    }

    /// A mensagem indica que a sessão do resume não existe NESTE CLI? Cada
    /// adapter conhece só as SUAS frases (casar frase exata; o AND genérico
    /// `session && not found` casava erro de tool e dropava resume em silêncio).
    /// Default false: agent novo sem frase mapeada vira card de erro (seguro).
    fn is_session_not_found(&self, msg: &str) -> bool {
        let _ = msg;
        false
    }

    /// A mensagem indica LIMITE de uso/cota atingido neste CLI? Devolve o hint
    /// de reset quando o CLI informa ("resets at 3pm"). Default None: agent sem
    /// frase mapeada vira card de erro comum, que também oferece o revezamento
    /// manual. NEEDS-VERIFY: frases de docs/relatos; o 1º estouro real é o fixture.
    fn classify_limit(&self, msg: &str) -> Option<LimitHit> {
        let _ = msg;
        None
    }
}

/// Sinal de limite de uso/cota atingido (+ hint de reset, se o CLI informou).
pub struct LimitHit {
    pub reset_hint: Option<String>,
}

/// Extrai a janela informada pelo provider sem reescrever o conteúdo. As
/// expressões são deliberadamente estreitas: a decisão de que a mensagem é um
/// limite continua dentro de cada adapter; esta função só lê o horário depois
/// que o adapter já classificou o incidente.
fn extract_reset_hint(msg: &str) -> Option<String> {
    let lower = msg.to_ascii_lowercase();
    let (start, marker) = ["resets at ", "reset at ", "resets "]
        .into_iter()
        .filter_map(|marker| lower.find(marker).map(|start| (start, marker)))
        .min_by_key(|(start, _)| *start)?;
    let tail = msg.get(start + marker.len()..)?;
    let hint = tail
        .lines()
        .next()
        .unwrap_or_default()
        .chars()
        .take(64)
        .collect::<String>();
    let hint = hint
        .trim()
        .trim_end_matches(|c: char| matches!(c, '.' | ';' | ','))
        .trim();
    (!hint.is_empty()).then(|| hint.to_string())
}

/// UMA entrada do registry: id + capabilities + construtor. O array `SPECS` é
/// o ÚNICO lugar do código genérico que conhece nomes de agent (G1.1) —
/// adicionar um motor = escrever o adapter e UMA linha aqui.
struct AgentSpec {
    id: &'static str,
    caps: &'static Capabilities,
    build: fn() -> Box<dyn AgentAdapter>,
}

fn build_claude() -> Box<dyn AgentAdapter> {
    Box::<ClaudeAdapter>::default()
}
fn build_codex() -> Box<dyn AgentAdapter> {
    Box::new(CodexAdapter {
        // o stream do codex NÃO emite o modelo → lê do config p/ estimar custo
        model: Some(codex_config_model()),
        evidence: None,
        // baseline e thread do run chegam no build_command (RunRequest).
        resume: None,
        usage_seen: None,
    })
}
fn build_agy() -> Box<dyn AgentAdapter> {
    Box::<AgyAdapter>::default()
}

static SPECS: [AgentSpec; 3] = [
    AgentSpec { id: "claude-code", caps: &CLAUDE_CAPS, build: build_claude },
    AgentSpec { id: "codex", caps: &CODEX_CAPS, build: build_codex },
    AgentSpec { id: "agy", caps: &AGY_CAPS, build: build_agy },
];

/// Id canônico: string vazia = claude-code (convenção histórica das conversas
/// antigas, a MESMA do resolve de sempre). Fica num lugar só.
pub fn canonical_agent(agent: &str) -> &str {
    if agent.is_empty() {
        "claude-code"
    } else {
        agent
    }
}

fn spec_of(agent: &str) -> Option<&'static AgentSpec> {
    let id = canonical_agent(agent);
    SPECS.iter().find(|s| s.id == id)
}

/// Resolve o id do agent → adapter concreto.
pub fn resolve(agent: &str) -> Result<Box<dyn AgentAdapter>, String> {
    spec_of(agent)
        .map(|s| (s.build)())
        .ok_or_else(|| format!("agent não suportado ainda: {agent}"))
}

/// Capabilities de um agent SEM construir o adapter (consulta barata pro
/// código genérico: mcp_control, sources). None = agent não registrado.
pub fn capabilities_of(agent: &str) -> Option<&'static Capabilities> {
    spec_of(agent).map(|s| s.caps)
}

/// H1 (prompt-hygiene-plan) — roteia o conteúdo de sistema pelo canal mais
/// forte que o motor declarar: com `system_channel`, segue separado (o adapter
/// emite no canal nativo); sem, DOBRA no corpo antes do prompt (fail-open: o
/// conteúdo nunca se perde, inclusive no transporte app-server do codex, que
/// não passa pelo build_command). Decisão por capability, nunca por nome. PURO.
pub fn route_system_prompt(
    caps: &Capabilities,
    system_prompt: Option<String>,
    prompt: String,
) -> (Option<String>, String) {
    match system_prompt.as_deref().map(str::trim) {
        Some(sp) if !sp.is_empty() => {
            if caps.system_channel {
                (system_prompt, prompt)
            } else {
                (None, format!("{sp}\n\n{prompt}"))
            }
        }
        _ => (None, prompt),
    }
}

/// Ids de TODOS os agents registrados, na ordem do registry. É a lista que o
/// mcp_control usa em vez de repetir nomes — e a que o teste de contrato varre.
pub fn registered_agents() -> impl Iterator<Item = &'static str> {
    SPECS.iter().map(|s| s.id)
}

/// O id (EXATO, sem canonicalizar — "" não é um binding válido) está
/// registrado? Validação de fronteira do mcp_control.
pub fn is_registered(agent: &str) -> bool {
    SPECS.iter().any(|s| s.id == agent)
}

/// Lê um inteiro não-negativo de um sub-objeto `usage` (0 se ausente/inválido).
fn usage_u64(usage: Option<&serde_json::Value>, key: &str) -> u64 {
    usage
        .and_then(|u| u.get(key))
        .and_then(|x| x.as_u64())
        .unwrap_or(0)
}

/// Texto de uma mensagem `user` do stream-json: content string direta, ou os
/// blocos `text` concatenados (o harness injeta a task-notification num deles).
fn user_message_text(v: &serde_json::Value) -> Option<String> {
    match v.pointer("/message/content") {
        Some(serde_json::Value::String(s)) => Some(s.clone()),
        Some(serde_json::Value::Array(blocks)) => {
            let joined = blocks
                .iter()
                .filter(|b| b.get("type").and_then(|x| x.as_str()) == Some("text"))
                .filter_map(|b| b.get("text").and_then(|x| x.as_str()))
                .collect::<Vec<_>>()
                .join("\n");
            (!joined.is_empty()).then_some(joined)
        }
        _ => None,
    }
}

/// Extrai o conteúdo da PRIMEIRA `<tag>…</tag>` de um texto (sem parser XML —
/// o payload é uma string plana injetada pelo harness, 4 tags fixas).
fn xml_tag(text: &str, tag: &str) -> Option<String> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = text.find(&open)? + open.len();
    let end = text[start..].find(&close)? + start;
    Some(text[start..end].trim().to_string())
}

/// Parse da string `<task-notification>` que o harness injeta como mensagem
/// `user` no `--resume` (deferred-work-plan, D1.1). Formato real capturado no
/// incidente: tags task-id / tool-use-id / status / summary. Só `completed` e
/// `stopped` viram evento; status desconhecido → None (fail-open). O conteúdo
/// é entrada NÃO confiável — vira dado de render, nunca comando.
fn parse_task_notification(text: &str) -> Option<AgentEvent> {
    let t = text.trim_start();
    if !t.starts_with("<task-notification>") {
        return None;
    }
    let id = xml_tag(t, "task-id")?;
    if id.is_empty() {
        return None;
    }
    let status = match xml_tag(t, "status").as_deref() {
        Some("completed") => DeferredStatus::Completed,
        Some("stopped") => DeferredStatus::Stopped,
        _ => return None,
    };
    Some(AgentEvent::DeferredWork {
        id,
        tool_use_id: xml_tag(t, "tool-use-id").filter(|s| !s.is_empty()),
        kind: None,
        name: None,
        status,
        summary: xml_tag(t, "summary").filter(|s| !s.is_empty()),
        // a string injetada não carrega output_file (payload real do incidente)
        output_file: None,
        progress: None,
    })
}

// ---------------- Claude Code (porta o map_events 1:1) ----------------

#[derive(Default)]
pub struct ClaudeAdapter {
    /// Destino da evidência visual (B1). None = sem gravação (testes/headless
    /// sem app_data_dir): tool_result segue só texto.
    evidence: Option<crate::evidence::EvidenceSink>,
}

impl AgentAdapter for ClaudeAdapter {
    fn id(&self) -> &'static str {
        "claude"
    }

    fn capabilities(&self) -> &'static Capabilities {
        &CLAUDE_CAPS
    }

    fn set_evidence_sink(&mut self, sink: crate::evidence::EvidenceSink) {
        self.evidence = Some(sink);
    }

    fn build_command(&mut self, req: &RunRequest) -> Result<Command, String> {
        let mut cmd = Command::new("claude");
        // anexos: injeta os paths no prompt (Read tool) + --add-dir (acesso fora do cwd)
        let mut prompt = req.prompt.clone();
        self.render_attachments(&req.attachments, &mut cmd, &mut prompt);
        // ATENÇÃO à ordem: TODAS as flags vêm ANTES do prompt. O prompt é
        // posicional e entra por último, atrás de `--` (ver fim da função). O `--`
        // encerra o parsing de opções, então qualquer flag DEPOIS dele viraria
        // posicional — foi o bug e9f7b737: `-- <prompt> --output-format …` fazia o
        // Claude ignorar o stream-json e cair em modo TEXTO (UI sem output).
        cmd.arg("-p")
            .arg("--output-format")
            .arg("stream-json")
            .arg("--verbose")
            .arg("--include-partial-messages")
            .current_dir(&req.cwd);
        // Trabalho diferido (deferred-work-plan D2A.1): em `-p` o CLI espera
        // background tasks (Workflow etc.) por no máximo
        // CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS (default 600_000 = 10 min) e aí
        // faz wind-down: marca o task como `stopped` e sai, orfanando o
        // trabalho — foi a morte do turno 1 do incidente deep-research
        // (stream-json-notes.md §Background tasks). 4h cobre qualquer workflow
        // realista; o teto continua existindo para um harness pendurado não
        // segurar o turno pra sempre. O usuário pode Interromper a qualquer
        // momento, e o D1 narra o que está rodando.
        cmd.env("CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS", "14400000");
        // Política de permissão por projeto (docs/agent-runner.md §7). Achado do
        // M0: `--allowedTools` NÃO sandboxa; o gate real é `--disallowedTools`.
        //
        // Interação PENDENTE (docs/interactive-input.md): o MCP server (socket) sobe
        // em TODOS os modos com MCP ligado — `ask_user` (tool de CONTEÚDO) vale sempre.
        // O `--permission-prompt-tool` (aprovação) segue SÓ no Padrão. Desabilitamos
        // os built-ins interativos (AskUserQuestion, ExitPlanMode) SEMPRE (eles erram
        // no `-p` headless) — o modelo usa a NOSSA `ask_user`; ExitPlanMode degrada p/
        // texto. Os disallow são MESCLADOS com os de read-only (não sobrescreve).
        const INTERACTIVE_BUILTINS: &str = "AskUserQuestion,ExitPlanMode";
        let mut disallowed: Vec<&str> = vec![INTERACTIVE_BUILTINS];
        match req.permission {
            Permission::Leitura => {
                disallowed.insert(0, "Bash,Edit,Write,MultiEdit,NotebookEdit");
            }
            // Fusion read-only: bloqueia edição E desliga TODO MCP (candidatos
            // especulativos não podem ter efeito externo, email/Notion/infra). Sem
            // MCP → sem ask_user aqui (perguntas viram texto); os built-ins seguem
            // desabilitados p/ não errarem.
            Permission::FusionRo => {
                disallowed.insert(0, "Bash,Edit,Write,MultiEdit,NotebookEdit");
                // G3.1 (capability-registry-plan × D3.2 do deferred-work-plan):
                // a arena do Fusion NÃO renderiza o nó de trabalho diferido —
                // um motor com `deferred_work` disparando `Workflow` aqui
                // criaria um background task ÓRFÃO, invisível e em silêncio
                // (pior que a tool ausente: o candidato acha que delegou).
                // Suprime a tool no spawn, decidido pela CAPABILITY declarada,
                // não pelo nome do agent — um motor futuro sem deferred_work
                // não ganha um disallow de tool que ele nem tem.
                if self.capabilities().deferred_work {
                    disallowed.insert(0, "Workflow");
                }
                cmd.arg("--strict-mcp-config")
                    .arg("--mcp-config")
                    .arg("{\"mcpServers\":{}}");
            }
            // "Planejar primeiro" SUBSTITUI o --permission-mode do modo neste
            // turno (senão emitiríamos a flag 2x). Emitido logo abaixo.
            Permission::Liberado | Permission::Padrao | Permission::Auto if req.plan_first => {}
            Permission::Liberado => {
                cmd.arg("--permission-mode").arg("bypassPermissions");
            }
            // Auto (validado docs 2026, claude 2.1.207+): roda sem pedir mas o
            // classificador de segurança barra exfiltração/rm destrutivo/deploy —
            // não leva o --permission-prompt-tool (só o Padrão precisa do gate
            // granular; o Auto se autogoverna).
            Permission::Auto => {
                cmd.arg("--permission-mode").arg("auto");
            }
            Permission::Padrao => {
                cmd.arg("--permission-mode").arg("acceptEdits");
            }
        }
        // "Planejar primeiro" (validado claude 2.1.209): `-p --permission-mode plan`
        // planeja e NÃO edita; o plano sai como texto final (ExitPlanMode não existe
        // no headless — segue no disallow — e o gate de execução é o nosso, na UI).
        // Em Leitura/FusionRo o disallow de escrita acima fica: plan por cima não
        // conflita. O --permission-prompt-tool do Padrão pode ficar (inofensivo).
        if req.plan_first {
            cmd.arg("--permission-mode").arg("plan");
        }
        // disallowedTools (mesclado): o gate de escrita (por modo) + os interativos.
        cmd.arg("--disallowedTools").arg(disallowed.join(","));

        // Canal SYSTEM por-run (H1 do prompt-hygiene-plan): doutrina/persona
        // pedidas pelo app entram AQUI — re-enviadas a cada spawn (frescor de
        // graça), NUNCA no corpo do prompt. Vêm ANTES dos nudges de tool
        // (identidade/regras primeiro, telemetria depois).
        let mut system_nudges: Vec<String> = Vec::new();
        if let Some(sp) = req.system_prompt.as_deref() {
            if !sp.trim().is_empty() {
                system_nudges.push(sp.to_string());
            }
        }
        // MCPs internos, ambos efêmeros e por-run:
        // - mc-approval: interação inline exclusiva do Claude;
        // - mc-context: memória read-only compartilhada também com o Codex.
        // FusionRo segue sem TODO MCP por contrato (candidato sem efeito externo).
        let mcp_on = !matches!(req.permission, Permission::FusionRo);
        if mcp_on {
            let mut servers = serde_json::Map::new();
            let mut allowed_internal_tools = Vec::new();
            if req.mcp_plan.managed {
                // A partir do primeiro binding explícito, o cockpit é a fonte da
                // lista MCP deste run; configs globais não vazam por fora do
                // profile selecionado.
                cmd.arg("--strict-mcp-config");
                for external in &req.mcp_plan.selected {
                    servers.insert(external.runtime_name.clone(), external.launch.claude_json());
                }
                if !req.mcp_plan.selected.is_empty() {
                    // Mesmo anúncio do preâmbulo do prompt (agent.rs): o nome
                    // de RUNTIME é o que o modelo precisa citar nas tools.
                    system_nudges.push(format!(
                        "Ferramentas MCP desta sessão:\n{}\nUse somente quando a tarefa exigir.",
                        req.mcp_plan
                            .selected
                            .iter()
                            .map(|server| {
                                format!(
                                    "- {}: {} (MCP externo roteado pelo MyCockpit)",
                                    server.runtime_name, server.display_name
                                )
                            })
                            .collect::<Vec<_>>()
                            .join("\n")
                    ));
                }
            }
            if let Some(gateway) = &req.context_gateway {
                servers.insert(
                    crate::context_gateway::MCP_SERVER_NAME.into(),
                    gateway.claude_server_json(),
                );
                gateway.apply_env(&mut cmd);
                for tool in [
                    crate::context_gateway::MANIFEST_TOOL,
                    crate::context_gateway::SEARCH_TOOL,
                    crate::context_gateway::READ_TOOL,
                ] {
                    allowed_internal_tools.push(format!(
                        "mcp__{}__{}",
                        crate::context_gateway::MCP_SERVER_NAME,
                        tool
                    ));
                }
                system_nudges.push(format!(
                    "Ao continuar trabalho de outro agent, use mcp__{}__{} para ler o índice e mcp__{}__{} / mcp__{}__{} somente quando faltar contexto; não carregue a memória inteira sem necessidade.",
                    crate::context_gateway::MCP_SERVER_NAME,
                    crate::context_gateway::MANIFEST_TOOL,
                    crate::context_gateway::MCP_SERVER_NAME,
                    crate::context_gateway::SEARCH_TOOL,
                    crate::context_gateway::MCP_SERVER_NAME,
                    crate::context_gateway::READ_TOOL,
                ));
            }
            if let Some(gateway) = &req.work_gateway {
                servers.insert(
                    crate::work_gateway::MCP_SERVER_NAME.into(),
                    gateway.claude_server_json(),
                );
                system_nudges.push(format!(
                    "Use mcp__{}__{} para dev servers, watchers, containers e outros processos longos; isso mantém PID, saída e controle no MyCockpit. Publique planos vivos com mcp__{}__{} quando a tarefa tiver várias etapas e marque cada início/conclusão com mcp__{}__{}. Se usar a checklist nativa, atualize os estados equivalentes também.",
                    crate::work_gateway::MCP_SERVER_NAME,
                    crate::work_gateway::PROCESS_START_TOOL,
                    crate::work_gateway::MCP_SERVER_NAME,
                    crate::work_gateway::WORK_PLAN_TOOL,
                    crate::work_gateway::MCP_SERVER_NAME,
                    crate::work_gateway::WORK_UPDATE_TOOL,
                ));
            }
            if let Some((server_bin, sock)) = &req.approval {
                servers.insert(
                    crate::approval::MCP_SERVER_NAME.into(),
                    serde_json::json!({
                        "type": "stdio",
                        "command": server_bin,
                        "args": ["approval-server"]
                    }),
                );
                // AUTO-APROVA a ask_user (achado A1 da revisão): sem isto, em
                // acceptEdits cada pergunta disparava ANTES um card de aprovação
                // ("aprovar uso de ask_user?") = 2 cards; e em Leitura (sem
                // permission-mode) a tool ERRAVA "requires approval" — com o nudge
                // ainda mandando o modelo insistir nela. A ask_user é tool de
                // CONTEÚDO nossa (só pergunta ao usuário) → segura de allowlist.
                allowed_internal_tools.push(format!(
                    "mcp__{}__{}",
                    crate::approval::MCP_SERVER_NAME,
                    crate::approval::ASK_USER_TOOL
                ));
                // permission-prompt-tool (aprovação granular) SÓ no Padrão.
                if matches!(req.permission, Permission::Padrao) {
                    cmd.arg("--permission-prompt-tool").arg(format!(
                        "mcp__{}__{}",
                        crate::approval::MCP_SERVER_NAME,
                        crate::approval::APPROVAL_TOOL
                    ));
                }
                system_nudges.push(format!(
                    "Quando precisar de uma decisão ou escolha do usuário, chame a tool mcp__{}__{} (do MCP {}) com as perguntas e opções, em vez de escrever a pergunta como texto.",
                    crate::approval::MCP_SERVER_NAME,
                    crate::approval::ASK_USER_TOOL,
                    crate::approval::MCP_SERVER_NAME,
                ));
                // o socket é lido pelo MCP server (subprocesso) via env.
                cmd.env(crate::approval::SOCK_ENV, sock);
            }
            if !servers.is_empty() {
                cmd.arg("--mcp-config")
                    .arg(serde_json::json!({ "mcpServers": servers }).to_string());
            }
            if !allowed_internal_tools.is_empty() {
                cmd.arg("--allowedTools")
                    .arg(allowed_internal_tools.join(","));
            }
        }
        // Emissão ÚNICA do canal system (system_prompt do app + nudges de
        // tool). Fora do gate de MCP de propósito: o conteúdo de sistema do
        // app não pode se perder num run sem MCP.
        if !system_nudges.is_empty() {
            cmd.arg("--append-system-prompt")
                .arg(system_nudges.join("\n"));
        }
        // Claude: --model <alias> · --effort low|medium|high|xhigh|max (verificado)
        if let Some(m) = &req.model {
            cmd.arg("--model").arg(m);
        }
        if let Some(e) = &req.effort {
            cmd.arg("--effort").arg(e);
        }
        if let Some(r) = &req.resume {
            cmd.arg("--resume").arg(r);
        }
        // pastas extras (fora do cwd): --add-dir por pasta (aceita múltiplas).
        for d in &req.extra_dirs {
            cmd.arg("--add-dir").arg(d);
        }
        // Prompt POSICIONAL por último, atrás do `--`: protege texto que começa com
        // "-" (diff `--- a/…`, lista markdown) SEM engolir as flags acima.
        cmd.arg("--").arg(&prompt);
        Ok(cmd)
    }

    fn supports_attachment(&self, kind: &AttachmentKind) -> bool {
        matches!(kind, AttachmentKind::Image | AttachmentKind::Pdf)
    }

    fn is_session_not_found(&self, msg: &str) -> bool {
        msg.to_lowercase()
            .contains("no conversation found with session id") // verificado
    }

    fn classify_limit(&self, msg: &str) -> Option<LimitHit> {
        let l = msg.to_ascii_lowercase();
        let hit = l.contains("session limit")
            || l.contains("usage limit")
            || l.contains("rate limit")
            || l.contains("rate_limit")
            || l.contains("out of credits")
            || l.contains("quota");
        if !hit {
            return None;
        }
        // Variantes REAIS do Claude:
        // - "…will reset at 3pm (America/Sao_Paulo)."
        // - "You've hit your session limit · resets 1:50pm (America/Sao_Paulo)"
        // O hint preserva caixa/timezone do payload original para a UI.
        let reset_hint = extract_reset_hint(msg);
        Some(LimitHit { reset_hint })
    }

    fn render_attachments(&self, atts: &[Attachment], cmd: &mut Command, prompt: &mut String) {
        if atts.is_empty() {
            return;
        }
        // concede ao Read tool acesso à pasta da conversa (verificado: --add-dir)
        if let Some(dir) = std::path::Path::new(&atts[0].path).parent() {
            cmd.arg("--add-dir").arg(dir);
        }
        prompt.push_str("\n\nArquivos anexados (use o Read tool para abri-los):\n");
        for a in atts {
            // path ABSOLUTO entre crases (blinda espaços, ex. "Application Support")
            prompt.push_str(&format!("- `{}` ({})\n", a.path, a.mime));
        }
    }

    fn map_line(&mut self, v: &serde_json::Value) -> Vec<AgentEvent> {
        match v.get("type").and_then(|x| x.as_str()).unwrap_or("") {
            "system" => match v.get("subtype").and_then(|x| x.as_str()) {
                Some("init") => vec![AgentEvent::Session {
                    session_id: v
                        .get("session_id")
                        .and_then(|x| x.as_str())
                        .unwrap_or_default()
                        .to_string(),
                    model: v.get("model").and_then(|x| x.as_str()).map(str::to_string),
                    tools: v
                        .get("tools")
                        .and_then(|x| x.as_array())
                        .map(Vec::len)
                        .unwrap_or(0),
                }],
                // AUTO-COMPACT do CLI (verificado no binário 2.1.219: as chaves
                // autoCompactEnabled/Window/Threshold existem e o default é
                // ligado). Quando a janela enche, o claude resume a conversa
                // sozinho e avisa por aqui. Isto CAÍA no `vec![]`: a conversa era
                // compactada, o modelo perdia detalhe e você nunca sabia — só via
                // o anel travado em 100%. Agora vira linha no fio.
                Some("compact_boundary") => vec![AgentEvent::Notice {
                    message: "Contexto cheio: o Claude Code compactou a conversa — o detalhe antigo virou resumo.".to_string(),
                }],
                // microcompact: poda cirúrgica (tool results antigos), muito menos
                // destrutiva que a compactação cheia — merece aviso mais discreto.
                Some("microcompact_boundary") => vec![AgentEvent::Notice {
                    message: "O Claude Code podou partes antigas do contexto para liberar espaço.".to_string(),
                }],
                // ---- Trabalho DIFERIDO (deferred-work-plan, D1.1) ----
                // Background tasks (tool `Workflow` etc.) sobrevivem ao turno.
                // O 2.1.219 emite eventos `system/task_*` ESTRUTURADOS (spike
                // D0) — a detecção nasce deles, não de farejar nome de tool.
                // Fail-open: sem esses eventos, comportamento idêntico ao atual.
                //
                // Lista COMPLETA de tasks vivas (vazia = nada pendente; aí não
                // há o que desenhar — a conclusão de cada task chega pelos
                // task_updated/task_notification próprios).
                Some("background_tasks_changed") => {
                    let tasks = v
                        .get("tasks")
                        .and_then(|x| x.as_array())
                        .cloned()
                        .unwrap_or_default();
                    tasks
                        .iter()
                        .filter_map(|t| {
                            let id = t.get("task_id").and_then(|x| x.as_str())?;
                            Some(AgentEvent::DeferredWork {
                                id: id.to_string(),
                                tool_use_id: None,
                                kind: t
                                    .get("task_type")
                                    .and_then(|x| x.as_str())
                                    .map(str::to_string),
                                name: t
                                    .get("description")
                                    .and_then(|x| x.as_str())
                                    .map(str::to_string),
                                status: DeferredStatus::Running,
                                summary: None,
                                output_file: None,
                                progress: None,
                            })
                        })
                        .collect()
                }
                // Nascimento do task: `tool_use_id` liga ao tool_use `Workflow`
                // que o criou (vínculo determinístico pro Fio Vivo).
                Some("task_started") => {
                    let Some(id) = v.get("task_id").and_then(|x| x.as_str()) else {
                        return vec![];
                    };
                    vec![AgentEvent::DeferredWork {
                        id: id.to_string(),
                        tool_use_id: v
                            .get("tool_use_id")
                            .and_then(|x| x.as_str())
                            .map(str::to_string),
                        kind: v
                            .get("task_type")
                            .and_then(|x| x.as_str())
                            .map(str::to_string),
                        name: v
                            .get("workflow_name")
                            .and_then(|x| x.as_str())
                            .or_else(|| v.get("description").and_then(|x| x.as_str()))
                            .map(str::to_string),
                        status: DeferredStatus::Running,
                        summary: None,
                        output_file: None,
                        progress: None,
                    }]
                }
                // Batimento do task: `description`/`summary` aqui descrevem o
                // PASSO corrente (agente da vez), não o workflow — vão pro
                // summary, nunca sobrescrevem o name.
                Some("task_progress") => {
                    let Some(id) = v.get("task_id").and_then(|x| x.as_str()) else {
                        return vec![];
                    };
                    let mut progress = serde_json::Map::new();
                    if let Some(wp) = v.get("workflow_progress") {
                        progress.insert("workflow_progress".to_string(), wp.clone());
                    }
                    if let Some(u) = v.get("usage") {
                        progress.insert("usage".to_string(), u.clone());
                    }
                    vec![AgentEvent::DeferredWork {
                        id: id.to_string(),
                        tool_use_id: v
                            .get("tool_use_id")
                            .and_then(|x| x.as_str())
                            .map(str::to_string),
                        kind: None,
                        name: None,
                        status: DeferredStatus::Progress,
                        summary: v
                            .get("summary")
                            .and_then(|x| x.as_str())
                            .or_else(|| v.get("description").and_then(|x| x.as_str()))
                            .map(str::to_string),
                        output_file: None,
                        progress: (!progress.is_empty())
                            .then_some(serde_json::Value::Object(progress)),
                    }]
                }
                // Patch de estado ({"status":"completed","end_time":…}). Patch
                // sem status terminal conhecido → nada a reportar (fail-open).
                Some("task_updated") => {
                    let Some(id) = v.get("task_id").and_then(|x| x.as_str()) else {
                        return vec![];
                    };
                    let status = match v.pointer("/patch/status").and_then(|x| x.as_str()) {
                        Some("completed") => DeferredStatus::Completed,
                        Some("stopped") | Some("cancelled") => DeferredStatus::Stopped,
                        _ => return vec![],
                    };
                    vec![AgentEvent::DeferredWork {
                        id: id.to_string(),
                        tool_use_id: None,
                        kind: None,
                        name: None,
                        status,
                        summary: None,
                        output_file: None,
                        progress: None,
                    }]
                }
                // Fim com resumo + output_file. Qualquer fim não-"completed"
                // vira Stopped (o front mostra "interrompido" — honesto). O
                // output_file é PRIMEIRA CLASSE: o resultado em disco era a
                // lição central do incidente (existia e ninguém sabia).
                Some("task_notification") => {
                    let Some(id) = v.get("task_id").and_then(|x| x.as_str()) else {
                        return vec![];
                    };
                    let status = match v.get("status").and_then(|x| x.as_str()) {
                        Some("completed") => DeferredStatus::Completed,
                        _ => DeferredStatus::Stopped,
                    };
                    vec![AgentEvent::DeferredWork {
                        id: id.to_string(),
                        tool_use_id: v
                            .get("tool_use_id")
                            .and_then(|x| x.as_str())
                            .map(str::to_string),
                        kind: None,
                        name: None,
                        status,
                        summary: v
                            .get("summary")
                            .and_then(|x| x.as_str())
                            .map(str::to_string),
                        output_file: v
                            .get("output_file")
                            .and_then(|x| x.as_str())
                            .map(str::to_string),
                        progress: None,
                    }]
                }
                _ => vec![],
            },
            // H2, streaming por bloco. text_delta → TextDelta; content_block_stop
            // → TextStop (FECHA a bolha do bloco — sem isso, deltas de blocos
            // diferentes colam na mesma bolha, às vezes no meio da palavra). Tool
            // input deltas e block_start seguem ignorados.
            "stream_event" => {
                let ev = v.get("event");
                let ev_type = ev.and_then(|e| e.get("type")).and_then(|x| x.as_str());
                if ev_type == Some("content_block_delta") {
                    let delta = ev.and_then(|e| e.get("delta"));
                    let is_text = delta.and_then(|d| d.get("type")).and_then(|x| x.as_str())
                        == Some("text_delta");
                    if is_text {
                        if let Some(t) = delta.and_then(|d| d.get("text")).and_then(|x| x.as_str())
                        {
                            return vec![AgentEvent::TextDelta {
                                text: t.to_string(),
                            }];
                        }
                    }
                } else if ev_type == Some("content_block_stop") {
                    // fecha a bolha do bloco que acabou (o próximo começa limpo).
                    return vec![AgentEvent::TextStop];
                }
                vec![]
            }
            // Mensagem assistant completa: texto (o front deduplica com os deltas)
            // + tool_use como cartões.
            "assistant" => {
                let mut out = Vec::new();
                // Subagent (Task): tem parent_tool_use_id. Mensagens do agente
                // PRINCIPAL já vieram inteiras pelos deltas (--include-partial-
                // messages) → o `text` consolidado é REDUNDANTE e, com ≥2 blocos,
                // criava a bolha duplicada no meio da frase. Então só emitimos o
                // `Text` consolidado pra SUBAGENT (que chega sem deltas — é a
                // única fonte dele).
                let parent_tool_id = v
                    .get("parent_tool_use_id")
                    .and_then(|x| x.as_str())
                    .filter(|id| !id.is_empty())
                    .map(str::to_string);
                let is_subagent = parent_tool_id.is_some();
                if let Some(content) = v.pointer("/message/content").and_then(|x| x.as_array()) {
                    for block in content {
                        match block.get("type").and_then(|x| x.as_str()) {
                            Some("text") if is_subagent => {
                                if let Some(t) = block.get("text").and_then(|x| x.as_str()) {
                                    if !t.trim().is_empty() {
                                        out.push(AgentEvent::SubagentText {
                                            parent_tool_id: parent_tool_id.clone().unwrap_or_default(),
                                            text: t.to_string(),
                                        });
                                    }
                                }
                            }
                            Some("tool_use") => out.push(AgentEvent::Tool {
                                id: block
                                    .get("id")
                                    .and_then(|x| x.as_str())
                                    .unwrap_or_default()
                                    .to_string(),
                                name: block
                                    .get("name")
                                    .and_then(|x| x.as_str())
                                    .unwrap_or("tool")
                                    .to_string(),
                                input: block
                                    .get("input")
                                    .cloned()
                                    .unwrap_or(serde_json::Value::Null),
                                parent_tool_id: parent_tool_id.clone(),
                            }),
                            _ => {}
                        }
                    }
                }
                // Footprint ATUAL do contexto: usage da própria mensagem (input +
                // cache lido + cache criado ≈ prompt desta chamada). Mensagens de
                // SUBAGENT (parent_tool_use_id) têm contexto próprio e não contam
                // (mesmo `is_subagent` computado acima).
                if !is_subagent {
                    if let Some(u) = v.pointer("/message/usage") {
                        let tokens = usage_u64(Some(u), "input_tokens")
                            + usage_u64(Some(u), "cache_read_input_tokens")
                            + usage_u64(Some(u), "cache_creation_input_tokens");
                        if tokens > 0 {
                            out.push(AgentEvent::ContextUsage { tokens });
                        }
                    }
                }
                out
            }
            // Mensagens "user" no stream carregam os tool_result: viram um resumo
            // ligado à linha da tool (id). O prompt ecoado do usuário não tem
            // blocos tool_result e cai fora naturalmente.
            "user" => {
                let mut out = Vec::new();
                if let Some(content) = v.pointer("/message/content").and_then(|x| x.as_array()) {
                    for block in content {
                        if block.get("type").and_then(|x| x.as_str()) != Some("tool_result") {
                            continue;
                        }
                        let id = block
                            .get("tool_use_id")
                            .and_then(|x| x.as_str())
                            .unwrap_or_default()
                            .to_string();
                        if id.is_empty() {
                            continue;
                        }
                        let ok = !block
                            .get("is_error")
                            .and_then(|x| x.as_bool())
                            .unwrap_or(false);
                        let full = match block.get("content") {
                            Some(serde_json::Value::String(s)) => s.clone(),
                            Some(serde_json::Value::Array(a)) => a
                                .iter()
                                .filter_map(|b| b.get("text").and_then(|x| x.as_str()))
                                .collect::<Vec<_>>()
                                .join("\n"),
                            _ => String::new(),
                        };
                        // B1.1: blocos `image` (screenshot de MCP, ex. Playwright)
                        // deixam de ser descartados — viram arquivo em disco e o
                        // evento carrega os paths (nunca o base64).
                        let images = crate::evidence::collect_images(
                            self.evidence.as_ref(),
                            &id,
                            block.get("content").unwrap_or(&serde_json::Value::Null),
                        );
                        let lines = if full.trim().is_empty() {
                            0
                        } else {
                            full.lines().count() as u64
                        };
                        let mut text: String = full.chars().take(600).collect();
                        if full.chars().count() > 600 {
                            text.push('…');
                        }
                        out.push(AgentEvent::ToolResult { id, ok, text, lines, images });
                    }
                }
                // D1.1: `<task-notification>` injetada pelo harness no
                // `--resume` quando o processo anterior morreu com background
                // task pendente (payload real do incidente deep-research).
                // Entrada NÃO confiável: vira só dado de render (DeferredWork),
                // jamais comando do app.
                if let Some(text) = user_message_text(v) {
                    if let Some(ev) = parse_task_notification(&text) {
                        out.push(ev);
                    }
                }
                out
            }
            "result" => {
                let is_error = v.get("is_error").and_then(|x| x.as_bool()).unwrap_or(false);
                let mut failure_message = None;
                let mut limit = None;
                // resume falhou (sessão não existe) → sinaliza p/ degradação graciosa,
                // em vez de virar um cartão de erro (o run_agent recomeça sem resume).
                if is_error {
                    let errs = v
                        .get("errors")
                        .and_then(|x| x.as_array())
                        .map(|a| {
                            a.iter()
                                .filter_map(|e| e.as_str())
                                .collect::<Vec<_>>()
                                .join(" ")
                        })
                        .unwrap_or_default();
                    if self.is_session_not_found(&errs) {
                        return vec![AgentEvent::SessionNotFound { message: errs }];
                    }
                    // Limite de uso/cota: cartão ACIONÁVEL (revezamento), não erro
                    // morto. A mensagem humana costuma vir no campo `result`.
                    let human = v.get("result").and_then(|x| x.as_str()).unwrap_or("");
                    let msg = format!("{errs} {human}").trim().to_string();
                    if let Some(hit) = self.classify_limit(&msg) {
                        limit = Some((msg, hit));
                    } else {
                        failure_message = Some(if msg.is_empty() {
                            "O Claude encerrou o turno com erro.".to_string()
                        } else {
                            msg
                        });
                    }
                }
                let usage = v.get("usage");
                // O Claude entrega o custo pronto (total_cost_usd) → Reported.
                let cost_usd = v.get("total_cost_usd").and_then(|x| x.as_f64());
                let mut out = vec![AgentEvent::Result {
                    ok: !is_error,
                    // Em falha, a mensagem pertence ao incidente terminal abaixo.
                    // O Result continua existindo para custo/usage, mas sem ecoar
                    // o mesmo texto em um segundo bloco visual.
                    text: (!is_error)
                        .then(|| v.get("result").and_then(|x| x.as_str()).map(str::to_string))
                        .flatten(),
                    cost_source: if cost_usd.is_some() {
                        CostSource::Reported
                    } else {
                        CostSource::Unknown
                    },
                    cost_usd,
                    input_tokens: usage_u64(usage, "input_tokens"),
                    output_tokens: usage_u64(usage, "output_tokens"),
                    cache_read: usage_u64(usage, "cache_read_input_tokens"),
                    cache_creation: usage_u64(usage, "cache_creation_input_tokens"),
                    // O `result` do Claude já é POR TURNO (usage do turno +
                    // total_cost_usd daquele turno): não há acumulado a
                    // devolver, e nada aqui muda por causa do ADR-033.
                    cumulative_usage: None,
                }];
                if let Some((message, hit)) = limit {
                    out.push(AgentEvent::LimitReached {
                        message,
                        reset_hint: hit.reset_hint,
                    });
                }
                // Mesmo que a CLI saia com código 0, um result `is_error` é uma
                // falha terminal e precisa deixar o último item acionável para o
                // "Continuar no …". O Result fica para telemetria/custo.
                if let Some(message) = failure_message {
                    out.push(AgentEvent::Error { message });
                }
                out
            }
            // Regra de ouro do agent-runner.md: tipo desconhecido vira Unknown,
            // nunca é silenciosamente descartado (nem crash).
            _ => vec![AgentEvent::Unknown { raw: v.clone() }],
        }
    }
}

// ---------------- Codex (`codex exec --json`, schema thread/turn/item) ----------------

#[derive(Default)]
pub struct CodexAdapter {
    /// Modelo capturado do stream (p/ estimar custo; Codex não dá USD).
    model: Option<String>,
    /// Evidência visual (B1): o exec só reporta imagem se o item trouxer um
    /// `result` com content MCP; sem isso, degrada honesto (vazio).
    evidence: Option<crate::evidence::EvidenceSink>,
    /// Thread que este run pediu pra retomar (`exec resume <id>`), copiada do
    /// RunRequest. Serve pra saber se o `thread.started` que voltou é MESMA
    /// thread do baseline — id diferente = thread nova, baseline não vale.
    resume: Option<String>,
    /// Acumulado JÁ contabilizado desta thread antes deste run (ADR-033). Vem
    /// do front no `RunRequest.usage_baseline` (o adapter morre com o run; a
    /// thread não). None = thread nova/desconhecida → o turno vale inteiro.
    usage_seen: Option<crate::agent::CumulativeUsage>,
}

impl AgentAdapter for CodexAdapter {
    fn id(&self) -> &'static str {
        "codex"
    }

    fn capabilities(&self) -> &'static Capabilities {
        &CODEX_CAPS
    }

    fn set_evidence_sink(&mut self, sink: crate::evidence::EvidenceSink) {
        self.evidence = Some(sink);
    }

    fn build_command(&mut self, req: &RunRequest) -> Result<Command, String> {
        // o modelo REQUISITADO substitui o default do config: o Session event e a
        // estimativa de custo leem self.model (senão estima com a tabela errada).
        if let Some(m) = &req.model {
            self.model = Some(m.clone());
        }
        // ADR-033: o usage do `turn.completed` é o acumulado da THREAD. O que
        // ela já gastou (baseline) e qual thread é vêm do run — o adapter só
        // subtrai.
        self.resume = req.resume.clone();
        self.usage_seen = req.usage_baseline;
        let mut cmd = Command::new("codex");
        // Config por-run: o mesmo MCP `mc-context` do Claude, sem escrever no
        // config global do usuário. Precisa vir ANTES do subcomando `exec`.
        if !matches!(req.permission, Permission::FusionRo) {
            req.mcp_plan.configure_codex(&mut cmd);
            if let Some(gateway) = &req.context_gateway {
                gateway.configure_codex(&mut cmd);
            }
            if let Some(gateway) = &req.work_gateway {
                gateway.configure_codex(&mut cmd);
            }
        }
        cmd.arg("exec")
            .arg("--json")
            .arg("--skip-git-repo-check")
            .arg("-C")
            .arg(&req.cwd)
            .current_dir(&req.cwd);
        // permissão (3 níveis) → sandbox do Codex (exec não tem --ask-for-approval).
        // "Planejar primeiro" força read-only NESTE turno, ignorando o mapeamento
        // do modo: sandbox de OS segura de verdade (validado codex 0.144.4). As
        // OPTIONS (-s, --json…) vêm ANTES do subcomando `resume` — depois, falham.
        let sandbox = if req.plan_first {
            "read-only"
        } else {
            match req.permission {
                Permission::Leitura | Permission::FusionRo => "read-only",
                Permission::Liberado => "danger-full-access",
                Permission::Padrao | Permission::Auto => "workspace-write",
            }
        };
        cmd.arg("-s").arg(sandbox);
        // Auto (validado codex 0.144.6): `approval_policy=never` = nunca pausa,
        // mas o sandbox workspace-write acima segue confinando (escrita só no
        // workspace, rede off). exec já não pausa por não ter TTY — explicitar
        // blinda contra um default futuro e deixa a intenção auditável. Vai como
        // OPTION (antes de -m/resume). `--full-auto` foi REMOVIDO e `on-failure`
        // é inválido nesta versão: não usar.
        if matches!(req.permission, Permission::Auto) && !req.plan_first {
            cmd.arg("-c").arg("approval_policy=never");
        }
        // Codex: -m <model> · effort via override de config (não tem flag dedicada
        // no exec). Valores: minimal|low|medium|high|xhigh. ANTES de `resume`.
        if let Some(m) = &req.model {
            cmd.arg("-m").arg(m);
        }
        if let Some(e) = &req.effort {
            cmd.arg("-c").arg(format!("model_reasoning_effort={e}"));
        }
        // pastas extras (fora do cwd): --add-dir <DIR> (writable alongside
        // workspace). ANTES do subcomando `resume`: no codex 0.146 o `exec
        // resume` NÃO aceita a opção ("unexpected argument '--add-dir'") e o
        // turno morria — bug real do usuário (04/08, projeto com pasta extra +
        // resume). Como opção do `exec` (antes do subcomando) funciona nos dois
        // caminhos — validado empiricamente com resume + --add-dir + resposta.
        for d in &req.extra_dirs {
            cmd.arg("--add-dir").arg(d);
        }
        // resume: `codex exec resume <thread_id> …`
        if let Some(r) = &req.resume {
            cmd.arg("resume").arg(r);
        }
        // anexos: -i por imagem (após `resume`, é opção do subcomando ativo). O -i
        // é VARIÁDICO (<FILE>...) e comeria o prompt → separa com `--` (verificado A0).
        let mut prompt = req.prompt.clone();
        self.render_attachments(&req.attachments, &mut cmd, &mut prompt);
        // `--` SEMPRE (não só com anexos): prompt começando com "-" não vira flag.
        cmd.arg("--");
        cmd.arg(&prompt);
        Ok(cmd)
    }

    fn supports_attachment(&self, kind: &AttachmentKind) -> bool {
        // -i do Codex é só imagem; PDF é bloqueado no envio (capacidade explícita).
        matches!(kind, AttachmentKind::Image)
    }

    /// NEEDS-VERIFY: a frase do `turn.failed` num resume de thread inexistente
    /// ainda não foi capturada de um run real; a do stderr foi (verificado).
    fn is_session_not_found(&self, msg: &str) -> bool {
        msg.to_lowercase()
            .contains("no rollout found for thread id") // verificado (stderr)
    }

    fn classify_limit(&self, msg: &str) -> Option<LimitHit> {
        codex_limit(msg)
    }

    fn render_attachments(&self, atts: &[Attachment], cmd: &mut Command, _prompt: &mut String) {
        for a in atts {
            cmd.arg("-i").arg(&a.path); // path absoluto; argv não passa por shell
        }
    }

    fn map_line(&mut self, v: &serde_json::Value) -> Vec<AgentEvent> {
        match v.get("type").and_then(|x| x.as_str()).unwrap_or("") {
            "thread.started" => {
                let id = v
                    .get("thread_id")
                    .and_then(|x| x.as_str())
                    .unwrap_or_default()
                    .to_string();
                // Thread DIFERENTE da que o baseline descreve (resume que
                // falhou e recomeçou, run sem resume): o contador do provider
                // recomeça do zero, então o baseline antigo não vale mais — e
                // manter o baseline zeraria o custo do 1º turno da thread nova.
                if self.resume.as_deref() != Some(id.as_str()) {
                    self.usage_seen = None;
                }
                vec![AgentEvent::Session {
                    session_id: id,
                    model: self.model.clone(),
                    tools: 0,
                }]
            }
            "item.completed" => match v.get("item") {
                Some(item) => map_codex_item(item, self.evidence.as_ref()),
                None => vec![AgentEvent::Unknown { raw: v.clone() }],
            },
            "turn.completed" => {
                // ADR-033: este `usage` é o ACUMULADO DA THREAD, não do turno
                // (medido no codex 0.146: dois turnos triviais no mesmo thread
                // via resume deram input 17494 → 35005). Tudo que a UI e o
                // ledger mostram é o DELTA contra o baseline do run.
                let usage = v.get("usage");
                let cum = crate::agent::CumulativeUsage {
                    input: usage_u64(usage, "input_tokens"),
                    cached_input: usage_u64(usage, "cached_input_tokens"),
                    output: usage_u64(usage, "output_tokens"),
                };
                let delta = cum.delta_from(&self.usage_seen.unwrap_or_default());
                // o contador do provider é a verdade pro próximo turno (vale
                // também pra 2 turnos no mesmo run, se um dia existirem).
                self.usage_seen = Some(cum);
                let nu = crate::pricing::NormalizedUsage {
                    input: delta.input,
                    cached_input: delta.cached_input,
                    output: delta.output,
                };
                // Codex NÃO dá USD → estima por tokens × tabela (default = config gpt-5.5)
                let model = self.model.clone().unwrap_or_else(|| "gpt-5.5".to_string());
                let (cost_usd, cost_source) = crate::pricing::estimate(&model, &nu);
                let mut out = Vec::new();
                // Footprint do contexto = NÍVEL, não soma: é o prompt DESTE
                // turno (`input_tokens` já inclui a parte cacheada, convenção
                // da API da OpenAI — por isso não somamos cached, que contaria
                // o cache duas vezes). Com o contador acumulado, o nível só
                // aparece na diferença; somar acumulados faria o anel crescer
                // pra sempre (62k depois de dois turnos triviais de 17k).
                // Mesma leitura do transporte app-server, que já usa o
                // `tokenUsage.last`. Assimetria consciente: custo SOMA deltas,
                // contexto é o ÚLTIMO delta.
                let ctx = nu.input;
                if ctx > 0 {
                    out.push(AgentEvent::ContextUsage { tokens: ctx });
                }
                out.push(AgentEvent::Result {
                    ok: true,
                    text: None,
                    cost_usd,
                    cost_source,
                    input_tokens: nu.input,
                    output_tokens: nu.output,
                    cache_read: nu.cached_input,
                    cache_creation: 0,
                    // devolve o acumulado cru pro front persistir por thread e
                    // mandar de volta como baseline no próximo run.
                    cumulative_usage: Some(cum),
                });
                out
            }
            "turn.failed" => {
                let msg = v
                    .pointer("/error/message")
                    .and_then(|x| x.as_str())
                    .unwrap_or("o turno do codex falhou")
                    .to_string();
                if self.is_session_not_found(&msg) {
                    vec![AgentEvent::SessionNotFound { message: msg }]
                } else if let Some(hit) = self.classify_limit(&msg) {
                    vec![AgentEvent::LimitReached {
                        message: msg,
                        reset_hint: hit.reset_hint,
                    }]
                } else {
                    vec![AgentEvent::Error { message: msg }]
                }
            }
            // begin/started e turn.started não viram cartão (mostramos no completed)
            "item.started" | "item.updated" | "turn.started" => vec![],
            _ => vec![AgentEvent::Unknown { raw: v.clone() }],
        }
    }
}

/// Limite/cota do Codex a partir da mensagem de erro. Livre (não é método do
/// trait) porque os DOIS transportes do Codex usam: o `exec` (via stderr/
/// turn.failed) e o app-server (via notificação `error`) — a frase vem do
/// provedor, não do enquadramento.
pub fn codex_limit(msg: &str) -> Option<LimitHit> {
    let l = msg.to_ascii_lowercase();
    let hit = l.contains("exceeded your current quota")
        || l.contains("insufficient_quota")
        || l.contains("usage limit")
        || l.contains("rate limit")
        || l.contains("rate_limit")
        || l.contains("out of credits");
    hit.then(|| LimitHit {
        reset_hint: extract_reset_hint(msg),
    })
}

/// Resultado de uma tool do Codex. Diferente do Claude, o Codex só expõe a
/// tool quando o `item.completed` chega; portanto a mesma linha precisa gerar
/// Tool + ToolResult. Sem isso o frontend preserva a tool como "sem resultado
/// registrado" mesmo depois de concluída.
fn codex_tool_result(
    item: &serde_json::Value,
    id: &str,
    evidence: Option<&crate::evidence::EvidenceSink>,
) -> AgentEvent {
    let status = item.get("status").and_then(|x| x.as_str()).unwrap_or("");
    let exit_code = item.get("exit_code").and_then(|x| x.as_i64());
    let error = item.get("error").filter(|x| !x.is_null());
    let ok = exit_code.map(|c| c == 0).unwrap_or(true)
        && !matches!(status, "failed" | "error" | "cancelled")
        && error.is_none();

    let full = item
        .get("aggregated_output")
        .and_then(|x| x.as_str())
        .or_else(|| item.get("output").and_then(|x| x.as_str()))
        .map(str::to_string)
        .or_else(|| {
            error.map(|e| {
                e.get("message")
                    .and_then(|x| x.as_str())
                    .map(str::to_string)
                    .unwrap_or_else(|| e.to_string())
            })
        })
        .unwrap_or_default();
    // B1: se o item trouxer um CallToolResult MCP (`result.content` com blocos
    // image), a evidência vira arquivo. Item sem `result` (caso comum do exec)
    // → vazio, degradação honesta.
    let images = crate::evidence::collect_images(
        evidence,
        id,
        item.pointer("/result/content")
            .unwrap_or(&serde_json::Value::Null),
    );
    let lines = if full.trim().is_empty() {
        0
    } else {
        full.lines().count() as u64
    };
    let mut text: String = full.chars().take(600).collect();
    if full.chars().count() > 600 {
        text.push('…');
    }
    AgentEvent::ToolResult {
        id: id.to_string(),
        ok,
        text,
        lines,
        images,
    }
}

/// Mapeia um `item` do Codex (em item.completed) → evento normalizado.
fn map_codex_item(
    item: &serde_json::Value,
    evidence: Option<&crate::evidence::EvidenceSink>,
) -> Vec<AgentEvent> {
    let id = item
        .get("id")
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string();
    let item_type = item.get("type").and_then(|x| x.as_str()).unwrap_or("");
    match item_type {
        "agent_message" => {
            if let Some(t) = item.get("text").and_then(|x| x.as_str()) {
                if !t.trim().is_empty() {
                    return vec![AgentEvent::Text {
                        text: t.to_string(),
                    }];
                }
            }
            vec![]
        }
        "command_execution" => vec![
            AgentEvent::Tool {
                id: id.clone(),
                name: "Bash".to_string(),
                input: serde_json::json!({
                    "command": item.get("command").and_then(|x| x.as_str()).unwrap_or("")
                }),
                parent_tool_id: None,
            },
            codex_tool_result(item, &id, evidence),
        ],
        "mcp_tool_call" => vec![
            AgentEvent::Tool {
                id: id.clone(),
                name: item
                    .get("tool")
                    .and_then(|x| x.as_str())
                    .unwrap_or("mcp")
                    .to_string(),
                input: item
                    .get("arguments")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null),
                parent_tool_id: None,
            },
            codex_tool_result(item, &id, evidence),
        ],
        "web_search" => vec![
            AgentEvent::Tool {
                id: id.clone(),
                name: "WebSearch".to_string(),
                input: serde_json::json!({
                    "query": item.get("query").and_then(|x| x.as_str()).unwrap_or("")
                }),
                parent_tool_id: None,
            },
            codex_tool_result(item, &id, evidence),
        ],
        "file_change" => vec![
            AgentEvent::Tool {
                id: id.clone(),
                name: "Edit".to_string(),
                input: item
                    .get("changes")
                    .cloned()
                    .unwrap_or(serde_json::Value::Null),
                parent_tool_id: None,
            },
            codex_tool_result(item, &id, evidence),
        ],
        // reasoning, todo_list, error (não-fatal, ex. plugin warp quebrado) → ignora
        _ => vec![],
    }
}

// ---------------- Antigravity CLI (`agy -p`, print mode, NÃO-estruturado) ----------------
//
// O `agy` (sucessor do Gemini CLI) na v1.0.16 NÃO expõe `--output-format json`:
// o print mode (`-p`) roda o loop de agente (edita arquivos, roda comandos) e
// devolve só o TEXTO final no stdout. Então é o caso "agent sem JSON" que o
// agent-runner.md previu (estratégia não-estruturada, gêmea do Aider): a UI
// degrada graciosa (sem stream de tools, sem custo — reports_usage=false); a
// observabilidade do que mudou vem do `git diff` na aba Alterações.
//
// Achados verificados na máquina (agy 1.0.16):
//   • `-p` SEM --add-dir edita um scratch isolado, NÃO o cwd → --add-dir <cwd> é
//     OBRIGATÓRIO p/ ele mexer no repo real.
//   • print mode + stdin null TRAVA esperando aprovação → --dangerously-skip-
//     permissions é obrigatório p/ não pendurar.
//   • stdout é texto puro (exit 0, sem stderr no caminho feliz).
// Achado de 2026-07 (agy 1.1.7) que corrigiu uma premissa errada nossa:
//   • ele LÊ imagem e PDF, pela ferramenta interna `view_file` (renderiza a
//     página e faz OCR/visão). O anexo ficava desligado porque não há flag de
//     imagem — e `-i` é `--prompt-interactive`, não `--image` (armadilha: quem
//     assume paridade com o `-i` do Codex abre sessão interativa e trava sem
//     TTY). Mas "sem flag" ≠ "não vê": o mecanismo é o do Claude — path
//     absoluto no prompt + `--add-dir`. Provado de cwd VAZIO, arquivo fora do
//     cwd, alcançável só pelo --add-dir.
//   • ⚠️ alucina: 1 rodada em 4 leu errado uma página de PDF sem sinalizar.
//     Melhor esforço, igual ao --sandbox e ao plan_first emulado.
// Roadmap: quando o agy ganhar `--output-format json`, migra p/ StructuredAdapter
// (tool-view ao vivo + custo). Resume (--continue/--conversation) fica p/ depois:
// o print mode não expõe o id da conversa no stdout.
#[derive(Default)]
pub struct AgyAdapter {
    /// Session já emitido? (a 1ª linha de stdout dispara o Session uma vez).
    started: bool,
    /// Modelo requisitado (p/ o rótulo no Session). None = default do agy (Flash).
    model: Option<String>,
}

impl AgentAdapter for AgyAdapter {
    fn id(&self) -> &'static str {
        "agy"
    }

    fn capabilities(&self) -> &'static Capabilities {
        &AGY_CAPS
    }

    fn build_command(&mut self, req: &RunRequest) -> Result<Command, String> {
        let mut cmd = Command::new("agy");
        // "Planejar primeiro" no agy é EMULAÇÃO POR PROMPT + --sandbox, sem
        // garantia dura: o `--mode plan` do agy 1.1.2 é CONSULTIVO e FUROU no
        // teste de 2026-07 (criou e executou arquivos no scratch com
        // --dangerously-skip-permissions em headless) → NÃO usamos --mode plan.
        // Melhor esforço documentado; o gate real de execução é o nosso, na UI.
        let mut prompt = if req.plan_first {
            format!(
                "MODO PLANEJAMENTO: NÃO crie nem edite arquivos, NÃO execute comandos com efeito. Apenas apresente o plano de implementação passo a passo, com arquivos e riscos.\n\nTarefa: {}",
                req.prompt
            )
        } else {
            req.prompt.clone()
        };
        // ANEXOS ANTES do `-p`: no agy o prompt é o VALOR da flag, então o texto
        // dos anexos precisa estar no String antes de ele ser passado. (No Codex
        // é o oposto — o prompt vai no fim, depois do `--`.) Trocar a ordem aqui
        // envia o prompt sem a lista e o anexo some sem erro.
        self.render_attachments(&req.attachments, &mut cmd, &mut prompt);
        cmd.arg("-p")
            .arg(&prompt)
            // amarra o cwd real (senão o print mode edita o scratch, não o repo).
            .arg("--add-dir")
            .arg(&req.cwd)
            .current_dir(&req.cwd);
        // pastas extras (fora do cwd): mais um --add-dir por pasta.
        for d in &req.extra_dirs {
            cmd.arg("--add-dir").arg(d);
        }
        // modelo: o value do front É o id exato listado por `agy models` (ex.:
        // "gemini-3.6-flash-low"). "default"/None = deixa o agy escolher.
        if let Some(m) = &req.model {
            if m != "default" {
                self.model = Some(m.clone());
                cmd.arg("--model").arg(m);
            }
        }
        // print mode não tem TUI p/ aprovar mid-run e o stdin é null → auto-aprova
        // sempre (senão trava). Leitura/Fusion — e "Planejar primeiro" — ganham
        // --sandbox como MELHOR ESFORÇO (não é read-only real; limite documentado,
        // igual PTY no agent-runner.md §7). Emitido UMA vez (sem duplicar quando
        // plan_first coincide com Leitura/Fusion).
        cmd.arg("--dangerously-skip-permissions");
        // --sandbox (confinamento best-effort do agy): Leitura/Fusion e "Planejar
        // primeiro" — e também Auto, que é "autonomia COM freio" (o agy não tem
        // classificador, então o sandbox é o único freio possível; sem ele, Auto
        // seria idêntico a Liberado). Emitido UMA vez (sem duplicar).
        if req.plan_first
            || matches!(
                req.permission,
                Permission::Leitura | Permission::FusionRo | Permission::Auto
            )
        {
            cmd.arg("--sandbox");
        }
        Ok(cmd)
    }

    /// agy print mode não emite JSON → `map_line` não é chamado (o on_stdout_line
    /// sobrescrito trata texto). Defensivo: se um dia emitir JSON, não perde a linha.
    fn map_line(&mut self, v: &serde_json::Value) -> Vec<AgentEvent> {
        vec![AgentEvent::Unknown { raw: v.clone() }]
    }

    /// NÃO-ESTRUTURADO: cada linha de stdout é TEXTO do assistente (não JSON). A 1ª
    /// linha emite também o Session (rótulo do modelo). Blank lines são preservadas
    /// (parágrafos do markdown). O turno fecha no Done (sem Result → sem custo).
    fn on_stdout_line(&mut self, line: &str) -> Vec<AgentEvent> {
        let mut out = Vec::new();
        if !self.started {
            self.started = true;
            out.push(AgentEvent::Session {
                session_id: String::new(),
                model: self.model.clone(),
                tools: 0,
            });
        }
        out.push(AgentEvent::TextDelta {
            text: format!("{line}\n"),
        });
        out
    }

    /// O agy LÊ imagem e PDF — provado na máquina (2026-07): rodando de um
    /// diretório vazio, com os arquivos FORA do cwd e liberados só por
    /// `--add-dir`, ele abriu PNG e PDF pela ferramenta interna `view_file`
    /// (renderiza a página e faz OCR/visão) e respondeu certo sobre os dois.
    ///
    /// Ficava em `false` (default do trait) porque o `agy` não tem flag de
    /// imagem — e `-i` é `--prompt-interactive`, não `--image`. Mas "sem flag"
    /// nunca significou "não vê": é o MESMO mecanismo do Claude (ponteiro no
    /// prompt + `--add-dir`), e o Gemini é multimodal nativo.
    ///
    /// ⚠️ MELHOR ESFORÇO, como o `--sandbox` e o plan_first emulado acima: numa
    /// das 4 rodadas do teste o agy respondeu "BANANA" para uma página cujo
    /// código era "BERIMBAU", SEM sinalizar falha. Ele lê, mas alucina às vezes
    /// e não avisa. Não é paridade com o Read do Claude.
    fn supports_attachment(&self, kind: &AttachmentKind) -> bool {
        matches!(kind, AttachmentKind::Image | AttachmentKind::Pdf)
    }

    /// Igual ao Claude: libera a pasta do anexo e cita o caminho ABSOLUTO no
    /// prompt. Chamado no TOPO do build_command — aqui o prompt é o valor do
    /// `-p`, então depois de `cmd.arg("-p")` já seria tarde.
    fn render_attachments(&self, atts: &[Attachment], cmd: &mut Command, prompt: &mut String) {
        if atts.is_empty() {
            return;
        }
        // `--add-dir` é repetível (verificado no --help), então este soma aos
        // extra_dirs sem conflito.
        if let Some(dir) = std::path::Path::new(&atts[0].path).parent() {
            cmd.arg("--add-dir").arg(dir);
        }
        prompt.push_str("\n\nArquivos anexados (abra-os antes de responder):\n");
        for a in atts {
            prompt.push_str(&format!("- `{}` ({})\n", a.path, a.mime));
        }
    }

    /// Frases extraídas do binário do agy 1.1.1 (strings do bundle Go/Codeium):
    /// a UI de esgotamento usa "Out of credits"; a camada gRPC expõe
    /// ResourceExhausted (com e sem underscore, conforme o formatador). Mantém
    /// quota/rate limit como rede genérica de provedor.
    fn classify_limit(&self, msg: &str) -> Option<LimitHit> {
        let l = msg.to_ascii_lowercase();
        let hit = l.contains("out of credits")
            || l.contains("resource_exhausted")
            || l.contains("resourceexhausted")
            || l.contains("quota")
            || l.contains("rate limit")
            || l.contains("usage limit");
        hit.then(|| LimitHit {
            reset_hint: extract_reset_hint(msg),
        })
    }
}

/// Modelo default do Codex (CODEX_HOME ou ~/.codex)/config.toml. O stream do
/// `codex exec --json` NÃO expõe o modelo, então essa é a fonte robusta p/ custo.
fn codex_config_model() -> String {
    let dir = std::env::var("CODEX_HOME")
        .map(PathBuf::from)
        .ok()
        .or_else(|| {
            std::env::var("HOME")
                .ok()
                .map(|h| PathBuf::from(h).join(".codex"))
        });
    dir.and_then(|d| std::fs::read_to_string(d.join("config.toml")).ok())
        .and_then(|t| t.parse::<toml_edit::DocumentMut>().ok())
        .and_then(|doc| {
            doc.get("model")
                .and_then(|v| v.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "gpt-5.5".to_string())
}

/// Modelo usado p/ ESTIMAR o custo do Codex (ele nunca reporta USD): o
/// requisitado no envio vence; sem ele, o default do `~/.codex/config.toml`.
/// Mesma regra dos dois transportes (`exec` e app-server).
pub fn codex_cost_model(requested: Option<&str>) -> Option<String> {
    Some(
        requested
            .map(str::to_string)
            .unwrap_or_else(codex_config_model),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// RunRequest mínimo p/ testar build_command (sem spawnar nada).
    fn req(permission: Permission, plan_first: bool) -> RunRequest {
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
            mcp_plan: crate::mcp_control::McpRunPlan::default(),
            plan_first,
            usage_baseline: None,
        }
    }

    /// argv do Command montado (só os args; o programa fica de fora).
    fn argv(cmd: &Command) -> Vec<String> {
        cmd.as_std()
            .get_args()
            .map(|a| a.to_string_lossy().into_owned())
            .collect()
    }

    /// O par `--flag valor` aparece no argv (adjacente, na ordem)?
    fn has_pair(args: &[String], flag: &str, value: &str) -> bool {
        args.windows(2).any(|w| w[0] == flag && w[1] == value)
    }

    /// Regressão do bug real de 04/08: `codex exec resume` (0.146) NÃO aceita
    /// `--add-dir` depois do subcomando ("unexpected argument"); a opção tem
    /// que vir ANTES do `resume`. Turno de resume com pasta extra morria.
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

    fn external_mcp() -> crate::mcp_control::McpRuntimeServer {
        crate::mcp_control::McpRuntimeServer {
            runtime_name: "mcx-claude-hostinger".into(),
            display_name: "Hostinger".into(),
            launch: crate::mcp_control::McpLaunchConfig {
                transport: "stdio".into(),
                command: Some("/opt/mcp/hostinger-wrapper".into()),
                args: vec!["serve".into()],
                ..Default::default()
            },
        }
    }

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
            server_bin: "/app/mycockpit".into(),
            root: "/repo".into(),
            conv_id: "c1".into(),
            db_path: Some("/data/mycockpit.db".into()),
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
        assert!(nudge.contains(
            "- mcx-claude-hostinger: Hostinger (MCP externo roteado pelo MyCockpit)"
        ));
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
                assert_eq!(kind.as_deref(), Some("local_workflow"));
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
                assert_eq!(
                    output_file.as_deref(),
                    Some("/tmp/tasks/wnz619fti.output")
                );
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
            AgentEvent::DeferredWork { status: DeferredStatus::Stopped, .. }
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

    // ---- evidência visual de tool_result (browser-plan B1) ----

    /// PNG 1×1 real em base64 (o mesmo fixture do evidence.rs).
    const PNG_1X1_B64: &str = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

    /// tool_result com bloco `image` (shape EXATO do stream-json: content array
    /// com source base64) → arquivo em disco com nome determinístico + path no
    /// evento; o base64 NUNCA aparece no evento serializado.
    #[test]
    fn claude_tool_result_com_imagem_grava_arquivo_e_emite_path() {
        let dir = std::env::temp_dir().join(format!(
            "mc-adapter-evidence-{}",
            std::process::id()
        ));
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
            AgentEvent::ToolResult { id, ok, text, images, .. } => {
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
            server_bin: "/app/mycockpit".into(),
            root: "/repo".into(),
            conv_id: "c1".into(),
            db_path: None,
        });
        let mut a = CodexAdapter::default();
        let args = argv(&a.build_command(&r).unwrap());
        let exec = args.iter().position(|x| x == "exec").unwrap();
        let cfg = args
            .iter()
            .position(|x| x.contains("mcp_servers.mc-context.command"))
            .unwrap();
        assert!(cfg < exec);
        assert!(args.iter().any(|x| x.contains("context-server")));
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

    // ---- ADR-033: usage do codex é ACUMULADO DA THREAD ----

    /// Sequência REAL medida no codex 0.146 (04/08/2026): dois turnos triviais
    /// na MESMA thread, o 2º via `exec resume`. O acumulado praticamente dobra
    /// com o mesmo prompt — ler isso como gasto do turno é o bug que inflou o
    /// ledger em ~20x.
    const TURNO_1: (u64, u64, u64) = (17494, 9984, 6);
    const TURNO_2: (u64, u64, u64) = (35005, 27136, 12);

    fn turn_completed(usage: (u64, u64, u64)) -> serde_json::Value {
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
    fn result_of(evs: &[AgentEvent]) -> (u64, u64, u64, f64, Option<crate::agent::CumulativeUsage>) {
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

    fn ctx_of(evs: &[AgentEvent]) -> Option<u64> {
        evs.iter().find_map(|e| match e {
            AgentEvent::ContextUsage { tokens } => Some(*tokens),
            _ => None,
        })
    }

    #[test]
    fn codex_segundo_turno_cobra_o_delta_e_nao_o_acumulado_da_thread() {
        // Turno 1: thread nova, sem baseline → o acumulado É o turno.
        let mut a1 = CodexAdapter::default();
        a1.build_command(&req(Permission::Padrao, false)).unwrap();
        a1.map_line(&serde_json::json!({ "type": "thread.started", "thread_id": "t-1" }));
        let evs1 = a1.map_line(&turn_completed(TURNO_1));
        let (i1, o1, c1, usd1, cum1) = result_of(&evs1);
        assert_eq!((i1, c1, o1), (17494, 9984, 6));
        assert_eq!(cum1.map(|c| c.input), Some(17494));

        // Turno 2: MESMA thread via resume, com o acumulado do turno 1 como
        // baseline (é o que o front persistiu do `cumulative_usage`).
        let mut a2 = CodexAdapter::default();
        let mut r = req(Permission::Padrao, false);
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
        assert_eq!(cum2.map(|c| (c.input, c.cached_input, c.output)), Some(TURNO_2));
        // custo do delta ≈ US$0,0106 (gpt-5.5); pelo acumulado seriam ~US$0,053.
        assert!(
            usd2 < 0.02,
            "custo do 2º turno saiu do acumulado (US$ {usd2:.4}); esperado ~US$ 0,0106"
        );
        assert!(usd1 > 0.0 && usd2 > 0.0);
        // contexto é NÍVEL: o prompt do turno (input já inclui o cacheado),
        // não a soma dos prompts da thread.
        assert_eq!(ctx_of(&evs1), Some(17494));
        assert_eq!(
            ctx_of(&evs2),
            Some(17511),
            "o anel de contexto mostra o prompt DESTE turno, não o acumulado"
        );
    }

    #[test]
    fn codex_thread_nova_descarta_o_baseline_em_vez_de_zerar_o_turno() {
        let mut a = CodexAdapter::default();
        let mut r = req(Permission::Padrao, false);
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
        assert_eq!((i, c, o), (17494, 9984, 6), "1º turno da thread nova vale inteiro");
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
        assert_eq!(ctx_of(&evs), None, "sem prompt novo, sem anel novo");
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
                    assert_eq!((*input_tokens, *output_tokens, *cache_read), (1200, 300, 900));
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
        // agy: stdout de texto puro, sem usage.
        assert!(!capabilities_of("agy").unwrap().cumulative_usage);
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
        // agy 1.1.12: só /credits (saldo, sem janela/reset) → sem fonte.
        assert_eq!(capabilities_of("agy").unwrap().usage_window, None);

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
        assert_eq!(capabilities_of("agy").unwrap().usage_window_poll, None);
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

    // ---- agy ----

    #[test]
    fn agy_plan_first_prefixa_prompt_e_liga_sandbox() {
        let mut a = AgyAdapter::default();
        let args = argv(&a.build_command(&req(Permission::Padrao, true)).unwrap());
        // prompt é o arg logo após o -p
        let i = args.iter().position(|x| x == "-p").unwrap();
        assert!(args[i + 1].starts_with("MODO PLANEJAMENTO:"));
        assert!(args[i + 1].contains("Tarefa: faça X"));
        assert!(args.contains(&"--sandbox".to_string()));
        // emulação NÃO usa --mode plan (consultivo; furou o gate em 2026-07)
        assert!(!args.contains(&"--mode".to_string()));
    }

    #[test]
    fn agy_sandbox_nao_duplica_em_leitura_com_plan_first() {
        let mut a = AgyAdapter::default();
        let args = argv(&a.build_command(&req(Permission::Leitura, true)).unwrap());
        assert_eq!(args.iter().filter(|x| *x == "--sandbox").count(), 1);
    }

    #[test]
    fn agy_sem_plan_first_prompt_intacto() {
        let mut a = AgyAdapter::default();
        let args = argv(&a.build_command(&req(Permission::Padrao, false)).unwrap());
        let i = args.iter().position(|x| x == "-p").unwrap();
        assert_eq!(args[i + 1], "faça X");
        assert!(!args.contains(&"--sandbox".to_string()));
    }

    /// RunRequest com um anexo (o path é o que vai pro prompt; nada é lido).
    fn req_com_anexo(kind: AttachmentKind, path: &str, mime: &str) -> RunRequest {
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

    /// O agy LÊ imagem e PDF (provado na máquina via `view_file`). Ficava em
    /// `false` só porque não há flag de imagem — "sem flag" ≠ "não vê".
    #[test]
    fn agy_aceita_imagem_e_pdf() {
        let a = AgyAdapter::default();
        assert!(a.supports_attachment(&AttachmentKind::Image));
        assert!(a.supports_attachment(&AttachmentKind::Pdf));
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
        assert!(claude.native_slash, "claude-code interpreta /comando nativo");
        assert_eq!(claude.command_sources, &[CommandSource::ClaudeDirs]);

        let codex = capabilities_of("codex").unwrap();
        // `codex exec` NÃO interpreta /prompt — a expansão é app-side; a
        // convenção ~/.codex/prompts segue existindo pro inventário do "/".
        assert!(!codex.native_slash);
        assert_eq!(codex.command_sources, &[CommandSource::CodexPrompts]);

        let agy = capabilities_of("agy").unwrap();
        assert!(!agy.native_slash);
        assert!(agy.command_sources.is_empty(), "agy só enxerga a casa");
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
        // dos nudges) + resume nativo + mc-context.
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
        assert!(!agy.system_channel);
        assert!(!agy.session_resume);
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
        // agy: nada.
        assert!(!capabilities_of("agy").unwrap().native_compact);
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
            server_bin: "/app/mycockpit".into(),
            socket: "/tmp/mc-work.sock".into(),
        });
        let mut a = ClaudeAdapter::default();
        let args = argv(&a.build_command(&r).unwrap());
        let system = args
            .windows(2)
            .find(|pair| pair[0] == "--append-system-prompt")
            .map(|pair| pair[1].clone())
            .expect("canal system emitido");
        let doutrina = system.find("<doutrina>regras</doutrina>").unwrap();
        let nudge = system.find("mc-work").expect("nudge do mc-work no canal");
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
            &a.build_command(&req_com_anexo(
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

    // ---- registry de capabilities (G1, capability-registry-plan) ----

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
            r.system_prompt = Some("DOUTRINA-DO-CONTRATO".to_string());
            r.context_gateway = Some(crate::context_gateway::GatewayConfig {
                server_bin: "/app/mycockpit".into(),
                root: "/repo".into(),
                conv_id: "c-contrato".into(),
                db_path: None,
            });
            r.work_gateway = Some(crate::work_gateway::GatewayConfig {
                server_bin: "/app/mycockpit".into(),
                socket: "/tmp/mc-work-contrato.sock".into(),
            });
            r.approval = Some(("/app/mycockpit".into(), "/tmp/mc-approval-contrato.sock".into()));
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
            let args = argv(&a.build_command(&r).unwrap());
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
            assert_eq!(
                blob.contains(crate::work_gateway::MCP_SERVER_NAME),
                caps.work_mcp,
                "{agent}: work_mcp declarado ≠ injeção do mc-work no comando"
            );
            assert_eq!(
                blob.contains(crate::context_gateway::MCP_SERVER_NAME),
                caps.context_mcp,
                "{agent}: context_mcp declarado ≠ injeção do mc-context no comando"
            );
            assert_eq!(
                blob.contains(crate::approval::MCP_SERVER_NAME),
                caps.inline_interaction,
                "{agent}: inline_interaction declarado ≠ mc-approval no comando"
            );
            assert_eq!(
                blob.contains("mcx-claude-hostinger"),
                caps.managed_mcp,
                "{agent}: managed_mcp declarado ≠ MCP externo do plano no comando"
            );
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
            let unknown = evs
                .iter()
                .any(|e| matches!(e, AgentEvent::Unknown { .. }));
            let texto = evs.iter().any(|e| {
                matches!(e, AgentEvent::TextDelta { .. } | AgentEvent::Text { .. })
            });
            assert_eq!(unknown, caps.structured_output, "{agent}: structured_output");
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
        assert_eq!(
            registered_agents().collect::<Vec<_>>(),
            vec!["claude-code", "codex", "agy"]
        );
    }
}
