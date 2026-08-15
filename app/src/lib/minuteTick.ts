// TICKER ÚNICO DE MINUTO (STYLEGUIDE §6, "slot da linha de conversa").
//
// Rótulo relativo ("agora · 9m · 1h · 3d") mofa sozinho: nada no store muda
// quando o tempo passa, então alguém precisa olhar o relógio. O erro barato
// seria um `setInterval` por linha — 40 conversas viram 40 assinaturas de
// relógio pra responder a MESMA pergunta. Aqui é o padrão do
// `lib/watchdog.ts`: um ticker de módulo, ligado no primeiro assinante e
// desligado no último, com todo mundo lendo o mesmo instante.
//
// Nunca segundos: a linha viva do rodapé é a dona única do agora (§6). Este
// ticker existe pra minuto pra cima, e por isso 60s é o período.

const PERIODO_MS = 60_000

type Ouvinte = () => void

const ouvintes = new Set<Ouvinte>()
let timer: ReturnType<typeof setInterval> | null = null
let agora = Date.now()

/** Relógio injetável (teste). Produção usa `Date.now`. */
let relogio: () => number = () => Date.now()

/** Só para teste: troca o relógio e devolve a função que restaura o original. */
export function _setRelogio(fn: () => number): () => void {
  relogio = fn
  agora = fn()
  return () => {
    relogio = () => Date.now()
    agora = relogio()
  }
}

/** Só para teste: derruba o ticker e a lista de ouvintes. */
export function _resetMinuteTick(): void {
  if (timer) clearInterval(timer)
  timer = null
  ouvintes.clear()
}

function tick() {
  agora = relogio()
  for (const ouvinte of ouvintes) ouvinte()
}

/**
 * Assina o minuto. Devolve o cancelamento (contrato do `useSyncExternalStore`).
 * O primeiro assinante liga o interval e re-lê o relógio (senão um componente
 * montado logo depois herdaria um instante de até 60s atrás); o último a sair
 * o desliga, porque ticker que sobrevive à tela é vazamento.
 */
export function subscribeMinute(ouvinte: Ouvinte): () => void {
  ouvintes.add(ouvinte)
  if (!timer) {
    agora = relogio()
    timer = setInterval(tick, PERIODO_MS)
  }
  return () => {
    ouvintes.delete(ouvinte)
    if (ouvintes.size === 0 && timer) {
      clearInterval(timer)
      timer = null
    }
  }
}

/**
 * Instante compartilhado, em epoch ms. É ESTÁVEL entre ticks de propósito: o
 * `useSyncExternalStore` compara o snapshot por identidade e um `Date.now()`
 * aqui faria o React re-renderizar em loop.
 */
export function minuteNow(): number {
  return agora
}

/** Quantos ouvintes o ticker tem agora (diagnóstico e teste). */
export function _ouvintesDoMinuto(): number {
  return ouvintes.size
}
