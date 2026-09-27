// As regras puras da edição (spec §7.4): sujo, reconciliar, fechar e contar.
// Nada aqui toca DOM, store ou IPC; os testes rodam sem montar o editor.

import type { Text } from "@codemirror/state"

/** Sujo é fato, não toque: o texto difere do que foi lido ou gravado.
 *  `Text.eq` compara tamanho e depois por pedaço, sem montar a string. */
export function estaSujo(doc: Text, base: Text): boolean {
  return !doc.eq(base)
}

export type Reconciliacao = "nada" | "recarregar" | "conflito" | "sumiu"

/** O que fazer quando o disco pode ter mudado. `noDisco` null = sumiu. */
export function reconciliar(
  b: { sujo: boolean; versao: string; versaoDoConflito: string | null },
  noDisco: string | null,
): Reconciliacao {
  if (noDisco === null) return "sumiu"
  if (noDisco === b.versao) return "nada"
  // Já avisado sobre esta mesma versão: a faixa está na tela, não repete.
  if (noDisco === b.versaoDoConflito) return "nada"
  return b.sujo ? "conflito" : "recarregar"
}

export interface Pergunta {
  chave: string
  caminho: string
  nome: string
}

export interface PlanoDeFechamento {
  /** Chaves que fecham sem perguntar. */
  fechaDireto: string[]
  /** Abas sujas que são a última cópia aberta daquele arquivo. */
  perguntar: Pergunta[]
}

export function nomeDoArquivo(chave: string): string {
  return chave.split("/").pop() || chave
}

/** Quem pergunta antes de fechar: arquivo sujo que nenhuma OUTRA conversa dona
 *  ainda tem aberto. Aba de diff e aba sem buffer nunca perguntam. */
export function planoDeFechamento(a: {
  chaves: readonly string[]
  convId: string
  caminhoDe: (chave: string) => string | null
  sujos: Readonly<Record<string, true>>
  donos: (caminho: string) => ReadonlyMap<string, string>
  abertaEm: (convId: string, chave: string) => boolean
}): PlanoDeFechamento {
  const plano: PlanoDeFechamento = { fechaDireto: [], perguntar: [] }
  const vistos = new Set<string>()
  for (const chave of a.chaves) {
    const caminho = a.caminhoDe(chave)
    if (!caminho || !a.sujos[caminho] || vistos.has(caminho)) {
      plano.fechaDireto.push(chave)
      continue
    }
    const outraAberta = [...a.donos(caminho)].some(
      ([conv, chaveDela]) => conv !== a.convId && a.abertaEm(conv, chaveDela),
    )
    if (outraAberta) plano.fechaDireto.push(chave)
    else {
      vistos.add(caminho)
      plano.perguntar.push({ chave, caminho, nome: nomeDoArquivo(chave) })
    }
  }
  return plano
}

export interface Contagem {
  /** Posição do achado selecionado (1…), ou 0 se a seleção não é um achado. */
  atual: number
  total: number
  /** Passou do teto: o total é "pelo menos". */
  passou: boolean
}

/** Conta os achados até o teto e acha a posição do que está selecionado. */
export function contarAchados(
  achados: Iterable<{ from: number; to: number }>,
  selecao: { from: number; to: number },
  teto = 1000,
): Contagem {
  let total = 0
  let atual = 0
  for (const m of achados) {
    total += 1
    if (!atual && m.from === selecao.from && m.to === selecao.to) atual = total
    if (total > teto) return { atual, total: teto, passou: true }
  }
  return { atual, total, passou: false }
}

const milhar = (n: number) => n.toLocaleString("pt-BR")

export function rotuloDaContagem(c: Contagem): string {
  if (c.total === 0) return "Nada"
  const total = c.passou ? `${milhar(c.total)}+` : milhar(c.total)
  if (c.atual) return `${milhar(c.atual)} de ${total}`
  return `${total} ${c.total === 1 && !c.passou ? "resultado" : "resultados"}`
}
