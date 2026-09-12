import { cancelAgent } from "@/lib/agent"
import {
  marcarCausaDoCorte,
  tomarCausaDoCorte,
  type CausaDoCorte,
} from "@/lib/corte"
import { registrarTurnoCortado } from "@/lib/db/turnoCortado"
import { stopManagedProcessesByConv } from "@/lib/work"
import { useChat } from "@/store/chat"

export type CancelDisposition = "idle" | "signaled" | "reconciled"

/** Para um runner vivo, apenas sinaliza e espera seus eventos terminais. Se o
 * backend já perdeu o run, reconcilia o snapshot local sem fingir que parou um
 * processo que ele não controla mais.
 *
 * `causa` é o gesto humano que pediu o corte. Ela não vira marco aqui: fica
 * carimbada até o `cancelled` do runner chegar (ADR-180), então o fio só diz
 * "você interrompeu" se o turno de fato parou. */
export async function cancelLinearTurn(
  convId: string,
  causa?: CausaDoCorte,
): Promise<CancelDisposition> {
  void stopManagedProcessesByConv(convId).catch(() => {})
  const chat = useChat.getState()
  chat.cancelAutoResume(convId)
  const conv = chat.byId[convId]
  const runId = conv?.runId
  if (!conv || !runId) {
    // Nada a cortar: um carimbo que sobrasse aqui seria atribuído ao próximo
    // corte, de outro gesto.
    tomarCausaDoCorte(convId)
    return "idle"
  }
  if (causa) marcarCausaDoCorte(convId, causa)
  // Processo subiu e consumiu até aqui, e nenhum motor garante usage no corte:
  // a linha entra com custo desconhecido e um `result` tardio a sobrescreve.
  // Durante um revezamento o motor em voo é o destino, nunca o de origem.
  if (conv.running) {
    const pending = conv.pendingTransplant
    void registrarTurnoCortado({
      runId,
      projectId: conv.projectId,
      convId,
      agent: pending?.targetAgent ?? conv.agent,
      model: pending ? (pending.targetModel ?? null) : (conv.model ?? null),
    })
  }
  if (await cancelAgent(runId)) return "signaled"

  if (useChat.getState().byId[convId]?.runId !== runId) {
    tomarCausaDoCorte(convId)
    return "idle"
  }
  await fecharTurnoLocalmente(convId)
  return "reconciled"
}

/** Fecha no fio um turno que nenhum processo vai fechar: a mesma sequência que
 * o runner publicaria (`cancelled`, depois `done`), porque `cancelled` sozinho
 * deixa a conversa em `finalizing` até o `done` (runLifecycle). Serve à
 * reconciliação e à disputa abortada. */
export async function fecharTurnoLocalmente(
  convId: string,
  causa?: CausaDoCorte,
): Promise<void> {
  const chat = useChat.getState()
  chat.handleEvent(
    convId,
    causa ? { type: "cancelled", cause: causa } : { type: "cancelled" },
  )
  chat.handleEvent(convId, { type: "done", code: null })
  chat.finish(convId)
  await chat.persist(convId)
}
