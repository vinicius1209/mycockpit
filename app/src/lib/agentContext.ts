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

/** Espelho de `Capabilities.context_ceiling` (ADR-196): quem diz em que ponto
 *  compacta sozinho. Teste-gêmeo: agents.contextCeiling.test.ts. */
export type ContextCeilingProbe =
  | "claude-control-request"
  | "codex-config-catalog"
  | "agy-generation-record"

const CEILING_PROBES: Record<string, ContextCeilingProbe> = {
  // claude 2.1.270: `get_context_usage` por control_request, sem turno.
  "claude-code": "claude-control-request",
  // codex 0.154.0: config/read + catálogo local, fórmula validada no binário.
  codex: "codex-config-catalog",
  // agy 1.2.4: estimativa e limite gravados a cada geração (ADR-198).
  agy: "agy-generation-record",
}

export function contextCeilingProbe(agent: string): ContextCeilingProbe | null {
  return CEILING_PROBES[agent] ?? null
}
