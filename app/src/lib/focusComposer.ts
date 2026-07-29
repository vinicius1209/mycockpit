/** Foco programático do composer da conversa a partir de FORA do React
 *  (tray://new-task, iniciar card, "pedir correção" do diff): acha o editor
 *  pelo alvo estável `data-composer="console"` (o contenteditable do Lexical),
 *  foca e leva o caret pro fim — equivalente ao setSelectionRange(len, len)
 *  que os call sites faziam no textarea. O Lexical reconcilia a seleção DOM
 *  colapsada no fim como caret no fim do draft. */
export function focusConsoleComposer() {
  const el = document.querySelector<HTMLElement>('[data-composer="console"]')
  if (!el) return
  el.focus()
  const sel = window.getSelection()
  if (sel) {
    sel.selectAllChildren(el)
    sel.collapseToEnd()
  }
}
