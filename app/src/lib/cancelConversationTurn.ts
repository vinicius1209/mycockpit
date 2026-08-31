import { cancelLinearTurn } from "@/lib/cancelLinearTurn"
import { useFusion } from "@/store/fusion"

/** Cancela o trabalho efetivo da conversa, inclusive disputa sem runId. */
export async function cancelConversationTurn(convId: string): Promise<boolean> {
  const fusion = useFusion.getState().byConv[convId]
  if (fusion && (fusion.phase === "running" || fusion.phase === "judging")) {
    useFusion.getState().abort(convId)
    return true
  }
  await cancelLinearTurn(convId)
  return false
}
