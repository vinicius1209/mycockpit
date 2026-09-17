import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"
import { agentDef } from "@/lib/agents"
import type { ToolEnforceability, ToolScope } from "@/lib/tooling"
import type {
  ResourceEvidence,
  ResourceKind,
  ResourceOwner,
} from "@/lib/resources"

export type McpHealthStatus =
  | "unchecked"
  | "healthy"
  | "auth-delegated"
  | "auth-required"
  | "unavailable"

export type McpEscopo = "por-run" | "por-projeto" | "global" | "nenhum"
export type CliInstallation = "enabled" | "disabled" | "absent" | "unknown"

export {
  mcpAgentUtilizavel, gestoDaLinha, rotuloDaAcao, consequenciaDaAcao,
  mcpAgentStatusLabel, CONSEQUENCIA_ESCOPO_GLOBAL, CONSEQUENCIA_ESCOPO_PROJETO,
  type GestoDaLinha,
} from "./mcpAgentActions"

export type McpFallback = "ask" | "deny" | "allow-readonly"

/** Espelho da união tipada do Rust (`McpNativeReason`, mcp_control.rs). Motivo
 *  de a config só funcionar no CLI que a definiu. */
export type McpNativeReason = "oauth" | "stream" | "headers-helper"

export interface McpAgentState {
  /** Id do registry. String de propósito: um adapter novo ou binding órfão
   * continua visível em vez de quebrar o render de uma versão anterior. */
  agent: string
  /** Compatível NATIVAMENTE (portável + capability). Sozinho não decide a
   *  tela: um MCP OAuth é sempre `false` aqui e ainda assim pode ser usado. */
  compatible: boolean
  /** O proxy do app roteia este servidor para este agent porque QUEM
   *  autenticou foi o Frota. Vem do backend (`roteavel_por_proxy`), que é
   *  quem sabe do transporte, do segredo literal e da credencial no Keychain.
   *  Opcional porque estado SERIALIZADO antes desta versão não tem o campo. */
  roteavelPeloApp?: boolean
  /** Este MOTOR aceita MCP gerenciado pelo app (capability `managed_mcp`)?
   *  `false` significa "o Frota não roteia MCP para ele", NUNCA "ele não fala
   *  MCP": o agy fala, tem `agy mcp add` desde a 1.1.13, e o que falta é
   *  escopo por-run (a config dele é global e permanente). */
  roteiaMcpGerenciado?: boolean
  /** Escopo de MCP do motor. Opcional porque estado gravado antes desta versão
   *  não o tem, e aí a linha não oferece gesto nenhum (em vez de chutar). */
  escopo?: McpEscopo
  /** Entrada de mesmo nome/transporte no inventário global. Não é health. */
  cliInstallation?: CliInstallation | null
  enabled: boolean
  required: boolean
  /** Binding marcado para dirigir o navegador do projeto: o plano do run
   *  injeta o endpoint do Chromium que o app possui (B2.2). */
  browser: boolean
  /** Como o MCP recebe o navegador (B4). Ausente em estado gravado antes. */
  browserConexao?: BrowserConexao
  fallback: McpFallback
  health: McpHealthStatus
  detail: string | null
  checkedAt: number | null
  /** Inventário do último `tools/list` que validou esta combinação. */
  toolNames?: string[]
}

export interface McpServer {
  id: string
  name: string
  source: string
  scope: string
  transport: "stdio" | "http" | "internal"
  locator: string
  envKeys: string[]
  sourceAgent: string | null
  sourceEnabled: boolean
  managed: boolean
  portable: boolean
  /** Motivo de a config ser nativa-apenas (OAuth, SSE/WS, helper de header);
   *  null quando não é. Separado de `literalSecret` de propósito: as duas
   *  travas barram o roteamento por causas diferentes. */
  nativeReason: McpNativeReason | null
  /** A config carrega valor literal (env/header/argv/URL) ou expansão do CLI
   *  de origem. Independente de `nativeReason`: pode haver os dois. */
  literalSecret: boolean
  /** O app consegue fazer o login deste servidor: bloco `oauth` declarado OU
   *  HTTP sem credencial na configuração (registro dinâmico, ADR-201). Decide
   *  se o cartão mostra "Entrar". Opcional porque snapshot serializado antes
   *  desta versão não tem o campo, e ausência significa "não sei, não ofereço". */
  loginPeloApp?: boolean
  /** Nome que o servidor assume dentro de um run gerenciado (o que o usuário
   *  cita no prompt). Só vem preenchido quando há binding ativo. */
  runtimeName: string | null
  agentStates: McpAgentState[]
}

