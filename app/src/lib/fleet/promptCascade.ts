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
import { emoldurarCitacoes } from "@/lib/citacao"
import { emoldurarColagens } from "@/lib/colagem"
import { emoldurarMarcacoes } from "@/lib/marcacao"
import { withNotasDoBloco } from "@/store/stickyNotes"
import { finalizeSlashExpansion } from "@/lib/slashDispatch"
import type { SlashExpansion } from "@/lib/slashCommands"
import type { Attachment } from "@/lib/attachments"

/** Anexos do turno somados aos das notas, sem repetir arquivo (mesma nota
 *  citada duas vezes, ou reenvio do mesmo pedido). A ordem do composer vem
 *  primeiro. */
export function juntarAnexos(
  base: readonly Attachment[],
  extras: readonly Attachment[],
): Attachment[] {
  const vistos = new Set(base.map((a) => a.path))
  const out = [...base]
  for (const a of extras) {
    if (vistos.has(a.path)) continue
    vistos.add(a.path)
    out.push(a)
  }
  return out
}

/**
 * As DUAS portas de nota, na ordem da cascata: a do fio e depois a do bloco
 * (`@nota/…`). Fonte única dos dois envios, o da mesa (`comporCascata`) e o do
 * composer (`ChatPanel`). O composer chamava só `withNotes`, então `@nota/slug`
 * saía como endereço cru e o agente nunca via o texto (14/09/2026). Os anexos
 * da nota entram na lista do run: sem eles a nota chegava sem os prints que
 * eram o assunto dela (ADR-192).
 */
export function withNotasDoTurno(
  convId: string,
  projectId: string,
  items: readonly import("@/store/chat").ChatItem[],
  texto: string,
  attachments: readonly Attachment[] = [],
): { prompt: string; attachments: Attachment[] } {
  // Citações (capricho R4) e colagens grandes (R7) viram moldura de dado antes das notas.
  const bloco = withNotasDoBloco(withNotes(convId, items, emoldurarMarcacoes(emoldurarColagens(emoldurarCitacoes(texto)))), { projectId, convId })
  return { prompt: bloco.prompt, attachments: juntarAnexos(attachments, bloco.anexos) }
}

export interface CamadasDoPrompt {
  convId: string
  projectId: string
  projectPath: string
  agent: string
  items: readonly import("@/store/chat").ChatItem[]
  /** Texto e proveniência antes da cascata; a re-expansão decide se um comando
   *  nativo ainda pode viajar cru. */
  slashExpansion: SlashExpansion
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
export async function comporCascata(
  c: CamadasDoPrompt,
): Promise<SlashExpansion & { anexosDeNota: Attachment[] }> {
  const expansion = await finalizeSlashExpansion(
    c.slashExpansion,
    c.text,
    c.projectPath,
    c.agent,
    !!c.lessonsBlock || !!c.doctrineBlock || !!c.personaBlock,
  )
  const notas = withNotasDoTurno(c.convId, c.projectId, c.items, expansion.text)
  let out = notas.prompt
  if (c.lessonsBlock) out = `${c.lessonsBlock}\n\n---\n\n${out}`
  if (c.doctrineBlock) out = `${c.doctrineBlock}\n\n${out}`
  return {
    text: out,
    instructionSources: expansion.instructionSources,
    anexosDeNota: notas.attachments,
  }
}
