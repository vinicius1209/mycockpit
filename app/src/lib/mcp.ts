import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"

export type McpHealthStatus =
  | "unchecked"
  | "healthy"
  | "auth-delegated"
  | "auth-required"
  | "unavailable"

export type McpFallback = "ask" | "deny" | "allow-readonly"

export interface McpAgentState {
  agent: "claude-code" | "codex" | "agy"
  compatible: boolean
  enabled: boolean
  required: boolean
  fallback: McpFallback
  health: McpHealthStatus
  detail: string | null
  checkedAt: number | null
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

export async function discoverMcpServers(
  projectPath: string,
): Promise<McpServer[]> {
  if (!isTauri()) return []
  return invoke<McpServer[]>("discover_mcp_servers", { projectPath })
}

export async function setMcpBinding(input: {
  projectPath: string
  serverId: string
  agent: string
  enabled: boolean
  required: boolean
  fallback: McpFallback
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
      "enabled" | "required" | "fallback" | "health" | "detail" | "checkedAt"
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
