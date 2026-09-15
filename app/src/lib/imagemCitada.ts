// Imagem citada por link no fio (o `file://` que o agente escreve depois de
// salvar uma captura). Bytes → object URL cacheado, no mesmo molde de
// `evidence.ts` e `attachments.ts`, para a miniatura não reler o disco a cada
// token que re-renderiza a mensagem.
//
// A leitura passa pelo `read_project_file_bytes`: o caminho vem de texto do
// modelo, então quem decide se ele pode ser lido é a contenção do Rust, nunca
// este arquivo. A validação raster roda antes de a imagem virar URL.

import { assertSafeRasterImage, imageMimeType } from "@/lib/projectFilePreview"
import { readProjectFileBytes } from "@/lib/sources"

// Falha não envenena o cache: o arquivo pode aparecer depois (o agente cita
// antes de terminar de copiar) e a próxima montagem tenta de novo.
const urlCache = new Map<string, Promise<string>>()

export function imagemCitadaUrl(root: string, path: string): Promise<string> {
  const chave = `${root}\n${path}`
  const cached = urlCache.get(chave)
  if (cached) return cached
  const pendente = (async () => {
    const mime = imageMimeType(path)
    if (!mime) throw new Error("Este formato de imagem não é compatível.")
    const bytes = await readProjectFileBytes(root, path)
    assertSafeRasterImage(bytes, mime)
    return URL.createObjectURL(new Blob([Uint8Array.from(bytes).buffer], { type: mime }))
  })()
  urlCache.set(chave, pendente)
  pendente.catch(() => urlCache.delete(chave))
  return pendente
}
