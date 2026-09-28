// "[imagem N]" no texto é a referência pública a uma imagem anexada (G3,
// ADR-275): N é a posição dela entre as IMAGENS do envio, na ordem. A mesma
// regra mora no Rust (`imagem_no_texto.rs`), que entrega a imagem a cada motor;
// aqui ela serve ao composer (ficha no lugar do texto) e ao fio.

import type { Attachment } from "@/lib/attachments"

export interface Referencia {
  n: number
  inicio: number
  fim: number
}

const REF = /\[imagem (\d+)\]/g

/** Referências válidas (1 ≤ N ≤ total), na ordem. Fora disso é texto comum.
 *  Mesma regra de `imagem_no_texto::referencias`. Puro. */
export function referencias(texto: string, total: number): Referencia[] {
  const out: Referencia[] = []
  for (const m of texto.matchAll(REF)) {
    const n = Number(m[1])
    if (n >= 1 && n <= total) out.push({ n, inicio: m.index, fim: m.index + m[0].length })
  }
  return out
}

/** As imagens do envio, na ordem: a primeira é a "[imagem 1]". Puro. */
export function imagensDoEnvio(anexos: readonly Attachment[]): Attachment[] {
  return anexos.filter((a) => a.kind === "image")
}

/** Caminhos das imagens citadas no texto: elas moram no texto, não na
 *  fileira de anexos. Puro. */
export function imagensCitadas(texto: string, anexos: readonly Attachment[]): Set<string> {
  const imgs = imagensDoEnvio(anexos)
  return new Set(referencias(texto, imgs.length).map((r) => imgs[r.n - 1].path))
}

/** O texto depois de a imagem N sair do envio: a referência dela some (com o
 *  espaço de antes, se sobraria espaço duplo) e as de número maior descem um,
 *  para continuarem apontando a mesma imagem. Puro. */
export function semAImagem(texto: string, n: number): string {
  return texto.replace(/( ?)\[imagem (\d+)\]/g, (inteiro, espaco: string, d: string, pos: number) => {
    const k = Number(d)
    if (k > n) return `${espaco}[imagem ${k - 1}]`
    if (k < n) return inteiro
    const depois = texto[pos + inteiro.length]
    return espaco && (depois === undefined || /[\s.,;:!?)]/.test(depois)) ? "" : espaco
  })
}

/** Várias imagens saindo de uma vez: da maior para a menor, para cada
 *  renumeração não mexer no número das que ainda vão sair. Puro. */
export function semReferencias(texto: string, numeros: readonly number[]): string {
  return [...numeros].sort((a, b) => b - a).reduce((t, n) => semAImagem(t, n), texto)
}

/** Texto de uma referência. Puro. */
export function referencia(n: number): string {
  return `[imagem ${n}]`
}
