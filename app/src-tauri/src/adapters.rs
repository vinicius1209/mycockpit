//! v0.2-α, abstração de agent. Cada CLI vira um adapter; o LOOP de execução
//! (spawn, leitura linha-a-linha, cancel, stderr, Done) é compartilhado em
//! `agent::run_agent`. O adapter varia só em 2 pontos: montar o `Command` e
//! mapear cada linha JSON → `AgentEvent`. O Claude porta a lógica atual 1:1.

use crate::agent::{AgentEvent, CostSource, DeferredKind, DeferredStatus};
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
    /// "Frota resume": texto PRONTO montado pelo front (recap + ponteiro pro
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
    /// absolutos existentes (por `frota_dir::resolve_extra_dirs`). Cada adapter
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
    /// MCP de trabalho/processos gerenciado pelo Frota. Mesmo contrato no
    /// Claude e Codex; ausente em providers sem MCP.
    pub work_gateway: Option<crate::work_gateway::GatewayConfig>,
    /// `frota-browser` (ADR-224): o navegador da Frota para qualquer motor que
    /// fale MCP, pelo mesmo socket do `frota-work`. None = sem navegador
    /// neste run (FusionRo, motor global sem cadastro, sem listener).
    pub browser_gateway: Option<crate::browser_gateway::GatewayConfig>,
    /// `frota-desktop` (ADR-225): o controlador de desktop da Frota para qualquer
    /// motor que fale MCP, pelo mesmo socket do `frota-work`.
    pub desktop_gateway: Option<crate::desktop_gateway::GatewayConfig>,
    /// MCPs do cadastro global do motor que ficam FORA deste run (nome do
    /// servidor). Só é preenchido para motor com `run_mcp_deny`; hoje leva o
    /// navegador de terceiro quando o `frota-browser` está no turno.
    pub denied_mcp_servers: Vec<String>,
    /// Materialização por-run do Tool Catalog da Frota. O catálogo é montado
    /// pelo app; este MCP só transporta a lista e as chamadas ao worker.
    pub tool_gateway: Option<crate::tool_gateway::GatewayConfig>,
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
    /// Custo acumulado que a sessão retomada já reportou (ADR-226). None =
    /// sem resume ou sem registro: o custo reportado vale como está.
    pub cost_baseline: Option<f64>,
}

/// Contrato de transporte do prompt na CLI. Não é capability de produto: a UI
/// não toma decisão com este dado. É conhecimento do fornecedor que cada
/// adapter declara para o teste de contrato conferir o `argv` montado.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CliPromptContract {
    /// O prompt é o último argumento, imediatamente após o separador indicado.
    TrailingAfterSeparator(&'static str),
    /// O prompt vem imediatamente após a flag indicada, e ainda há argumentos depois.
    AfterFlagBeforeTrailingArgs(&'static str),
}

impl CliPromptContract {
    /// Guarda estrutural do caminho de produção. O teste de contrato faz a
    /// cobrança mais forte (valor exato e ocorrência única); aqui basta impedir
    /// o spawn quando a forma declarada deixou de existir, sem expor o prompt.
    fn validate(self, agent: &str, cmd: &Command) -> Result<(), String> {
        let args: Vec<_> = cmd.as_std().get_args().collect();
        let valid = match self {
            Self::TrailingAfterSeparator(separator) => {
                args.len() >= 2 && args[args.len() - 2] == std::ffi::OsStr::new(separator)
            }
            Self::AfterFlagBeforeTrailingArgs(flag) => args
                .iter()
                .position(|arg| *arg == std::ffi::OsStr::new(flag))
                .is_some_and(|index| index + 2 < args.len()),
        };
        if valid {
            Ok(())
        } else {
            Err(format!(
                "falha interna ao montar `{agent}`: o comando viola o contrato de transporte do prompt ({self:?})"
            ))
        }
    }
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
/// (`.frota/commands`) é agnóstica e vale pra todo agent; isto aqui é só o
/// que cada motor soma por conta própria. `sources.rs` consulta a capability
/// `command_sources` e casa NESTE enum — nunca no nome do agent.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CommandSource {
    /// `.claude/commands` + `.claude/skills` (projeto e ~/.claude).
    ClaudeDirs,
    /// `~/.codex/prompts` (custom prompts; a convenção do Codex é SÓ global).
    CodexPrompts,
    /// Plugins habilitados do Claude Code: `installed_plugins.json` +
    /// `enabledPlugins` dos settings, e dentro de cada um `commands/` e
    /// `skills/`, invocados como `/plugin:nome` (claude 2.1.270).
    ClaudePlugins,
    /// Skills do Codex em `~/.codex/skills` (inclui `.system`). Plugins do
    /// Codex só aparecem pelo inventário consultado (`CodexSkillsList`).
    CodexSkills,
}

/// Canal pelo qual o PRÓPRIO motor publica o inventário de comandos e skills
/// (ADR-189). O disco (`CommandSource`) é o fallback; isto é a verdade do motor
/// quando existe. Mesmo padrão do `CommandSource`: o dialeto mora no enum, o
/// código genérico só pergunta a capability.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum CommandInventory {
    /// O `system/init` de todo run traz `slash_commands`, `skills`, `plugins`
    /// e `terminal_slash_commands` (claude 2.1.270). Guardado por projeto, com
    /// horário: é evidência do último run, não do presente.
    ClaudeRunInit,
    /// `codex app-server` responde `skills/list` sem turno de modelo
    /// (codex 0.154.0), com descrição, caminho do SKILL.md e plugin de origem.
    CodexSkillsList,
}

/// Comando do PRÓPRIO CLI que a Frota oferece no "/". Só entra aqui o que foi
/// auditado no headless (`num_turns=0`, custo zero, sem efeito fora do run);
/// o resto dos builtins fica fora por padrão (fail-closed, ADR-189).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct BuiltinCommand {
    pub name: &'static str,
    /// Rótulo de fonte nativa do motor (o mesmo de `nativeCommandSource` no
    /// TS): é por ele que a expansão sabe que o `/nome` viaja cru.
    pub source: &'static str,
    /// Descrição em pt-BR para o popover (o CLI não publica descrição).
    pub description: &'static str,
}

/// Builtins do Claude Code auditados em 14/09/2026 (claude 2.1.270,
/// `docs/composer-extensoes-plan.md`). `/model`, `/effort`, `/mcp` e `/config`
/// ficaram de fora de propósito: são controles que a Frota já tem.
pub const CLAUDE_BUILTINS: &[BuiltinCommand] = &[
    BuiltinCommand {
        source: "claude",
        name: "context",
        description: "Mostra quanto da janela de contexto cada parte ocupa",
    },
    BuiltinCommand {
        source: "claude",
        name: "usage",
        description: "Uso da assinatura e quando a janela renova",
    },
    BuiltinCommand {
        source: "claude",
        name: "skill-doctor",
        description: "Skills carregadas, quanto contexto ocupam e quantas vezes foram usadas",
    },
    BuiltinCommand {
        source: "claude",
        name: "list-agents",
        description: "Sessões do Claude Code abertas nesta máquina",
    },
];

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

/// Fonte do MEDIDOR DE CONTEXTO da conversa (não confundir com
/// `UsageWindowSource`, que é a cota do plano da conta). `Stream` significa
/// que o próprio transporte publica o footprint da última chamada. O Codex em
/// `exec` só publica o acumulado da thread; nele o runner consulta o rollout
/// depois do turno e lê `last_token_usage` + `model_context_window`.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ContextUsageSource {
    Stream,
    CodexRollout,
}

/// Onde o PRÓPRIO motor diz em que ponto compacta sozinho (ADR-196). O teto
/// do anel sem isto é a janela do modelo, e a régua de oferta era palpite
/// nosso: o limiar efetivo depende de modelo, `autoCompactEnabled`, ambiente e
/// do `/autocompact` da pessoa, e só o CLI sabe combinar os quatro.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ContextCeilingProbe {
    /// claude 2.1.270: `control_request` `get_context_usage` (`detail:
    /// "summary"`) num processo `--input-format stream-json --resume <sid>`.
    /// Medido em 16/09/2026: 0,7s sem hooks nem MCP, custo zero, sessão
    /// intacta (md5 igual), `autoCompactThreshold` sensível a modelo, env e
    /// settings. Fixtures em testdata/claude-2.1.270/context-usage*.jsonl.
    ClaudeControlRequest,
    /// codex 0.154.0: `config/read` no app-server (sem turno, sem cota) mais o
    /// catálogo `models_cache.json`, com a fórmula do código validada no
    /// binário contra uma Responses API local (ADR-198).
    CodexConfigCatalog,
    /// agy 1.2.4: estimativa e limite gravados a cada geração em
    /// `conversations/<id>.db` (`gen_metadata`). Registro interno, não
    /// contrato: sem o campo, nada se afirma (ADR-198).
    AgyGenerationRecord,
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
    /// `opencode models` — uma linha por `provider/model`, sem rótulo.
    OpenCodeModelsSubcommand,
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
    /// opencode 1.17.9: `opencode run --format json -m <slug> "<prompt>"`.
    /// Precisa dos DOIS fluxos: o sucesso e a recusa de crédito saem em NDJSON
    /// no stdout, mas o slug inexistente sai no STDERR como
    /// `ProviderModelNotFoundError` (capturado 26/08/2026) — e é justamente
    /// essa a distinção que o curador existe pra fazer.
    OpenCodeRunJson,
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
/// Até onde o app consegue instalar um MCP externo num motor, e por quanto
/// tempo aquilo dura. Medido motor a motor em 26/08/2026 (ver cada CAPS).
///
/// A ordem importa e é do mais contido para o mais invasivo: quanto mais
/// abaixo, mais do estado do usuário o app precisaria tocar para instalar.
#[allow(dead_code)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum McpEscopo {
    /// A config vai junto com o spawn e morre com ele. Isolamento perfeito:
    /// duas missões simultâneas não se veem.
    PorRun,
    /// A config mora num arquivo do PROJETO. Dura depois do run e pode estar
    /// versionada no repositório do usuário, então instalar ali é um gesto
    /// diferente de instalar por run.
    PorProjeto,
    /// A config é GLOBAL do CLI: vale para todos os projetos e continua depois
    /// do run. Nunca se escreve nisso em silêncio.
    Global,
    /// O CLI não fala MCP.
    Nenhum,
}

impl McpEscopo {
    /// O control plane de MCPs externos (bindings, proxy, profiles) só sabe
    /// operar com isolamento por run. Os demais escopos existem no vocabulário
    /// para a tela dizer a verdade e para o F2 instalar pelo CLI do agent.
    pub fn por_run(self) -> bool {
        matches!(self, McpEscopo::PorRun)
    }

    /// Rótulo estável para o front. Não é `Debug`: nome de variante muda com
    /// refactor, e a tela não pode quebrar por causa disso.
    pub fn rotulo(self) -> &'static str {
        match self {
            McpEscopo::PorRun => "por-run",
            McpEscopo::PorProjeto => "por-projeto",
            McpEscopo::Global => "global",
            McpEscopo::Nenhum => "nenhum",
        }
    }

    /// O CLI fala MCP, mesmo que o app não consiga escopar. É a distinção que
    /// faltava: "o Frota não roteia" nunca é "o motor não suporta".
    #[allow(dead_code)]
    pub fn cli_fala_mcp(self) -> bool {
        !matches!(self, McpEscopo::Nenhum)
    }
}

/// O motor confina por conta PRÓPRIA nos modos que prometem escrita zero?
///
/// # O bug que este vocabulário existe pra matar (09/09/2026)
///
/// O S2 do sandbox-plan passou a envelopar o spawn em `sandbox-exec` sempre que
/// o modo prometia não escrever. O Codex faz a MESMA coisa por dentro: ele roda
/// `/usr/bin/sandbox-exec` com política `(deny default)` a cada comando de
/// shell. macOS recusa aplicar perfil restritivo dentro de perfil já aplicado, e
/// quem morre é o de dentro — o que executa os comandos. Medido:
///
/// ```text
/// sandbox-exec -f allow-default.sb sandbox-exec -f deny-default.sb sh -c 'echo ok'
/// → sandbox-exec: sandbox_apply: Operation not permitted   (exit 71)
/// ```
///
/// Resultado real: automação agendada em "Só lê" com Codex ficou CEGA (`pwd` e
/// `cat` com exit 71), rodou três vezes, gastou US$ 1,16 e gravou `ok` nas três.
/// "Planejar primeiro" + Codex tinha o mesmo defeito no chat inteiro.
///
/// Bool não serve aqui, e é a lição do `managed_mcp: bool` → `McpEscopo` logo
/// acima: são TRÊS realidades, e colapsá-las em duas faria o agy (que diz
/// confinar e na verdade emudece) ser tratado como garantia.
#[allow(dead_code)]
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SandboxProprio {
    /// Não confina nada por conta própria. O envelope da Frota é a única
    /// garantia de sistema que existe, e é ele que vale.
    Nenhum,
    /// DIZ confinar, mas a medida da fase 0 mostrou que ele EMUDECE em vez de
    /// falhar (`exit 0`, stdout vazio, stderr sem assinatura). Não conta como
    /// garantia: o envelope continua valendo, e é o `SilencioSuspeito` do S3
    /// que transforma o silêncio em aviso.
    MelhorEsforco,
    /// Aplica sandbox de SO, MEDIDO por turno real. Dispensa o envelope da
    /// Frota — e COLIDE com ele, então dispensar não é otimização, é correção.
    SistemaOperacional,
}

