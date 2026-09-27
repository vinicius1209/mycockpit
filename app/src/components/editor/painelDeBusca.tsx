// A fábrica do painel de busca que o CodeMirror monta (`search({ createPanel })`).
// O painel é um React próprio, redesenhado a cada atualização relevante do
// editor; a verdade continua sendo o `SearchQuery` do CodeMirror.

import { createRoot } from "react-dom/client"
import { setSearchQuery } from "@codemirror/search"
import type { EditorView, Panel, ViewUpdate } from "@codemirror/view"
import { BuscaNoArquivo } from "@/components/editor/BuscaNoArquivo"
import { mostrarSubstituir } from "@/components/editor/estadoDaBusca"

function relevante(u: ViewUpdate): boolean {
  return (
    u.docChanged ||
    u.selectionSet ||
    u.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery) || e.is(mostrarSubstituir)))
  )
}

export function criarPainelDeBusca(view: EditorView): Panel {
  const dom = document.createElement("div")
  const raiz = createRoot(dom)
  let tique = 0
  const desenhar = () => raiz.render(<BuscaNoArquivo view={view} tique={++tique} />)
  return {
    dom,
    top: true,
    mount: desenhar,
    update: (u) => {
      if (relevante(u)) desenhar()
    },
    // Desmontar o React no meio de uma atualização do editor avisa; fora dela, não.
    destroy: () => queueMicrotask(() => raiz.unmount()),
  }
}
