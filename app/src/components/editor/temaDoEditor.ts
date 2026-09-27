// O tema do editor (spec §7.6). Só VARIÁVEIS do `index.css`, nenhum hex: um
// tema serve claro e escuro, porque `.dark` troca as variáveis.
//
// As cores de código são as mesmas `--hljs-*` do visualizador estático e do
// fio: o mesmo trecho tem a mesma cor em todo lugar.
//
// Seleção, achado de busca e linha ativa são NEUTROS (tons do `--foreground`):
// seleção não é cor, nem âmbar nem brass (STYLEGUIDE §2, ADR-043).

import { HighlightStyle, syntaxHighlighting } from "@codemirror/language"
import { EditorView } from "@codemirror/view"
import { tags as t } from "@lezer/highlight"

const tom = (pct: number) => `color-mix(in srgb, var(--foreground) ${pct}%, transparent)`

export const temaDoEditor = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "12px",
    color: "var(--foreground)",
    backgroundColor: "color-mix(in srgb, var(--background) 40%, transparent)",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.55" },
  ".cm-content": { padding: "16px 0", caretColor: "var(--foreground)" },
  ".cm-line": { padding: "0 16px" },
  // O gutter repete o do visualizador estático: `bg-card` e o divisor interno.
  ".cm-gutters": {
    backgroundColor: "var(--card)",
    color: "color-mix(in srgb, var(--muted-foreground) 40%, transparent)",
    borderRight: "1px solid color-mix(in srgb, var(--border) 40%, transparent)",
  },
  ".cm-lineNumbers .cm-gutterElement": { padding: "0 12px 0 14px", fontVariantNumeric: "tabular-nums" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--muted-foreground)" },
  ".cm-activeLine": { backgroundColor: "var(--sel-hover)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: tom(18) },
  ".cm-selectionMatch": { backgroundColor: "var(--sel)" },
  ".cm-searchMatch": { backgroundColor: tom(10), outline: `1px solid ${tom(22)}`, borderRadius: "2px" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: tom(26) },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "var(--sel)", outline: `1px solid ${tom(22)}` },
  // O painel de busca flutua no canto do texto (mock, seção 1), não ocupa a
  // faixa inteira de cima como o painel padrão do CodeMirror.
  ".cm-panels": { backgroundColor: "transparent", color: "inherit" },
  ".cm-panels.cm-panels-top": {
    position: "absolute",
    top: "8px",
    right: "12px",
    left: "auto",
    borderBottom: "none",
    zIndex: "10",
  },
})

/** Espelha o mapa das classes `.hljs-*` do `index.css`. */
export const realceDoEditor = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.comment, t.quote], color: "var(--muted-foreground)", fontStyle: "italic" },
    {
      tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier, t.tagName, t.bool, t.null, t.atom],
      color: "var(--hljs-keyword)",
    },
    { tag: [t.string, t.special(t.string), t.attributeName, t.regexp, t.character], color: "var(--hljs-string)" },
    { tag: [t.number, t.standard(t.variableName)], color: "var(--hljs-number)" },
    {
      tag: [t.function(t.variableName), t.function(t.propertyName), t.className, t.heading, t.definition(t.typeName)],
      color: "var(--hljs-title)",
    },
    { tag: [t.typeName, t.definition(t.variableName), t.attributeValue, t.labelName], color: "var(--hljs-variable)" },
    { tag: [t.meta, t.processingInstruction], color: "var(--muted-foreground)" },
    { tag: t.emphasis, fontStyle: "italic" },
    { tag: t.strong, fontWeight: "600" },
    { tag: t.link, textDecoration: "underline" },
  ]),
)
