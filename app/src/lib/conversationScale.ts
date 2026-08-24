/** Escala de leitura da conversa, em degraus previsíveis como o zoom do browser.
 * O chrome do app e o composer não mudam: só o transcript usa este valor. */
export const CONVERSATION_SCALES = [
  0.8,
  0.9,
  1,
  1.1,
  1.2,
  1.3,
  1.4,
  1.5,
  1.6,
] as const

export const DEFAULT_CONVERSATION_SCALE = 1
export const CONVERSATION_COLUMN_WIDTH = 760

export type ConversationScaleAction = "decrease" | "increase" | "reset"

type ScaleShortcutEvent = Pick<
  KeyboardEvent,
  | "altKey"
  | "code"
  | "ctrlKey"
  | "metaKey"
  | "preventDefault"
  | "stopPropagation"
>

/** Valor persistido pode vir de uma versão futura, edição manual ou storage
 * corrompido. A UI sempre trabalha numa parada conhecida da escala. */
export function normalizeConversationScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_CONVERSATION_SCALE
  return CONVERSATION_SCALES.reduce((nearest, candidate) =>
    Math.abs(candidate - value) < Math.abs(nearest - value) ? candidate : nearest,
  )
}

export function stepConversationScale(
  value: number,
  direction: -1 | 1,
): number {
  const normalized = normalizeConversationScale(value)
  const index = CONVERSATION_SCALES.indexOf(
    normalized as (typeof CONVERSATION_SCALES)[number],
  )
  const next = Math.max(
    0,
    Math.min(CONVERSATION_SCALES.length - 1, index + direction),
  )
  return CONVERSATION_SCALES[next]
}

export function conversationScalePercent(value: number): string {
  return `${Math.round(normalizeConversationScale(value) * 100)}%`
}

/**
 * O estilo da coluna do fio. `width` é **100%, sem compensação nenhuma** — e
 * isso é contraintuitivo o bastante pra merecer o parágrafo abaixo.
 *
 * A tentação (e o que estava aqui antes) é `width: 100 / scale`, pra "desfazer"
 * o zoom. Em Chrome moderno isso é COMPENSAR DUAS VEZES: no `zoom`
 * padronizado, uma porcentagem resolve contra o bloco contentor JÁ AJUSTADO
 * pelo zoom do próprio elemento. Um pai de 760px vira 950px de contentor para
 * um filho com `zoom: 0.8`, então `width: 100%` já pinta exatos 760px.
 *
 * MEDIDO no navegador (varredura de `elementFromPoint`, coordenada visual),
 * pai de 760px:
 *
 * | escala | com `100/scale` | com `100%` |
 * |---|---|---|
 * | 0,8 | **950px** (transborda o pai) | 760px |
 * | 1,0 | 760px | 760px |
 * | 1,3 | **585px** (coluna encolhe) | 760px |
 *
 * Por que ninguém viu antes: a versão de uma div só tinha
 * `max-width: 760 / scale`, e era o CLAMP que entregava os 760 — a largura
 * percentual já estava errada e invisível. Ao mover o teto para um pai sem
 * zoom, o clamp saiu de cena e o erro apareceu nos dois sentidos.
 */
export function conversationColumnStyle(value: number): {
  width: string
  zoom: number
} {
  return { width: "100%", zoom: normalizeConversationScale(value) }
}

/** ⌘/Ctrl +, ⌘/Ctrl - e ⌘/Ctrl 0. Usamos `code`, não o caractere, porque `+`
 * normalmente chega como Shift+Equal e varia conforme o layout do teclado. */
export function conversationScaleAction(
  event: Pick<ScaleShortcutEvent, "altKey" | "code" | "ctrlKey" | "metaKey">,
): ConversationScaleAction | null {
  if ((!event.metaKey && !event.ctrlKey) || event.altKey) return null
  if (event.code === "Equal" || event.code === "NumpadAdd") return "increase"
  if (event.code === "Minus" || event.code === "NumpadSubtract") return "decrease"
  if (event.code === "Digit0" || event.code === "Numpad0") return "reset"
  return null
}

/** Consome o atalho para o WebView não aplicar zoom à janela inteira e devolve
 * a nova escala. `null` significa que a tecla não pertence a esta feature. */
export function scaleFromShortcut(
  event: ScaleShortcutEvent,
  current: number,
): number | null {
  const action = conversationScaleAction(event)
  if (!action) return null
  event.preventDefault()
  event.stopPropagation()
  if (action === "reset") return DEFAULT_CONVERSATION_SCALE
  return stepConversationScale(current, action === "increase" ? 1 : -1)
}
