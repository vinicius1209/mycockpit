// v0.2.x, anexos (imagem + PDF). Espelha os tipos do Rust (attachments.rs).
// O blob mora em app_data_dir/attachments/<convId>/<hash>.<ext>; aqui trafega só
// o metadado (path relativo + nome de display + mime + tamanho), nunca o payload.

import { invoke } from "@tauri-apps/api/core"

export type AttachmentKind = "image" | "pdf" | "other"

export interface Attachment {
  /** Relativo ao app_data_dir: "attachments/<convId>/<hash>.<ext>". */
  path: string
  /** Nome original, só display (chip). */
  name: string
  kind: AttachmentKind
  mime: string
  bytes: number
}

/** Referência de conversa p/ o GC (espelha ConvRef no Rust). */
export interface ConvRef {
  id: string
  updated_at: number
}

// Capacidade por agent (`supports_attachment` no trait Rust) agora vive no
// registry único: `agentCaps()` em lib/agents.ts.

/** Limites (espelham o backend): 10 MB por arquivo, 8 anexos por mensagem. */
export const MAX_ATTACH_MB = 10
export const MAX_ATTACH_BYTES = MAX_ATTACH_MB * 1024 * 1024
export const MAX_ATTACH_COUNT = 8

export interface GcSummary {
  freed_bytes: number
  removed_dirs: number
  skipped: boolean
}

// ---------------- wrappers dos comandos Tauri ----------------

/** Salva bytes colados → Attachment (path relativo). `bytes` vai como number[]. */
export async function saveAttachment(
  convId: string,
  name: string,
  declaredMime: string,
  bytes: Uint8Array,
): Promise<Attachment> {
  return invoke<Attachment>("save_attachment", {
    convId,
    name,
    declaredMime,
    bytes: Array.from(bytes),
  })
}

/** Anexa um arquivo já em disco (file picker) → Attachment. */
export async function attachPath(
  convId: string,
  srcPath: string,
): Promise<Attachment> {
  return invoke<Attachment>("attach_path", { convId, srcPath })
}

export async function deleteAttachment(path: string): Promise<void> {
  await invoke("delete_attachment", { path })
}

/** GC do cache (boot). `validConvs` = ConvRef[] autoritativo do DB;
 *  `validNotes` = ids das notas vivas (elas têm ciclo de vida próprio e a
 *  pasta delas não é varrida pela régua da conversa). Lista vazia dos dois
 *  lados não apaga nada — "não recebi" e "não existe" são indistinguíveis. */
export async function gcAttachments(
  validConvs: ConvRef[],
  validNotes: string[] = [],
): Promise<GcSummary> {
  return invoke<GcSummary>("gc_attachments", { validConvs, validNotes })
}

/** Salva bytes colados numa NOTA (mesma validação/allowlist da conversa). */
export async function saveNoteAttachment(
  noteId: string,
  name: string,
  declaredMime: string,
  bytes: Uint8Array,
): Promise<Attachment> {
  return invoke<Attachment>("save_note_attachment", {
    noteId,
    name,
    declaredMime,
    bytes: Array.from(bytes),
  })
}

/** Para onde um anexo é copiado (espelha `DonoDoAnexo` em anexo_entre_donos.rs). */
export type DonoDoAnexo = { tipo: "conversa"; id: string } | { tipo: "nota"; id: string }

/** Copia um anexo para outro dono, no disco: os bytes não passam pela ponte.
 *  O rascunho que vira nota leva as imagens; a nota que volta as devolve. */
export async function copiarAnexo(a: Attachment, para: DonoDoAnexo): Promise<Attachment> {
  return invoke<Attachment>("copiar_anexo", { path: a.path, nome: a.name, para })
}

/** Apaga os blobs de uma nota (ao deletá-la). */
export async function wipeNoteAttachments(noteId: string): Promise<void> {
  await invoke("wipe_note_attachments", { noteId })
  const prefixo = `attachments/notes/${noteId}/`
  for (const path of [...urlCache.keys()]) {
    if (path.startsWith(prefixo)) revokeAttachmentUrl(path)
  }
}

