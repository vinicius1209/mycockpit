// Imagem na aba Alterações. O git só diz "binário"; quem decide se dá para
// mostrar é a mesma lista do visualizador (`imageMimeType`), para o diff não
// prometer o que a aba de arquivo e o Lightbox não abrem.
//
// Só existe a versão do DISCO. Arquivo removido não tem o que ler, e imagem
// modificada mostra a atual dizendo que é a atual: a anterior mora no HEAD, e
// ler o HEAD pede um comando no Rust que ainda não existe.

import type { DiffFile } from "@/lib/git"
import { imageMimeType } from "@/lib/projectFilePreview"
import type { LightboxImage } from "@/store/lightbox"

export function imagemDoDiffVisivel(file: DiffFile): boolean {
  return file.binary && file.status !== "deleted" && imageMimeType(file.path) !== null
}

/** Galeria do Lightbox com TODAS as imagens visíveis do diff, na ordem da
 *  lista: quem abre um quadro de uma sequência anda pelos outros com ←/→. */
export function galeriaDoDiff(files: DiffFile[], root: string): LightboxImage[] {
  return files.filter(imagemDoDiffVisivel).map((f) => ({
    path: f.path,
    name: f.path.split("/").pop() || f.path,
    source: "arquivo",
    root,
  }))
}
