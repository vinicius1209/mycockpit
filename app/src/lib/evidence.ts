// Evidência VISUAL de tool_result (browser-plan B1). O backend grava as
// imagens que os MCPs devolvem (screenshot do Playwright etc.) em
// app_data_dir/evidence/<convId>/ e o item da tool carrega só o path RELATIVO.
// Aqui: bytes → object URL cacheado (mesmo padrão de attachments.ts) e o
// helper de abrir no app padrão do SO. Paths são SEMPRE os que o backend
// emitiu (evidence/…) ou o anexo original (attachments/…) — nunca um path
// vindo de texto do modelo; a contenção real mora no Rust (canonicalize).

import { invoke } from "@tauri-apps/api/core"

/** Copy do placeholder quando o arquivo saiu do disco (honesto, sem <img> quebrada). */
export const EVIDENCE_MISSING = "evidência removida"

/** MIME derivado da EXTENSÃO do path de evidência (o backend só grava a
 *  allowlist png/jpg/webp/gif, então a extensão é confiável). */
export function evidenceMime(path: string): string {
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg"
  if (path.endsWith(".webp")) return "image/webp"
  if (path.endsWith(".gif")) return "image/gif"
  return "image/png"
}

/** Nome curto p/ alt/título ("toolu_01-0.png", sem o caminho inteiro). */
export function evidenceName(path: string): string {
  return path.split("/").pop() ?? path
}

// URL de object cacheada por path (mesma razão do F6 dos anexos: não re-ler
// bytes a cada render). Falha NÃO envenena o cache: re-tentar é possível.
const urlCache = new Map<string, string>()

/** Bytes da evidência → object URL (cacheado). Rejeita quando o arquivo saiu
 *  do disco — o chamador mostra o placeholder EVIDENCE_MISSING. */
export async function evidenceUrl(path: string): Promise<string> {
  const cached = urlCache.get(path)
  if (cached) return cached
  const bytes = await invoke<number[]>("read_evidence", { path })
  const url = URL.createObjectURL(
    new Blob([new Uint8Array(bytes)], { type: evidenceMime(path) }),
  )
  urlCache.set(path, url)
  return url
}

/** Abre uma imagem do fio (evidência OU anexo do usuário) no app padrão do
 *  SO. O path segue relativo; o Rust valida contenção antes de abrir. */
export async function openConvImage(path: string): Promise<void> {
  await invoke("open_conv_image", { path })
}

/** Mostra a imagem do fio na pasta dela (Finder / gerenciador de arquivos).
 *  Mesma contenção do openConvImage: o path segue relativo e quem resolve é
 *  o Rust. */
export async function revealConvImage(path: string): Promise<void> {
  await invoke("reveal_conv_image", { path })
}

/** Copia a imagem do fio para o caminho que o diálogo de salvar devolveu
 *  ("Salvar no projeto" do lightbox). A origem segue relativa e contida no
 *  Rust; o destino é escolha da pessoa. */
export async function saveConvImage(path: string, destino: string): Promise<void> {
  await invoke("save_conv_image", { path, destino })
}
