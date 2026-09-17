// A contabilidade de TOKENS do recibo do turno: entrada, saída, contexto
// reaproveitado do cache e contexto reenviado.
//
// ADR-199: nada disto é mais texto na linha do recibo. Entrada e saída não
// mudam decisão nenhuma (e "10↓" enganava, porque exclui o cache lido), e o
// "+419k reconstruído" em âmbar gritava em todo turno sem pedir nada. Tudo vira
// a quebra do custo, no tooltip de quem ocupa a ponta do recibo.
//
// O PORQUÊ do contexto reenviado custar caro está em `lib/cacheDoTurno`.

import { fmtTokens } from "@/lib/format"
import { divisaoDoCacheDoTurno } from "@/lib/cacheDoTurno"

export interface UsageDoRecibo {
  input: number
  output: number
  cacheRead: number
  cacheCreation?: number
}

/** Linhas da quebra de tokens do turno, para tooltip. Vazio quando não há o
 *  que dizer: nada de tooltip pendurado em "Entrada: 0". Puro. */
export function resumoDosTokens(usage?: UsageDoRecibo): string[] {
  if (!usage) return []
  const d = divisaoDoCacheDoTurno(usage)
  const temIO = usage.input > 0 || usage.output > 0
  if (!temIO && !d.lido && !d.reconstruido) return []
  const linhas: string[] = []
  if (temIO) {
    linhas.push(`Entrada: ${fmtTokens(usage.input)}`, `Saída: ${fmtTokens(usage.output)}`)
  }
  if (d.lido > 0) linhas.push(`Contexto reaproveitado do cache: ${fmtTokens(d.lido)}`)
  // Só aparece quando houve: o reenvio custa mais por token que o reaproveitado.
  if (d.reconstruido > 0) {
    linhas.push(`Contexto reenviado: ${fmtTokens(d.reconstruido)} (custa mais por token)`)
  }
  return linhas
}
