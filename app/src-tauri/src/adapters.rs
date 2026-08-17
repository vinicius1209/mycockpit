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
    /// agy 1.1.13: `agy -p "/usage" --output-format json` — o CLI EXPANDE o
    /// comando de cliente em modo print e devolve, além do TSV em `response`,
    /// um bloco ESTRUTURADO em `command.data` (grupos × buckets, com `id`
    /// estável, `window` e `remaining_fraction`). POLL headless, e o CUSTO É
    /// ZERO: o mesmo payload volta com `num_turns: 0`, `duration_seconds: 0` e
    /// `usage` inteiro zerado, `conversation_id` VAZIO — é consulta de cliente
    /// ao backend, não abre turno nem conversa. Medido nesta máquina em
    /// 16/08/2026 (exit 0, ~4,5s de parede; fixture real em usage_window.rs).
    /// O `response` (TSV) é ignorado de propósito: percentual arredondado a
    /// inteiro e sem id de bucket, ou seja, contrato pior que o `command.data`.
    ///
    /// Espelho TS: `"print"` (o mecanismo — sonda headless pelo modo print do
    /// próprio CLI). Aqui o nome carrega o fornecedor porque é a convenção
    /// deste enum: dialeto É domínio do fornecedor.
    AgyPrintCommand,
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

/// Como PERGUNTAR ao CLI quais modelos ele conhece HOJE (M1 do
/// model-autonomy-plan). Mesmo padrão do `UsageWindowSource`/`HookDialect`: o
/// enum confina o "como" (comando, framing, shape da resposta — consumido SÓ
/// por model_list.rs), a capability decide o "se". `None` = motor sem fonte
/// viva auditada; a lista curada de `lib/agents.ts` + o catálogo models.dev
/// seguem sendo a fonte (degradação honesta, nunca inventar sonda).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ModelListSource {
    /// agy 1.1.13: `agy models` imprime TSV `slug<TAB>Rótulo` no stdout (o
    /// "Fetching available models..." vai pro stderr). Sem `--json` (o flag
    /// não existe: "flags provided but not defined"). Saída real capturada
    /// nesta máquina em 14/08/2026 — fixture em model_list.rs.
    AgyModelsSubcommand,
    /// codex 0.147: JSON-RPC `model/list` no MESMO canal app-server que o
    /// medidor de uso já abre (`codex -s read-only -a untrusted app-server` →
    /// initialize → initialized → método; sonda local, NENHUMA quota). A
    /// resposta traz `id`, `displayName`, `description`, `hidden`, `isDefault`
    /// e — o achado que M1 precisava — `upgrade`/`upgradeInfo.migrationMarkdown`
    /// quando o slug está sendo APOSENTADO. Resposta real capturada nesta
    /// máquina em 14/08/2026 — fixture em model_list.rs.
    CodexAppServer,
}

/// Como fazer a FUMAÇA DE UM TOKEN num candidato (M2 do model-autonomy-plan):
/// a chamada mínima que descobre, na prática, se um slug funciona com ESTA
/// autenticação. Mesmo padrão dos outros dialetos: o enum confina o "como"
/// (flags de custo mínimo + as frases que cada CLI usa pra recusar — consumido
/// SÓ por model_smoke.rs), a capability decide o "se".
///
/// A fumaça é a ÚNICA peça do app que gasta quota de propósito. Por isso ela
/// nunca roda em laço nem no boot: só por gesto/agenda, com teto de candidatos
/// por rodada e janela mínima entre rodadas (guardas em model_smoke.rs).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ModelSmokeDialect {
    /// claude 2.1.220: `claude -p --model <slug> --output-format json` com
    /// `--tools ""` (derruba as definições de ferramenta: o mesmo turno caiu de
    /// $0,036 pra $0,00055), `--no-session-persistence`, `--strict-mcp-config`,
    /// `--safe-mode` e `--max-turns 1`. O JSON final classifica sozinho:
    /// `is_error` + `api_error_status` (404 real capturado 14/08/2026) e, no
    /// sucesso, `modelUsage[*].contextWindow` + `canonicalModel` — é o ÚNICO
    /// motor que devolve o teto de contexto, e por isso o único que hoje
    /// consegue apontar `context-mismatch`.
    ClaudePrintJson,
    /// codex 0.147: `codex exec -m <slug> -s read-only --skip-git-repo-check
    /// --ephemeral --ignore-user-config --json`. ATENÇÃO: o `exec` NÃO aceita
    /// `-a untrusted` (só o `app-server` aceita — erro real na tentativa). O
    /// JSONL separa os dois desfechos que o plano precisava distinguir: o CLI
    /// avisa "Model metadata for `X` not found" quando é ELE que não conhece o
    /// slug; sem esse aviso, uma recusa do servidor é a SUA auth não alcançando.
    CodexExecJson,
    /// agy 1.1.13: `agy -p <prompt> --model <slug> --output-format json`. A
    /// recusa de slug é LOCAL (nem sai chamada: "model X is not recognized as
    /// a known model or custom model in settings", capturado 14/08/2026) — a
    /// fumaça de slug inválido no agy custa zero.
    AgyPrintJson,
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
    /// O CLI sabe dizer, AGORA, quais modelos ele conhece (M1 do
    /// model-autonomy-plan): é a verificação que hoje só existe na cabeça de
    /// quem testou à mão. Verdade por versão auditada nesta máquina
    /// (14/08/2026): agy 1.1.13 ✅ `agy models` (TSV no stdout); codex 0.147 ✅
    /// `model/list` no app-server (o MESMO canal do medidor de uso — reusado,
    /// não duplicado); claude 2.1.220 ❌ — NÃO há subcomando de modelos
    /// (`claude --help` só tem agents/auth/auto-mode/doctor/gateway/install/
    /// mcp/plugin/project/setup-token/ultrareview/update), e o que existe em
    /// `~/.claude/*.json` é cache de tooling do usuário, não lista oficial →
    /// `None`, e o catálogo (models.dev) segue sendo a fonte, exatamente como
    /// o §M1 do plano previu. Espelho TS: `listsModels` em lib/agents.ts
    /// (teste-gêmeo agents.modelList.test.ts ↔ `matriz_lista_de_modelos_por_agent`).
    pub lists_models: Option<ModelListSource>,
    /// Dá pra TESTAR um slug neste motor com uma chamada mínima e ler o
    /// desfecho (M2 do model-autonomy-plan): é a peça que substitui o humano
    /// no portão das propostas. Verdade por versão auditada nesta máquina
    /// (14/08/2026): claude 2.1.220 ✅, codex 0.147 ✅ e agy 1.1.13 ✅ — os três
    /// têm modo print com saída legível o bastante pra separar "o CLI não
    /// conhece" de "a sua auth não alcança". `None` = motor sem forma de testar:
    /// o candidato continua indo pro humano decidir, como sempre foi.
    /// Espelho TS: `modelSmoke` em lib/agents.ts (teste-gêmeo
    /// agents.modelSmoke.test.ts ↔ `matriz_fumaca_de_modelo_por_agent`).
    pub model_smoke: Option<ModelSmokeDialect>,
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
    // claude 2.1.220: não existe fonte viva de lista de modelos — nenhum
    // subcomando (`--help` verificado 14/08/2026) e nada oficial em disco.
    // Fonte confiável ausente ⇒ None, e o comportamento de hoje (lista curada
    // + catálogo models.dev) fica intacto.
    lists_models: None,
    // claude 2.1.220: `-p --output-format json` classifica sozinho — 404 real
    // no slug inválido e `modelUsage.contextWindow` no sucesso (14/08/2026).
    model_smoke: Some(ModelSmokeDialect::ClaudePrintJson),
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
    // codex 0.147: `model/list` no app-server read-only devolveu 6 modelos
    // visíveis (+2 hidden com `includeHidden`) e marcou `gpt-5.4`/`gpt-5.4-mini`
    // com `upgrade` — aposentadoria ANUNCIADA pelo próprio CLI (capturado na
    // mão 14/08/2026, fixture em model_list.rs).
    lists_models: Some(ModelListSource::CodexAppServer),
    // codex 0.147: `exec --json` distingue "o CLI não conhece o slug" (aviso
    // de metadata) de recusa do servidor (14/08/2026).
    model_smoke: Some(ModelSmokeDialect::CodexExecJson),
};

