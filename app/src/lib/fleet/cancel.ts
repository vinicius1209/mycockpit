import { toast } from "sonner"
import { cancelConversationTurn } from "@/lib/cancelConversationTurn"

/** Stop compartilhado pela Mesa, dock e Companion. O corte é gesto seu, e o
 *  marco do corte fica no fio (ADR-180). O toast da disputa continua aqui
 *  porque estas superfícies ficam FORA do fio: nelas ele é o único retorno. */
export async function cancelDeskTurn(convId: string): Promise<void> {
  if (await cancelConversationTurn(convId, "parada")) toast("Disputa cancelada")
}
