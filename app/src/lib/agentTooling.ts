import type { AgentToolingCaps } from "@/lib/tooling"

/** Espelho TS das capabilities de materialização do registry Rust. O mapa é a
 * fronteira por provider; consumidores genéricos recebem somente capabilities. */
const TOOLING_BY_AGENT: Readonly<Record<string, AgentToolingCaps>> = {
  "claude-code": {
    mcpScope: "run",
    nativeToolInventory: "runtime-count",
  },
  codex: { mcpScope: "run", nativeToolInventory: "opaque" },
  agy: { mcpScope: "global", nativeToolInventory: "runtime-count" },
  opencode: { mcpScope: "project", nativeToolInventory: "opaque" },
}

const UNKNOWN_TOOLING: AgentToolingCaps = {
  mcpScope: "none",
  nativeToolInventory: "opaque",
}

/** Provider desconhecido degrada honestamente, sem inferir suporte. */
export function agentToolingCaps(agentId: string): AgentToolingCaps {
  return TOOLING_BY_AGENT[agentId] ?? UNKNOWN_TOOLING
}
