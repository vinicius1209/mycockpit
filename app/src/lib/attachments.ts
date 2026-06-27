// v0.2.x — anexos (imagem + PDF). Espelha os tipos do Rust (attachments.rs).
// O blob mora em app_data_dir/attachments/<convId>/<hash>.<ext>; aqui trafega só
// o metadado (path relativo + nome de display + mime + tamanho), nunca o payload.

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

/** Capacidade por agent (espelha `supports_attachment` no trait Rust). O envio
 *  é bloqueado no front quando um anexo não é suportado pelo agent-alvo. */
export const AGENT_CAPS: Record<string, { image: boolean; pdf: boolean }> = {
  "claude-code": { image: true, pdf: true },
  codex: { image: true, pdf: false },
  opencode: { image: false, pdf: false },
}
