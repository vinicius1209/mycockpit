// Guardar para depois (docs/composer-vira-nota-spec.md §4): a mensagem pronta
// no composer, ou o item da fila, vira nota; e a nota volta ao composer como
// fala sua.
//
// Fila é compromisso, nota é lembrete: nada aqui aciona motor, enfileira ou
// despacha. E nada do rascunho se perde: se um anexo não copia, a nota não
// nasce e o rascunho fica como estava.

import { avisar, mensagemDe } from "@/lib/avisos"
import {
  copiarAnexo,
  MAX_ATTACH_COUNT,
  wipeNoteAttachments,
  type Attachment,
} from "@/lib/attachments"
import { focusConsoleComposer } from "@/lib/focusComposer"
import { textoDoEnvio } from "@/lib/textoDoEnvio"
import type { StickyNote } from "@/components/notes/types"
import { pullQueued } from "@/components/chat/filaComposer"
import { useApp } from "@/store/app"
import { useChat, type QueuedMsg } from "@/store/chat"
import { acrescentarAoRascunho, useComposerDrafts, type ComposerDraft } from "@/store/composerDrafts"
import { useStickyNotes } from "@/store/stickyNotes"

export type EscopoDoGuardar = "conversa" | "projeto"

const plural = (n: number, um: string, varios: string) => (n === 1 ? `1 ${um}` : `${n} ${varios}`)

/** O conteúdo de uma nota que só tem anexo: "2 imagens", "relatorio.pdf". Puro. */
export function tituloDoGuardado(texto: string, anexos: readonly Attachment[]): string {
  if (texto.trim()) return texto.trim()
  if (anexos.length === 1) return anexos[0].name
  if (anexos.every((a) => a.kind === "image")) return plural(anexos.length, "imagem", "imagens")
  return plural(anexos.length, "anexo", "anexos")
}

/** Onde a nota foi parar, na frase do toast. Puro. */
export function rotuloDoEscopo(escopo: EscopoDoGuardar, projeto: string | null): string {
  return escopo === "conversa" ? "desta conversa" : projeto ? `do projeto ${projeto}` : "do projeto"
}

function projetoDaConversa(convId: string): { id: string | undefined; nome: string | null } {
  const chat = useChat.getState()
  const id =
    chat.byId[convId]?.projectId ??
    Object.entries(chat.conversationsByProject).find(([, lista]) => lista?.some((c) => c.id === convId))?.[0] ??
    undefined
  const nome = useApp.getState().projects.find((p) => p.id === id)?.name ?? null
  return { id, nome }
}

/** Copia os anexos para a pasta da nota. Falha em qualquer um: apaga o que já
 *  copiou e devolve o erro (a nota não nasce pela metade). */
async function copiarParaANota(id: string, anexos: readonly Attachment[]): Promise<Attachment[]> {
  const copiados: Attachment[] = []
  try {
    for (const a of anexos) copiados.push(await copiarAnexo(a, { tipo: "nota", id }))
    return copiados
  } catch (e) {
    await wipeNoteAttachments(id).catch(() => {})
    throw e
  }
}

async function criarNota(a: {
  convId: string
  escopo: EscopoDoGuardar
  texto: string
  anexos: readonly Attachment[]
  origem: NonNullable<StickyNote["origem"]>
}): Promise<{ nota: StickyNote; onde: string } | null> {
  const projeto = projetoDaConversa(a.convId)
  const id = crypto.randomUUID()
  let anexos: Attachment[]
  try {
    anexos = await copiarParaANota(id, a.anexos)
  } catch (e) {
    avisar.erro("Não consegui guardar a nota.", { detalhe: mensagemDe(e) })
    return null
  }
  const nota = useStickyNotes.getState().addNote(
    {
      id,
      projectId: projeto.id,
      convId: a.escopo === "conversa" ? a.convId : undefined,
      content: tituloDoGuardado(a.texto, anexos),
      attachments: anexos,
      origem: a.origem,
    },
    { abrir: false },
  )
  return { nota, onde: rotuloDoEscopo(a.escopo, projeto.nome) }
}

/** Devolve um rascunho guardado ao composer. Composer vazio: volta exato;
 *  com algo escrito depois, acrescenta, sem apagar nada. */
