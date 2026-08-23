// Espelho TS de `Capabilities.context_usage` no Rust. Separado do registry
// visual porque o arquivo agents.ts está na catraca; a chave continua sendo o
// id canônico e o consumidor pergunta pela capability, nunca por if de nome.

export type ContextUsageSource = "stream" | "codex-rollout"

const SOURCES: Record<string, ContextUsageSource> = {
  "claude-code": "stream",
  codex: "codex-rollout",
  agy: "stream",
}

export function contextUsageSource(agent: string): ContextUsageSource | null {
  return SOURCES[agent] ?? null
}