/** Apaga todos os anexos de uma conversa (ao deletá-la). */
export async function wipeAttachments(convId: string): Promise<void> {
  await invoke("wipe_conv_attachments", { convId })
  // os blobs acabaram de sumir do disco → libera os object URLs cacheados deles
  // (o convId está embutido no path "attachments/<convId>/…"), senão vazam.
  const prefix = `attachments/${convId}/`
  for (const path of [...urlCache.keys()]) {
    if (path.startsWith(prefix)) revokeAttachmentUrl(path)
  }
}

/** Referência CRUA de recurso: o endereço de um blob/arquivo, não um texto que
 *  alguém escreveu. `blob:tauri://localhost/<uuid>` é o que o webview põe no
 *  `text/plain` quando você copia uma <img> do próprio app (o mesmo recurso que
 *  vem como File no clipboard); `file:` e `data:` são as outras formas do mesmo
 *  endereço. Um token só, sem espaço — por isso o teste é por token. */
function isResourceRef(token: string): boolean {
  return /^(?:blob|file|data):\S*$/i.test(token)
}

/** Texto que é SÓ referência de recurso (uma ou mais, nada além delas). String
 *  vazia não conta: "vazio" é outro caso, e quem chama trata. */
export function isResourceRefOnly(text: string): boolean {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  return tokens.length > 0 && tokens.every(isResourceRef)
}

/** Texto do paste que deve entrar no composer, dado quantos anexos o MESMO
 *  paste produziu.
 *
 *  Copiar uma imagem de outra conversa do app põe DOIS itens na área de
 *  transferência: o File (que vira anexo) e, no `text/plain`, a URL do MESMO
 *  recurso. Sem filtro a URL entrava no prompt e, como o título deriva do 1º
 *  texto do usuário, batizava a conversa de "blob:tauri://localhost/d7dd…".
 *
 *  Regra: com anexo(s), um texto que é APENAS referência de recurso é
 *  descartado inteiro; qualquer texto real vai junto INTACTO (colar imagem +
 *  texto continua colando o texto, e nada é recortado do meio dele). Sem
 *  anexo, o texto passa como está — uma URL colada sozinha é escolha sua. */
export function pastedTextToInsert(text: string, attachedCount: number): string {
  if (attachedCount <= 0) return text
  return isResourceRefOnly(text) ? "" : text
}

/** Nome honesto para uma mensagem que não tem texto próprio, só anexo(s). */
export function attachmentsTitle(atts: readonly Attachment[]): string | null {
  if (atts.length === 0) return null
  if (atts.length > 1) return `${atts.length} anexos`
  const kind = atts[0].kind
  return kind === "image" ? "Imagem" : kind === "pdf" ? "PDF" : "Anexo"
}

// URL de object cacheada por path (F6: não re-lê bytes a cada render).
const urlCache = new Map<string, string>()

/** Bytes do anexo → object URL (cacheado) p/ thumbnail no histórico. */
export async function attachmentUrl(att: Attachment): Promise<string> {
  const cached = urlCache.get(att.path)
  if (cached) return cached
  const bytes = await invoke<number[]>("read_attachment", { path: att.path })
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: att.mime }),
  )
  urlCache.set(att.path, url)
  return url
}

/** Revoga o object URL cacheado de um anexo. Atrele ao CICLO DE VIDA do blob
 *  (remover o anexo / wipe da conversa), NUNCA ao unmount do thumbnail: o URL é
 *  cacheado por path e o mesmo blob (dedup por hash) pode estar montado em outra
 *  <img>, revogar no unmount apagaria a imagem ainda visível. */
export function revokeAttachmentUrl(path: string): void {
  const url = urlCache.get(path)
  if (url) {
    URL.revokeObjectURL(url)
    urlCache.delete(path)
  }
}
