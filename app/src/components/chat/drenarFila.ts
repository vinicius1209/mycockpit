// A DRENAGEM da fila: o que você digitou enquanto o agente trabalhava.
//
// Saiu do ChatPanel pela catraca (STYLEGUIDE §10). Recorte fechado: tudo aqui é
// `getState()` mais o `enviar`, que entra como PARÂMETRO — este módulo não
// precisa conhecer o composer.

import {
  expandQueuedForJoin,
  parseSlashInvocation,
  splitQueueForAppCommand,
} from "@/lib/slashCommands"
import { readProjectCommands } from "@/lib/sources"
import { HUMANO } from "@/lib/sendOrigin"
import type { Attachment } from "@/lib/attachments"
import { cancelConversationTurn } from "@/lib/cancelConversationTurn"
import { useChat } from "@/store/chat"

type EnviarFila = (
  texto: string,
  cfg: undefined,
  anexos: Attachment[],
  origem: typeof HUMANO,
  originConvId?: string,
) => unknown

export async function drainQueued(
  convId: string,
  agent: string,
  projectPath: string,
  /** O `handleSend` do ChatPanel. Parâmetro e não import: a fila é do humano,
   *  mas a drenagem não precisa conhecer o composer pra saber disso. */
  enviar: EnviarFila,
): Promise<boolean> {
  const all = useChat.getState().dequeueQueued(convId)
  if (all.length === 0) return false
  const { batch, rest } = splitQueueForAppCommand(all)
  for (const m of rest) {
    useChat.getState().enqueue(convId, m.text, m.attachments, HUMANO)
  }
  // G2.2 — expande CADA pendente ANTES do join: `/comando` no meio do texto
  // coalescido era barra morta (a expansão do handleSend só olha o texto
  // inteiro). Com 1 item só, segue intacto (o próprio handleSend expande,
  // inclusive o cru nativo). Fail-open: inventário indisponível → os textos
  // seguem como digitados.
  let texts = batch.map((q) => q.text).filter(Boolean)
  if (texts.length > 1 && texts.some((t) => parseSlashInvocation(t.trim()))) {
    try {
      const commands = await readProjectCommands(projectPath, agent)
      texts = expandQueuedForJoin(texts, commands, agent)
    } catch (e) {
      console.warn(
        "inventário de comandos indisponível; fila segue como texto",
        e,
      )
    }
  }
  const atts = [
    ...new Map(
      batch.flatMap((q) => q.attachments).map((a) => [a.path, a]),
    ).values(),
  ]
  // A fila é do humano, então a drenagem dela também é: o que sai daqui foi
  // ele que digitou (ADR-046).
  void enviar(texts.join("\n\n"), undefined, atts, HUMANO, convId)
  return true
}

/** Interrompe o turno, quando ainda existe um, e garante o despacho da fila.
 *  Se o processo ainda está fechando, o `finally` canônico do ChatPanel fará a
 *  drenagem; se a conversa já está ociosa, este caminho drena imediatamente.
 *  `dequeueQueued` é atômico, portanto a corrida entre os dois não duplica o
 *  lote. */
export async function dispatchQueuedNow(
  convId: string,
  projectPath: string | undefined,
  enviar: EnviarFila,
  interromper: (id: string) => Promise<unknown> = cancelConversationTurn,
): Promise<"enviado" | "aguardando" | "vazio"> {
  if (!projectPath) throw new Error("projeto indisponível para despachar a fila")
  let conv = useChat.getState().byId[convId]
  if (!conv?.queued?.length) return "vazio"
  if (conv.running) await interromper(convId)

  conv = useChat.getState().byId[convId]
  if (!conv?.queued?.length) return "vazio"
  if (conv.running || conv.finalizing) return "aguardando"
  return (await drainQueued(convId, conv.agent, projectPath, enviar))
    ? "enviado"
    : "vazio"
}