function devolverRascunho(convId: string, antes: ComposerDraft): void {
  const drafts = useComposerDrafts.getState()
  const agora = drafts.byConv[convId]
  drafts.setText(convId, acrescentarAoRascunho(agora?.text ?? "", antes.text))
  drafts.setAttachments(convId, [...(agora?.attachments ?? []), ...antes.attachments])
  drafts.setBlocos(convId, [...(agora?.blocos ?? []), ...(antes.blocos ?? [])])
  drafts.setMentionValues(convId, [...new Set([...(agora?.mentionValues ?? []), ...antes.mentionValues])])
}

/** Guarda o rascunho da conversa como nota. `texto` é o recém-serializado do
 *  editor (pode estar um tique à frente da store). `true` só se guardou. */
export async function guardarRascunho(convId: string, escopo: EscopoDoGuardar, texto?: string): Promise<boolean> {
  const rascunho = useComposerDrafts.getState().byConv[convId]
  if (!rascunho) return false
  const composto = textoDoEnvio(texto, rascunho.text, rascunho.blocos).trim()
  if (!composto && rascunho.attachments.length === 0) return false
  const antes: ComposerDraft = {
    ...rascunho,
    text: typeof texto === "string" ? texto : rascunho.text,
  }
  const criada = await criarNota({ convId, escopo, texto: composto, anexos: rascunho.attachments, origem: "composer" })
  if (!criada) return false
  useComposerDrafts.getState().clear(convId)
  avisar.feito(`Guardado nas notas ${criada.onde}.`, {
    acao: {
      rotulo: "Desfazer",
      fazer: () => {
        devolverRascunho(convId, antes)
        useStickyNotes.getState().deleteNote(criada.nota.id)
      },
    },
  })
  return true
}

/** Devolve um item à fila, na posição de onde saiu. */
function devolverAFila(convId: string, indice: number, item: QueuedMsg): void {
  useChat.setState((s) => {
    const c = s.byId[convId]
    if (!c) return s
    const fila = [...(c.queued ?? [])]
    fila.splice(Math.min(indice, fila.length), 0, item)
    return { byId: { ...s.byId, [convId]: { ...c, queued: fila } } }
  })
}

/** Tira o item da fila e guarda como nota. `true` só se guardou. */
export async function guardarDaFila(convId: string, indice: number, escopo: EscopoDoGuardar): Promise<boolean> {
  const item = pullQueued(convId, indice)
  if (!item) return false
  const criada = await criarNota({ convId, escopo, texto: item.text, anexos: item.attachments, origem: "fila" })
  if (!criada) {
    devolverAFila(convId, indice, item)
    return false
  }
  avisar.feito(`Tirado da fila e guardado nas notas ${criada.onde}.`, {
    acao: {
      rotulo: "Desfazer",
      fazer: () => {
        devolverAFila(convId, indice, item)
        useStickyNotes.getState().deleteNote(criada.nota.id)
      },
    },
  })
  return true
}

/** Devolve o texto e os anexos da nota ao rascunho da conversa, como fala sua.
 *  A nota fica: apagar é gesto da pessoa. */
export async function levarAoComposer(nota: StickyNote, convId: string): Promise<boolean> {
  const drafts = useComposerDrafts.getState()
  const atuais = drafts.byConv[convId]?.attachments ?? []
  const cabem = Math.max(0, MAX_ATTACH_COUNT - atuais.length)
  const daNota = nota.attachments ?? []
  const anexos: Attachment[] = []
  try {
    for (const a of daNota.slice(0, cabem)) anexos.push(await copiarAnexo(a, { tipo: "conversa", id: convId }))
  } catch (e) {
    // Nada entra no rascunho pela metade; a cópia que sobrou na pasta da
    // conversa é do GC de sempre.
    avisar.erro("Não consegui levar a nota ao composer.", { detalhe: mensagemDe(e) })
    return false
  }
  // O rótulo derivado ("2 imagens") não é fala: só o texto de verdade volta.
  const texto = nota.content.trim() === tituloDoGuardado("", daNota) ? "" : nota.content
  const agora = useComposerDrafts.getState().byConv[convId]
  if (texto) drafts.setText(convId, acrescentarAoRascunho(agora?.text ?? "", texto))
  if (anexos.length) drafts.setAttachments(convId, [...(agora?.attachments ?? []), ...anexos])
  if (daNota.length > cabem) {
    avisar.nota(`Couberam ${cabem} dos ${daNota.length} anexos.`, {
      detalhe: `O composer leva até ${MAX_ATTACH_COUNT} anexos por mensagem.`,
    })
  }
  focusConsoleComposer()
  return true
}
