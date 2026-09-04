import type { AgentEvent } from "@/lib/agent"
import type { McpPreflightGate } from "@/lib/tooling"
import type { ConvState } from "@/store/chat"

type ChatSlice = { byId: Record<string, ConvState> }

export function beginPreparationState(
  state: ChatSlice,
  convId: string,
  runId: string,
) {
  const current = state.byId[convId]
  if (!current || current.running || current.finalizing || current.preparing) {
    return {}
  }
  return {
    byId: {
      ...state.byId,
      [convId]: {
        ...current,
        preparing: { runId, startedAt: Date.now() },
        preflightGate: undefined,
      },
    },
  }
}

export function blockPreparationState(
  state: ChatSlice,
  convId: string,
  runId: string,
  gate: McpPreflightGate,
) {
  const current = state.byId[convId]
  if (!current || current.preparing?.runId !== runId) return {}
  return {
    byId: {
      ...state.byId,
      [convId]: {
        ...current,
        preparing: undefined,
        preflightGate: { runId, gate },
      },
    },
  }
}

export function clearPreparationState(
  state: ChatSlice,
  convId: string,
  runId: string,
) {
  const current = state.byId[convId]
  if (!current || current.preparing?.runId !== runId) return {}
  return {
    byId: {
      ...state.byId,
      [convId]: { ...current, preparing: undefined },
    },
  }
}

/** Controle do turno linear. A lane do Fusion deriva o próprio status. */
export function turnControl(event: AgentEvent): Partial<ConvState> {
  switch (event.type) {
    case "result":
      return { running: false, finalizing: true, runId: null, startedAt: null }
    case "error":
    case "cancelled":
      // O evento terminal entra no fio antes do `done` e antes de o processo
      // devolver o controle ao ChatPanel. Até lá a fila ainda não foi drenada:
      // liberar a UI aqui criava o estado impossível "interrompido + fila que
      // será enviada ao terminar". `done` é a única fronteira de repouso.
      return { running: false, finalizing: true, runId: null, startedAt: null }
    case "startup_failed":
      return {
        running: false,
        finalizing: false,
        runId: null,
        startedAt: null,
      }
    case "done":
      return { running: false, finalizing: false, runId: null, startedAt: null }
    default:
      return {}
  }
}