export interface McpHealth {
  serverId: string
  agent: string
  status: McpHealthStatus
  detail: string | null
  checkedAt: number
  toolCount: number
  toolNames: string[]
}

export type ProviderMcpInventoryEvidence =
  | "structured"
  | "summary"
  | "opaque"
  | "unavailable"

export interface ProviderMcpServer {
  name: string
  enabled: boolean
  transport: string | null
  scope: ToolScope
  /** Recursos reconhecidos pelo catálogo de integrações. Vazio não prova que
   * a fonte não acessa recursos; pode apenas não estar classificada. */
  resourceKinds: ResourceKind[]
  resourceOwner: ResourceOwner
  resourceEvidence: ResourceEvidence
}

export interface ProviderMcpInventory {
  agent: string
  evidence: ProviderMcpInventoryEvidence
  enforceability: ToolEnforceability
  defaultScope: ToolScope
  servers: ProviderMcpServer[]
  detail: string | null
}

export interface McpDiscovery {
  servers: McpServer[]
  providerInventories: ProviderMcpInventory[]
}

export async function discoverMcpServers(
  projectPath: string,
  options?: { force?: boolean },
): Promise<McpDiscovery> {
  if (!isTauri()) return { servers: [], providerInventories: [] }
  return invoke<McpDiscovery>("discover_mcp_servers", {
    projectPath,
    force: options?.force,
  })
}

/** Formas de um MCP se conectar ao navegador do projeto (espelho de
 *  `browser_conexao.rs`). A flag é o que diferencia, não o nome do MCP. */
export type BrowserConexao = "cdp-endpoint" | "browser-url" | "ws-endpoint"

export const CONEXOES_DO_NAVEGADOR: { value: BrowserConexao; label: string; title: string }[] = [
  { value: "cdp-endpoint", label: "--cdp-endpoint", title: "Endereço http do navegador em --cdp-endpoint" },
  { value: "browser-url", label: "--browserUrl", title: "Endereço http do navegador em --browserUrl" },
  { value: "ws-endpoint", label: "--wsEndpoint", title: "WebSocket do navegador em --wsEndpoint" },
]

export async function setMcpBinding(input: {
  projectPath: string
  serverId: string
  agent: string
  enabled: boolean
  required: boolean
  fallback: McpFallback
  browser: boolean
  browserConexao?: BrowserConexao
}): Promise<void> {
  if (!isTauri()) return
  await invoke("set_mcp_binding", input)
}

export interface McpBindingsSummaryEntry {
  projectId: string
  count: number
}

/** Contagem de bindings por projeto (fonte única: tabela mcp_bindings). */
export async function mcpBindingsSummary(): Promise<McpBindingsSummaryEntry[]> {
  if (!isTauri()) return []
  return invoke<McpBindingsSummaryEntry[]>("mcp_bindings_summary")
}

/** Rótulo do projeto no seletor: anexa a contagem quando há bindings
 *  (ex.: "viniciusmachado · 2"), pra responder "cadê meus toggles?". */
export function mcpProjectOptionLabel(name: string, count: number): string {
  return count > 0 ? `${name} · ${count}` : name
}

/** Escopo inicial do painel MCP: o projeto ativo da sidebar quando existe,
 *  senão o primeiro da lista. Nunca inventa um id fora da lista. */
export function initialMcpProjectId(
  projects: { id: string }[],
  activeProjectId: string | null,
): string | null {
  if (activeProjectId && projects.some((p) => p.id === activeProjectId)) {
    return activeProjectId
  }
  return projects[0]?.id ?? null
}

export async function checkMcpServer(input: {
  projectPath: string
  serverId: string
  agent: string
}): Promise<McpHealth> {
  return invoke<McpHealth>("check_mcp_server", input)
}

/** Patch imutável de um estado de agent dentro da lista de servidores.
 *  Base do toggle otimista: o mesmo helper aplica e reverte. */
