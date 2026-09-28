import type { Attachment } from "@/lib/attachments"

/** Tinta de papel do post-it (ADR-109). `sage` saiu: verde é marco raro do §2. */
export type StickyNoteColor = "sand" | "slate" | "teal" | "indigo" | "rose"

/** ID do registry (`lib/agents.ts`) ou `ALVO_QUALQUER`. Nunca um apelido local:
 *  a lista de alvos deriva do registry (`noteTargets.ts`), e valor gravado passa
 *  por `normalizarAlvo` antes de ser usado. */
export type StickyNoteTarget = string

export interface StickyNote {
  id: string
  /** Projeto dono da nota. Ausente = nota de TODOS os projetos (é também o que
   *  as notas gravadas antes deste campo são: sem dono, e agora rotuladas como
   *  tal em vez de fingirem ser "do projeto" em qualquer projeto que abrisse). */
  projectId?: string
  convId?: string
  title?: string
  content: string
  color: StickyNoteColor
  targetAgent?: StickyNoteTarget
  /** Anexos da nota: só o METADADO (path relativo, nome, mime, bytes). O byte
   *  mora em disco (`attachments/notes/<id>/`), nunca aqui — a store persiste em
   *  `localStorage`, que guarda string e tem cota de ~5 MB: base64 estouraria a
   *  cota e serializaria megabytes na thread principal a cada mudança. */
  attachments?: Attachment[]
  /** De onde a nota veio, quando não foi escrita na gaveta: a mensagem que
   *  estava no composer, ou o item tirado da fila (docs/composer-vira-nota-prd.md).
   *  Ausente = escrita na gaveta, como toda nota antes deste campo. */
  origem?: "composer" | "fila"
  collapsed?: boolean
  createdAt: number
  updatedAt: number
}
