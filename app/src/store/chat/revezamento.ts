import { DESTINATIONS } from "@/lib/agents"
import { EMPTY_CONTEXT_SNAPSHOT } from "@/lib/contextSnapshot"
import { comSessaoGuardada } from "@/lib/retomadaDeMotor"
import type { ChatState, ConvState } from "@/store/chat"

type Get = () => ChatState
type Set = (fn: (s: ChatState) => Partial<ChatState>) => void

/**
 * Registra a intenção de revezar o motor desta conversa no próximo envio.
 * Passar `null` ou o mesmo agente cancela o revezamento pendente.
 */
export function stageAgentImpl(
  get: Get,
  set: Set,
  convId: string,
  agent: string | null,
): void {
  const cur = get().byId[convId]
  if (!cur) return
  const next = agent && agent !== cur.agent ? agent : undefined
  set((s) => ({
    byId: { ...s.byId, [convId]: { ...s.byId[convId], stagedAgent: next } },
  }))
}

/**
 * Rótulo do aviso ao preparar ou cancelar o revezamento de motor.
 */
export function avisoDeRevezamento(
  nextStaged: string | null,
  origAgent: string,
): string {
  if (nextStaged) {
    const targetDef = DESTINATIONS.find((d) => d.id === nextStaged)
    return `Revezamento preparado: próximo envio usará ${targetDef?.label ?? nextStaged}`
  }
  const origDef = DESTINATIONS.find((d) => d.id === origAgent)
  return `Revezamento cancelado: mantendo ${origDef?.label ?? origAgent}`
}

/** Confirma o transplante como uma unidade: identidade, sessão e aviso. */
export function commitTransplantState(
  cur: ConvState,
  pending: NonNullable<ConvState["pendingTransplant"]>,
): ConvState {
  const items =
    pending.commitNotice &&
    !cur.items.some(
      (item) =>
        item.kind === "notice" && item.message === pending.commitNotice,
    )
      ? [
          ...cur.items,
          {
            kind: "notice" as const,
            id: crypto.randomUUID(),
            message: pending.commitNotice,
            ts: Date.now(),
          },
        ]
      : cur.items
  return {
    ...cur,
    // R5: a sessão de quem SAI fica guardada. Voltar depois para este motor
    // retoma a conversa que ele já tem, em vez de pagar o transplante de novo.
    sessoesAnteriores: comSessaoGuardada(cur.sessoesAnteriores, cur.agent, {
      sessionId: cur.sessionId,
      model: cur.model,
      items: cur.items,
    }),
    agent: pending.targetAgent,
    reqModel: pending.targetModel ?? null,
    effort: pending.targetEffort ?? null,
    items,
    sessionId: null,
    model: null,
    ...EMPTY_CONTEXT_SNAPSHOT,
    pendingTransplant: undefined,
  }
}

/** Os dois campos de sessão que a linha da conversa grava (a persistência da
 *  conversa é por coluna, não por blob). Sai daqui para o `persist` do store
 *  não crescer de tamanho por causa de um campo novo. */
export function argsDaSessao(
  c: Pick<ConvState, "sessionMode" | "sessoesAnteriores">,
): [string | null, string | null] {
  return [
    c.sessionMode ?? null,
    c.sessoesAnteriores && Object.keys(c.sessoesAnteriores).length
      ? JSON.stringify(c.sessoesAnteriores)
      : null,
  ]
}
