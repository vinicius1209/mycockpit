import { toast } from "sonner"
import type { Attachment } from "@/lib/attachments"
import type { AgentDef } from "@/lib/agentDefs"
import {
  buildAdviceItem,
  buildAdvisorPrompt,
  runAdvisor,
} from "@/lib/advisor"
import { serializeContext } from "@/lib/fusion"
import { useChat } from "@/store/chat"

/** Consulta lateral: registra o pedido humano antes do run de leitura e nunca
 * entrega os eventos do conselheiro ao reducer do executor. */
export async function consultAdvisor(
  convId: string,
  def: AgentDef,
  question: string,
  project: { path: string },
  sent: { text: string; attachments: Attachment[] },
) {
  const conversation = useChat.getState().byId[convId]
  const cwd = conversation?.worktreePath ?? project.path
  const context = serializeContext(conversation?.items ?? [])
  await useChat.getState().appendItems(convId, [
    {
      kind: "user",
      id: crypto.randomUUID(),
      text: sent.text,
      attachments: sent.attachments.length ? sent.attachments : undefined,
      advisorTo: { id: def.id, name: def.name },
      ts: Date.now(),
    },
  ])
  useChat.getState().setAdvising(convId, { id: def.id, name: def.name })
  try {
    const prompt = buildAdvisorPrompt({
      def,
      context,
      question,
      attachments: sent.attachments.map((attachment) => attachment.path),
    })
    const result = await runAdvisor({ def, prompt, cwd })
    if (!result.text) {
      toast.error(
        result.error
          ? `O parecer de ${def.name} falhou: ${result.error}`
          : `O parecer de ${def.name} veio vazio.`,
      )
      return
    }
    await useChat
      .getState()
      .appendItems(convId, [buildAdviceItem(def, question, result.text)])
  } catch (error) {
    toast.error(
      typeof error === "string" ? error : `Não consegui consultar ${def.name}.`,
    )
  } finally {
    useChat.getState().setAdvising(convId, null)
  }
}