impl SandboxProprio {
    /// O envelope da Frota deve sair de cena para este motor?
    ///
    /// Só a garantia medida dispensa. `MelhorEsforco` NÃO dispensa de
    /// propósito: um motor que emudece em vez de falhar é exatamente o caso que
    /// o sandbox-plan existe para cobrir.
    pub fn dispensa_envelope(self) -> bool {
        matches!(self, SandboxProprio::SistemaOperacional)
    }
}

/// Como uma fonte torna ferramentas disponíveis ao motor. MCP é só UM dos
/// transportes; o domínio não pode depender dele para representar tools
/// nativas, ACP ou uma futura API de provider.
#[allow(dead_code)]
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolTransport {
    Native,
    Mcp,
    Cli,
    Acp,
}

/// Tempo de vida da configuração que materializa a fonte de ferramentas.
/// `User` fica no vocabulário mesmo sem consumidor atual: é diferente de uma
/// configuração global da máquina e evita outro bool que colapse realidades.
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum CapabilityScope {
    Run,
    Project,
    User,
    Global,
}

/// Quanto a Frota consegue garantir que a fonte descrita é exatamente a que o
/// run recebeu. `Hard` nasce e morre sob controle do runner; `Advisory` depende
/// também de estado que o provider mantém fora do run.
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PolicyEnforceability {
    Hard,
    Advisory,
}

