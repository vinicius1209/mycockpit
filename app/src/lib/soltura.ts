// Soltar no composer: regras puras.
//
// De FORA (capricho PRD R6): imagem e PDF viram anexo (a mesma allowlist do
// Rust); o resto vira CARTÃO de arquivo (ADR-252), bloco do rascunho com o
// caminho absoluto. Pasta vira cartão de pasta. Antes o resto virava menção
// `@caminho` em texto cru: o mesmo gesto dava dois resultados.
//
// De DENTRO (R8): o que já está na janela não precisa passar pelo disco.
// Arquivo da árvore vira o mesmo cartão; texto selecionado vira bloco do
// rascunho (colagem grande) ou texto direto, pela MESMA régua do colar (R7),
// senão o mesmo conteúdo teria dois destinos dependendo do gesto.

import { MAX_ATTACH_BYTES, MAX_ATTACH_COUNT, MAX_ATTACH_MB } from "@/lib/attachments"
import type { BlocoArquivo } from "@/lib/arquivoCitado"
import { ehColagemGrande } from "@/lib/colagem"
import type { CargaArrastada } from "@/lib/arrastoInterno"

export interface CaminhoSolto {
  path: string
  pasta: boolean
  bytes: number
}

export interface PlanoDaSoltura {
  /** Caminhos absolutos que vão para `attachPath`, na ordem soltada. */
  anexos: string[]
  /** Cartões de arquivo, na ordem soltada, sem repetir caminho. */
  arquivos: BlocoArquivo[]
  /** Frases prontas para avisar o que ficou de fora. */
  recusados: string[]
}

/** Extensões que o anexo aceita (espelho de `ext_for_mime` em attachments.rs). */
const ANEXAVEIS = new Set(["png", "jpg", "jpeg", "webp", "gif", "pdf"])

