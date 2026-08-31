import { cancelAgent } from "@/lib/agent"
import { useChat } from "@/store/chat"

export type CancelDisposition = "idle" | "signaled" | "reconciled"

/** Para um runner vivo, apenas sinaliza e espera seus eventos terminais. Se o
 * backend já perdeu o run, reconcilia o snapshot local sem fingir que parou um
 * processo que ele não controla mais. */
export async function cancelLinearTurn(
  convId: string,
): Promise<CancelDisposition> {
  const chat = useChat.getState()
  chat.cancelAutoResume(convId)
  const runId = chat.byId[convId]?.runId
  if (!runId) return "idle"
  if (await cancelAgent(runId)) return "signaled"

  const current = useChat.getState()
  if (current.byId[convId]?.runId !== runId) return "idle"
  current.handleEvent(convId, { type: "cancelled" })
  current.handleEvent(convId, { type: "done", code: null })
  current.finish(convId)
  await current.persist(convId)
  return "reconciled"
}
