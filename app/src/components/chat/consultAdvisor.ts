import { toast } from "sonner"
import type { Attachment } from "@/lib/attachments"
import { listAgentDefs, type AgentDef } from "@/lib/agentDefs"
import {
  buildAdviceItem,
  buildAdvisorPrompt,
  detectAdvisorMentions,
  resolveAdvisor,
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
  opts: {
    /** O que a bolha do fio mostra. Com dois conselheiros chamados na mesma
     *  mensagem, cada um recebe o trecho dele, e a bolha diz isso. */
    bolha?: string
    /** Anexo aparece UMA vez no fio, mesmo com dois conselheiros: é o mesmo
     *  arquivo, e repetir a miniatura só polui. Os dois prompts recebem. */
    mostrarAnexos?: boolean
    /** Chamado assim que a mensagem ENTRA no fio, não quando o parecer chega:
     *  é esse o momento em que o composer pode limpar (relato de 21/09/2026,
     *  a mensagem ficava no composer enquanto o parecer não voltava). */
    aoAceitar?: () => void
  } = {},
) {
  const conversation = useChat.getState().byId[convId]
  const cwd = conversation?.worktreePath ?? project.path
  const context = serializeContext(conversation?.items ?? [])
  const mostrarAnexos = opts.mostrarAnexos ?? true
  await useChat.getState().appendItems(convId, [
    {
      kind: "user",
      id: crypto.randomUUID(),
      text: opts.bolha ?? sent.text,
      attachments:
        mostrarAnexos && sent.attachments.length ? sent.attachments : undefined,
      advisorTo: { id: def.id, name: def.name },
      ts: Date.now(),
    },
  ])
  opts.aoAceitar?.()
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


/** O desvio inteiro do envio quando há `@persona` no texto: quem foi chamado,
 *  o que cada um recebe e em que ordem. Devolve `true` quando a mensagem virou
 *  consulta (o executor não roda) e `false` quando nenhum `@token` resolveu uma
 *  persona conhecida, caso em que o envio segue o fluxo normal.
 *
 *  Dois conselheiros numa mensagem só entram os DOIS, em sequência: o segundo
 *  parecer enxerga o primeiro no contexto, que é o que uma mesa de conselheiros
 *  tem de útil. Antes de 21/09/2026 só o primeiro era consultado, em silêncio. */
export async function consultarMencionados(entrada: {
  convId: string
  project: { path: string }
  sent: { text: string; attachments: Attachment[] }
  aoAceitar?: () => void
}): Promise<boolean> {
  const { convId, project, sent } = entrada
  // Só custa uma leitura das personas quando há um `@token` (envio comum: zero).
  const defs = await listAgentDefs(project.path)
  const chamados = detectAdvisorMentions(sent.text, defs)
  if (chamados.length === 0) return false

  // Estado FRESCO: o await acima pode ter deixado o snapshot do chamador velho,
  // e um turno pode ter começado nesse meio-tempo.
  const agora = useChat.getState().byId[convId]
  if (agora?.running || agora?.finalizing || agora?.advising) {
    toast("Termine o turno atual antes de pedir um parecer.")
    return true
  }

  // Fail-closed e ANTES de consultar qualquer um: persona sumida ou ilegível
  // cancela o pedido INTEIRO. Meio pedido entregue seria pior que nenhum,
  // porque o fio mostraria uma consulta e esconderia a outra.
  const resolvidos: { def: AgentDef; question: string }[] = []
  for (const chamado of chamados) {
    const achado = await resolveAdvisor(project.path, chamado.def.id)
    if (achado.status === "unreadable") {
      toast.error(`Não consegui ler a persona "${chamado.def.name}" do disco. Tente de novo.`)
      return true
    }
    if (achado.status === "missing") {
      toast.error(`A persona "${chamado.def.name}" não existe mais.`)
      return true
    }
    resolvidos.push({ def: achado.def, question: chamado.question })
  }

  let aceito = false
  for (const [indice, { def, question }] of resolvidos.entries()) {
    await consultAdvisor(convId, def, question, project, sent, {
      // Com mais de um chamado, a bolha mostra o trecho de cada um: é o que
      // ele de fato recebeu.
      bolha: resolvidos.length > 1 ? question : sent.text,
      mostrarAnexos: indice === 0,
      aoAceitar: () => {
        if (aceito) return
        aceito = true
        entrada.aoAceitar?.()
      },
    })
  }
  return true
}