/// Qual evidência permite enumerar a superfície. Não confundir stream
/// estruturado com inventário: um provider pode narrar tool calls sem publicar
/// a lista completa de tools disponíveis.
#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolInventoryEvidence {
    /// Catálogo fixo e versionado pela própria Frota.
    Declared,
    /// O handshake do provider informa ao menos a contagem da superfície.
    RuntimeCount,
    /// A Frota executa descoberta/`tools/list` antes do run.
    Probe,
    /// Não existe uma fonte completa auditada; a UI deve dizer isso.
    Opaque,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolMaterializerDef {
    pub kind: ToolMaterializerKind,
    pub transport: ToolTransport,
    pub scope: CapabilityScope,
    pub enforceability: PolicyEnforceability,
    pub inventory: ToolInventoryEvidence,
    pub filters_per_run: bool,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ToolMaterializerKind {
    ProviderNative,
    FrotaGateway,
    ExternalMcp,
}

#[allow(dead_code)]
pub struct Capabilities {
    /// Evidência disponível para a superfície NATIVA do provider. A fonte
    /// existe em todo adapter; o que varia é se conseguimos enumerá-la.
    pub native_tool_inventory: ToolInventoryEvidence,
    /// Fala MCP e recebe o `frota-work` (processos longos + planos vivos).
    pub work_mcp: bool,
    /// O servidor precisa de cadastro global, mas recebe o socket pelo ambiente
    /// de CADA filho. Não altera o escopo dos MCPs externos.
    pub work_mcp_global_env: bool,
    /// Aceita negar, POR RUN, as tools de um MCP que vem do cadastro global do
    /// motor. Com ela o navegador de terceiro sai do turno quando o
    /// `frota-browser` está presente; sem ela, o turno só o nomeia.
    pub run_mcp_deny: bool,
    /// Recebe o `frota-context` (memória read-only por MCP).
    pub context_mcp: bool,
    /// Até ONDE o app consegue instalar um MCP externo neste motor.
    ///
    /// Era `managed_mcp: bool`, e o bool colapsava QUATRO realidades em duas.
    /// Foi dessa perda que saíram dois bugs de copy seguidos (ADR-100 e
    /// ADR-101): "não roteável pelo app" virava "não suportado" na tela, sobre
    /// um CLI que fala MCP muito bem. Escopo é a palavra que a realidade tem.
    pub mcp_escopo: McpEscopo,
    /// O config MCP nativo aceita `cwd` no launch (só o Codex documenta; o
    /// schema JSON do Claude não tem o campo — não prometer o que some).
    pub mcp_launch_cwd: bool,
    /// O motor confina por conta PRÓPRIA nos modos de escrita zero. Decide se o
    /// envelope `sandbox-exec` da Frota entra ou sai (ver `SandboxProprio`):
    /// dois perfis Seatbelt aninhados fazem o de dentro falhar, e o de dentro é
    /// o que executa os comandos. Espelho TS: `sandboxProprio` em
    /// lib/agents.ts (teste-gêmeo `agents.sandbox.test.ts`).
    pub sandbox_proprio: SandboxProprio,
    /// O motor recebe pasta extra por run (`RunRequest.extra_dirs` vira
    /// `--add-dir` ou raiz gravável). É o que deixa o arquivo solto de fora do
    /// projeto ser lido SÓ naquele envio (ADR-252). false = vai só o caminho, e
    /// o cartão diz isso. Espelho TS: `pastasExtras` (agents.pastasExtras.test.ts).
    pub pastas_extras: bool,
    /// Interação inline via `frota-approval` (ask_user + permission-prompt-tool).
    pub inline_interaction: bool,
    /// Emite background tasks que sobrevivem ao turno (`system/task_*`,
    /// ADR-028). false = nunca inventar nó diferido pra este motor.
    pub deferred_work: bool,
    /// O CLI interpreta `/comando` nativamente (fonte PRÓPRIA passa crua;
    /// consumido pelo espelho TS em lib/agents.ts — o Rust declara a verdade).
    pub native_slash: bool,
    /// Convenções nativas de descoberta de comando "/" (além da casa).
    pub command_sources: &'static [CommandSource],
    /// Canal em que o motor publica o próprio inventário (None = só disco).
    /// Espelho TS: `commandInventory` em lib/agentCommands.ts.
    pub command_inventory: Option<CommandInventory>,
    /// Builtins do CLI auditados no headless e oferecidos no "/".
    pub builtin_commands: &'static [BuiltinCommand],
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
    /// Como obter o footprint da ÚLTIMA chamada para o anel de contexto.
    /// Nunca aponta para o total acumulado do turno/thread. `None` = o motor
    /// não oferece medição confiável e a UI não inventa percentual.
    pub context_usage: Option<ContextUsageSource>,
    /// Sonda FORA do turno que lê o limiar efetivo de compactação automática e
    /// o footprint atual da sessão. `None` = o anel usa a janela como teto e
    /// não afirma quando o motor compacta. Exige `session_resume` (a sonda
    /// retoma a sessão sem mandar mensagem). Espelho TS: `contextCeilingProbe`
    /// em lib/agentContext.ts.
    pub context_ceiling: Option<ContextCeilingProbe>,
    /// Expõe a JANELA DE USO do plano (% usado + reset, feature "9% used ·
    /// 4h 22m" do estudo do Orca — pipeline SEPARADO do custo em $). `None` =
    /// motor sem fonte auditada: a UI some com pill/toggle (degradação
    /// honesta), nunca inventa percentual. Exemplo do motivo caindo com nova
    /// evidência: agy ficou em `None` até 16/08/2026 porque a única fonte
    /// conhecida era `/credits` (saldo absoluto, sem % nem reset); caiu
    /// quando o `/usage` foi auditado (ver `AGY_CAPS` abaixo — hoje é
    /// `Some(AgyPrintCommand)`). Espelho TS: `usageWindow` em lib/agents.ts
    /// (teste-gêmeo agents.usageWindow.test.ts ↔
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
    /// O CLI aceita um id de modelo DIGITADO, fora de qualquer lista: é o que
    /// libera o "Modelo custom…" no seletor. claude ✅ `--model` passa alias ou
    /// id completo direto à API; codex ✅ `-m` idem; agy ❌ só aceita os slugs
    /// que ele mesmo lista (`agy models`, recusa local), então a escolha vem da
    /// lista; opencode ❌ até ser auditado. Espelho TS: `modeloLivre` em
    /// lib/agents.ts (teste-gêmeo agents.modeloLivre.test.ts ↔
    /// `matriz_modelo_livre_por_agent`).
    pub modelo_livre: bool,
}

impl Capabilities {
    /// Fontes de tools declaradas por este adapter, sem comparar seu nome.
    /// Gateways internos da Frota entram depois, no manifesto do run, porque
    /// só ali sabemos quais listeners realmente nasceram.
    pub fn tool_materializers(&self) -> Vec<ToolMaterializerDef> {
        let mut out = vec![ToolMaterializerDef {
            kind: ToolMaterializerKind::ProviderNative,
            transport: ToolTransport::Native,
            scope: CapabilityScope::Run,
            enforceability: PolicyEnforceability::Advisory,
            inventory: self.native_tool_inventory,
            filters_per_run: false,
        }];
        let scope = match self.mcp_escopo {
            McpEscopo::PorRun => Some(CapabilityScope::Run),
            McpEscopo::PorProjeto => Some(CapabilityScope::Project),
            McpEscopo::Global => Some(CapabilityScope::Global),
            McpEscopo::Nenhum => None,
        };
        if let Some(scope) = scope {
            let hard = matches!(scope, CapabilityScope::Run);
            out.push(ToolMaterializerDef {
                kind: ToolMaterializerKind::ExternalMcp,
                transport: ToolTransport::Mcp,
                scope,
                enforceability: if hard {
                    PolicyEnforceability::Hard
                } else {
                    PolicyEnforceability::Advisory
                },
                inventory: ToolInventoryEvidence::Probe,
                filters_per_run: hard,
            });
        }
        out
    }
}

/// Regra de permissão do Claude que casa TODAS as tools de um servidor MCP. O
/// nome vira prefixo de tool: fora de `[A-Za-z0-9_-]` o Claude troca por `_`
/// (é o que faz de "claude.ai Gmail" o prefixo `mcp__claude_ai_Gmail`).
pub fn claude_mcp_rule(servidor: &str) -> String {
    let limpo: String = servidor
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect();
    format!("mcp__{limpo}")
}

/// claude 2.1.219 (auditado 2026-07): o mais rico — MCP completo, background
/// tasks, resume, stream-json e custo pronto em USD.
pub const CLAUDE_CAPS: Capabilities = Capabilities {
    // O `system/init.tools` traz a contagem real da superfície deste run.
    native_tool_inventory: ToolInventoryEvidence::RuntimeCount,
    work_mcp: true,
    work_mcp_global_env: false,
    // claude 2.1.280 (medido em 22/09/2026): `mcp__playwright` no
    // `--disallowedTools` levou o `system/init` de 219 para 194 tools, zero
    // do Playwright; o servidor conecta, mas não oferece nada ao modelo.
    run_mcp_deny: true,
    context_mcp: true,
    // claude 2.1.220: config MCP injetada no spawn, morre com o processo.
    mcp_escopo: McpEscopo::PorRun,
    mcp_launch_cwd: false,
    // claude 2.1.266: NÃO expõe sandbox de SO (o `--help` só cita "sandboxes"
    // como recomendação de ambiente pro --dangerously-skip-permissions). A
    // medida da fase 0 confirma que ele conviveu com o envelope da denylist sem
    // colidir. Se ganhar sandbox de bash no macOS, cai na colisão do Codex e é
    // ESTE valor que muda — uma linha, não um bug novo.
    sandbox_proprio: SandboxProprio::Nenhum,
    // `--add-dir` por pasta no build_command.
    pastas_extras: true,
    inline_interaction: true,
    deferred_work: true,
    native_slash: true,
    command_sources: &[CommandSource::ClaudeDirs, CommandSource::ClaudePlugins],
    command_inventory: Some(CommandInventory::ClaudeRunInit),
    builtin_commands: CLAUDE_BUILTINS,
    session_resume: true,
    system_channel: true,
    structured_output: true,
    reports_cost: true,
    // o `result` do stream-json traz o usage E o USD DO TURNO.
    cumulative_usage: false,
    // claude 2.1.220: `-p --resume <sid> "/compact"` processa o comando em
    // modo print (empírico 04/08/2026; §7.1 do agent-runner).
    native_compact: true,
    context_usage: Some(ContextUsageSource::Stream),
    context_ceiling: Some(ContextCeilingProbe::ClaudeControlRequest),
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
    modelo_livre: true,
};

/// codex-cli 0.144.6 (auditado 2026-07): MCP completo (config efêmero via -c),
/// resume de thread, stream JSON — mas sem background task, sem slash nativo
/// no `exec` e sem USD no stream (custo é estimado por tokens × tabela).
pub const CODEX_CAPS: Capabilities = Capabilities {
    // `exec`/app-server não publicam catálogo completo das tools nativas.
    native_tool_inventory: ToolInventoryEvidence::Opaque,
    work_mcp: true,
    work_mcp_global_env: false,
    run_mcp_deny: false,
    context_mcp: true,
    // codex 0.146: idem, config por run no exec.
    mcp_escopo: McpEscopo::PorRun,
    mcp_launch_cwd: true,
    // codex 0.153.2 (medido 10/09/2026, turnos reais): `-s read-only` barra
    // escrita no cwd, fora do cwd, em pasta de `--add-dir`, pela via NATIVA
    // (`apply_patch` → "writing is blocked by read-only sandbox"), por
    // python3/perl/cp e por processo destacado (`nohup &` — o perfil é herdado
    // pelos filhos). Leitura do disco inteiro segue livre; rede fica off.
    //
    // É estritamente MAIS apertado que a denylist da Frota (que libera rede e
    // só protege o projeto), então dispensar o envelope aperta em vez de
    // afrouxar. Em Linux o envelope nunca aplicou (`disponivel()` é
    // macOS-only), e lá isto já era o comportamento: o macOS é que estava com
    // uma regressão de plataforma.
    sandbox_proprio: SandboxProprio::SistemaOperacional,
    // `--add-dir` como opção do `exec` (vale no resume).
    pastas_extras: true,
    inline_interaction: false,
    deferred_work: false,
    native_slash: false,
    command_sources: &[CommandSource::CodexPrompts, CommandSource::CodexSkills],
    command_inventory: Some(CommandInventory::CodexSkillsList),
    // Builtins do Codex no headless ainda não foram auditados.
    builtin_commands: &[],
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
    // O `turn.completed.usage` do exec é acumulado da THREAD e não serve de
    // nível. O runner lê o `last_token_usage` do rollout depois do turno.
    context_usage: Some(ContextUsageSource::CodexRollout),
    // codex 0.154.0: nenhum canal diz o limiar; ele sai da config efetiva e do
    // catálogo pela fórmula do código, validada no binário (ADR-198).
    context_ceiling: Some(ContextCeilingProbe::CodexConfigCatalog),
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
    modelo_livre: true,
};

/// agy 1.1.13 (auditado NESTA máquina em 14/08/2026, sondas cruas em
/// `agy_stream` nos testes). A declaração de antes descrevia a 1.1.9 e ficou
/// para trás: o `--output-format json|stream-json` da 1.1.12 destravou canal
/// estruturado, usage e resume — três campos que estavam `false` por versão
/// velha, não por medição. Cada campo abaixo cita a evidência e a data.
pub const AGY_CAPS: Capabilities = Capabilities {
    // O evento `init.tools` traz a contagem real da superfície deste run.
    native_tool_inventory: ToolInventoryEvidence::RuntimeCount,
    // agy 1.1.21 (medido 26/08/2026): o motor SUPORTA MCP, e desde a 1.1.13
    // ganhou CLI própria (`agy mcp add|remove|list|enable|disable`, stdio e
    // http, com `--header` e `--env`). A evidência de antes ("só por arquivo,
    // sem CLI") está velha e foi trocada por esta.
    //
    // O que NÃO mudou é o que decide este campo: `agy mcp add` não tem flag de
    // escopo, então escreve no config GLOBAL
    // (`~/.gemini/config/mcp_config.json`), e o `agy --help` da 1.1.21 segue
    // sem qualquer opção de MCP por-run. MCP externo continua global. O canal
    // interno de trabalho usa cadastro explícito estável e env por processo,
    // comprovada na 1.1.27; não reescreve config a cada turno (ADR-173).
    //
    // Portanto o escopo é `Global`, que significa "o FROTA não escopa MCP
    // aqui", NUNCA "este motor não fala MCP". Quem escreve copy a partir deste
    // campo tem de dizer a primeira frase (ver `mcpAgentStatusLabel`).
    // Agy 1.1.27, 08/09/2026: /credits inicializou o MCP e comprovou a herança
    // do socket/run ID. Cadastro explícito + env por filho, sem CWD como chave.
    work_mcp: true,
    work_mcp_global_env: true,
    run_mcp_deny: false,
    context_mcp: false,
    mcp_escopo: McpEscopo::Global,
    mcp_launch_cwd: false,
    // agy 1.1.13: tem `--sandbox`, mas ele é "terminal restrictions" e a fase 0
    // do sandbox-plan MEDIU o que ele faz quando barra: `exit 0`, stdout vazio,
    // stderr sem assinatura. Ele não falha, FINGE que funcionou. Isso não é
    // garantia, é o caso que motivou o módulo inteiro — então o envelope da
    // Frota continua valendo aqui, e é o `SilencioSuspeito` do S3 que dá voz ao
    // silêncio.
    sandbox_proprio: SandboxProprio::MelhorEsforco,
    // `--add-dir` por pasta no build_command.
    pastas_extras: true,
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
    // (`.frota/commands`) o agy não conhece e segue expandindo app-side.
    native_slash: false,
    command_sources: &[],
    command_inventory: None,
    builtin_commands: &[],
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
    context_usage: Some(ContextUsageSource::Stream),
    // agy 1.2.4: compacta quando a PRÓPRIA estimativa passa do limite gravado
    // a cada geração (256.000 no Gemini Flash), não perto da janela de 1M.
    context_ceiling: Some(ContextCeilingProbe::AgyGenerationRecord),
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
    modelo_livre: false,
};

pub trait AgentAdapter: Send {
    /// Id estável (= binário lógico), usado em mensagens de erro.
    fn id(&self) -> &'static str;
    /// Capabilities declaradas (agent-runner.md §2). SEM default de propósito:
    /// agent novo é OBRIGADO a declarar — e o teste de contrato
    /// (`contrato_capabilities_x_comportamento_por_agent`) cobra que a
    /// declaração corresponda ao comando que o build_command monta.
    fn capabilities(&self) -> &'static Capabilities;
    /// Como esta CLI transporta o prompt no `argv`. SEM default de propósito:
    /// adapter novo precisa declarar a convenção, e o teste genérico confere se
    /// o comando realmente obedece a ela.
    fn cli_prompt_contract(&self) -> CliPromptContract;
    /// Monta o `Command` (binário + flags). O loop compartilhado null-a o stdin
    /// e pipa stdout/stderr, o adapter NÃO cuida disso. `&mut self`: o adapter
    /// pode fixar estado do run (ex. Codex guarda o modelo requisitado p/ custo).
    fn build_command(&mut self, req: &RunRequest) -> Result<Command, String>;
    /// Caminho do runner: monta e valida a forma declarada antes de qualquer
    /// spawn. Centraliza a guarda sem centralizar a sintaxe do fornecedor.
    fn build_validated_command(&mut self, req: &RunRequest) -> Result<Command, String> {
        let contract = self.cli_prompt_contract();
        let agent = self.id();
        let cmd = self.build_command(req)?;
        contract.validate(agent, &cmd)?;
        Ok(cmd)
    }
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
    /// Última chance após gesto de parar. Só adapters com fonte autoritativa
    /// externa ao stream devem devolver eventos; o default não inventa nada.
    fn on_cancel(&mut self) -> Vec<AgentEvent> {
        Vec::new()
    }
    /// Uma linha do stderr AO VIVO. O stderr inteiro continua indo para o
    /// relatório de fim de run; este gancho é só para motor que escreve ESTADO
    /// ali durante o turno. Default: nada.
    fn on_stderr_line(&mut self, _line: &str) -> Vec<AgentEvent> {
        Vec::new()
    }
    /// Batida periódica do runner (a mesma da amostra de memória), para quem
    /// espera uma fonte externa ao stream ficar pronta. Default: nada.
    fn on_heartbeat(&mut self) -> Vec<AgentEvent> {
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
/// Pastas distintas dos anexos, na ordem em que aparecem. O anexo da nota mora
/// em outra pasta que o da conversa; liberar só a do primeiro deixava o resto
/// ilegível para o agente (ADR-192).
pub(crate) fn pastas_dos_anexos(atts: &[Attachment]) -> Vec<&std::path::Path> {
    let mut pastas: Vec<&std::path::Path> = Vec::new();
    for a in atts {
        if let Some(dir) = std::path::Path::new(&a.path).parent() {
            if !pastas.contains(&dir) {
                pastas.push(dir);
            }
        }
    }
    pastas
}

fn extract_reset_hint(msg: &str) -> Option<String> {
    let lower = msg.to_ascii_lowercase();
    // "resets …" é o formato do Claude; "try again at …" é o do Codex 0.154.0
    // ("try again at Sep 19th, 2026 10:12 AM."), colhido do fio em 14/09/2026.
    // Sem ele o hint vinha vazio e a retomada caía no backoff cego.
    let (start, marker) = ["resets at ", "reset at ", "resets ", "try again at "]
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

/// OpenCode 1.17.9 — capabilities MEDIDAS no stream real (26/08/2026), não na
/// documentação. O que foi verificado rodando `opencode run --format json`:
///
///   • envelope NDJSON `{type, timestamp, sessionID, part}` — um objeto por
///     linha, exatamente o transporte que o loop compartilhado já lê;
///   • `step_finish.part.cost` vem do CLI ⇒ `reports_cost: true`;
///   • `tokens.cache` traz **read E write** (nenhum outro motor entrega os
///     dois — claude reporta e a gente só lia read; codex e agy mandam 0);
///   • **NÃO é cumulativo**: dois turnos na mesma sessão (`--continue`) deram
///     `input` 5499 e 5515, custos independentes. Se fosse acumulado o 2º
///     viria ~11k. Sem baseline, sem a maquinaria do ADR-033;
///   • `total = input + cache.read + output + reasoning` (conferido:
///     5499+36220+1+212 = 41932) ⇒ **`input` EXCLUI o cache**, convenção do
///     agy, não a do claude. O mapeamento soma, como o agy faz.
///
/// O que fica `false` porque NÃO foi medido em uso, mesmo a doc prometendo:
/// MCP, canal de sistema, compactação nativa e janela de uso. O CLI faz mais;
/// a flag diz o que o APP já usa.
pub const OPENCODE_CAPS: Capabilities = Capabilities {
    // ACP anuncia capabilities de protocolo, não a lista completa de tools.
    native_tool_inventory: ToolInventoryEvidence::Opaque,
    work_mcp: false,
    work_mcp_global_env: false,
    run_mcp_deny: false,
    context_mcp: false,
    // opencode 1.18.21 (medido 26/08/2026): a chave `mcp` do `opencode.json`
    // do DIRETÓRIO vale. Provado dos dois lados: dentro do projeto o
    // `opencode mcp list` mostra o servidor, fora dele diz "No MCP servers
    // configured". Escopo de projeto real, sem truque. Existe também
    // `opencode mcp add`, que é por onde o F2 vai instalar.
    mcp_escopo: McpEscopo::PorProjeto,
    mcp_launch_cwd: false,
    // opencode 1.18.21: zero menção a sandbox no `--help` (conferido
    // 11/09/2026). Sem fonte auditada, o valor é o fail-closed do agnosticismo:
    // assumir confinamento próprio que não existe tiraria a única garantia real.
    sandbox_proprio: SandboxProprio::Nenhum,
    // nenhum canal de pasta extra no `run` nem no ACP.
    pastas_extras: false,
    inline_interaction: false,
    deferred_work: false,
    native_slash: false,
    command_sources: &[],
    command_inventory: None,
    builtin_commands: &[],
    // `-s <id>` / `--continue` / `--fork`, medidos no --help.
    session_resume: true,
    system_channel: false,
    structured_output: true,
    reports_cost: true,
    cumulative_usage: false,
    // A doc anuncia `session.next.compaction.started`, mas o stream do `run`
    // não foi observado emitindo — fica false até alguém ver acontecer.
    native_compact: false,
    context_usage: None,
    context_ceiling: None,
    usage_window: None,
    usage_window_poll: None,
    hooks_status: false,
    hooks_permission: false,
    hook_dialect: None,
    // `opencode models`: 88 linhas nesta máquina, em 4 provedores. A lista viva
    // é a única fonte honesta — o que aparece depende de QUAIS credenciais
    // existem, e isso muda sem o app saber.
    lists_models: Some(ModelListSource::OpenCodeModelsSubcommand),
    model_smoke: Some(ModelSmokeDialect::OpenCodeRunJson),
    modelo_livre: false,
};

/// Limite do OpenCode/provider. O NVIDIA NIM devolve literalmente "Too Many
/// Requests" (429), sem as palavras `rate limit`; se isso virar erro genérico,
/// o usuário procura defeito na chave quando na verdade precisa esperar/trocar.
pub fn opencode_limit(msg: &str) -> Option<LimitHit> {
    let lower = msg.to_ascii_lowercase();
    (lower.contains("too many requests")
        || lower.contains("rate limit")
        || lower.contains("rate_limit")
        || lower.contains("quota")
        || lower.contains("out of credits"))
    .then(|| LimitHit {
        reset_hint: extract_reset_hint(msg),
    })
}

#[path = "adapters_opencode.rs"]
mod adapters_opencode;
pub use adapters_opencode::{
    exportar_sessao as exportar_sessao_opencode, somar_filhos as somar_filhos_opencode, UsoOpenCode,
};
use adapters_opencode::{exportar_sessao, somar_filhos, tool_use, total_da_sessao};
#[path = "opencode_ferramentas.rs"]
pub(crate) mod opencode_ferramentas;

/// Adapter do OpenCode: `opencode run --format json`.
///
/// O motor é um MULTIPLICADOR de credencial (OAuth com Copilot, SuperGrok,
/// GitLab Duo, OpenAI e Anthropic), então o valor dele não é ser "mais um
/// modelo" — é alcançar assinatura que o Frota não alcança sozinho.
#[derive(Default)]
pub struct OpenCodeAdapter {
    /// Texto acumulado dos blocos `text` do turno, pro `Result`.
    texto: String,
    /// SOMA dos `step_finish` do turno, nunca o último (ver `adapters_opencode`).
    uso: Option<UsoOpenCode>,
    /// Sessões filhas (subagentes via `task`) vistas no turno. O custo delas
    /// não passa pelo stream: é lido no fechamento pelo `opencode export`.
    filhos: Vec<String>,
    /// Porta de leitura de uma sessão; `None` é o `opencode export` real, e o
    /// teste injeta o export colhido.
    exportar: Option<fn(&str) -> Result<String, String>>,
    /// O `-m` deste turno. O stream não diz o modelo em evento nenhum, e sem
    /// ele o `session` apagava o modelo da conversa e do ledger.
    modelo: Option<String>,
    /// Retomada e acumulado anterior da sessão (ver `total_da_sessao`).
    retomada: bool,
    base: Option<f64>,
    /// Falhou? O `error` vem como evento, e o exit code NÃO serve: medido
    /// saindo **0 em falha** (banco local fora de sincronia).
    erro: Option<String>,
    /// Passamos o `--dangerously-skip-permissions` neste turno?
    ///
    /// Sem ele o `opencode run` **não pergunta: ele auto-rejeita** (medido em
    /// 26/08/2026 — o CLI escreve `permission requested: bash (…);
    /// auto-rejecting` no stderr, como texto humano, e segue). Guardar isto é
    /// o que permite distinguir "a pessoa recusou" de "ninguém foi perguntado".
    bypass: bool,
}

impl AgentAdapter for OpenCodeAdapter {
    fn id(&self) -> &'static str {
        "opencode"
    }

    fn capabilities(&self) -> &'static Capabilities {
        &OPENCODE_CAPS
    }

    fn cli_prompt_contract(&self) -> CliPromptContract {
        CliPromptContract::TrailingAfterSeparator("--")
    }

    fn supports_attachment(&self, kind: &AttachmentKind) -> bool {
        matches!(kind, AttachmentKind::Image)
    }

    fn render_attachments(&self, atts: &[Attachment], cmd: &mut Command, prompt: &mut String) {
        for a in atts {
            cmd.arg("-f").arg(&a.path);
        }
        if let Some(l) = crate::attachments::imagem_no_texto::legenda(prompt, atts) {
            prompt.push_str(&l);
        }
        if prompt.trim().is_empty() && !atts.is_empty() {
            *prompt = " ".to_string();
        }
    }

    fn build_command(&mut self, req: &RunRequest) -> Result<Command, String> {
        let mut cmd = Command::new("opencode");
        cmd.arg("run").arg("--format").arg("json");
        // `--dir` é o diretório do run; o `current_dir` acompanha porque o
        // resto do loop (sandbox, worktree) raciocina em cima dele.
        cmd.arg("--dir").arg(&req.cwd).current_dir(&req.cwd);
        (self.modelo, self.retomada) = (req.model.clone(), req.resume.is_some());
        self.base = req.cost_baseline;
        if let Some(m) = &req.model {
            // O dialeto é `provider/model` — é assim que `opencode models` lista.
            cmd.arg("-m").arg(m);
        }
        if let Some(e) = &req.effort {
            cmd.arg("--variant").arg(e);
        }
        if let Some(r) = &req.resume {
            cmd.arg("-s").arg(r);
        }
        let mut prompt = req.prompt.clone();
        self.render_attachments(&req.attachments, &mut cmd, &mut prompt);
        // Só existe o bypass tudo-ou-nada; não há granularidade de modo. Por
        // isso o `enforcement` deste motor é `flag`, nunca `sandbox`, e a UI
        // precisa dizer isso (F3 do plano).
        self.bypass = matches!(req.permission, Permission::Liberado);
        if self.bypass {
            cmd.arg("--dangerously-skip-permissions");
        }
        // OpenCode 1.18.21: o parser junta `args.message` com `args["--"]`.
        // Sem o separador, pedido iniciado por hífen vira opção desconhecida
        // antes do handler; com ele, segue como texto (probe local 29/08/2026).
        cmd.arg("--").arg(&prompt);
        Ok(cmd)
    }

    fn map_line(&mut self, v: &serde_json::Value) -> Vec<AgentEvent> {
        let tipo = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let part = v.get("part");
        match tipo {
            "step_start" => {
                let sid = v.get("sessionID").and_then(|s| s.as_str()).unwrap_or("");
                if sid.is_empty() {
                    return Vec::new();
                }
                vec![AgentEvent::Session {
                    session_id: sid.to_string(),
                    model: self.modelo.clone(),
                    tools: 0,
                }]
            }
            "text" => {
                let t = part
                    .and_then(|p| p.get("text"))
                    .and_then(|t| t.as_str())
                    .unwrap_or("");
                if t.is_empty() {
                    return Vec::new();
                }
                self.texto.push_str(t);
                vec![AgentEvent::Text {
                    text: t.to_string(),
                }]
            }
            "step_finish" => {
                if let Some(p) = part {
                    self.uso
                        .get_or_insert_with(UsoOpenCode::default)
                        .somar_step(p);
                }
                Vec::new()
            }
            // A ferramenta recusada SEM ninguém ter sido perguntado. Sem este
            // braço o turno passava calado: o `tool_use` caía no `_ => vazio`,
            // nenhum evento `error` nascia, e o `on_close` reportava `ok:true`
            // sobre um turno onde toda ferramenta foi barrada. Sucesso falso.
            "tool_use" => {
                let Some(p) = part else { return Vec::new() };
                let (eventos, erro) = tool_use(p, self.bypass, &mut self.filhos);
                self.erro = erro.or(self.erro.take());
                eventos
            }
            "error" => {
                let msg = v
                    .get("error")
                    .and_then(|e| e.get("data"))
                    .and_then(|d| d.get("message"))
                    .and_then(|m| m.as_str())
                    .unwrap_or("o opencode falhou sem detalhe");
                self.erro = Some(msg.to_string());
                match opencode_limit(msg) {
                    Some(hit) => vec![AgentEvent::LimitReached {
                        message: msg.to_string(),
                        reset_hint: hit.reset_hint,
                    }],
                    None => vec![AgentEvent::Error {
                        message: msg.to_string(),
                    }],
                }
            }
            _ => Vec::new(),
        }
    }

    fn on_close(&mut self) -> Vec<AgentEvent> {
        let exportar = self.exportar.unwrap_or(exportar_sessao);
        let filhos = std::mem::take(&mut self.filhos);
        let proprio = self.uso.as_ref().and_then(|u| u.cost);
        let total = total_da_sessao(self.retomada, self.base, proprio);
        let (uso, mut avisos) = somar_filhos(self.uso.take(), filhos, exportar);
        let UsoOpenCode {
            input,
            output,
            cache_read,
            cache_write: cache_creation,
            cost,
        } = uso.unwrap_or_default();
        avisos.push(AgentEvent::Result {
            // O desfecho vem do EVENTO, nunca do exit code: medido saindo 0
            // numa falha real (banco local fora de sincronia).
            ok: self.erro.is_none(),
            text: (!self.texto.is_empty()).then(|| self.texto.clone()),
            cost_usd: cost,
            cost_source: if cost.is_some() {
                CostSource::Reported
            } else {
                CostSource::Unknown
            },
            input_tokens: input,
            output_tokens: output,
            cache_read,
            cache_creation,
            // Reporta por TURNO (medido em dois turnos da mesma sessão): nada
            // a acumular, nada de baseline.
            cumulative_usage: None,
            reported_cost_total: total,
        });
        avisos
    }
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
        // (None = sem config nem chave `model`; SEM chute — ver `codex_config_model`)
        model: codex_config_model(),
        evidence: None,
        // baseline e thread do run chegam no build_command (RunRequest).
        resume: None,
        usage_seen: None,
    })
}
fn build_agy() -> Box<dyn AgentAdapter> {
    Box::<AgyAdapter>::default()
}
fn build_opencode() -> Box<dyn AgentAdapter> {
    Box::<OpenCodeAdapter>::default()
}

