// Lógica PURA do rascunho da Sala de Decisão (GateAnswerForm) — testável sem
// DOM (gateAnswerDraft.test.ts). O componente só orquestra; toda transição de
// estado (texto, anexos, submit) vive aqui, imutável.
import type { GateAnswer } from "@/lib/missionTypes"
import {
  MAX_ATTACH_BYTES,
  MAX_ATTACH_COUNT,
  MAX_ATTACH_MB,
  pastedTextToInsert,
  type Attachment,
} from "@/lib/attachments"

/** Rascunho de UMA resposta do gate (texto + anexos pendentes). */
export interface GateDraft {
  text: string
  attachments: Attachment[]
}

/** Um rascunho vazio por pergunta. */
export function initGateDrafts(n: number): GateDraft[] {
  return Array.from({ length: n }, () => ({ text: "", attachments: [] }))
}

/** Troca o texto da resposta `i` (imutável). */
export function draftSetText(
  drafts: GateDraft[],
  i: number,
  text: string,
): GateDraft[] {
  return drafts.map((d, j) => (j === i ? { ...d, text } : d))
}

/** Acrescenta texto ditado/colado ao fim da resposta `i` (espaço único). */
export function draftAppendText(
  drafts: GateDraft[],
  i: number,
  text: string,
): GateDraft[] {
  const t = text.trim()
  if (!t) return drafts
  return drafts.map((d, j) =>
    j === i
      ? { ...d, text: d.text.trim() ? `${d.text.replace(/\s+$/, "")} ${t}` : t }
      : d,
  )
}

/** Soma anexos salvos à resposta `i` (imutável). */
export function draftAddAttachments(
  drafts: GateDraft[],
  i: number,
  atts: Attachment[],
): GateDraft[] {
  if (atts.length === 0) return drafts
  return drafts.map((d, j) =>
    j === i ? { ...d, attachments: [...d.attachments, ...atts] } : d,
  )
}

/** Remove o anexo `path` da resposta `i` (imutável; o blob é do chamador). */
export function draftRemoveAttachment(
  drafts: GateDraft[],
  i: number,
  path: string,
): GateDraft[] {
  return drafts.map((d, j) =>
    j === i
      ? { ...d, attachments: d.attachments.filter((a) => a.path !== path) }
      : d,
  )
}

/** Rascunhos → GateAnswer[] rico do answerGate (texto aparado; anexos junto). */
export function draftsToAnswers(drafts: GateDraft[]): GateAnswer[] {
  return drafts.map((d) => ({ text: d.text.trim(), attachments: d.attachments }))
}

/** Quantas respostas têm conteúdo (texto OU anexo) — o contador do rodapé. */
export function answeredCount(drafts: GateDraft[]): number {
  return drafts.filter((d) => d.text.trim() || d.attachments.length > 0).length
}

/** O arquivo é anexável? (mesma régua do onPaste do composer/useAttachments —
 *  imagem, PDF ou tipo vazio que o backend sniffa). */
export function attachableFile(f: { type: string }): boolean {
  return (
    f.type.startsWith("image/") || f.type === "application/pdf" || f.type === ""
  )
}

/** File[] anexáveis de um clipboard/DataTransfer (captura SÍNCRONA — chamar
 *  ANTES de qualquer await, F21 do composer). */
export function clipboardAttachables(
  items: Iterable<{ kind: string; getAsFile: () => File | null }>,
): File[] {
  return [...items]
    .filter((it) => it.kind === "file")
    .map((it) => it.getAsFile())
    .filter((f): f is File => !!f && attachableFile(f))
}

/** O que um paste na resposta do gate rende: os anexos E o texto que deve entrar
 *  no rascunho. Espelha o `collectPaste` do composer (hooks/useAttachments) e,
 *  como ele, é ENTRADA ÚNICA de propósito.
 *
 *  Existe porque a Sala de Decisão lia o `text/plain` CRU: copiar uma imagem do
 *  próprio app põe no clipboard o File E o endereço `blob:tauri://…` do MESMO
 *  recurso, e esse endereço entrava na resposta como se fosse texto do humano —
 *  o incidente que o `pastedTextToInsert` existe pra fechar, e que esta
 *  superfície não atravessava. Régua duplicada é assim que um conserto vale só
 *  na metade das telas. */
export function gatePaste(data: {
  items: Iterable<{ kind: string; getAsFile: () => File | null }>
  getData: (tipo: string) => string
}): { files: File[]; text: string } {
  const files = clipboardAttachables(data.items)
  return {
    files,
    text: pastedTextToInsert(data.getData("text/plain"), files.length),
  }
}

/** Salva File[] como Attachment[] respeitando os limites do backend (10 MB por
 *  arquivo, 8 por resposta). `save` injetável (saveAttachment real na UI; fake
 *  nos testes). Erros viram `onError` (toast na UI), nunca exceção. */
export async function saveFilesAsAttachments(
  convId: string,
  files: File[],
  existingCount: number,
  save: (
    convId: string,
    name: string,
    mime: string,
    bytes: Uint8Array,
  ) => Promise<Attachment>,
  onError: (msg: string) => void,
): Promise<Attachment[]> {
  const saved: Attachment[] = []
  let count = existingCount
  for (const f of files) {
    if (f.size > MAX_ATTACH_BYTES) {
      onError(`"${f.name || "anexo"}" excede ${MAX_ATTACH_MB} MB`)
      continue
    }
    if (count >= MAX_ATTACH_COUNT) {
      onError(`máx. ${MAX_ATTACH_COUNT} anexos por resposta`)
      break
    }
    try {
      const buf = new Uint8Array(await f.arrayBuffer())
      saved.push(await save(convId, f.name || "colado", f.type, buf))
      count++
    } catch (err) {
      onError(typeof err === "string" ? err : "falha ao anexar")
    }
  }
  return saved
}
