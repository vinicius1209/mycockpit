// O estado que o painel de busca guarda no próprio editor: se a linha de
// substituir está aberta. `⌘⌥F` / `Ctrl+H` abrem com ela.

import { StateEffect, StateField } from "@codemirror/state"

export const mostrarSubstituir = StateEffect.define<boolean>()
export const campoDeSubstituir = StateField.define<boolean>({
  create: () => false,
  update: (v, tr) => tr.effects.reduce((acc, e) => (e.is(mostrarSubstituir) ? e.value : acc), v),
})