/// agy 1.1.13 (auditado NESTA máquina em 14/08/2026, sondas cruas em
/// `agy_stream` nos testes). A declaração de antes descrevia a 1.1.9 e ficou
/// para trás: o `--output-format json|stream-json` da 1.1.12 destravou canal
/// estruturado, usage e resume — três campos que estavam `false` por versão
/// velha, não por medição. Cada campo abaixo cita a evidência e a data.
pub const AGY_CAPS: Capabilities = Capabilities {
    // agy 1.1.13: FALA MCP por dentro (a tool `call_mcp_tool` está na lista de
    // 56 tools do evento `init`, capturado 14/08/2026), mas a configuração é
    // GLOBAL e só por arquivo (`~/.gemini/config/mcp_config.json`) — o
    // `--help` da 1.1.13 não tem nenhuma flag de config MCP por-run. Injetar
    // servidor nosso exigiria reescrever o config do usuário, o oposto de
    // "por-run". Fica false: o mc-work/mc-context nunca são prometidos, e o
    // control plane de MCPs externos não roteia este motor.
    work_mcp: false,
    context_mcp: false,
    managed_mcp: false,
    mcp_launch_cwd: false,
    inline_interaction: false,
    // agy 1.1.13: o stream tem `step_type: "tool"`, mas nada que sobreviva ao
    // turno (nenhum evento de task/workflow em background nas sondas de
    // 14/08/2026). `schedule` e `manage_task` existem como TOOLS, e enquanto
    // não houver evento de ciclo de vida delas no stream, inventar nó diferido
    // aqui seria teatro.
    deferred_work: false,
    // agy 1.1.13: o CLI EXPANDE `/comando` em print mode — `agy -p "/credits"`
    // devolveu `{"event":"command_result","command":{"name":"credits",…}}`
    // (14/08/2026), e o `--help` tem `--disable-slash-commands` justamente
    // para desligar isso. Segue `false` MESMO ASSIM, e por um motivo medido:
    // não auditamos NENHUMA fonte de comando custom do agy (por isso
    // `command_sources` vazio), e `native_slash` só muda comportamento para
    // comando vindo da fonte NATIVA declarada. Declarar `true` com fonte
    // nenhuma prometeria um caminho que não existe; a casa
    // (`.mycockpit/commands`) o agy não conhece e segue expandindo app-side.
    native_slash: false,
    command_sources: &[],
    // agy 1.1.13: `--conversation <ID>` retoma de verdade — o `conversation_id`
    // sai no `init` de TODO run e, no resume, o `step_index` CONTINUA de onde
    // parou (6→8 em vez de recomeçar em 0) e o modelo lembra o turno anterior
    // (medido 14/08/2026). ⚠️ id inexistente NÃO falha: o agy escreve
    // `warning: conversation "…" not found` no stderr e começa uma conversa
    // NOVA em silêncio — por isso o adapter compara o id pedido com o id do
    // `init` e emite SessionNotFound (senão o app acharia que tem contexto).
    session_resume: true,
    system_channel: false,
    // agy 1.1.13: `--output-format stream-json` é NDJSON, um objeto por linha,
    // envelope `{"event": <nome>, <nome>: {…}}` (init | step_update | result |
    // command_result). Capturado 14/08/2026; fixtures em `agy_stream`.
    structured_output: true,
    // agy 1.1.13: NENHUM campo de USD em nenhum evento (init/step_update/
    // result) — só tokens. O custo do turno é ESTIMADO por tokens × tabela,
    // igual ao codex; `reports_cost` é sobre USD REPORTADO, e não há.
    reports_cost: false,
    // agy 1.1.13: `result.usage` é o ACUMULADO DA CONVERSA, não do turno.
    // Medido nos DOIS caminhos de resume em 14/08/2026 (a lição do ADR-033,
    // cobrada antes de declarar): turno 1 input 43296 → turno 2 (`--continue`)
    // 45684, e o step do turno 2 sozinho custou 2388 = a diferença EXATA;
    // repetido com `--conversation` (33000 → 50586, step de 17586). O
    // `num_turns` também acumula (1 → 2). Já o `step_update.usage` é
    // INCREMENTAL, por step.
    cumulative_usage: true,
    // agy 1.1.13: `/compact` NÃO é comando nativo — `agy -p "/compact"` não
    // devolveu `command_result` nenhum (o `/credits` devolve), o texto caiu no
    // modelo como prompt qualquer e ele respondeu "It looks like you entered
    // `/compact`… No manual command is required" (medido 14/08/2026). Sem
    // compactação nativa, o `/compactar` do app segue na renovação com recap.
    native_compact: false,
    // agy 1.1.13: era `None` porque o `/credits` só expõe saldo absoluto (sem
    // percentual de janela nem reset). O motivo caiu em 16/08/2026: o `/usage`
    // existe, o print mode o expande e devolve `command.data` com grupos ×
    // buckets — fração restante exata, tipo de janela e reset por bucket, que
    // é o contrato de UsageWindow inteiro. Custo ZERO (num_turns 0, usage
    // zerado, conversation_id vazio: não abre turno nem conversa), então o
    // poll entra na cadência normal. Payload real na fixture de usage_window.rs.
    usage_window: Some(UsageWindowSource::AgyPrintCommand),
    usage_window_poll: Some(UsageWindowSource::AgyPrintCommand),
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
    // agy 1.1.13: `agy models` lista 14 slugs em TSV (capturado 14/08/2026).
    // É a MESMA fonte que a detecção já usava — agora com contrato declarado.
    lists_models: Some(ModelListSource::AgyModelsSubcommand),
    // agy 1.1.13: `-p --output-format json` recusa slug desconhecido LOCALMENTE
    // (sem chamada, sem custo) e devolve status SUCCESS quando aceita.
    model_smoke: Some(ModelSmokeDialect::AgyPrintJson),
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

/// Um slug de modelo é o VALOR de uma flag (`--model <slug>`) ou de um campo
/// JSON — nunca uma linha de listagem. Espaço em branco dentro dele só aparece
/// quando um parser deixou rótulo colado no id: foi exatamente isso que quebrou
/// o agy (o `agy models` é TSV `slug<TAB>Rótulo` e um parser velho devolvia a
/// linha inteira), e o CLI respondeu com "model … is not recognized".
///
/// Guarda GENÉRICA (nenhum nome de fornecedor aqui): o formato de slug não é o
/// dialeto de ninguém, é a regra do transporte. Fail-closed com mensagem
/// honesta — o turno é recusado ANTES de gastar quota, dizendo o que está
/// errado, em vez de virar erro do CLI sem explicação.
pub fn validate_model_slug(model: Option<&str>) -> Result<(), String> {
    let Some(m) = model else { return Ok(()) };
    if m.trim().is_empty() {
        return Err(
            "o modelo selecionado está vazio. Escolha um modelo no seletor e tente de novo."
                .to_string(),
        );
    }
    if m.chars().any(char::is_whitespace) {
        let limpo = m.split_whitespace().next().unwrap_or("");
        return Err(format!(
            "o modelo selecionado veio com texto colado no id ({m:?}), então o CLI não reconhece. \
             Escolha o modelo de novo no seletor (o id correto parece ser {limpo:?})."
        ));
    }
    Ok(())
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
        // TODO `-c` VAI ANTES DO SUBCOMANDO (codex 0.147, empírico 13/08/2026).
        // Os overrides passados DEPOIS de `exec` não fazem merge: eles
        // SUBSTITUEM os globais, e a tabela `mcp_servers` inteira evapora — o
        // turno roda sem mc-work e sem mc-context, e o agente responde "o MCP
        // mc-work não está exposto nesta sessão". Provado isolando a variável:
        // com `-c model_reasoning_effort=high` DEPOIS de `exec`, zero MCP
        // server sobe; a MESMA flag antes de `exec`, os dois sobem — e o
        // effort continua aplicado nos dois casos (rollout do codex com
        // `reasoning_effort: high`). Vale pro `approval_policy` também.
        // Qualquer `-c` novo entra AQUI, nunca depois do subcomando.
        if matches!(req.permission, Permission::Auto) && !req.plan_first {
            // Auto (validado codex 0.144.6): `approval_policy=never` = nunca
            // pausa, mas o sandbox workspace-write abaixo segue confinando
            // (escrita só no workspace, rede off). exec já não pausa por não
            // ter TTY — explicitar blinda contra um default futuro e deixa a
            // intenção auditável. `--full-auto` foi REMOVIDO e `on-failure` é
            // inválido nesta versão: não usar.
            cmd.arg("-c").arg("approval_policy=never");
        }
        // effort via override de config (o exec não tem flag dedicada).
        // Valores: minimal|low|medium|high|xhigh.
        if let Some(e) = &req.effort {
            cmd.arg("-c").arg(format!("model_reasoning_effort={e}"));
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
        // Codex: -m <model> é flag do próprio `exec` (não é `-c`, então não
        // atropela os overrides globais). ANTES de `resume`.
        if let Some(m) = &req.model {
            cmd.arg("-m").arg(m);
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

// ---------------- Antigravity CLI (`agy -p --output-format stream-json`) ----------------
//
// O `agy` (sucessor do Gemini CLI) ERA o caso "agent sem JSON" do
// agent-runner.md: até a 1.1.9 o print mode devolvia texto puro e o adapter
// tratava cada linha de stdout como fala do assistente. A 1.1.12 ganhou
// `--output-format json|stream-json` e este adapter passou a ser ESTRUTURADO
// (auditado na 1.1.13 em 14/08/2026; fixtures cruas em `agy_stream`).
//
// ── O sintoma que a troca conserta ────────────────────────────────────────
// Em texto puro, o stdout é a CONCATENAÇÃO de toda fala do modelo — inclusive
// a narração que ele escreve antes de cada ferramenta, que sai em inglês por
// padrão. Incidente real do usuário (conversa `b770e13f`, 2026-07): a resposta
// abria com quatro linhas "I am analyzing the repository…", "I will read…" e
// só depois virava o português pedido, tudo colado numa bolha só, porque não
// havia NADA no transporte que separasse narração-de-ação de resposta.
//
// O stream-json separa por STEP, e é só isso que precisava: a narração vem no
// `text_delta` do `agent_response` que ANTECEDE o `step_type: "tool"`, então
// ela é renderizada como preâmbulo do cartão da ferramenta, no lugar dela, em
// vez de virar cabeçalho da resposta. Nenhum filtro de idioma, nenhuma
// instrução de tradução: o inglês para de vazar porque o transporte passou a
// dizer o que cada pedaço é. Medido em 14/08/2026: step 2 `agent_response`
// text_delta "Eu vou listar o conteúdo do diretório…" → step 3 `tool` list_dir
// → step 5 `agent_response` com a resposta.
// ⚠️ `result.response` NÃO serve como resposta: ele é a mesma concatenação do
// texto puro (narração + resposta), o blob do incidente. Só usamos os steps.
//
// ── O que o stream traz (agy 1.1.13, 14/08/2026) ──────────────────────────
// NDJSON, um objeto por linha, envelope `{"event": <nome>, <nome>: {…}}`:
//   • `init` — `conversation_id`, `init.cwd`, `init.tools` (56 nomes),
//     `init.permission_mode`.
//   • `step_update` — `step_index`, `state` (ACTIVE|DONE|ERROR), `step_type`
//     (user_input | unknown | system_message | agent_response | tool |
//     checkpoint), `text_delta?`, `tool_name?`, `tool_info` (`parameters`,
//     `output?`, `error?`), `usage?` (INCREMENTAL, por step).
//   • `result` — `status` (SUCCESS|ERROR), `response`, `num_turns`, `usage`
//     (ACUMULADO da conversa, ver ADR-033 abaixo).
//   • `command_result` — resposta de `/comando` nativo (ex. `/credits`); não
//     é turno de modelo e vira Unknown (a UI ignora, nada se perde).
// `--output-format json` devolve SÓ o objeto `result` — inútil para o fio.
//
// ── Custo e contexto ──────────────────────────────────────────────────────
// NENHUM evento traz USD (`reports_cost: false` medido, não presumido), mas
// traz tokens: `input_tokens`, `output_tokens`, `thinking_tokens`,
// `cache_read_tokens`. Duas convenções DIFERENTES da do codex, medidas:
//   • `input_tokens` EXCLUI o cache (step com cache_read 16278 tinha input
//     2320; a soma é que é o prompt). O `CumulativeUsage.input` do app é
//     "input TOTAL incluindo cache" → somamos os dois na conversão.
//   • `output_tokens` INCLUI o thinking (295 output com 246 thinking para uma
//     frase). Somar thinking à parte cobraria em dobro.
// `result.usage` é o ACUMULADO DA CONVERSA — a mesma armadilha do ADR-033,
// conferida ANTES de declarar: dois turnos, nos dois caminhos de resume, e a
// diferença bateu ao token com o usage do step novo. O que a UI e o ledger
// veem é o DELTA contra o baseline do run.
// O anel de CONTEXTO é NÍVEL, não soma: o footprint do último `agent_response`
// (`input_tokens + cache_read_tokens`). Os steps `checkpoint` são uma chamada
// auxiliar minúscula (118 tokens) e mediriam o anel errado — ficam de fora.
//
// ── Achados que continuam valendo ─────────────────────────────────────────
//   • `-p` SEM --add-dir opera num scratch isolado, NÃO o cwd → --add-dir
//     <cwd> é OBRIGATÓRIO (re-visto em 14/08/2026: mesmo com `init.cwd`
//     correto, o modelo foi trabalhar em ~/.gemini/antigravity-cli/scratch
//     quando o cwd não era workspace confiável).
//   • print mode + stdin null TRAVA esperando aprovação →
//     --dangerously-skip-permissions é obrigatório p/ não pendurar.
//   • ele LÊ imagem e PDF pela ferramenta interna `view_file` (2026-07, agy
//     1.1.7): sem flag de imagem, o mecanismo é o do Claude — path absoluto no
//     prompt + `--add-dir`. `-i` é `--prompt-interactive`, não `--image`.
//     ⚠️ alucina: 1 rodada em 4 leu errado uma página de PDF sem sinalizar.
//   • `--mode plan` é CONSULTIVO e furou o gate em 2026-07 → seguimos com
//     emulação por prompt + `--sandbox`.
#[derive(Default)]
pub struct AgyAdapter {
    /// Modelo requisitado (p/ o rótulo no Session e p/ estimar o custo).
    /// None = default do agy, e aí o custo sai sem estimativa (honesto).
    model: Option<String>,
    /// Conversa que o run PEDIU pra retomar (`--conversation <ID>`). Guardado
    /// pra comparar com o `conversation_id` do `init`: o agy começa conversa
    /// NOVA em silêncio quando o id não existe, e sem essa comparação o app
    /// acharia que tem contexto que não tem.
    resume: Option<String>,
    /// Acumulado da conversa já contabilizado (ADR-033): entra como baseline do
    /// run e vira o total lido no fim. None = conversa nova.
    usage_seen: Option<crate::agent::CumulativeUsage>,
    /// Footprint do último `agent_response` (input + cache lido) = o NÍVEL do
    /// contexto. Só o agent_response conta; checkpoint é chamada auxiliar.
    context_tokens: u64,
    /// Resume que o agy IGNOROU: o turno ainda vai rodar inteiro no processo
    /// filho, mas nada dele pode chegar ao fio (seria resposta sem o contexto
    /// que o usuário pediu). O run_agent recomeça com o recap.
    abandoned: bool,
    /// Um step de texto está aberto? Fecha com TextStop quando o step encerra,
    /// pro próximo bloco não colar no anterior.
    text_open: bool,
    /// Sink de evidência visual de tool_result (browser-plan B1).
    evidence: Option<crate::evidence::EvidenceSink>,
}

/// A explicação do PRÓPRIO agy num `result` de `status: ERROR`: `error`
/// primeiro (é onde a razão mora), `response` como reserva.
///
/// Medido em 16/08/2026, forçando `--print-timeout 2s` num turno real: o
/// `response` do ERROR vem VAZIO e o campo irmão `error` traz
/// `"timeout waiting for response"` — com stderr vazio e exit 1. É o buraco de
/// prova §5.1 do incidente 2026-08-16 fechado: a explicação existia, e num
/// campo que o relatório não conhecia.
///
/// Mora aqui (e não no fetcher da janela de uso, que também a usa) porque o
/// envelope `result` é o mesmo nos dois modos de saída do print — `json` e
/// `stream-json` — e o dono do contrato de stream do agy é este adapter.
/// `status` diferente de ERROR não tem motivo a extrair, e ERROR sem nenhum
/// dos dois campos devolve `None` honesto em vez de frase fabricada.
pub fn agy_result_error(result: &serde_json::Value) -> Option<String> {
    if result.get("status").and_then(|x| x.as_str()) != Some("ERROR") {
        return None;
    }
    ["error", "response"]
        .iter()
        .find_map(|k| {
            result
                .get(*k)
                .and_then(|x| x.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
        })
        .map(str::to_string)
}

impl AgyAdapter {
    /// Um `step_update` → eventos. É AQUI que a narração deixa de virar
    /// resposta: o texto sai amarrado ao SEU step, e o step de ferramenta que
    /// vem logo depois entra como cartão entre um texto e outro.
    fn map_step(&mut self, step: &serde_json::Value) -> Vec<AgentEvent> {
        let state = step.get("state").and_then(|x| x.as_str()).unwrap_or("");
        let kind = step.get("step_type").and_then(|x| x.as_str()).unwrap_or("");
        // O step_index é o ÚNICO id estável do agy (não há id de tool call): é
        // ele que casa o `tool` ACTIVE com o `DONE`/`ERROR` do mesmo step.
        let id = step
            .get("step_index")
            .and_then(|x| x.as_u64())
            .map(|i| format!("agy-step-{i}"))
            .unwrap_or_else(|| "agy-step".to_string());
        let mut out = Vec::new();
        match kind {
            "agent_response" => {
                // Contexto é NÍVEL (prompt da última chamada de modelo), e só o
                // agent_response é chamada de modelo — checkpoint é auxiliar.
                if let Some(u) = step.get("usage") {
                    let level = usage_u64(Some(u), "input_tokens")
                        + usage_u64(Some(u), "cache_read_tokens");
                    if level > 0 {
                        self.context_tokens = level;
                    }
                }
                if let Some(t) = step.get("text_delta").and_then(|x| x.as_str()) {
                    if !t.is_empty() {
                        self.text_open = true;
                        out.push(AgentEvent::TextDelta {
                            text: t.to_string(),
                        });
                    }
                }
                // Fim do step = fim DESTE bloco de fala. Sem o TextStop a
                // narração do próximo passo colaria no texto anterior — que é
                // exatamente o blob que estamos desfazendo.
                if state != "ACTIVE" && self.text_open {
                    self.text_open = false;
                    out.push(AgentEvent::TextStop);
                }
            }
            "tool" => {
                let info = step.get("tool_info");
                let name = step
                    .get("tool_name")
                    .and_then(|x| x.as_str())
                    .unwrap_or("tool")
                    .to_string();
                if state == "ACTIVE" {
                    out.push(AgentEvent::Tool {
                        id,
                        name,
                        input: info
                            .and_then(|i| i.get("parameters"))
                            .cloned()
                            .unwrap_or(serde_json::Value::Null),
                        parent_tool_id: None,
                    });
                } else {
                    let erro = info
                        .and_then(|i| i.get("error"))
                        .filter(|e| !e.is_null());
                    let full = erro
                        .and_then(|e| e.get("message").and_then(|x| x.as_str()))
                        .or_else(|| {
                            info.and_then(|i| i.get("output").and_then(|x| x.as_str()))
                        })
                        .unwrap_or_default()
                        .to_string();
                    let lines = if full.trim().is_empty() {
                        0
                    } else {
                        full.lines().count() as u64
                    };
                    let mut text: String = full.chars().take(600).collect();
                    if full.chars().count() > 600 {
                        text.push('…');
                    }
                    out.push(AgentEvent::ToolResult {
                        id: id.clone(),
                        ok: state == "DONE" && erro.is_none(),
                        text,
                        lines,
                        // B1: o agy não devolve CallToolResult com blocos
                        // `image` no step (só string em `output`) — sem sink de
                        // evidência visual, degradação honesta.
                        images: crate::evidence::collect_images(
                            self.evidence.as_ref(),
                            &id,
                            info.and_then(|i| i.pointer("/result/content"))
                                .unwrap_or(&serde_json::Value::Null),
                        ),
                    });
                }
            }
            // user_input / system_message / checkpoint / unknown: nenhum cartão.
            // (O `unknown` aqui é step_type do PRÓPRIO agy, não linha
            // desconhecida — a linha foi entendida, o step é que não pinta nada.)
            _ => {}
        }
        out
    }

    /// O `result` fecha o turno. Duas armadilhas medidas em 14/08/2026:
    /// `response` é a concatenação narração+resposta (não usamos), e `usage` é
    /// o ACUMULADO DA CONVERSA (ADR-033) — o que sai daqui é o DELTA.
    fn map_result(&mut self, result: &serde_json::Value) -> Vec<AgentEvent> {
        let usage = result.get("usage");
        // `input_tokens` do agy EXCLUI o cache; o `CumulativeUsage` do app é
        // input TOTAL (convenção da API da OpenAI) → soma os dois. E
        // `output_tokens` JÁ inclui o thinking: somar seria cobrar em dobro.
        let cum = crate::agent::CumulativeUsage {
            input: usage_u64(usage, "input_tokens") + usage_u64(usage, "cache_read_tokens"),
            cached_input: usage_u64(usage, "cache_read_tokens"),
            output: usage_u64(usage, "output_tokens"),
        };
        let delta = cum.delta_from(&self.usage_seen.unwrap_or_default());
        self.usage_seen = Some(cum);
        let nu = crate::pricing::NormalizedUsage {
            input: delta.input,
            cached_input: delta.cached_input,
            output: delta.output,
        };
        // O agy não reporta USD em lugar nenhum → estimativa por tokens, igual
        // ao codex. SEM modelo requisitado não há tabela pra consultar, e aí
        // sai `Unknown` (a UI mostra só tokens) em vez de um número inventado.
        let (cost_usd, cost_source) = match self.model.as_deref() {
            Some(m) => crate::pricing::estimate(m, &nu),
            None => (None, CostSource::Unknown),
        };
        let ok = result.get("status").and_then(|x| x.as_str()) != Some("ERROR");
        let mut out = Vec::new();
        if self.text_open {
            self.text_open = false;
            out.push(AgentEvent::TextStop);
        }
        if self.context_tokens > 0 {
            out.push(AgentEvent::ContextUsage {
                tokens: self.context_tokens,
            });
        }
        out.push(AgentEvent::Result {
            ok,
            // SUCCESS: `text` segue None de propósito — o `result.response` é o
            // blob do incidente (narração colada na resposta) e o fio já
            // recebeu o texto pelos steps, separado.
            //
            // ERROR: é a última coisa que o CLI tem a dizer, e a gente jogava
            // fora. No incidente 2026-08-16 o usuário ficou só com "o agent
            // `agy` saiu com código 1" porque o stderr veio VAZIO (agent.rs
            // dá precedência ao stderr, então não houve desonestidade — não
            // havia o que mostrar ALI). Havia aqui: medido em 16/08/2026,
            // forçando `--print-timeout 2s` num turno real, o `response` do
            // ERROR vem vazio MESMO, e a razão mora num campo irmão que o
            // relatório não conhecia — `error: "timeout waiting for response"`.
            // Daí `agy_result_error` olhar `error` primeiro e `response` como
            // reserva.
            //
            // O item genérico do exit code NÃO precisa sumir aqui: com `text`
            // preenchido, o construtor de incidente do fio já absorve o
            // "saiu com código N" que vem depois (messageNodes.ts,
            // `isGenericExitError`) e mostra a causa real no lugar dele.
            text: if ok { None } else { agy_result_error(result) },
            cost_usd,
            cost_source,
            input_tokens: nu.input,
            output_tokens: nu.output,
            cache_read: nu.cached_input,
            cache_creation: 0,
            cumulative_usage: Some(cum),
        });
        out
    }
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
            // O canal estruturado (agy ≥1.1.12). Sem ele o stdout é a
            // concatenação de toda fala do modelo — narração de ação colada na
            // resposta, que é o bug do inglês misturado descrito no topo.
            .arg("--output-format")
            .arg("stream-json")
            // O `agy -p` tem teto PRÓPRIO, `--print-timeout`, com default de
            // 5m0s — e a gente nunca passou a flag. Estourado, o processo morre
            // com exit 1, stderr VAZIO e um `result` de `status: ERROR`,
            // indistinguível de uma falha real. Incidente 2026-08-16: dois
            // turnos de 5min04s mortos assim, ~4,2M de tokens cobrados e "saiu
            // com código 1" na tela; na mesma conversa, tudo abaixo de 300s
            // passou (113s, 158s, 257s) e tudo acima morreu.
            //
            // 60m NÃO é uma promessa de duração: o app não tem nenhuma, e a
            // régua de "travou" é o watchdog de SILÊNCIO (lib/watchdog.ts,
            // default 10 min sem item novo), que foi ensinado de propósito a
            // não confundir trabalho longo com travamento. Aqui o teto existe
            // só como rede anti-zumbi, alto o bastante pra nunca ser o gate
            // normal — missões rodam fases de 15 min rotineiramente. claude
            // 2.1.220 e codex 0.147 não têm flag equivalente (conferido no
            // `--help` dos dois em 16/08/2026): o teto é só do agy, e agora ele
            // fica no mesmo regime dos outros.
            //
            // A sintaxe é `time.Duration` do Go, validada NO PARSE: `60m` foi
            // aceito nesta máquina e `60banana` foi recusado com exit 2 e
            // `unknown unit "banana"` — ou seja, valor torto aqui viraria falha
            // barulhenta no ato, não teto silencioso de volta pros 5m.
            .arg("--print-timeout")
            .arg("60m")
            // amarra o cwd real (senão o print mode edita o scratch, não o repo).
            .arg("--add-dir")
            .arg(&req.cwd)
            .current_dir(&req.cwd);
        // resume: `--conversation <ID>`, o id que saiu do `init` do run anterior.
        // (`--continue` também existe, mas retoma "a mais recente" do CLI, que
        // não é necessariamente a conversa DESTA aba — id explícito é o único
        // que não erra de alvo com duas conversas abertas.)
        if let Some(r) = &req.resume {
            self.resume = Some(r.clone());
            cmd.arg("--conversation").arg(r);
        }
        // ADR-033: quanto a conversa já tinha gasto antes deste run. Só vale se
        // o run REALMENTE retomar — o `init` confirma (ou desmente) o alvo.
        self.usage_seen = req.usage_baseline;
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

    fn set_evidence_sink(&mut self, sink: crate::evidence::EvidenceSink) {
        self.evidence = Some(sink);
    }

    /// Uma linha do NDJSON do `--output-format stream-json` → eventos.
    /// O envelope é `{"event": <nome>, <nome>: {…}}`, então o payload mora numa
    /// chave com o MESMO nome do evento.
    fn map_line(&mut self, v: &serde_json::Value) -> Vec<AgentEvent> {
        // Resume que o agy ignorou: o processo segue rodando o turno inteiro,
        // mas nada dele pode chegar ao fio (seria resposta sem o contexto que o
        // usuário pediu — teatro). O run_agent já recomeça com o recap.
        if self.abandoned {
            return vec![];
        }
        let name = v.get("event").and_then(|x| x.as_str()).unwrap_or("");
        let body = v.get(name);
        match (name, body) {
            ("init", Some(init)) => {
                let cid = v
                    .get("conversation_id")
                    .and_then(|x| x.as_str())
                    .unwrap_or_default()
                    .to_string();
                // O agy NÃO falha em resume de id inexistente: escreve
                // `warning: conversation "…" not found` no stderr e abre
                // conversa NOVA (medido 14/08/2026). O único jeito de saber é
                // comparar o alvo pedido com o id que voltou.
                if let Some(pedido) = self.resume.clone() {
                    if !cid.is_empty() && cid != pedido {
                        self.abandoned = true;
                        return vec![AgentEvent::SessionNotFound {
                            message: format!(
                                "a conversa {pedido} não existe mais no agy (ele abriu uma nova em silêncio)"
                            ),
                        }];
                    }
                }
                // Conversa DIFERENTE da que o baseline descreve → o contador do
                // provider recomeça do zero e o baseline antigo não vale mais
                // (mesma regra do codex, ADR-033).
                if self.resume.as_deref() != Some(cid.as_str()) {
                    self.usage_seen = None;
                }
                vec![AgentEvent::Session {
                    session_id: cid,
                    model: self.model.clone(),
                    tools: init
                        .get("tools")
                        .and_then(|x| x.as_array())
                        .map(|a| a.len())
                        .unwrap_or(0),
                }]
            }
            ("step_update", Some(step)) => self.map_step(step),
            ("result", Some(result)) => self.map_result(result),
            // `command_result` (resposta de `/comando` nativo, ex. `/credits`)
            // e qualquer evento novo: surfaça em vez de descartar.
            _ => vec![AgentEvent::Unknown { raw: v.clone() }],
        }
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

    /// EOF sem `result` (processo morto, timeout do `--print-timeout`): fecha o
    /// bloco de texto aberto pra bolha não ficar pendurada.
    fn on_close(&mut self) -> Vec<AgentEvent> {
        if self.text_open {
            self.text_open = false;
            return vec![AgentEvent::TextStop];
        }
        Vec::new()
    }

    /// Frase LITERAL do stderr do agy 1.1.13 quando o `--conversation <ID>`
    /// aponta pra conversa que não existe (capturada 14/08/2026):
    /// `warning: conversation "…" not found`. É rede de segurança — o alvo
    /// primário é a comparação de id no `init`, que pega o caso ANTES de
    /// qualquer evento chegar ao fio (o stderr só é lido no fim do processo).
    fn is_session_not_found(&self, msg: &str) -> bool {
        let l = msg.to_ascii_lowercase();
        l.contains("conversation") && l.contains("not found")
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

    /// REGRESSÃO (codex 0.147, 13/08/2026): `-c` depois do subcomando `exec`
    /// SUBSTITUI os overrides globais em vez de somar — e leva junto a tabela
    /// `mcp_servers`. O turno rodava sem mc-work e sem mc-context, e o agente
    /// respondia "o MCP mc-work não está exposto nesta sessão" (bug real do
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
            server_bin: "/app/mycockpit".into(),
            root: "/repo".into(),
            conv_id: "c1".into(),
            db_path: None,
        });
        r.work_gateway = Some(crate::work_gateway::GatewayConfig {
            server_bin: "/app/mycockpit".into(),
            socket: "/tmp/mc-work-regressao.sock".into(),
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
        // agy 1.1.13: `result.usage` também é o total da CONVERSA — medido nos
        // dois caminhos de resume em 14/08/2026 (43296 → 45684 com
        // `--continue`, 33000 → 50586 com `--conversation`, e o step novo
        // fechando a diferença ao token). Antes era `false` porque a 1.1.9 não
        // reportava usage nenhum, não porque o número fosse por turno.
        assert!(capabilities_of("agy").unwrap().cumulative_usage);
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

    /// `init` — id da conversa, cwd e as 56 tools que o agy expõe.
    const AGY_INIT: &str = r#"{"event":"init","conversation_id":"a165239c-dde9-493c-a60c-ccf5ac0ccffb","init":{"cwd":"/private/tmp/agyprobe","tools":["ask_permission","ask_question","browser_click_element","browser_drag_pixel_to_pixel","browser_get_dom","browser_get_network_request","browser_input","browser_list_network_requests","browser_mouse_down","browser_mouse_up","browser_move_mouse","browser_press_key","browser_refresh_page","browser_resize_window","browser_scroll","browser_scroll_dom","browser_select_option","browser_subagent","call_mcp_tool","capture_browser_console_logs","capture_browser_screenshot","click_browser_pixel","command_status","define_subagent","delete_knowledge","execute_browser_javascript","find_by_name","finish","generate_image","grep_search","invoke_subagent","list_browser_pages","list_dir","list_permissions","list_resources","manage_inbox","manage_subagents","manage_task","multi_replace_file_content","notebook_edit","notebook_execution","open_browser_url","read_browser_page","read_resource","read_url_content","replace_file_content","run_command","schedule","search_web","sed_file","send_command_input","send_message","view_file","wait","wait_5_seconds","write_to_file"],"permission_mode":"request-review"}}"#;
    /// Steps de infra do começo do turno: não pintam nada na UI.
    const AGY_STEP_USER_INPUT: &str = r#"{"event":"step_update","step_update":{"conversation_id":"a165239c-dde9-493c-a60c-ccf5ac0ccffb","step_index":0,"state":"DONE","step_type":"user_input"}}"#;
    const AGY_STEP_INFRA: &str = r#"{"event":"step_update","step_update":{"conversation_id":"a165239c-dde9-493c-a60c-ccf5ac0ccffb","step_index":1,"state":"DONE","step_type":"unknown","duration_seconds":0.001105}}"#;
    /// A NARRAÇÃO: fala que ANTECEDE a ferramenta. Em texto puro era isto que
    /// colava no topo da resposta (o "I am analyzing the repository…" do
    /// incidente); aqui ela vem no step 2, e o step 3 é a ferramenta.
    const AGY_STEP_NARRACAO: &str = r#"{"event":"step_update","step_update":{"conversation_id":"a165239c-dde9-493c-a60c-ccf5ac0ccffb","step_index":2,"state":"DONE","step_type":"agent_response","text_delta":"Vou listar o conteúdo do diretório `/Users/viniciusmachado/.gemini/antigravity-cli/scratch` para verificar a quantidade de arquivos nele.\n","duration_seconds":2.85021,"usage":{"input_tokens":15897,"output_tokens":965,"thinking_tokens":878,"cache_read_tokens":0,"total_tokens":16862}}}"#;
    const AGY_STEP_TOOL_ACTIVE: &str = r#"{"event":"step_update","step_update":{"conversation_id":"a165239c-dde9-493c-a60c-ccf5ac0ccffb","step_index":3,"state":"ACTIVE","step_type":"tool","tool_name":"list_dir","tool_info":{"name":"list_dir","parameters":{"DirectoryPath":"/Users/viniciusmachado/.gemini/antigravity-cli/scratch"}}}}"#;
    const AGY_STEP_TOOL_DONE: &str = r#"{"event":"step_update","step_update":{"conversation_id":"a165239c-dde9-493c-a60c-ccf5ac0ccffb","step_index":3,"state":"DONE","step_type":"tool","tool_name":"list_dir","duration_seconds":0.006099,"tool_info":{"name":"list_dir","parameters":{"DirectoryPath":"/Users/viniciusmachado/.gemini/antigravity-cli/scratch"},"output":"doc.pdf\nshape.png\nsmall-circle.png"}}}"#;
    /// `checkpoint` é uma chamada AUXILIAR minúscula (121 tokens) — se ela
    /// medisse o anel de contexto, o anel despencaria no fim de todo turno.
    const AGY_STEP_CHECKPOINT: &str = r#"{"event":"step_update","step_update":{"conversation_id":"a165239c-dde9-493c-a60c-ccf5ac0ccffb","step_index":4,"state":"DONE","step_type":"checkpoint","duration_seconds":0.57305,"usage":{"input_tokens":121,"output_tokens":7,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":128}}}"#;
    /// A RESPOSTA, partida no meio da palavra "scratc|h" entre ACTIVE e DONE.
    const AGY_STEP_RESP_ACTIVE: &str = r#"{"event":"step_update","step_update":{"conversation_id":"a165239c-dde9-493c-a60c-ccf5ac0ccffb","step_index":5,"state":"ACTIVE","step_type":"agent_response","text_delta":"Existem exatamente 3 arquivos no diretório de trabalho padrão ([`/Users/viniciusmachado/.gemini/antigravity-cli/scratc"}}"#;
    const AGY_STEP_RESP_DONE: &str = r#"{"event":"step_update","step_update":{"conversation_id":"a165239c-dde9-493c-a60c-ccf5ac0ccffb","step_index":5,"state":"DONE","step_type":"agent_response","text_delta":"h`](file:///Users/viniciusmachado/.gemini/antigravity-cli/scratch)):\n\n1. doc.pdf\n2. shape.png\n3. small-circle.png\n","duration_seconds":1.788865,"usage":{"input_tokens":4793,"output_tokens":619,"thinking_tokens":467,"cache_read_tokens":12209,"total_tokens":5412}}}"#;
    /// O `result` do MESMO run: repare no `response` — narração + resposta
    /// concatenadas, que é EXATAMENTE o blob do modo texto puro.
    const AGY_RESULT: &str = r#"{"event":"result","result":{"conversation_id":"a165239c-dde9-493c-a60c-ccf5ac0ccffb","status":"SUCCESS","response":"Vou listar o conteúdo do diretório `/Users/viniciusmachado/.gemini/antigravity-cli/scratch` para verificar a quantidade de arquivos nele.\nExistem exatamente 3 arquivos no diretório de trabalho padrão ([`/Users/viniciusmachado/.gemini/antigravity-cli/scratch`](file:///Users/viniciusmachado/.gemini/antigravity-cli/scratch)):\n\n1. doc.pdf\n2. shape.png\n3. small-circle.png\n","duration_seconds":4.87077,"num_turns":1,"usage":{"input_tokens":20811,"output_tokens":1591,"thinking_tokens":1345,"cache_read_tokens":12209,"total_tokens":22402}}}"#;
    /// Ferramenta que FALHOU (outro run real, mesmo dia): o motivo está em
    /// `tool_info.error.message`, não em `output`.
    const AGY_STEP_TOOL_ERROR: &str = r#"{"event":"step_update","step_update":{"conversation_id":"4f102d41-414f-4def-a5d2-362c33b61ed5","step_index":3,"state":"ERROR","step_type":"tool","tool_name":"list_dir","duration_seconds":0.061392,"tool_info":{"name":"list_dir","parameters":{"DirectoryPath":"/Users/viniciusmachado/.gemini/antigravity-cli"},"error":{"type":"TOOL_ERROR","message":"Permission denied for read_file(/Users/viniciusmachado/.gemini/antigravity-cli). Matches hardcoded system protection boundary rule."}}}}"#;
    /// `/comando` nativo (o `agy -p "/credits"`): não é turno de modelo.
    const AGY_COMMAND_RESULT: &str = r#"{"event":"command_result","command":{"name":"credits","data":{"remaining_credits":0,"upgrade_uri":"https://antigravity.google/g1-upgrade"}}}"#;

    /// Roda uma linha CRUA pelo mesmo caminho do runner (`on_stdout_line`).
    fn agy_linha(a: &mut AgyAdapter, raw: &str) -> Vec<AgentEvent> {
        a.on_stdout_line(raw)
    }

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
                "texto",         // a narração
                "fim-do-bloco",  // …fecha ANTES da ferramenta
                "ferramenta",
                "resultado",
                "texto",         // a resposta, em bloco PRÓPRIO
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

    /// Linha `result` REAL de um desfecho de ERRO do print mode, capturada em
    /// 16/08/2026 forçando `--print-timeout 2s` num turno de verdade (exit 1,
    /// stderr VAZIO). É a prova que faltava no §5.1 do incidente 2026-08-16:
    /// o `response` vem vazio MESMO, e a razão está em `error`.
    const AGY_RESULT_ERRO: &str = r#"{"event":"result","result":{"conversation_id":"83fedb99-22c9-408c-83a4-b550c705aa55","status":"ERROR","response":"","error":"timeout waiting for response","duration_seconds":0.041688,"num_turns":1,"usage":{"input_tokens":0,"output_tokens":0,"thinking_tokens":0,"cache_read_tokens":0,"total_tokens":0}}}"#;

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
            AgentEvent::Tool { id, name, input, .. } => {
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
            AgentEvent::ToolResult { id, ok, text, lines, .. } => {
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
                AgentEvent::ContextUsage { tokens } => Some(*tokens),
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
            Some(AgentEvent::Result { cost_usd, cost_source, .. }) => {
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
        assert!(has_pair(&args, "--conversation", "00000000-0000-0000-0000-000000000000"));

        // o `init` volta com OUTRO id: o agy trocou de conversa por conta.
        let evs = agy_linha(&mut a, AGY_INIT);
        match &evs[..] {
            [AgentEvent::SessionNotFound { message }] => {
                assert!(message.contains("00000000-0000-0000-0000-000000000000"), "{message}");
            }
            _ => panic!("esperava SÓ SessionNotFound"),
        }
        // …e NADA do turno abandonado chega ao fio (seria resposta sem o
        // contexto pedido, o oposto de estado real).
        for linha in [AGY_STEP_NARRACAO, AGY_STEP_RESP_DONE, AGY_RESULT] {
            assert!(agy_linha(&mut a, linha).is_empty(), "run abandonado é silencioso");
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
            [AgentEvent::Session { session_id, tools, .. }] => {
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
        let args = argv(&claude.build_command(&req(Permission::Padrao, false)).unwrap());
        assert!(!args.iter().any(|a| a.contains("timeout")));
        let mut codex = CodexAdapter::default();
        let args = argv(&codex.build_command(&req(Permission::Padrao, false)).unwrap());
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
        // agy 1.1.13: nenhum canal system além do `-p` (o `--help` não expõe
        // outro), e MCP só por config GLOBAL — nada por-run pra registrar o
        // mc-context. Resume, esse SIM existe: `--conversation <ID>` retomou a
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
        assert!(erro.contains("seletor"), "a mensagem diz o que fazer: {erro}");
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
        for limpo in ["gemini-3.7-flash-high", "claude-opus-5[1m]", "gpt-5.6-sol", "default"] {
            assert!(validate_model_slug(Some(limpo)).is_ok(), "{limpo} é slug válido");
        }
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
            r.model = Some("modelo-do-contrato".to_string());
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
