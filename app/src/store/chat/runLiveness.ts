/** Diagnóstico efêmero do processo do run. Métrica/sonda não é progresso e,
 * por isso, nunca participa da assinatura do watchdog. */
export interface RunLiveness {
  mainAlive: boolean | null
  descendants: number | null
  rssMb: number | null
  lastByteAt: number | null
  lastEventAt: number | null
  observedAt: number | null
}

export function createInitialRunLiveness(lastEventAt = Date.now()): RunLiveness {
  return {
    mainAlive: null,
    descendants: null,
    rssMb: null,
    lastByteAt: null,
    lastEventAt,
    observedAt: null,
  }
}

export interface RunStatusEventPayload {
  main_alive: boolean | null
  descendants: number | null
  rss_mb: number | null
  last_byte_at: number | null
  observed_at: number | null
}

export function applyRunStatusToLiveness(
  prev: RunLiveness | undefined,
  e: RunStatusEventPayload,
): RunLiveness {
  const base = prev ?? createInitialRunLiveness()
  return {
    ...base,
    mainAlive: e.main_alive,
    descendants: e.descendants,
    rssMb: e.rss_mb,
    lastByteAt: e.last_byte_at,
    observedAt: e.observed_at,
  }
}

export interface LivenessReadableState {
  activeId: string | null
  runLivenessByConv?: Record<string, RunLiveness>
  byId: Record<string, { runLiveness?: RunLiveness }>
}

/** Seletor puro de liveness por conversa (ADR-183). */
export function selectRunLiveness(
  s: LivenessReadableState,
  convId?: string | null,
): RunLiveness | undefined {
  const id = convId ?? s.activeId
  return id ? s.runLivenessByConv?.[id] ?? s.byId[id]?.runLiveness : undefined
}

