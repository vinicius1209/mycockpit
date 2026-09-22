import type { AgentModelOption } from "./curatedModels"

export interface AgentDef {
  id: string
  /** Rótulo longo ("Claude Code"), TitleBar, MessageList, DESTINATIONS, liga. */
  label: string
  /** Rótulo curto ("Claude"), candLabel do Fusion (desambigua repetidos). */
  shortLabel: string
  kind: "agent" | "model"
  available: boolean
  hint?: string
  /** Descrição curta (linha secundária no seletor rico). */
  description?: string
  /** Capacidade de anexo. ⚠️ FONTE DUPLICADA: o gate REAL é
   *  `supports_attachment` no trait Rust (adapters.rs) — é ele que decide o que
   *  o agent recebe. Este espelho existe porque a UI precisa validar o anexo
   *  ANTES do envio (chip vermelho, bloqueio). Mexeu num, mexa no outro: ligar
   *  só o Rust faz o front bloquear o que o backend aceitaria (e vice-versa,
   *  pior: o chip promete e o anexo é descartado no spawn). */
  caps: { image: boolean; pdf: boolean }
  /** Opções de modelo (vazio = agent sem flag de modelo). 1ª = "default". */
  models: AgentModelOption[]
  /** Opções de effort (vazio = sem flag). 1ª = "default". */
  efforts: AgentModelOption[]
  /** Modelo pré-selecionado (o default observado). null = "default". */
  defaultModel: string | null
  // -- Espelho TS das Capabilities do Rust (adapters.rs, G1.2 do
  // capability-registry-plan). COMPORTAMENTO genérico da UI consulta estes
  // campos; o id do agent fica só pra identidade visual (logo/selo). Na
  // dúvida, false/null: degradação honesta, nunca prometer o que não sabe. --
  /** O CLI interpreta `/comando` nativamente: comando de fonte PRÓPRIA viaja
   *  cru; qualquer outra combinação expande app-side (lib/slashCommands). */
  nativeSlash: boolean
  /** Fonte NATIVA de comandos "/" deste motor (valor de SlashCommand.source).
   *  null = motor sem convenção própria (só a casa .frota/commands). */
  nativeCommandSource: string | null
  /** Sufixo do empty-state do "/" citando a convenção nativa (copy pt-BR,
   *  inclui a pontuação final). null = a frase da casa termina em ponto. */
  slashEmptyExtra: string | null
  /** O CLI tem canal SYSTEM são por-run (espelho de `system_channel`, H1 do
   *  prompt-hygiene-plan): doutrina/persona viajam pelo canal, re-enviadas a
   *  cada spawn, NUNCA no corpo do prompt. Teste-gêmeo: agents.channels.test.ts
   *  ↔ `matriz_de_canais_por_agent` no Rust. */
  systemChannel: boolean
  /** Retoma sessão nativa (espelho de `session_resume`). false = todo turno é
   *  sessão fresca → memória sintética no prompt (transcript.ts) e doutrina em
   *  todo turno (doctrine.ts). Decide COMPORTAMENTO no lugar de `id === "agy"`
   *  (H5: agnóstico de nome). */
  sessionResume: boolean
  /** Recebe o MCP read-only `frota-context` (espelho de `context_mcp`). false =
   *  handoff degrada pra ponteiros de ARQUIVO (leitura direta), sem prometer
   *  um MCP que o motor não alcança. */
  contextMcp: boolean
  /**
   * O motor confina por conta PRÓPRIA nos modos de escrita zero (espelho de
   * `sandbox_proprio`). Decide se o envelope `sandbox-exec` da Frota entra, e
   * decide QUAL frase de garantia a tela mostra.
   *
   * # O bug que este campo existe pra matar (04–09/09/2026)
   *
   * O Codex aplica Seatbelt por dentro, `(deny default)` a cada comando. Com o
   * envelope da Frota por fora, macOS recusa o perfil de dentro — e o de dentro
   * é o que executa. `pwd` e `cat` morriam com `sandbox_apply: Operation not
   * permitted` (exit 71). Uma automação agendada rodou cega três vezes, gastou
   * US$ 1,16 e gravou `ok` nas três.
   *
   * - `nenhum` → não confina; o envelope da Frota é a única garantia.
   * - `melhorEsforco` → DIZ confinar e emudece em vez de falhar (agy, fase 0
   *   do sandbox-plan). Não conta: o envelope continua valendo.
   * - `sistemaOperacional` → garantia MEDIDA. Dispensa o envelope, e dispensar
   *   é correção, não otimização.
   *
   * Teste-gêmeo: `agents.sandbox.test.ts` ↔ `contrato_capabilities_x_comportamento_por_agent`.
   */
  sandboxProprio: "nenhum" | "melhorEsforco" | "sistemaOperacional"
  /** Canal de planos/processos; cadastro global é confirmado pelo backend. */
  workMcp: boolean
  workMcpGlobalEnv: boolean
  /** Onde a config de MCP deste motor mora (espelho de `McpEscopo` no Rust).
   *  Só `por-run` aceita binding por projeto; é por este eixo que a tela diz
   *  por onde o navegador da Frota chega a cada motor (ADR-224).
   *  Teste-gêmeo: `agents.mcpEscopo.test.ts` ↔ `matriz_mcp_escopo_por_agent`. */
  mcpEscopo: "por-run" | "por-projeto" | "global" | "nenhum"
  /** Pode disputar no Fusion: entra como complementar da liga default. O agy
   *  fica de fora porque o read-only dele é best-effort (candidato
   *  especulativo precisa de confinamento real, ADR do FusionRo). */
  disputes: boolean
  /** O stdout do CLI é um STREAM ESTRUTURADO de eventos, não texto corrido
   *  (espelho de `structured_output`, adapters.rs). false = a linha crua é fala
   *  do assistente e NÃO existe evento por ferramenta: a superfície que
   *  narraria "ação a ação" troca de componente e declara a ignorância em vez
   *  de inventar verbo ("preparando…"). Quem lê decide COMPORTAMENTO
   *  (lib/missionQuiet), nunca `id === "agy"`. Teste-gêmeo:
   *  agents.telemetry.test.ts ↔ `matriz_telemetria_por_agent` no Rust. */
  structuredOutput: boolean
  /** O motor entrega o custo do turno em DÓLAR (espelho de `reports_cost`,
   *  adapters.rs → CostSource::Reported). false = o número, quando existe, é
   *  ESTIMADO por tokens; e quando o motor também não reporta tokens
   *  (`cumulativeUsage` false + `structuredOutput` false) não existe custo
   *  nenhum, nem como estimativa: a tela diz "não mede", nunca zero.
   *  Teste-gêmeo: agents.telemetry.test.ts ↔ `matriz_telemetria_por_agent`. */
  reportsCost: boolean
  /** O usage do fim de turno vem ACUMULADO da thread, não do turno (espelho
   *  de `cumulative_usage`, ADR-033). O runner já normaliza para delta antes
   *  do evento chegar aqui; a UI consulta isto só pra saber de QUAL motor o
   *  histórico gravado ANTES da correção está superestimado (a manutenção de
   *  Configurações). Teste-gêmeo: agents.usage.test.ts ↔
   *  `matriz_cumulative_usage_por_agent` no Rust. */
  cumulativeUsage: boolean
  /** O CLI compacta a PRÓPRIA sessão em modo headless (espelho de
   *  `native_compact`, §7.1): o builtin /compactar manda um turno técnico com
   *  o texto literal "/compact" via resume. false = renovação de sessão com
   *  recap (transplante para si, lib/compact). Teste-gêmeo:
   *  agents.compact.test.ts ↔ `matriz_native_compact_por_agent` no Rust. */
  nativeCompact: boolean
  /** Fonte da JANELA DE USO do plano (% usado + reset — espelho de
   *  `usage_window`, adapters.rs): "statusline" = PUSH (o script instalado
   *  posta pro receptor local a cada turno), "rpc" = POLL (probe read-only do
   *  app-server), "print" = POLL (sonda headless pelo modo print do próprio
   *  CLI). null = motor sem fonte auditada → a UI some com pill/toggle (4
   *  camadas do Orca), nunca inventa percentual. Gêmeo:
   *  agents.usageWindow.test.ts ↔ `matriz_usage_window_por_agent` no Rust. */
  usageWindow: "statusline" | "rpc" | "print" | null
  /** Dialeto que o POLL do vigia usa pra PERGUNTAR a janela agora (espelho de
   *  `usage_window_poll`): "oauth" = leitura da conta do provider, "rpc" =
   *  probe read-only do CLI, "print" = o CLI em modo print respondendo um
   *  comando de cliente. null = só recebe push, nada a perguntar. Separado de
   *  `usageWindow` porque divergiram no claude: lá se INSTALA a statusline,
   *  mas ela só roda em sessão interativa e o app é headless, então quem
   *  alimenta o medidor é a conta. Lê: duePollAgents. Gêmeo no Rust. */
  usagePoll: "oauth" | "rpc" | "print" | null
  /** Emite eventos de ciclo de vida a scripts externos (espelho de
   *  `hooks_status`, hooks-plan H1): habilita a instalação de hooks em
   *  Configurações e a presença de sessões EXTERNAS no Painel/tray. false =
   *  o card nem mostra a opção; o watchdog segue existindo pra todos.
   *  Teste-gêmeo: agents.hooks.test.ts ↔ `matriz_de_hooks_por_agent`. */
  hooksStatus: boolean
  /** O prompt de permissão do CLI pode ser decidido por hook SÍNCRONO
   *  (espelho de `hooks_permission`, hooks-plan H2): a pendência aparece na
   *  UI/Companion e a decisão volta pro terminal. Timeout ⇒ ask (o prompt
   *  nativo aparece lá — nunca allow fantasma nem deny fabricado). */
  hooksPermission: boolean
  /** Dialeto de instalação/protocolo dos hooks (espelho de `hook_dialect`,
   *  adapters.rs). Consumido só como identidade informativa na UI (o merge
   *  real é do Rust). null = motor sem hooks. */
  hookDialect: "claude-settings" | "codex-hooks-json" | "agy-config-hooks" | null
  /** Fonte VIVA de lista de modelos do próprio CLI (espelho de `lists_models`,
   *  M1 do model-autonomy-plan): "agy-models" = subcomando `agy models`,
   *  "codex-app-server" = `model/list` no canal RPC read-only. null = o CLI
   *  não sabe se listar, e a lista curada daqui + o catálogo (models.dev)
   *  seguem sendo a fonte — degradação honesta, nunca sonda inventada.
   *  Quem lê decide o COMPORTAMENTO: slug que a fonte viva não conhece não é
   *  proposto, e slug aposentado vira estado explicado (o codex entrega a
   *  aposentadoria por escrito), nunca sumiço silencioso. Teste-gêmeo:
   *  agents.modelList.test.ts ↔ `matriz_lista_de_modelos_por_agent` no Rust. */
  listsModels: "agy-models" | "codex-app-server" | "opencode-models" | null
  /** Dialeto da FUMAÇA DE UM TOKEN (espelho de `model_smoke`, M2 do
   *  model-autonomy-plan): dá pra testar um slug neste motor com uma chamada
   *  mínima e ler o desfecho (ok · auth-rejected · unknown-slug ·
   *  context-mismatch · unreachable). null = motor sem forma de testar, e o
   *  candidato continua indo pro humano decidir. A fumaça é a ÚNICA coisa que
   *  gasta quota de propósito: só roda por gesto ou agenda, nunca em laço nem
   *  no boot (o freio vive no Rust, model_smoke.rs). Teste-gêmeo:
   *  agents.modelSmoke.test.ts ↔ `matriz_fumaca_de_modelo_por_agent`. */
  modelSmoke: "claude-print-json" | "codex-exec-json" | "agy-print-json" | "opencode-run-json" | null
  /** Aceita id de modelo DIGITADO, fora da lista ("Modelo custom…" no
   *  seletor). Teste-gêmeo: agents.modeloLivre.test.ts ↔
   *  `matriz_modelo_livre_por_agent`. */
  modeloLivre: boolean
}
