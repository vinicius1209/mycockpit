// v0.2.x — anexos (imagem + PDF). Espelha os tipos do Rust (attachments.rs).
// O blob mora em app_data_dir/attachments/<convId>/<hash>.<ext>; aqui trafega só
// o metadado (path relativo + nome de display + mime + tamanho), nunca o payload.

import { invoke } from "@tauri-apps/api/core"

export type AttachmentKind = "image" | "pdf" | "other"

export interface Attachment {
  /** Relativo ao app_data_dir: "attachments/<convId>/<hash>.<ext>". */
  path: string
  /** Nome original — só display (chip). */
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

/** GC do cache (boot). `validConvs` = ConvRef[] autoritativo do DB. */
export async function gcAttachments(
  validConvs: ConvRef[],
): Promise<GcSummary> {
  return invoke<GcSummary>("gc_attachments", { validConvs })
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
 *  <img> — revogar no unmount apagaria a imagem ainda visível. */
export function revokeAttachmentUrl(path: string): void {
  const url = urlCache.get(path)
  if (url) {
    URL.revokeObjectURL(url)
    urlCache.delete(path)
  }
}
