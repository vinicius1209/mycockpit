// Movimento no fio conta um EVENTO que acabou de acontecer (ADR-179).
//
// Abrir uma conversa, rolar até o histórico, trocar de aba ou a janela voltar de
// uma oclusão NÃO são eventos: o que aparece assim chega pronto. O jeito honesto
// de separar "nasceu agora" de "já existia" é o carimbo de nascimento que todo
// item do fio carrega (`ts`, Date.now() na criação). Quem nasceu há menos de
// `JANELA_NASCIMENTO_MS` está nascendo na frente da pessoa; o resto é histórico.
//
// Por que carimbo e não um Set de ids "já mostrados": o Set animaria, na
// primeira visita, TUDO que nasceu enquanto a pessoa estava em outra conversa,
// uma cascata de quarenta itens entrando ao abrir. O precedente a não repetir é
// o `PlanMilestone` antigo, que refazia a entrada a cada montagem.

import { useRef, useState } from "react"

/** Idade máxima (ms) de um item que ainda conta como "nascendo agora". Cobre a
 *  distância entre o reduce que carimba e a montagem que pinta, com folga para
 *  um quadro lento; curta o bastante para reabrir uma conversa não reencenar. */
export const JANELA_NASCIMENTO_MS = 1500

/** Puro: `ts` nasceu dentro da janela? Sem carimbo (legado) nunca anima, e
 *  carimbo no futuro (relógio que andou para trás) também não. */
export function nasceuAgora(
  ts: number | null | undefined,
  now: number = Date.now(),
): boolean {
  if (ts == null || !Number.isFinite(ts)) return false
  const idade = now - ts
  return idade >= 0 && idade < JANELA_NASCIMENTO_MS
}

/** Decide UMA vez, na montagem. Re-render não liga nem desliga a entrada no
 *  meio do caminho: a classe permanece e a animação de CSS não reinicia
 *  enquanto o elemento vive. Remontar depois da janela devolve `false`. */
export function useNasceuAgora(ts: number | null | undefined): boolean {
  const [nasceu] = useState(() => nasceuAgora(ts))
  return nasceu
}

export interface RegistroDeTroca<T> {
  inicial: T
  trocou: boolean
}

/** Puro: o valor já saiu do que estava na montagem? Uma vez trocado, segue
 *  trocado mesmo se voltar ao inicial, porque a volta também é um evento. */
export function registrarTroca<T>(reg: RegistroDeTroca<T>, valor: T): RegistroDeTroca<T> {
  if (reg.trocou || Object.is(reg.inicial, valor)) return reg
  return { inicial: reg.inicial, trocou: true }
}

/** Para ESTADO que muda num elemento que já existe (o slot da sidebar): montar
 *  não anima, a primeira troca em diante sim. Combine com `key={valor}` no
 *  glifo para cada troca remontar a entrada. */
export function useTrocou<T>(valor: T): boolean {
  const reg = useRef<RegistroDeTroca<T>>({ inicial: valor, trocou: false })
  reg.current = registrarTroca(reg.current, valor)
  return reg.current.trocou
}

/** Carimbos da CAUDA do fio (id → ts). Só o que está no fim pode estar
 *  nascendo: olhar os últimos `n` itens mantém o custo fixo por token, em vez
 *  de varrer o fio inteiro a cada delta (guarda `fio.fluidez`). Id fora do
 *  mapa é histórico, e histórico chega pronto. */
export function tsDaCauda(
  items: readonly { id: string; ts?: number }[],
  n = 24,
): Map<string, number | undefined> {
  const mapa = new Map<string, number | undefined>()
  for (let i = Math.max(0, items.length - n); i < items.length; i++) {
    mapa.set(items[i].id, items[i].ts)
  }
  return mapa
}