export function applyAgentPatch(
  servers: McpServer[],
  serverId: string,
  agent: McpAgentState["agent"],
  patch: Partial<
    Pick<
      McpAgentState,
      | "enabled"
      | "required"
      | "browser"
      | "browserConexao"
      | "fallback"
      | "health"
      | "detail"
      | "checkedAt"
      | "toolNames"
    >
  >,
): McpServer[] {
  return servers.map((server) =>
    server.id === serverId
      ? {
          ...server,
          agentStates: server.agentStates.map((state) =>
            state.agent === agent ? { ...state, ...patch } : state,
          ),
        }
      : server,
  )
}

/** Otimismo com verdade no fim: aplica o patch na hora, confirma em silêncio
 *  no sucesso e, no erro, reverte e explica o motivo. Retorna se confirmou. */
export async function optimisticBindingUpdate(opts: {
  apply: () => void
  revert: () => void
  commit: () => Promise<void>
  onError: (message: string) => void
}): Promise<boolean> {
  opts.apply()
  try {
    await opts.commit()
    return true
  } catch (cause) {
    opts.revert()
    opts.onError(cause instanceof Error ? cause.message : String(cause))
    return false
  }
}

export interface McpPortabilityNotice {
  /** `native-only` é fato estrutural (nada a corrigir no arquivo);
   *  `literal-secret` é pendência do usuário (migrar o valor). */
  kind: "native-only" | "literal-secret"
  text: string
}

const NATIVE_CAUSE: Record<McpNativeReason, string> = {
  oauth:
    "Login próprio do CLI (OAuth): o token fica no keychain de quem autenticou, então não dá pra rotear pra outro agent.",
  stream:
    "Transporte SSE/WebSocket: a sessão é mantida pelo CLI de origem, o Frota não a repassa pra outro agent.",
  "headers-helper":
    "Cabeçalho gerado por um helper do CLI de origem: o comando roda dentro dele e a credencial não viaja.",
}

const NATIVE_REMEDY: Record<McpNativeReason, string> = {
  oauth: "nos demais, autentique por lá",
  stream: "nos demais, use um endpoint HTTP MCP",
  "headers-helper":
    "nos demais, troque o helper por referência de ambiente (${VAR})",
}

/** Onde a config JÁ funciona nativa. Quando a origem não é de um agent
 *  conhecido (ex.: `.mcp.json` do projeto, lido por quem passar), não inventa
 *  nome: diz que segue valendo no CLI que fez o login. */
function nativeOrigin(sourceAgent: string | null): string {
  const label = sourceAgent ? (agentDef(sourceAgent)?.label ?? null) : null
  return label
    ? `No ${label} ele já funciona nativo`
    : "Ele segue funcionando no CLI que fez o login"
}

/** Por que este servidor não é roteável, com a copy do motivo CERTO.
 *
 *  A trava é a mesma de sempre (nada passa a ser roteável aqui), o que muda é
 *  parar de descrever tudo como "valor literal": um servidor OAuth sem nenhum
 *  segredo no arquivo recebia uma mensagem falsa e sem saída. Os dois motivos
 *  são independentes e podem aparecer juntos. */
export function mcpPortabilityNotices(
  server: Pick<
    McpServer,
    "managed" | "portable" | "nativeReason" | "literalSecret" | "sourceAgent"
  >,
  /** Há login do MyCockpit neste servidor? Com login, o motivo `oauth` deixa
   *  de valer: quem autentica passa a ser o app, e o proxy roteia pros dois
   *  motores (A2). As demais causas seguem intactas. */
  autenticadoPeloApp = false,
): McpPortabilityNotice[] {
  // MCP interno não é roteável por binding e nunca teve config a comentar.
  if (!server.managed || server.portable) return []
  const notices: McpPortabilityNotice[] = []
  if (autenticadoPeloApp && server.nativeReason === "oauth") {
    if (!server.literalSecret) return []
  } else if (server.nativeReason) {
    const reason = server.nativeReason
    notices.push({
      kind: "native-only",
      text: `${NATIVE_CAUSE[reason]} ${nativeOrigin(server.sourceAgent)}; ${NATIVE_REMEDY[reason]}.`,
    })
  }
  if (server.literalSecret) {
    notices.push({
      kind: "literal-secret",
      text: "Não portável: contém valor literal ou expansão específica do CLI de origem.",
    })
  }
  // Não portável por um motivo que o backend ainda não tipou: diz isso em vez
  // de escolher uma causa qualquer.
  if (notices.length === 0) {
    notices.push({
      kind: "literal-secret",
      text: "Não portável: esta configuração não pode ser roteada para outro agent.",
    })
  }
  return notices
}

