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
