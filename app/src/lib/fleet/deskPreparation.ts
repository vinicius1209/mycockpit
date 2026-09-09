import { toast } from "sonner"
import { comRedeDePreparo } from "@/components/chat/redeDePreparo"
import { perfOperation } from "@/lib/fleet/perf"
import type { DeskSendArgs } from "@/lib/fleet/send"
import type { ConversationMeta } from "@/lib/db/conversations"
import { useChat } from "@/store/chat"

export function newestConversation(
  list: ConversationMeta[],
): ConversationMeta | null {
  return list.reduce<ConversationMeta | null>(
    (best, conversation) =>
      best == null || conversation.updatedAt > best.updatedAt ? conversation : best,
    null,
  )
}

export async function runDeskPreparation(
  args: DeskSendArgs,
  run: (args: DeskSendArgs, runId: string) => Promise<void>,
): Promise<void> {
  const runId = crypto.randomUUID()
  let outcome = "not-accepted"
  const finish = perfOperation("send.desk.preflight")
  const ok = await comRedeDePreparo(
    runId,
    {
      conversas: () => Object.keys(useChat.getState().byId),
      limpar: (convId, currentRun) =>
        useChat.getState().clearPreparation(convId, currentRun),
    },
    (currentRun) =>
      run(
        {
          ...args,
          onAccepted: (accepted) => {
            outcome = accepted
            args.onAccepted?.(accepted)
          },
        },
        currentRun,
      ),
  )
  for (const convId of Object.keys(useChat.getState().byId)) {
    useChat.getState().clearPreparation(convId, runId)
  }
  finish({ outcome: ok ? outcome : "error" })
  if (!ok) toast.error("O turno não começou. O pedido continua disponível.")
}
