import { toast } from "sonner"
import { cancelConversationTurn } from "@/lib/cancelConversationTurn"

/** Stop compartilhado pela Mesa, dock e Companion. */
export async function cancelDeskTurn(convId: string): Promise<void> {
  if (await cancelConversationTurn(convId)) toast("Disputa cancelada")
}
