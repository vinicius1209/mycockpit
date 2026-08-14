// Nome da conversa na lista (S4): derivado do 1º prompt do USUÁRIO. Puro e
// replay-safe — deriva só dos items, sem estado paralelo.
//
// Nome de conversa é TEXTO que alguém escreveu. Duas bordas em que não há
// texto: a mensagem só com anexo (colar/arrastar uma imagem e mandar) e o
// endereço CRU de um recurso — colar uma imagem de outra conversa do app trazia
// junto a URL `blob:tauri://…` dela e a conversa nascia chamada
// "blob:tauri://localhost/d7dd…". O paste já barra essa URL
// (`pastedTextToInsert`); aqui fica o cinto. Nas duas bordas quem nomeia é o
// anexo; sem nem isso volta `null` e a lista mostra "Nova conversa".

import type { Attachment } from "@/lib/attachments"
import { attachmentsTitle, isResourceRefOnly } from "@/lib/attachments"

/** O mínimo que o título precisa de um item do fio (evita importar o store). */
export interface TitleScanItem {
  kind: string
  text?: string
  attachments?: readonly Attachment[]
}

/** Título derivado do 1º prompt do usuário, ou `null` quando não há nome
 *  honesto a dar. Corta em 44 caracteres (a régua da sidebar). */
export function deriveTitle(items: readonly TitleScanItem[]): string | null {
  const first = items.find((it) => it.kind === "user")
  if (!first) return null
  const t = (first.text ?? "").trim().replace(/\s+/g, " ")
  if (!t || isResourceRefOnly(t)) return attachmentsTitle(first.attachments ?? [])
  return t.length > 44 ? `${t.slice(0, 44)}…` : t
}
