// A árvore de processos de um turno como o painel da máquina a desenha
// (ADR-263, mock `docs/mocks/processos-do-turno.html`).
//
// Uma linha por processo, com duas exceções que tiram ruído sem esconder
// nada: as ferramentas do próprio Frota que são irmãs viram uma linha só
// ("aprovações, navegador, contexto"), e processos irmãos idênticos viram
// "nome ×N" (os renderizadores de um Chromium). A soma de memória e CPU do
// grupo é a dos membros; o hover diz o comando de cada um.

import type { PapelDoProcesso, ProcessoNaArvore } from "@/lib/maquina"

export interface LinhaDaArvore {
  chave: string
  profundidade: number
  papel: PapelDoProcesso
  nome: string
  executor: string | null
  /** O que o hover mostra: o comando inteiro, ou um por linha no grupo. */
  comando: string
  rssMb: number
  cpuPct: number
  tempoS: number
  pids: number[]
  /** Dá para encerrar daqui: um processo só, que não é o motor (esse é o
   *  Parar) nem uma ferramenta do Frota (ela é do turno, não do agente). */
  encerravel: boolean
}

export const PAPEL: Record<PapelDoProcesso, string> = {
  motor: "motor",
  comando: "comando",
  mcp: "MCP",
  frota: "Frota",
  processo: "processo",
}

/** Pai de cada processo, pela ordem em profundidade que o Rust manda. */
function pais(processos: ProcessoNaArvore[]): (number | null)[] {
  const pilha: ProcessoNaArvore[] = []
  return processos.map((p) => {
    while (pilha.length > p.profundidade) pilha.pop()
    const pai = pilha.at(-1)?.pid ?? null
    pilha.push(p)
    return pai
  })
}

/** As linhas do painel, na ordem da árvore. Puro. */
export function linhasDaArvore(processos: ProcessoNaArvore[]): LinhaDaArvore[] {
  const paiDe = pais(processos)
  const temFilho = new Set(paiDe.filter((p): p is number => p != null))
  // Chave de grupo: só folhas agrupam, e só entre irmãs.
  const chaveDe = (p: ProcessoNaArvore, i: number) =>
    temFilho.has(p.pid) ? null : p.papel === "frota" ? `${paiDe[i]}:frota` : `${paiDe[i]}:${p.papel}:${p.nome}`
  const tamanho = new Map<string, number>()
  processos.forEach((p, i) => {
    const k = chaveDe(p, i)
    if (k) tamanho.set(k, (tamanho.get(k) ?? 0) + 1)
  })

  const linhas: LinhaDaArvore[] = []
  const grupos = new Map<string, LinhaDaArvore>()
  processos.forEach((p, i) => {
    const k = chaveDe(p, i)
    const agrupa = k != null && (tamanho.get(k) ?? 0) > 1
    const existente = agrupa ? grupos.get(k) : undefined
    if (existente) {
      existente.pids.push(p.pid)
      existente.rssMb += p.rssMb
      existente.cpuPct += p.cpuPct
      existente.tempoS = Math.max(existente.tempoS, p.tempoS)
      existente.comando += `\n${p.comando}`
      if (p.papel === "frota") existente.nome += `, ${p.nome}`
      return
    }
    const linha: LinhaDaArvore = {
      chave: agrupa ? k : String(p.pid),
      profundidade: p.profundidade,
      papel: p.papel,
      nome: p.nome,
      executor: p.executor,
      comando: p.comando,
      rssMb: p.rssMb,
      cpuPct: p.cpuPct,
      tempoS: p.tempoS,
      pids: [p.pid],
      encerravel: !agrupa && p.papel !== "motor" && p.papel !== "frota",
    }
    if (agrupa) grupos.set(k, linha)
    linhas.push(linha)
  })
  // "nome ×N" para os grupos de iguais (o do Frota já lista os nomes).
  for (const l of linhas) if (l.pids.length > 1 && l.papel !== "frota") l.nome = `${l.nome} ×${l.pids.length}`
  return linhas
}
