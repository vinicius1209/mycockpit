// Colar texto grande no composer vira pílula (capricho PRD R7). Módulo irmão do
// `LexicalComposer` (perto do teto de tamanho): o plugin de colar só pergunta
// `virouPilula(texto)` antes de inserir.
//
// ⌘⇧V (Ctrl⇧V fora do Mac) cola como texto: o atalho arma um passe único para
// a próxima colagem. Se o motor do WebView não disparar colagem para esse
// atalho, nada muda; "Inserir como texto" na prévia da pílula faz o mesmo.

import { ehColagemGrande } from "@/lib/colagem"
import { useChat } from "@/store/chat"
import { useComposerDrafts } from "@/store/composerDrafts"

let colarComoTexto = false
let desarmar: ReturnType<typeof setTimeout> | null = null

function aoTeclar(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "v") {
    colarComoTexto = true
    if (desarmar) clearTimeout(desarmar)
    desarmar = setTimeout(() => (colarComoTexto = false), 1_000)
  }
}

if (typeof document !== "undefined") document.addEventListener("keydown", aoTeclar, true)

/** A colagem virou bloco do rascunho? `false` = o editor insere como sempre. */
export function virouPilula(texto: string): boolean {
  if (colarComoTexto) {
    colarComoTexto = false
    return false
  }
  if (!ehColagemGrande(texto)) return false
  const convId = useChat.getState().activeId
  if (!convId) return false
  useComposerDrafts.getState().addColagem(convId, texto)
  return true
}