function nomeDe(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

function extensao(path: string): string {
  const nome = nomeDe(path)
  const ponto = nome.lastIndexOf(".")
  return ponto > 0 ? nome.slice(ponto + 1).toLowerCase() : ""
}

/** O cartão de um caminho absoluto. O id sai do caminho: soltar o mesmo
 *  arquivo duas vezes dá o mesmo cartão, e o teste não depende de sorteio. */
export function cartaoDoCaminho(caminho: string, pasta: boolean, bytes: number): BlocoArquivo {
  return { tipo: "arquivo", id: `arquivo:${caminho}`, caminho, pasta, bytes }
}

export function planoDaSoltura(
  itens: readonly CaminhoSolto[],
  contexto: { anexosAtuais: number },
): PlanoDaSoltura {
  const plano: PlanoDaSoltura = { anexos: [], arquivos: [], recusados: [] }
  let anexos = contexto.anexosAtuais
  for (const item of itens) {
    if (!item.pasta && ANEXAVEIS.has(extensao(item.path))) {
      if (item.bytes > MAX_ATTACH_BYTES) {
        plano.recusados.push(`"${nomeDe(item.path)}" excede ${MAX_ATTACH_MB} MB`)
      } else if (anexos >= MAX_ATTACH_COUNT) {
        plano.recusados.push(`"${nomeDe(item.path)}" ficou de fora: máx. ${MAX_ATTACH_COUNT} anexos por mensagem`)
      } else {
        plano.anexos.push(item.path)
        anexos++
      }
      continue
    }
    if (!plano.arquivos.some((a) => a.caminho === item.path)) {
      plano.arquivos.push(cartaoDoCaminho(item.path, item.pasta, item.bytes))
    }
  }
  return plano
}

/** A posição do evento do Tauri vem em pixels físicos; o retângulo do DOM, em
 *  CSS. Dentro do composer? */
export function dentroDoRetangulo(
  posicao: { x: number; y: number },
  escala: number,
  ret: { left: number; top: number; right: number; bottom: number },
): boolean {
  const x = posicao.x / (escala || 1)
  const y = posicao.y / (escala || 1)
  return x >= ret.left && x <= ret.right && y >= ret.top && y <= ret.bottom
}

/** O verbo diz o resultado (docs/explorador-de-arquivos-prd.md, D5): "anexar"
 *  só para o que vira anexo de verdade (imagem, PDF); o resto é citado, como
 *  cartão. Vale para o que vem do Finder e da árvore. `pasta` desconhecida
 *  (o Finder só dá o caminho) não inventa "a pasta". Puro. */
export function rotuloDosCaminhos(itens: readonly { caminho: string; pasta?: boolean }[]): string {
  const anexa = (i: { caminho: string; pasta?: boolean }) => !i.pasta && ANEXAVEIS.has(extensao(i.caminho))
  if (itens.length !== 1) {
    return `Solte para ${itens.every(anexa) ? "anexar" : "citar"} ${itens.length} itens`
  }
  const [item] = itens
  if (anexa(item)) return `Solte para anexar ${nomeDe(item.caminho)}`
  return item.pasta ? `Solte para citar a pasta ${nomeDe(item.caminho)}` : `Solte para citar ${nomeDe(item.caminho)}`
}

/** Os caminhos absolutos de uma carga de arquivo: a árvore manda relativo à
 *  raiz (um item) ou já absoluto (vários). Puro. */
export function caminhosDaCarga(
  carga: CargaArrastada,
  projectPath: string | null,
): { caminho: string; pasta: boolean }[] {
  const raiz = projectPath?.replace(/\/+$/, "")
  const absoluto = (c: string) => (raiz && !c.startsWith("/") ? `${raiz}/${c}` : c)
  if (carga.tipo === "arquivo") return [{ caminho: absoluto(carga.caminho), pasta: carga.pasta }]
  if (carga.tipo === "arquivos") return carga.itens.map((i) => ({ caminho: absoluto(i.caminho), pasta: i.pasta }))
  return []
}

/** A coluna da conversa inteira só aceita arquivo: texto e imagem do fio
 *  continuam indo para o composer, senão arrastar uma seleção no próprio fio
 *  já acenderia o alvo. Puro. */
export function aceitaNaConversa(carga: CargaArrastada): boolean {
  return carga.tipo === "arquivo" || carga.tipo === "arquivos"
}

/** Um anexo a mais no rascunho: o mesmo arquivo não entra duas vezes e o teto
 *  recusa em vez de empurrar outro para fora. A mesma regra da captura de
 *  página (`anexosComCaptura`), aqui para qualquer anexo. */
export function anexosComOutro<T extends { path: string }>(
  atuais: readonly T[],
  novo: T,
): { anexos: T[]; coube: boolean } {
  if (atuais.some((a) => a.path === novo.path)) return { anexos: [...atuais], coube: true }
  if (atuais.length >= MAX_ATTACH_COUNT) return { anexos: [...atuais], coube: false }
  return { anexos: [...atuais, novo], coube: true }
}

export type PlanoDoArrasto =
  | { acao: "anexo"; anexo: { path: string; name: string } }
  | { acao: "arquivo"; bloco: BlocoArquivo }
  | { acao: "colagem"; texto: string }
  | { acao: "texto"; texto: string }
  | { acao: "nada" }

/** O que soltar no composer faz com cada carga arrastada de dentro do app.
 *  Carga de reordenação (projeto, conversa) não tem o que fazer aqui: o
 *  composer recusa em silêncio, que é o comportamento honesto para um gesto
 *  que a pessoa começou em outro contexto. O arquivo da árvore chega com o
 *  caminho relativo à raiz: `projectPath` o faz absoluto. */
export function planoDoArrasto(carga: CargaArrastada, projectPath: string | null = null): PlanoDoArrasto {
  if (carga.tipo === "arquivo") {
    const raiz = projectPath?.replace(/\/+$/, "")
    const caminho = raiz && !carga.caminho.startsWith("/") ? `${raiz}/${carga.caminho}` : carga.caminho
    return { acao: "arquivo", bloco: cartaoDoCaminho(caminho, carga.pasta, 0) }
  }
  if (carga.tipo === "imagem") {
    return { acao: "anexo", anexo: { path: carga.anexo.path, name: carga.anexo.name } }
  }
  if (carga.tipo === "texto") {
    const texto = carga.texto.trim()
    if (!texto) return { acao: "nada" }
    return ehColagemGrande(texto) ? { acao: "colagem", texto } : { acao: "texto", texto }
  }
  return { acao: "nada" }
}

/** O rótulo do alvo aceso, que diz o que vai acontecer ANTES de soltar. */
export function rotuloDoArrasto(carga: CargaArrastada): string | null {
  if (aceitaNaConversa(carga)) return rotuloDosCaminhos(caminhosDaCarga(carga, null))
  const plano = planoDoArrasto(carga)
  if (plano.acao === "nada") return null
  if (plano.acao === "anexo") return `Solte para anexar ${plano.anexo.name}`
  if (plano.acao === "arquivo") return `Solte para anexar ${nomeDe(plano.bloco.caminho)}`
  return plano.acao === "colagem"
    ? "Solte para anexar o trecho como bloco"
    : "Solte para citar o trecho"
}
