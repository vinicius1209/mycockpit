// Notas do humano no fio (docs/notas-no-fio-plan.md, N3 — o "push").
//
// N1/N2 já fazem a nota EXISTIR e viajar nas rotas que re-serializam a
// conversa (recap e transcript). Isso cobre fork, handoff e sessão perdida —
// mas NÃO a conversa corrente: com sessão viva o resume nativo carrega o
// histórico do CLI, e a nota, que nasceu do nosso lado, nunca chega lá.
// Este módulo é a ponte: bloco no prompt do próximo envio.
//
// Por que `sent` é uma FLAG e não algo derivado da ordem do fio: a tentação
// era "pendente = nota depois do último item de usuário". Não serve — o
// auto-resume (ADR-046) reenvia SEM virar mensagem do usuário, então a nota
// seria mandada no resume E de novo no próximo envio. Duplicar instrução em
// silêncio é pior que guardar um booleano.

import { useChat, type ChatItem } from "@/store/chat"

export type NoteItem = Extract<ChatItem, { kind: "note" }>

/** Quanto do turno citado entra na moldura (o suficiente pra ancorar). */
export const NOTE_QUOTE_MAX = 100

/** Notas ainda não entregues ao agente. */
export function pendingNotes(items: readonly ChatItem[]): NoteItem[] {
  return items.filter((it): it is NoteItem => it.kind === "note" && !it.sent)
}

/** Trecho do turno que a nota comenta — é ele que torna a nota
 *  auto-suficiente do outro lado (mesma lição dos órfãos do diff). */
function quoteOf(items: readonly ChatItem[], anchorId: string): string | null {
  const alvo = items.find((it) => it.id === anchorId)
  if (!alvo) return null
  const texto =
    alvo.kind === "user" || alvo.kind === "text" || alvo.kind === "result"
      ? (alvo.text ?? "")
      : ""
  const limpo = texto.trim().replace(/\s+/g, " ")
  if (!limpo) return null
  return limpo.length > NOTE_QUOTE_MAX
    ? `${limpo.slice(0, NOTE_QUOTE_MAX - 1)}…`
    : limpo
}

/**
 * O bloco que entra no prompt. `null` = nada pendente (a zona não escreve
 * nada; prompt não ganha cabeçalho vazio).
 *
 * A moldura diz três coisas de propósito: que é do HUMANO, que é DIREÇÃO (não
 * fala do agente a ser respondida como conversa) e SOBRE O QUÊ — sem a
 * citação do turno a nota chega como bilhete sem endereço.
 */
export function notesBlock(items: readonly ChatItem[]): string | null {
  const pend = pendingNotes(items)
  if (pend.length === 0) return null
  const blocos = pend.map((n) => {
    const quote = quoteOf(items, n.anchorId)
    return quote ? `- Sobre "${quote}":\n  ${n.text.trim()}` : `- ${n.text.trim()}`
  })
  return [
    "<notas-do-usuario>",
    "Anotações que o usuário deixou no fio desta conversa. São DIREÇÃO dele",
    "sobre turnos anteriores, não falas a responder: leve em conta no que vier",
    "a seguir.",
    ...blocos,
    "</notas-do-usuario>",
  ].join("\n")
}

/**
 * Ordem de RENDER: cada nota logo abaixo do turno que ela comenta.
 *
 * O armazenamento continua append-only (a nota nasce no fim do fio, que é a
 * escrita mais simples e segura); quem reposiciona é a tela. Sem isto a nota
 * sobre o turno 3 aparecia lá embaixo, e a âncora que a gente grava viraria
 * promessa não cumprida. Puro: não muda `items`, devolve outra lista.
 *
 * Nota órfã (âncora que não existe mais) fica onde está — some do lugar certo,
 * mas nunca some da tela.
 */
export function placeNotes(items: readonly ChatItem[]): ChatItem[] {
  const notas = items.filter((it): it is NoteItem => it.kind === "note")
  if (notas.length === 0) return items as ChatItem[]
  const ids = new Set(items.map((it) => it.id))
  const porAncora = new Map<string, NoteItem[]>()
  const orfas: NoteItem[] = []
  for (const n of notas) {
    if (n.anchorId !== n.id && ids.has(n.anchorId)) {
      const lista = porAncora.get(n.anchorId) ?? []
      lista.push(n)
      porAncora.set(n.anchorId, lista)
    } else {
      orfas.push(n)
    }
  }
  const out: ChatItem[] = []
  for (const it of items) {
    if (it.kind === "note" && !orfas.includes(it)) continue // reposicionada abaixo
    out.push(it)
    const presas = porAncora.get(it.id)
    if (presas) out.push(...presas)
  }
  return out
}

/**
 * Cola as notas pendentes no prompt e as carimba como entregues.
 *
 * IMPURA de propósito (toca a store) e vive aqui, e não nas duas superfícies
 * de envio: a coreografia "monta o bloco → prepende → carimba" precisa ser uma
 * só. Duplicada, um lado carimbaria e o outro não — e a nota voltaria pro
 * agente todo turno. Mesmo motivo do `shouldInlineMemory`.
 */
export function withNotes(
  convId: string,
  items: readonly ChatItem[],
  prompt: string,
): string {
  const bloco = notesBlock(items)
  if (!bloco) return prompt
  useChat.getState().markNotesSent(
    convId,
    pendingNotes(items).map((n) => n.id),
  )
  return `${bloco}\n\n---\n\n${prompt}`
}