// ---- login do app (A1) -----------------------------------------------------

/** Espelho de `McpAuthState` (mcp_auth.rs). Quem autenticou é o MyCockpit, não
 *  o CLI de origem. */
export type McpAuthState = "sem-login" | "conectado" | "expirado"

export interface McpAuthStatus {
  serverId: string
  state: McpAuthState
  /** Só metadado (epoch em segundos). O token nunca chega ao frontend. */
  expiresAt: number | null
  scope: string | null
  /** `false` quando o servidor de autorização não expõe revogação: "Sair"
   *  apaga a credencial deste Mac, mas não derruba a sessão lá. */
  revogavel: boolean
}

export async function mcpOauthStatus(
  projectPath: string,
  serverId: string,
): Promise<McpAuthStatus | null> {
  if (!isTauri()) return null
  return invoke<McpAuthStatus>("mcp_oauth_status", { projectPath, serverId })
}

export async function mcpOauthLogin(
  projectPath: string,
  serverId: string,
): Promise<McpAuthStatus> {
  return invoke<McpAuthStatus>("mcp_oauth_login", { projectPath, serverId })
}

/** Devolve a frase do que REALMENTE aconteceu (revogou ou só apagou local). */
export async function mcpOauthLogout(
  projectPath: string,
  serverId: string,
): Promise<string> {
  return invoke<string>("mcp_oauth_logout", { projectPath, serverId })
}

// Sem "pelo Frota": dentro do Frota isso é implícito, e repetido em cada
// linha virava ruído (pedido do usuário, 16/09/2026).
const AUTH_LABEL: Record<McpAuthState, string> = {
  "sem-login": "sem login",
  conectado: "conectado",
  expirado: "sessão expirada",
}

/** Rótulo do estado do login. Nunca diz "conectado" por otimismo: o backend só
 *  reporta `conectado` com token válido de verdade. */
export function mcpAuthLabel(state: McpAuthState): string {
  return AUTH_LABEL[state]
}

/** O que o botão faz em cada estado. `expirado` volta a ser "Entrar" porque é
 *  isso que resolve, não um "tentar de novo" que esconde o motivo. */
export function mcpAuthActionLabel(state: McpAuthState): string {
  return state === "conectado" ? "Sair" : "Entrar"
}

/** Explicação de uma linha ao lado do botão. Em `conectado` cita o prazo
 *  quando existe, porque "conectado até quando?" é a dúvida seguinte. */
export function mcpAuthHint(
  status: Pick<McpAuthStatus, "state" | "expiresAt">,
  now: number = Date.now(),
): string {
  if (status.state === "sem-login") {
    return "O Frota faz o login e guarda o token no Keychain deste Mac. O agent recebe um proxy local, nunca a credencial."
  }
  if (status.state === "expirado") {
    return "A sessão venceu e não foi possível renovar. Entre de novo."
  }
  if (status.expiresAt === null) {
    return "Sessão ativa. O servidor não informou prazo de validade."
  }
  const restante = Math.round((status.expiresAt * 1000 - now) / 60000)
  if (restante <= 0) return "Sessão ativa, renovando."
  if (restante < 60) return `Sessão ativa, renova em ${restante} min.`
  return `Sessão ativa, renova em ${Math.round(restante / 60)} h.`
}

export function mcpHealthLabel(status: McpHealthStatus): string {
  switch (status) {
    case "healthy":
      return "saudável"
    case "auth-delegated":
      return "alcançável · auth por env"
    case "auth-required":
      return "requer autenticação"
    case "unavailable":
      return "indisponível"
    default:
      return "não testado"
  }
}

// Quem autentica, elegibilidade do login e o resumo do painel moram em
// mcpAuthView.ts (a catraca de tamanho deste arquivo). Mesmo padrão de
// mcpAgentActions.ts: re-export aqui, uma porta só para quem consome.
export { mcpOfereceLogin, mcpQuemAutentica, mcpResumo, type McpResumo } from "./mcpAuthView"
