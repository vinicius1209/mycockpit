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
import { useChat } from "@/store/chat"

export async function drainQueued(
  convId: string,
  agent: string,
  projectPath: string,
  /** O `handleSend` do ChatPanel. Parâmetro e não import: a fila é do humano,
   *  mas a drenagem não precisa conhecer o composer pra saber disso. */
  enviar: (
    texto: string,
    cfg: undefined,
    anexos: Attachment[],
    origem: typeof HUMANO,
    originConvId?: string,
  ) => unknown,
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
