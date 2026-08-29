// A CASCATA do prompt: o que o pedido do humano ganha em volta antes de sair.
//
// Extraído de `send.ts` (no teto do ratchet) porque a cascata é um recorte
// fechado, não um pedaço partido pra caber: ela responde UMA pergunta — em que
// ORDEM as camadas de contexto entram — e a ordem é a regra, não o acaso.
//
// **De dentro pra fora: notas → lições → doutrina.** O mais específico fica
// mais perto do pedido; o mais durável, mais longe. Notas são pontuais e do
// turno; lições são padrão aprendido; doutrina é lei do projeto. Inverter isso
// afasta do pedido justamente o que foi escrito PARA ele.
//
// As duas portas de nota entram lado a lado de propósito: a do FIO
// (`lib/notes.ts`, ancorada num turno, acumula sozinha e por isso carimba o que
// entregou) e a do BLOCO (`@nota/…`, endereçada à mão, sem carimbo porque
// mencionar duas vezes é decisão). Intenções iguais, gatilhos diferentes.

import { withNotes } from "@/lib/notes"
import { withNotasDoBloco } from "@/store/stickyNotes"
import { reexpandIfEmbedded } from "@/lib/slashCommands"

export interface CamadasDoPrompt {
  convId: string
  projectId: string
  projectPath: string
  agent: string
  items: readonly import("@/store/chat").ChatItem[]
  /** Texto que o motor receberia sem cascata (comando nativo cru, quando é o
   *  caso) e o texto do humano — a re-expansão decide entre os dois. */
  sendText: string
  text: string
  personaBlock: string | null
  lessonsBlock: string | null
  doctrineBlock: string | null
}

/**
 * Monta o texto final do prompt.
 *
 * A re-expansão entra AQUI e não antes porque ela depende da própria cascata:
 * com bloco a prepender (doutrina/lições/persona), o pedido deixa de ser o
 * prompt inteiro, e um comando nativo cru viraria barra morta atrás do bloco.
 * Sem bloco nenhum, o cru nativo segue valendo. Separar as duas decisões era o
 * que fazia essa correção precisar ser lembrada em dois lugares.
 */
export async function comporCascata(c: CamadasDoPrompt): Promise<string> {
  const promptText = await reexpandIfEmbedded(
    c.sendText,
    c.text,
    c.projectPath,
    c.agent,
    !!c.lessonsBlock || !!c.doctrineBlock || !!c.personaBlock,
  )
  let out = withNotes(c.convId, c.items, promptText)
  out = withNotasDoBloco(out, { projectId: c.projectId, convId: c.convId })
  if (c.lessonsBlock) out = `${c.lessonsBlock}\n\n---\n\n${out}`
  if (c.doctrineBlock) out = `${c.doctrineBlock}\n\n${out}`
  return out
}