static SPECS: [AgentSpec; 4] = [
    AgentSpec {
        id: "claude-code",
        caps: &CLAUDE_CAPS,
        build: build_claude,
    },
    AgentSpec {
        id: "codex",
        caps: &CODEX_CAPS,
        build: build_codex,
    },
    AgentSpec {
        id: "agy",
        caps: &AGY_CAPS,
        build: build_agy,
    },
    AgentSpec {
        id: "opencode",
        caps: &OPENCODE_CAPS,
        build: build_opencode,
    },
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
/// `result` do Claude que não fecha turno nenhum (ver o uso em `map_line`).
fn resultado_de_bastidor(v: &serde_json::Value) -> bool {
    let zero_turnos = v.get("num_turns").and_then(|x| x.as_u64()) == Some(0);
    let sem_texto = v
        .get("result")
        .and_then(|x| x.as_str())
        .is_none_or(|t| t.trim().is_empty());
    let sem_custo = v
        .get("total_cost_usd")
        .and_then(|x| x.as_f64())
        .is_none_or(|c| c == 0.0);
    let usage = v.get("usage");
    let sem_tokens = ["input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"]
        .iter()
        .all(|k| usage_u64(usage, k) == 0);
    zero_turnos && sem_texto && sem_custo && sem_tokens
}

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

/// Parse da mensagem emitida pelo Claude Code ao despachar comando em background
/// (payload real do incidente: `Command running in background with ID: <id>. Output is being written to: <path>...`).
/// Extrai deterministamente task_id e output_file para associar ao tool_use_id.
fn parse_claude_background_task(text: &str) -> Option<(String, String)> {
    let prefix = "Command running in background with ID: ";
    let output_marker = ". Output is being written to: ";
    let p_idx = text.find(prefix)?;
    let after_prefix = &text[p_idx + prefix.len()..];
    let m_idx = after_prefix.find(output_marker)?;
    let task_id = after_prefix[..m_idx].trim();
    if task_id.is_empty() {
        return None;
    }
    let after_marker = &after_prefix[m_idx + output_marker.len()..];
    let end_idx = after_marker
        .find(". You will be notified")
        .or_else(|| after_marker.find(". "))
        .or_else(|| after_marker.find('\n'))
        .unwrap_or_else(|| {
            if after_marker.ends_with('.') {
                after_marker.len().saturating_sub(1)
            } else {
                after_marker.len()
            }
        });
    let output_file = after_marker[..end_idx].trim();
    if output_file.is_empty() || !output_file.starts_with('/') {
        return None;
    }
    Some((task_id.to_string(), output_file.to_string()))
}

// ---------------- Claude Code (porta o map_events 1:1) ----------------

#[derive(Default)]
pub struct ClaudeAdapter {
    /// Destino da evidência visual (B1). None = sem gravação (testes/headless
    /// sem app_data_dir): tool_result segue só texto.
    evidence: Option<crate::evidence::EvidenceSink>,
    /// Texto que os `text_delta` do bloco ABERTO já entregaram. É a régua pra
    /// completar a cauda quando o `assistant` consolidado chega com mais texto
    /// do que os deltas trouxeram (ver o arm "assistant").
    texto_do_bloco: String,
    /// Existe um bloco de TEXTO aberto (`content_block_start` sem `stop`)? Fora
    /// dele, o `assistant` nunca completa nada: mensagem cumulativa ou CLI sem
    /// `--include-partial-messages` repetiriam texto que já está na tela.
    bloco_de_texto_aberto: bool,
    /// Ids de mensagem que tiveram `message_start` no stream. Mensagem que
    /// nunca streamou (builtin local: modelo `<synthetic>`, sem deltas, claude
    /// 2.1.270) só existe no `assistant` consolidado, e é ele que vai pro fio.
    mensagens_streamadas: std::collections::HashSet<String>,
    /// Tasks que nasceram com `is_backgrounded: false` (claude 2.1.270, fixture
    /// `comando-em-primeiro-plano.jsonl`): o CLI abre task até para o Bash comum
    /// que demora, e o turno ESPERA por ele. Não é trabalho em segundo plano; o
    /// cartão da tool já conta a história. Guardadas aqui até um `task_updated`
    /// com `is_backgrounded: true` promovê-las (o binário emite esse patch).
    tarefas_em_primeiro_plano: std::collections::HashMap<String, TarefaEmPrimeiroPlano>,
    /// ADR-226: sessão que este run tentou retomar, o custo acumulado que ela
    /// já tinha reportado e o modelo que o `init` confirmou (régua de preço do
    /// `custo_do_turno`).
    resume: Option<String>,
    custo_visto: Option<f64>,
    modelo: Option<String>,
}

/// O nascimento de uma task em primeiro plano, para emitir se ela for para o
/// segundo plano depois.
/// `task_type` do Claude Code → tipo do contrato. Valores colhidos das capturas
/// reais (`testdata/claude-2.1.2xx`): `local_bash`, `local_agent`,
/// `local_workflow`. Tipo novo do CLI cai em `Other`, nunca num chute.
fn claude_task_kind(task_type: &str) -> DeferredKind {
    match task_type {
        "local_bash" => DeferredKind::Terminal,
        "local_agent" => DeferredKind::Subagent,
        "local_workflow" => DeferredKind::Workflow,
        _ => DeferredKind::Other,
    }
}

struct TarefaEmPrimeiroPlano {
    tool_use_id: Option<String>,
    kind: Option<DeferredKind>,
    name: Option<String>,
}

impl AgentAdapter for ClaudeAdapter {
    fn id(&self) -> &'static str {
        "claude"
    }

    fn capabilities(&self) -> &'static Capabilities {
        &CLAUDE_CAPS
    }

    fn cli_prompt_contract(&self) -> CliPromptContract {
        CliPromptContract::TrailingAfterSeparator("--")
    }

    fn set_evidence_sink(&mut self, sink: crate::evidence::EvidenceSink) {
        self.evidence = Some(sink);
    }

    fn build_command(&mut self, req: &RunRequest) -> Result<Command, String> {
        // ADR-226: o custo reportado ao retomar é o acumulado da sessão.
        self.resume = req.resume.clone();
        self.custo_visto = req.cost_baseline;
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
        // MCPs do cadastro global negados neste run: a regra `mcp__<servidor>`
        // tira todas as tools dele (medido no claude 2.1.280).
        let negados: Vec<String> = req
            .denied_mcp_servers
            .iter()
            .map(|nome| claude_mcp_rule(nome))
            .collect();
        disallowed.extend(negados.iter().map(String::as_str));
        // disallowedTools (mesclado): o gate de escrita (por modo) + os interativos.
        cmd.arg("--disallowedTools").arg(disallowed.join(","));
        // A regra acima tira as tools, mas o servidor SUBIA assim mesmo: visto
        // em 23/09/2026, `npm exec @playwright/mcp@latest` nascendo em todo
        // turno (~230 MB, e o `@latest` consultando o registro). O
        // `deniedMcpServers` dos settings impede o processo de nascer (medido
        // no claude 2.1.280: sem ele o playwright sobe, com ele não).
        if !req.denied_mcp_servers.is_empty() {
            let negados: Vec<serde_json::Value> = req
                .denied_mcp_servers
                .iter()
                .map(|nome| serde_json::json!({ "serverName": nome }))
                .collect();
            cmd.arg("--settings")
                .arg(serde_json::json!({ "deniedMcpServers": negados }).to_string());
        }

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
        // - frota-approval: interação inline exclusiva do Claude;
        // - frota-context: memória read-only compartilhada também com o Codex.
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
            }
            for contributed in &req.mcp_plan.contributed {
                servers.insert(
                    contributed.runtime_name.clone(),
                    contributed.launch.claude_json(),
                );
            }
            let announced = req.mcp_plan.announced_servers();
            if !announced.is_empty() {
                // Mesmo anúncio do preâmbulo do prompt (agent.rs): o nome de
                // runtime é o que o modelo precisa citar nas tools.
                system_nudges.push(format!(
                    "Ferramentas MCP desta sessão:\n{}\nUse somente quando a tarefa exigir.",
                    announced
                        .iter()
                        .map(|server| {
                            format!(
                                "- {}: {} (MCP roteado pela Frota)",
                                server.runtime_name, server.display_name
                            )
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                ));
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
                system_nudges.push(crate::work_gateway::ferramentas::instrucao_qualificada(req.resume.is_none()));
                allowed_internal_tools.push(format!(
                    "mcp__{}__{}",
                    crate::work_gateway::MCP_SERVER_NAME,
                    crate::work_gateway::CONVERSATION_TITLE_TOOL
                ));
            }
            if let Some(gateway) = &req.browser_gateway {
                servers.insert(
                    crate::browser_gateway::MCP_SERVER_NAME.into(),
                    gateway.claude_server_json(),
                );
                system_nudges.push(format!(
                    "Para ver ou testar uma página, use o navegador da Frota pelo MCP {}: mcp__{}__{} lê a página, mcp__{}__{} captura como evidência, mcp__{}__{} abre uma URL ou um HTML do projeto, mcp__{}__{} roda JavaScript na página (canvas, File, import do dev server) e mcp__{}__{} envia arquivo a um input. Com mais de uma aba, mcp__{}__{} lista e mcp__{}__{} troca. Ele aparece na aba ao lado da conversa. Se estiver desligado, a tool pede à pessoa e espera a resposta dela (até 90 s) antes de voltar; não abra outro navegador por conta própria.",
                    crate::browser_gateway::MCP_SERVER_NAME,
                    crate::browser_gateway::MCP_SERVER_NAME,
                    crate::browser_gateway::SNAPSHOT_TOOL,
                    crate::browser_gateway::MCP_SERVER_NAME,
                    crate::browser_gateway::CAPTURE_TOOL,
                    crate::browser_gateway::MCP_SERVER_NAME,
                    crate::browser_gateway::NAVIGATE_TOOL,
                    crate::browser_gateway::MCP_SERVER_NAME,
                    crate::browser_gateway::EVALUATE_TOOL,
                    crate::browser_gateway::MCP_SERVER_NAME,
                    crate::browser_gateway::UPLOAD_TOOL,
                    crate::browser_gateway::MCP_SERVER_NAME,
                    crate::browser_gateway::TABS_TOOL,
                    crate::browser_gateway::MCP_SERVER_NAME,
                    crate::browser_gateway::TAB_SELECT_TOOL,
                ));
            }
            if let Some(gateway) = &req.desktop_gateway {
                servers.insert(
                    crate::desktop_gateway::MCP_SERVER_NAME.into(),
                    gateway.claude_server_json(),
                );
                system_nudges.push(format!(
                    "Para operar ou inspecionar o desktop, use o MCP {}: mcp__{}__{} informa a tela e status, mcp__{}__{} captura como evidência visual, mcp__{}__{} clica e mcp__{}__{} digita. Capturar a tela e pilotar exigem que a pessoa libere o computador neste turno: sem isso a Frota mostra o pedido e a tool espera a resposta dela (até 90 s) antes de voltar; não repita a chamada enquanto espera.",
                    crate::desktop_gateway::MCP_SERVER_NAME,
                    crate::desktop_gateway::MCP_SERVER_NAME,
                    crate::desktop_gateway::STATUS_TOOL,
                    crate::desktop_gateway::MCP_SERVER_NAME,
                    crate::desktop_gateway::CAPTURE_TOOL,
                    crate::desktop_gateway::MCP_SERVER_NAME,
                    crate::desktop_gateway::CLICK_TOOL,
                    crate::desktop_gateway::MCP_SERVER_NAME,
                    crate::desktop_gateway::TYPE_TOOL,
                ));
            }
            if let Some(gateway) = &req.tool_gateway {
                servers.insert(
                    crate::tool_gateway::MCP_SERVER_NAME.into(),
                    gateway.claude_server_json(),
                );
                system_nudges.push(format!(
                    "As tools de plugins revisados desta sessão chegam pelo MCP {}. O worker só nasce quando uma tool é chamada; não use uma extensão fora da necessidade da tarefa.",
                    crate::tool_gateway::MCP_SERVER_NAME,
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
        // concede ao Read tool acesso às pastas dos anexos (verificado: --add-dir,
        // repetível). Uma por pasta: anexo da nota mora em `attachments/notes/`,
        // o da conversa em `attachments/<conv>/` (ADR-192).
        for dir in pastas_dos_anexos(atts) {
            cmd.arg("--add-dir").arg(dir);
        }
        prompt.push_str("\n\nArquivos anexados (use o Read tool para abri-los):\n");
        for (a, rotulo) in atts.iter().zip(crate::attachments::imagem_no_texto::rotulos(atts)) {
            // path ABSOLUTO entre crases (blinda espaços, ex. "Application Support")
            prompt.push_str(&format!("- {rotulo}`{}` ({})\n", a.path, a.mime));
        }
    }

    fn map_line(&mut self, v: &serde_json::Value) -> Vec<AgentEvent> {
        match v.get("type").and_then(|x| x.as_str()).unwrap_or("") {
            "system" => match v.get("subtype").and_then(|x| x.as_str()) {
                Some("init") => {
                    let sessao = v.get("session_id").and_then(|x| x.as_str()).unwrap_or_default();
                    // Retomada que abriu OUTRA sessão: o acumulado da antiga não
                    // descreve esta (ADR-226, mesma régua do ADR-033).
                    if self.resume.as_deref().is_some_and(|r| r != sessao) {
                        self.custo_visto = None;
                    }
                    self.modelo = v.get("model").and_then(|x| x.as_str()).map(str::to_string);
                    let mut events = vec![AgentEvent::Session {
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
                    }];
                    // claude 2.1.270: o init traz slash_commands/skills/plugins
                    // (ADR-189). Sem esses campos, nada se afirma.
                    if let Some(inventory) = crate::command_inventory::parse_claude_init(
                        v,
                        crate::run_resources::epoch_ms(),
                    ) {
                        events.push(AgentEvent::EngineInventory { inventory });
                    }
                    events
                }
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
                            if self.tarefas_em_primeiro_plano.contains_key(id) {
                                return None;
                            }
                            Some(AgentEvent::DeferredWork {
                                id: id.to_string(),
                                tool_use_id: None,
                                kind: t
                                    .get("task_type")
                                    .and_then(|x| x.as_str())
                                    .map(claude_task_kind),
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
                    let tool_use_id = v
                        .get("tool_use_id")
                        .and_then(|x| x.as_str())
                        .map(str::to_string);
                    let kind = v
                        .get("task_type")
                        .and_then(|x| x.as_str())
                        .map(claude_task_kind);
                    let name = v
                        .get("workflow_name")
                        .and_then(|x| x.as_str())
                        .or_else(|| v.get("description").and_then(|x| x.as_str()))
                        .map(str::to_string);
                    // Só `false` explícito segura: CLI antigo sem o campo segue
                    // como antes (fail-open, ADR-200).
                    if v.get("is_backgrounded").and_then(|x| x.as_bool()) == Some(false) {
                        self.tarefas_em_primeiro_plano
                            .insert(id.to_string(), TarefaEmPrimeiroPlano { tool_use_id, kind, name });
                        return vec![];
                    }
                    vec![AgentEvent::DeferredWork {
                        id: id.to_string(),
                        tool_use_id,
                        kind,
                        name,
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
                    if self.tarefas_em_primeiro_plano.contains_key(id) {
                        return vec![];
                    }
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
                    // Foi para o segundo plano no meio do caminho: nasce agora.
                    let mut out = Vec::new();
                    if self.tarefas_em_primeiro_plano.contains_key(id) {
                        if v.pointer("/patch/is_backgrounded").and_then(|x| x.as_bool()) != Some(true) {
                            return vec![];
                        }
                        if let Some(t) = self.tarefas_em_primeiro_plano.remove(id) {
                            out.push(AgentEvent::DeferredWork {
                                id: id.to_string(),
                                tool_use_id: t.tool_use_id,
                                kind: t.kind,
                                name: t.name,
                                status: DeferredStatus::Running,
                                summary: None,
                                output_file: None,
                                progress: None,
                            });
                        }
                    }
                    let status = match v.pointer("/patch/status").and_then(|x| x.as_str()) {
                        Some("completed") => DeferredStatus::Completed,
                        // claude 2.1.270 (fixture background-bash.jsonl): o
                        // shell em segundo plano morto no fim do turno chega
                        // como `killed` (ADR-200).
                        Some("stopped") | Some("cancelled") | Some("killed") => DeferredStatus::Stopped,
                        _ => return out,
                    };
                    out.push(AgentEvent::DeferredWork {
                        id: id.to_string(),
                        tool_use_id: None,
                        kind: None,
                        name: None,
                        status,
                        summary: None,
                        output_file: None,
                        progress: None,
                    });
                    out
                }
                // Fim com resumo + output_file. Qualquer fim não-"completed"
                // vira Stopped (o front mostra "interrompido" — honesto). O
                // output_file é PRIMEIRA CLASSE: o resultado em disco era a
                // lição central do incidente (existia e ninguém sabia).
                Some("task_notification") => {
                    let Some(id) = v.get("task_id").and_then(|x| x.as_str()) else {
                        return vec![];
                    };
                    // Fim de task que nunca saiu do primeiro plano: o resultado
                    // já veio no tool_result do próprio comando.
                    if self.tarefas_em_primeiro_plano.remove(id).is_some() {
                        return vec![];
                    }
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
            // input deltas seguem ignorados; block_start delimita a recomposição.
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
                            if self.bloco_de_texto_aberto {
                                self.texto_do_bloco.push_str(t);
                            }
                            return vec![AgentEvent::TextDelta {
                                text: t.to_string(),
                            }];
                        }
                    }
                } else if ev_type == Some("message_start") {
                    if let Some(id) = ev
                        .and_then(|e| e.pointer("/message/id"))
                        .and_then(|x| x.as_str())
                    {
                        self.mensagens_streamadas.insert(id.to_string());
                    }
                } else if ev_type == Some("content_block_start") {
                    self.texto_do_bloco.clear();
                    self.bloco_de_texto_aberto = ev
                        .and_then(|e| e.pointer("/content_block/type"))
                        .and_then(|x| x.as_str())
                        == Some("text");
                } else if ev_type == Some("content_block_stop") {
                    self.texto_do_bloco.clear();
                    self.bloco_de_texto_aberto = false;
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
                // única fonte dele). Pro principal, o consolidado só serve pra
                // completar a CAUDA que os deltas não trouxeram (logo abaixo).
                let parent_tool_id = v
                    .get("parent_tool_use_id")
                    .and_then(|x| x.as_str())
                    .filter(|id| !id.is_empty())
                    .map(str::to_string);
                let is_subagent = parent_tool_id.is_some();
                // Cauda perdida dos deltas. No stream real (claude 2.1.266,
                // `testdata/claude-2.1.266`) a ordem de cada bloco é `text_delta`…
                // → `assistant` com o texto INTEIRO do bloco → `content_block_stop`.
                // Então o consolidado chega com a bolha ainda aberta, e o que ele
                // tem além do que os deltas já entregaram é texto que se perdeu no
                // caminho: vai como delta na MESMA bolha, antes do stop. Só completa
                // quando os deltas são prefixo exato do consolidado; divergência não
                // é cauda, e reescrever o que a pessoa já leu seria pior.
                if !is_subagent && self.bloco_de_texto_aberto {
                    let ultimo_texto = v
                        .pointer("/message/content")
                        .and_then(|x| x.as_array())
                        .and_then(|blocos| {
                            blocos
                                .iter()
                                .rev()
                                .find(|b| b.get("type").and_then(|x| x.as_str()) == Some("text"))
                        })
                        .and_then(|b| b.get("text"))
                        .and_then(|x| x.as_str());
                    if let Some(completo) = ultimo_texto {
                        if completo.len() > self.texto_do_bloco.len()
                            && completo.starts_with(self.texto_do_bloco.as_str())
                        {
                            let cauda = completo[self.texto_do_bloco.len()..].to_string();
                            self.texto_do_bloco.push_str(&cauda);
                            out.push(AgentEvent::TextDelta { text: cauda });
                        }
                    }
                }
                // Mensagem do executor que NUNCA streamou: o consolidado é a
                // única fonte do texto (resposta de builtin como `/usage`).
                // Sem isto o builtin rodava, custava zero e não aparecia.
                let nunca_streamou = !is_subagent
                    && v.pointer("/message/id")
                        .and_then(|x| x.as_str())
                        .is_some_and(|id| !self.mensagens_streamadas.contains(id));
                if let Some(content) = v.pointer("/message/content").and_then(|x| x.as_array()) {
                    for block in content {
                        match block.get("type").and_then(|x| x.as_str()) {
                            Some("text") if nunca_streamou => {
                                if let Some(t) = block.get("text").and_then(|x| x.as_str()) {
                                    if !t.trim().is_empty() {
                                        out.push(AgentEvent::Text { text: t.to_string() });
                                    }
                                }
                            }
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
                            out.push(AgentEvent::ContextUsage {
                                tokens,
                                window_tokens: None,
                            });
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
                        out.push(AgentEvent::ToolResult {
                            id: id.clone(),
                            ok,
                            text,
                            lines,
                            images,
                        });
                        if let Some((task_id, output_file)) = parse_claude_background_task(&full) {
                            out.push(AgentEvent::DeferredWork {
                                id: task_id,
                                tool_use_id: Some(id),
                                kind: Some(DeferredKind::Terminal),
                                name: None,
                                status: DeferredStatus::Running,
                                summary: None,
                                output_file: Some(output_file),
                                progress: None,
                            });
                        }
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
                // claude 2.1.270 (reproduzido 16/09/2026, fixture
                // `resume-apos-tarefa-parada.jsonl`): ao retomar depois de uma
                // tarefa em segundo plano que parou, o CLI entrega a
                // `task_notification` e fecha um `result` de BASTIDOR antes do
                // turno pedido: `num_turns` 0, custo 0, texto vazio. Não é fim
                // de turno; virava recibo "concluído · US$ 0,000" no TOPO da
                // resposta. Builtin (`/usage`) também tem zero turnos, mas traz
                // texto, e a compactação traz custo: os dois seguem valendo.
                if !is_error && resultado_de_bastidor(v) {
                    return vec![];
                }
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
                // Ao retomar, desde o 2.1.280 esse total é da SESSÃO: o custo do
                // turno sai da diferença, decidida pelo preço dos tokens do
                // próprio turno (ADR-226, `pricing::custo_do_turno`).
                let reportado = v.get("total_cost_usd").and_then(|x| x.as_f64());
                let estimado = self.modelo.as_deref().and_then(|m| {
                    let cache_read = usage_u64(usage, "cache_read_input_tokens");
                    let nu = crate::pricing::NormalizedUsage {
                        input: usage_u64(usage, "input_tokens")
                            + cache_read
                            + usage_u64(usage, "cache_creation_input_tokens"),
                        cached_input: cache_read,
                        output: usage_u64(usage, "output_tokens"),
                    };
                    crate::pricing::estimate(m, &nu).0
                });
                let cost_usd = reportado
                    .map(|r| crate::pricing::custo_do_turno(r, self.custo_visto, estimado));
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
                    // Os TOKENS do `result` do Claude são por turno: não há
                    // acumulado de usage a devolver (ADR-033 não se aplica).
                    cumulative_usage: None,
                    // O custo cru da sessão volta para o front guardar como base
                    // do próximo turno (ADR-226).
                    reported_cost_total: reportado,
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
    /// Modelo REQUISITADO (`req.model` em `build_command`), pra estimar custo
    /// (Codex não dá USD). NÃO é capturado do stream: medido 17/08/2026, o
    /// `codex exec --json` não reporta o modelo em evento nenhum — `None`
    /// quando ninguém pediu, e o custo sai sem preço em vez de chutar.
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

    fn cli_prompt_contract(&self) -> CliPromptContract {
        CliPromptContract::TrailingAfterSeparator("--")
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
        // Config por-run: o mesmo MCP `frota-context` do Claude, sem escrever no
        // config global do usuário. Precisa vir ANTES do subcomando `exec`.
        if !matches!(req.permission, Permission::FusionRo) {
            req.mcp_plan.configure_codex(&mut cmd);
            if let Some(gateway) = &req.context_gateway {
                gateway.configure_codex(&mut cmd);
            }
            if let Some(gateway) = &req.work_gateway {
                gateway.configure_codex(&mut cmd);
            }
            if let Some(gateway) = &req.browser_gateway {
                gateway.configure_codex(&mut cmd);
            }
            if let Some(gateway) = &req.desktop_gateway {
                gateway.configure_codex(&mut cmd);
            }
            if let Some(gateway) = &req.tool_gateway {
                gateway.configure_codex(&mut cmd);
            }
        }
        // TODO `-c` VAI ANTES DO SUBCOMANDO (codex 0.147, empírico 13/08/2026).
        // Os overrides passados DEPOIS de `exec` não fazem merge: eles
        // SUBSTITUEM os globais, e a tabela `mcp_servers` inteira evapora — o
        // turno roda sem frota-work e sem frota-context, e o agente responde "o MCP
        // frota-work não está exposto nesta sessão". Provado isolando a variável:
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

    fn render_attachments(&self, atts: &[Attachment], cmd: &mut Command, prompt: &mut String) {
        for a in atts {
            cmd.arg("-i").arg(&a.path); // path absoluto; argv não passa por shell
        }
        if let Some(l) = crate::attachments::imagem_no_texto::legenda(prompt, atts) {
            prompt.push_str(&l);
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
                // Codex NÃO dá USD → estima por tokens × tabela, mas SÓ quando
                // sabemos o modelo. `self.model` nasce de `codex_config_model()`
                // (lê `~/.codex/config.toml`) em `build_codex()` e é sobrescrito
                // por `req.model` em `build_command` quando o usuário pede um —
                // mas antes desta correção, se NENHUM dos dois soubesse dizer,
                // o adapter chutava um default fixo ("gpt-5.5") pra estimar em
                // cima. Medido 17/08/2026 (`codex exec --json` sem `-m`,
                // codex-cli 0.147.0): NENHUM evento do stream (`thread.started`,
                // `turn.started`, `item.completed`, `turn.completed`) carrega o
                // modelo — o stream não tem como corrigir o chute. Um dólar
                // atribuído a um modelo que ninguém escolheu e que a gente não pode
                // provar é pior que nenhum dólar. String vazia não casa
                // catálogo nem SEED (`price_for("")`, testado) → `(None,
                // Unknown)`, a mesma degradação honesta do ADR-047: o turno
                // ainda entra no ledger, com os tokens reais e `cost_usd` NULL.
                let model = self.model.clone().unwrap_or_default();
                let (cost_usd, cost_source) = crate::pricing::estimate(&model, &nu);
                let mut out = Vec::new();
                // IMPORTANTE: o delta acima é o TOTAL processado pelas várias
                // chamadas do turno, não o footprint da última chamada. Num
                // turno com tools ele pode ultrapassar a janela várias vezes.
                // O runner publica o contexto depois, lendo `last_token_usage`
                // do rollout (capability ContextUsageSource::CodexRollout).
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
                    reported_cost_total: None,
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
            // `codex exec --json` publica o começo/atualização antes do
            // completed. Repetir a mesma Tool por id é replay-safe no reducer
            // e mantém a linha viva ancorada em evento real do provider.
            "item.started" | "item.updated" => match v.get("item") {
                Some(item) => map_codex_item_activity(item),
                None => vec![AgentEvent::Unknown { raw: v.clone() }],
            },
            "turn.started" => vec![],
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

/// Abertura/atualização de item no stream JSONL legado do Codex. Só tipos cujo
/// payload carrega identidade e argumentos próprios viram Tool; nenhum verbo é
/// inferido da prosa do modelo.
fn map_codex_item_activity(item: &serde_json::Value) -> Vec<AgentEvent> {
    let id = item
        .get("id")
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string();
    if id.is_empty() {
        return vec![AgentEvent::Unknown { raw: item.clone() }];
    }
    let item_type = item.get("type").and_then(|x| x.as_str()).unwrap_or("");
    let event = match item_type {
        "command_execution" => AgentEvent::Tool {
            id,
            name: "Bash".to_string(),
            input: serde_json::json!({
                "command": item.get("command").and_then(|x| x.as_str()).unwrap_or("")
            }),
            parent_tool_id: None,
        },
        "mcp_tool_call" => AgentEvent::Tool {
            id,
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
        "web_search" => AgentEvent::Tool {
            id,
            name: "WebSearch".to_string(),
            input: serde_json::json!({
                "query": item.get("query").and_then(|x| x.as_str()).unwrap_or("")
            }),
            parent_tool_id: None,
        },
        "file_change" => AgentEvent::Tool {
            id,
            name: "Edit".to_string(),
            input: item
                .get("changes")
                .cloned()
                .unwrap_or(serde_json::Value::Null),
            parent_tool_id: None,
        },
        // Itens conhecidos sem ação visível. O texto chega no completed e o
        // reasoning/todo continua não sendo promovido a progresso fictício.
        "agent_message" | "reasoning" | "todo_list" => return vec![],
        _ => return vec![AgentEvent::Unknown { raw: item.clone() }],
    };
    vec![event]
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
/// Marco do fio quando o agy resume a conversa sozinho. Antes → depois só com
/// as duas medidas do próprio stream; sem elas, o fato sem número.
fn aviso_agy_compactou(antes: Option<u64>, depois: Option<u64>) -> AgentEvent {
    fn milhar(n: u64) -> String {
        let digits = n.to_string();
        let mut out = String::new();
        for (i, c) in digits.chars().enumerate() {
            if i > 0 && (digits.len() - i) % 3 == 0 {
                out.push('.');
            }
            out.push(c);
        }
        out
    }
    let base = "Contexto cheio: o Antigravity resumiu a conversa sozinho";
    let message = match (antes, depois) {
        (Some(a), Some(d)) => format!("{base} · {} → {} tokens.", milhar(a), milhar(d)),
        (None, Some(d)) => format!("{base} · agora {} tokens.", milhar(d)),
        _ => format!("{base}; o detalhe antigo virou resumo."),
    };
    AgentEvent::Notice { message }
}

#[derive(Default)]
pub struct AgyAdapter {
    /// Já avisamos que o agy compactou neste run? O `compaction_info` acompanha
    /// os steps seguintes, e repetir viraria eco a cada linha.
    avisou_compactacao: bool,
    /// Compactação vista (step `checkpoint` sem `usage`) esperando a próxima
    /// resposta para confirmar a queda e medir o antes → depois. Guarda o nível
    /// de contexto conhecido ANTES do checkpoint (0 = o run começou por ele).
    compactacao_pendente: Option<u64>,
    /// Modelo requisitado (p/ o rótulo no Session e p/ estimar o custo).
    /// None = default do agy, e aí o custo sai sem estimativa (honesto).
    model: Option<String>,
    /// Conversa que o run PEDIU pra retomar (`--conversation <ID>`). Guardado
    /// pra comparar com o `conversation_id` do `init`: o agy começa conversa
    /// NOVA em silêncio quando o id não existe, e sem essa comparação o app
    /// acharia que tem contexto que não tem.
    resume: Option<String>,
    /// Conversa confirmada pelo `init`, usada para consultar o transcript do
    /// próprio Agy se a ponte parar depois de uma ferramenta em background.
    conversation_id: Option<String>,
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
    /// Posição monotônica no stream deste RUN. O `step_index` do agy é
    /// global à conversa retomada; esta régua local deixa a decisão terminal
    /// comparar apenas fatos observados no turno corrente.
    stream_position: u64,
    /// Maior step global que efetivamente atravessou o stream externo.
    last_provider_step: u64,
    /// Um `result` normal vence qualquer recuperação de transcript.
    result_seen: bool,
    /// Step de resposta que está recebendo deltas e se ele já trouxe texto.
    /// ACTIVE e DONE chegam em linhas diferentes para a mesma resposta.
    response_step: Option<String>,
    response_step_has_text: bool,
    /// A última resposta utilizável que chegou a DONE e a última ferramenta
    /// observada neste run. Uma resposta DONE posterior à ferramenta é a prova
    /// de que uma falha local foi absorvida pelo próprio agente.
    last_completed_response_position: Option<u64>,
    last_tool_position: Option<u64>,
    /// Sink de evidência visual de tool_result (browser-plan B1).
    evidence: Option<crate::evidence::EvidenceSink>,
    /// Tarefas em background que o `-p` avisou estar esperando (stderr). None =
    /// sem espera anunciada, ou a ponte já voltou a falar.
    esperando_tarefas: Option<u32>,
    /// A espera já foi explicada no fio (uma vez por run).
    avisou_espera: bool,
    /// Step da resposta mostrada a partir do transcript durante a espera. Quando
    /// a ponte liberar os steps segurados, o texto deste step já está na tela.
    resposta_adiantada: Option<u64>,
    /// Teste: transcript no lugar do arquivo em `~/.gemini`.
    #[cfg(test)]
    pub(crate) transcript_de_teste: Option<String>,
}

/// Quantas tarefas o `agy -p` diz esperar, pela frase LITERAL do stderr da
/// 1.2.5 (`testdata/agy-1.2.5/bg-sleep.stderr`). O `-p` só sai quando elas
/// terminam, com teto no `--print-timeout`, e a ponte segura os steps até lá:
/// um servidor de desenvolvimento em background deixava o turno "trabalhando"
/// por até 60 min com a resposta pronta no histórico.
pub fn agy_tarefas_em_espera(linha: &str) -> Option<u32> {
    let resto = linha
        .trim()
        .strip_prefix("root agent idle; waiting for ")?;
    let (numero, depois) = resto.split_once(' ')?;
    depois
        .starts_with("background task")
        .then(|| numero.parse().ok())
        .flatten()
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

#[path = "agy_ferramentas.rs"]
mod agy_ferramentas;
use agy_ferramentas::{linhas_do_resultado, no_contrato, parse_agy_background_task};

/// Parse da mensagem de notificação de tarefa do Antigravity / Agy
/// (payloads reais capturados em bg-sleep e 22/09/2026:
/// `Task id "<id>" finished with result:` ou `Task id "<id>" was canceled with result:`).
fn parse_agy_task_notification(text: &str) -> Option<AgentEvent> {
    let prefix = "Task id \"";
    let p_idx = text.find(prefix)?;
    let after_prefix = &text[p_idx + prefix.len()..];
    let end_id_idx = after_prefix.find('"')?;
    let task_id = &after_prefix[..end_id_idx];
    if task_id.is_empty() {
        return None;
    }
    let status = if text.contains("finished with result:") {
        DeferredStatus::Completed
    } else if text.contains("was canceled with result:")
        || text.contains("was cancelled with result:")
    {
        DeferredStatus::Stopped
    } else {
        return None;
    };
    Some(AgentEvent::DeferredWork {
        id: task_id.to_string(),
        tool_use_id: None,
        kind: Some(DeferredKind::Terminal),
        name: None,
        status,
        summary: None,
        output_file: None,
        progress: None,
    })
}

impl AgyAdapter {
    /// O `result.status` do agy 1.1.13 fica contaminado depois de uma falha de
    /// ferramenta numa conversa retomada: o mesmo ERROR reaparece em turnos
    /// seguintes que entregaram resposta válida. A evidência autoritativa do
    /// TURNO é a ordem dos steps novos: resposta com texto, DONE, depois da
    /// última ferramenta. Sem essa prova (timeout, transporte cortado, tool
    /// falhou e não houve resposta posterior), o ERROR continua terminal.
    fn completed_answer_after_last_tool(&self) -> bool {
        match (
            self.last_completed_response_position,
            self.last_tool_position,
        ) {
            (Some(response), Some(tool)) => response > tool,
            (Some(_), None) => true,
            _ => false,
        }
    }

    /// Mostra a resposta que o agente já deu enquanto o `-p` espera tarefas em
    /// background. `achada` vem do transcript do próprio Agy (fonte do provider,
    /// nada fabricado); sem ela, só a explicação da espera entra no fio e a
    /// batida do runner tenta de novo.
    fn adiantar_resposta(&mut self, achada: Option<(u64, String)>) -> Vec<AgentEvent> {
        let mut out = Vec::new();
        let Some(tarefas) = self.esperando_tarefas else {
            return out;
        };
        if self.result_seen || self.abandoned {
            return out;
        }
        if self.resposta_adiantada.is_none() {
            if let Some((step, text)) = achada {
                if self.text_open {
                    self.text_open = false;
                    out.push(AgentEvent::TextStop);
                }
                self.resposta_adiantada = Some(step);
                self.last_provider_step = self.last_provider_step.max(step);
                out.push(AgentEvent::TextDelta { text });
                out.push(AgentEvent::TextStop);
            }
        }
        if !self.avisou_espera {
            self.avisou_espera = true;
            let quantas = if tarefas == 1 {
                "1 tarefa".to_string()
            } else {
                format!("{tarefas} tarefas")
            };
            out.push(AgentEvent::Notice {
                message: format!(
                    "O Agy terminou de responder e está esperando {quantas} em segundo plano (um servidor de desenvolvimento, por exemplo). O turno fica aberto enquanto ela roda; parar encerra a tarefa junto."
                ),
            });
        }
        out
    }

    fn buscar_resposta_adiantada(&self) -> Option<(u64, String)> {
        if self.resposta_adiantada.is_some() {
            return None;
        }
        self.resposta_no_transcript()
    }

    /// A resposta final gravada no transcript do Agy depois do último step que
    /// atravessou a ponte. Única porta para o arquivo do provider.
    fn resposta_no_transcript(&self) -> Option<(u64, String)> {
        #[cfg(test)]
        if let Some(transcript) = &self.transcript_de_teste {
            return crate::agy_recovery::completed_answer_step_in(transcript, self.last_provider_step);
        }
        crate::agy_recovery::completed_answer_step(
            self.conversation_id.as_deref()?,
            self.last_provider_step,
        )
    }

    fn recover_answer(&self) -> Vec<AgentEvent> {
        if self.result_seen {
            return Vec::new();
        }
        let Some((_, text)) = self.resposta_no_transcript() else {
            return Vec::new();
        };
        vec![
            AgentEvent::TextDelta { text },
            AgentEvent::TextStop,
            AgentEvent::Notice {
                message: "Recuperei a resposta final no histórico do Agy; as métricas deste trecho não chegaram pela ponte.".to_string(),
            },
        ]
    }

    /// Um `step_update` → eventos. É AQUI que a narração deixa de virar
    /// resposta: o texto sai amarrado ao SEU step, e o step de ferramenta que
    /// vem logo depois entra como cartão entre um texto e outro.
    fn map_step(&mut self, step: &serde_json::Value) -> Vec<AgentEvent> {
        self.stream_position = self.stream_position.saturating_add(1);
        // A ponte voltou a falar: a espera acabou (as tarefas terminaram).
        self.esperando_tarefas = None;
        let step_index = step.get("step_index").and_then(|x| x.as_u64());
        if let Some(step_index) = step_index {
            self.last_provider_step = self.last_provider_step.max(step_index);
        }
        // Texto que já foi para a tela pelo transcript durante a espera.
        let ja_mostrado = matches!(
            (step_index, self.resposta_adiantada),
            (Some(i), Some(adiantada)) if i <= adiantada
        );
        let position = self.stream_position;
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
                if self.response_step.as_deref() != Some(id.as_str()) {
                    self.response_step = Some(id.clone());
                    self.response_step_has_text = false;
                }
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
                        self.response_step_has_text = true;
                        if !ja_mostrado {
                            self.text_open = true;
                            out.push(AgentEvent::TextDelta {
                                text: t.to_string(),
                            });
                        }
                    }
                }
                // Fim do step = fim DESTE bloco de fala. Sem o TextStop a
                // narração do próximo passo colaria no texto anterior — que é
                // exatamente o blob que estamos desfazendo.
                if state != "ACTIVE" && self.text_open {
                    self.text_open = false;
                    out.push(AgentEvent::TextStop);
                }
                if state != "ACTIVE" {
                    // `DONE`, e não "qualquer estado terminal": o agy fecha o
                    // step de resposta em ERROR também (mesma régua do ramo de
                    // ferramenta logo abaixo, que já exige DONE). Aceitar ERROR
                    // aqui invertia o conserto — uma resposta cortada por
                    // rate limit, sem ferramenta nenhuma no turno, virava
                    // "prova de recuperação" e pintava de VERDE um turno que
                    // falhou de verdade. O cartão vermelho mentindo foi o bug
                    // original; o verde mentindo é pior, porque ninguém volta
                    // pra conferir um turno que diz que deu certo.
                    if state == "DONE" && self.response_step_has_text {
                        self.last_completed_response_position = Some(position);
                    }
                    self.response_step = None;
                    self.response_step_has_text = false;
                }
            }
            "tool" => {
                self.last_tool_position = Some(position);
                let info = step.get("tool_info");
                let name = step
                    .get("tool_name")
                    .and_then(|x| x.as_str())
                    .unwrap_or("tool")
                    .to_string();
                if state == "ACTIVE" {
                    // No vocabulário do contrato, não no do agy (ADR-253).
                    let params = info.and_then(|i| i.get("parameters")).cloned().unwrap_or_default();
                    let (name, input) = no_contrato(&name, params);
                    out.push(AgentEvent::Tool { id, name, input, parent_tool_id: None });
                } else {
                    let erro = info.and_then(|i| i.get("error")).filter(|e| !e.is_null());
                    let full = erro
                        .and_then(|e| e.get("message").and_then(|x| x.as_str()))
                        .or_else(|| info.and_then(|i| i.get("output").and_then(|x| x.as_str())))
                        .unwrap_or_default()
                        .to_string();
                    let lines = linhas_do_resultado(&full);
                    let mut text: String = full.chars().take(600).collect();
                    if full.chars().count() > 600 {
                        text.push('…');
                    }
                    let bg_task = parse_agy_background_task(&full)
                        .or_else(|| parse_claude_background_task(&full));
                    out.push(AgentEvent::ToolResult {
                        id: id.clone(),
                        ok: (state == "DONE" || bg_task.is_some()) && erro.is_none(),
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
                    if let Some((task_id, output_file)) = bg_task {
                        out.push(AgentEvent::DeferredWork {
                            id: task_id,
                            tool_use_id: Some(id.clone()),
                            kind: Some(DeferredKind::Terminal),
                            name: None,
                            status: DeferredStatus::Running,
                            summary: None,
                            output_file: Some(output_file),
                            progress: None,
                        });
                    }
                }
            }
            "user_input" | "system_message" => {
                let text = step
                    .get("text_delta")
                    .and_then(|x| x.as_str())
                    .or_else(|| step.get("message").and_then(|x| x.as_str()))
                    .or_else(|| step.pointer("/message/content").and_then(|x| x.as_str()));
                if let Some(t) = text {
                    if let Some(ev) = parse_agy_task_notification(t).or_else(|| parse_task_notification(t)) {
                        out.push(ev);
                    }
                }
            }
            // checkpoint / unknown: nenhum cartão.
            // (O `unknown` aqui é step_type do PRÓPRIO agy, não linha
            // desconhecida — a linha foi entendida, o step é que não pinta nada.)
            _ => {}
        }
        out
    }

    /// O `result` fecha o turno. Duas armadilhas medidas em 14/08/2026:
    /// `response` é a concatenação narração+resposta (não usamos), e `usage` é
    /// o ACUMULADO DA CONVERSA (ADR-033) — o que sai daqui é o DELTA.
    /// AUTO-COMPACTAÇÃO do agy → linha no fio.
    ///
    /// Descoberta no binário 1.1.19 (24/08/2026): há o protobuf
    /// `exa.jetski_cortex_pb.CompactionInfo`, o campo serializado
    /// `json:"compaction_info,omitempty"` e o cabeçalho de prompt
    /// `# Resuming from a compaction`. Ou seja, o agy compacta sozinho, como o
    /// claude e o codex.
    ///
    /// Isto era INVISÍVEL: o claude avisava (`compact_boundary`, ADR-015) e os
    /// outros dois não. Mesma família de defeito do `enforcement` antes do
    /// sandbox — um motor tem o sinal, os outros não, e a diferença não aparece.
    ///
    /// Aceita as duas grafias porque o campo vem de protobuf (snake) mas o
    /// serializador pode emitir camel; checar só uma seria apostar na versão.
    /// UMA vez por run: o `compaction_info` acompanha os steps seguintes, e
    /// repetir viraria eco a cada linha.
    fn aviso_de_compactacao(&mut self, step: &serde_json::Value) -> Vec<AgentEvent> {
        if self.avisou_compactacao {
            return vec![];
        }
        // agy 1.2.4 (medido 16/09/2026, fixtures em testdata/agy-1.2.4): a
        // compactação chega como step `checkpoint` DONE SEM `usage` (12 a 15s,
        // é o resumidor), e a resposta seguinte cai de ~255 mil para ~22 mil.
        // O `checkpoint` auxiliar de versões anteriores trazia `usage` de ~120
        // tokens e não derrubava nada; ele não avisa.
        let kind = step.get("step_type").and_then(|x| x.as_str()).unwrap_or("");
        let done = step.get("state").and_then(|x| x.as_str()) == Some("DONE");
        if kind == "checkpoint" && done && step.get("usage").is_none() {
            self.compactacao_pendente = Some(self.context_tokens);
            return vec![];
        }
        if kind == "agent_response" && done {
            if let Some(antes) = self.compactacao_pendente {
                let depois = step
                    .get("usage")
                    .map(|u| usage_u64(Some(u), "input_tokens") + usage_u64(Some(u), "cache_read_tokens"))
                    .unwrap_or(0);
                if depois > 0 {
                    self.compactacao_pendente = None;
                    // Sem queda não houve resumo: nada se afirma.
                    if antes > 0 && depois >= antes {
                        return vec![];
                    }
                    self.avisou_compactacao = true;
                    return vec![aviso_agy_compactou(Some(antes).filter(|a| *a > 0), Some(depois))];
                }
            }
        }
        let tem = ["compaction_info", "compactionInfo"]
            .iter()
            .any(|k| step.get(*k).is_some_and(|v| !v.is_null()));
        if !tem {
            return vec![];
        }
        self.avisou_compactacao = true;
        vec![aviso_agy_compactou(None, None)]
    }

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
        let provider_failed = result.get("status").and_then(|x| x.as_str()) == Some("ERROR");
        // `ERROR` + resposta final utilizável posterior à última ferramenta
        // significa "concluído com aviso". O contrato normalizado ainda é
        // booleano, então ele sai `ok: true`; a falha local NÃO some: já foi
        // emitida como ToolResult(false) no Fio Vivo. Isso também neutraliza o
        // ERROR antigo que o agy repete nos próximos `--conversation`.
        let recovered_with_answer = provider_failed && self.completed_answer_after_last_tool();
        let ok = !provider_failed || recovered_with_answer;
        let mut out = Vec::new();
        if self.text_open {
            self.text_open = false;
            out.push(AgentEvent::TextStop);
        }
        // Checkpoint de compactação sem resposta depois (turno caiu logo após o
        // resumo): o fato aconteceu, só não há medida do depois.
        if self.compactacao_pendente.take().is_some() && !self.avisou_compactacao {
            self.avisou_compactacao = true;
            out.push(aviso_agy_compactou(None, None));
        }
        if self.context_tokens > 0 {
            out.push(AgentEvent::ContextUsage {
                tokens: self.context_tokens,
                window_tokens: None,
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
            reported_cost_total: None,
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

    fn cli_prompt_contract(&self) -> CliPromptContract {
        CliPromptContract::AfterFlagBeforeTrailingArgs("-p")
    }

    fn build_command(&mut self, req: &RunRequest) -> Result<Command, String> {
        let mut cmd = Command::new("agy");
        // Não herdar canal de um processo que tenha iniciado o próprio app.
        cmd.env_remove(crate::work_gateway::SOCK_ENV);
        if !matches!(req.permission, Permission::FusionRo) {
            if let Some(gateway) = &req.work_gateway {
                cmd.env(crate::work_gateway::SOCK_ENV, &gateway.socket);
            }
        }
        // "Planejar primeiro" no agy é EMULAÇÃO POR PROMPT + --sandbox, sem
        // garantia dura: o `--mode plan` é CONSULTIVO e FUROU no teste de
        // 2026-07 (agy 1.1.2) → NÃO usamos --mode plan.
        //
        // REVALIDADO em 21/08/2026 na 1.1.17, com os dois lados medidos:
        //   `agy --mode plan -p "crie o arquivo X"`   → CRIOU o arquivo
        //   prefixo de prompt + --sandbox (o daqui)   → não criou
        // O próprio agy explicou: "como você utilizou o comando /plan mas
        // solicitou execução imediata, os artefatos de planejamento foram
        // gerados retroativamente" — executa e documenta depois. O caminho que
        // PARECE mais fraco segura melhor que o modo nativo do motor.
        //
        // A recusa está registrada COM VERSÃO em lib/agentModes.ts
        // (`naoAdotado`), então ela vence sozinha quando o binário mudar e o
        // sino volta a pedir o teste. Melhor esforço documentado; o gate real
        // de execução é o nosso, na UI.
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
                self.conversation_id = (!cid.is_empty()).then_some(cid.clone());
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
            ("step_update", Some(step)) => {
                let mut out = self.aviso_de_compactacao(step);
                out.extend(self.map_step(step));
                out
            }
            ("result", Some(result)) => {
                self.result_seen = true;
                self.map_result(result)
            }
            // `command_result` (resposta de `/comando` nativo, ex. `/credits`)
            // e qualquer evento novo: surfaça em vez de descartar.
            _ => {
                if let Some(text) = user_message_text(v) {
                    if let Some(ev) = parse_agy_task_notification(&text).or_else(|| parse_task_notification(&text)) {
                        return vec![ev];
                    }
                }
                vec![AgentEvent::Unknown { raw: v.clone() }]
            }
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
        // extra_dirs sem conflito. Uma por pasta de anexo (ADR-192).
        for dir in pastas_dos_anexos(atts) {
            cmd.arg("--add-dir").arg(dir);
        }
        prompt.push_str("\n\nArquivos anexados (abra-os antes de responder):\n");
        for (a, rotulo) in atts.iter().zip(crate::attachments::imagem_no_texto::rotulos(atts)) {
            prompt.push_str(&format!("- {rotulo}`{}` ({})\n", a.path, a.mime));
        }
    }

    /// EOF sem `result` (processo morto, timeout do `--print-timeout`): fecha o
    /// bloco de texto aberto pra bolha não ficar pendurada.
    fn on_close(&mut self) -> Vec<AgentEvent> {
        let mut out = Vec::new();
        if self.text_open {
            self.text_open = false;
            out.push(AgentEvent::TextStop);
        }
        out.extend(self.recover_answer());
        out
    }

    fn on_cancel(&mut self) -> Vec<AgentEvent> {
        self.recover_answer()
    }

    fn on_stderr_line(&mut self, line: &str) -> Vec<AgentEvent> {
        let Some(tarefas) = agy_tarefas_em_espera(line) else {
            return Vec::new();
        };
        self.esperando_tarefas = Some(tarefas);
        let achada = self.buscar_resposta_adiantada();
        self.adiantar_resposta(achada)
    }

    /// O aviso de espera pode chegar antes de o transcript gravar a resposta:
    /// enquanto a espera durar e nada tiver sido mostrado, a batida tenta de novo.
    fn on_heartbeat(&mut self) -> Vec<AgentEvent> {
        if self.esperando_tarefas.is_none() || self.resposta_adiantada.is_some() {
            return Vec::new();
        }
        let achada = self.buscar_resposta_adiantada();
        if achada.is_none() {
            return Vec::new();
        }
        self.adiantar_resposta(achada)
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

/// Modelo default do Codex, lido de `(CODEX_HOME ou ~/.codex)/config.toml`. O
/// stream do `codex exec --json` NÃO expõe o modelo (medido 17/08/2026: nenhum
/// evento carrega o campo), então esta é a fonte mais robusta que existe p/
/// custo — mas só quando o arquivo REALMENTE diz. `None` = não achou (sem
/// `CODEX_HOME`/`HOME`, sem arquivo, sem parse, ou sem a chave `model`); antes
/// disso caía num "gpt-5.5" chutado, um dólar atribuído a um modelo que
/// ninguém confirmou. Sem fonte, sem preço — mesma doutrina do ADR-047.
fn codex_config_model() -> Option<String> {
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
}

/// Modelo usado p/ ESTIMAR o custo do Codex (ele nunca reporta USD): o
/// requisitado no envio vence; sem ele, o default do `~/.codex/config.toml`;
/// sem os dois, `None` — nunca um chute. Mesma regra dos dois transportes
/// (`exec` e app-server).
pub fn codex_cost_model(requested: Option<&str>) -> Option<String> {
    requested.map(str::to_string).or_else(codex_config_model)
}

#[cfg(test)]
#[path = "adapters_claude_tail_tests.rs"]
mod claude_tail_tests;
#[cfg(test)]
#[path = "adapters_claude_inventory_tests.rs"]
mod claude_inventory_tests;
#[cfg(test)]
#[path = "adapters_opencode_stream_tests.rs"]
mod opencode_stream_tests;
#[cfg(test)]
#[path = "adapters_claude_titulo_tests.rs"]
mod claude_titulo_tests;

#[cfg(test)]
#[path = "adapters_tests.rs"]
mod tests;
#[cfg(test)]
#[path = "adapters_claude_tests.rs"]
mod claude_tests;
#[cfg(test)]
#[path = "adapters_codex_tests.rs"]
mod codex_tests;
#[cfg(test)]
#[path = "adapters_agy_tests.rs"]
mod agy_tests;
#[cfg(test)]
#[path = "adapters_agy_stream_tests.rs"]
mod agy_stream_tests;
#[cfg(test)]
#[path = "adapters_agy_stream2_tests.rs"]
mod agy_stream2_tests;
#[cfg(test)]
#[path = "adapters_imagem_tests.rs"]
mod imagem_tests;
