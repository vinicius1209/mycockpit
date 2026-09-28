// O botão "❝ Citar" que aparece ao soltar uma seleção dentro de UMA mensagem
// do agente (capricho PRD R3). Seleção que cruza duas mensagens não mostra;
// Esc, rolar ou desfazer a seleção escondem. O mesmo gesto existe no menu do
// botão direito ("Citar trecho"), para quem usa teclado.

import { useEffect, useState } from "react"
import { Quote } from "lucide-react"
import { BarraDeSelecao } from "@/components/ui/barra-de-selecao"
import { controle } from "@/components/ui/controle"
import { citarTrecho } from "@/lib/citarTrecho"
import { cn } from "@/lib/utils"

interface AlvoDaCitacao {
  itemId: string
  selecao: string
  ancora: { right: number; bottom: number; top: number }
}

function citavelDe(no: Node | null): HTMLElement | null {
  const el = no instanceof Element ? no : (no?.parentElement ?? null)
  return el?.closest<HTMLElement>("[data-citavel]") ?? null
}

function alvoDaSelecao(): AlvoDaCitacao | null {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
  const origem = citavelDe(sel.anchorNode)
  if (!origem || origem !== citavelDe(sel.focusNode)) return null
  const selecao = sel.toString().trim()
  const itemId = origem.dataset.citavel
  if (!selecao || !itemId) return null
  const range = sel.getRangeAt(0)
  const retangulos = range.getClientRects()
  const fim = retangulos[retangulos.length - 1] ?? range.getBoundingClientRect()
  return { itemId, selecao, ancora: { right: fim.right, bottom: fim.bottom, top: fim.top } }
}

export function CitarTrecho() {
  const [alvo, setAlvo] = useState<AlvoDaCitacao | null>(null)

  useEffect(() => {
    // No quadro seguinte ao soltar: a seleção do navegador já assentou.
    const avaliar = () => requestAnimationFrame(() => setAlvo(alvoDaSelecao()))
    const aoMudar = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) setAlvo(null)
    }
    const esconder = () => setAlvo(null)
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") esconder()
      else if (e.shiftKey) avaliar()
    }
    document.addEventListener("mouseup", avaliar)
    document.addEventListener("selectionchange", aoMudar)
    document.addEventListener("keyup", aoTeclar)
    window.addEventListener("scroll", esconder, true)
    window.addEventListener("resize", esconder)
    return () => {
      document.removeEventListener("mouseup", avaliar)
      document.removeEventListener("selectionchange", aoMudar)
      document.removeEventListener("keyup", aoTeclar)
      window.removeEventListener("scroll", esconder, true)
      window.removeEventListener("resize", esconder)
    }
  }, [])

  if (!alvo) return null
  return (
    <BarraDeSelecao ancora={alvo.ancora} rotulo="Ações da seleção">
      <button
        type="button"
        onClick={() => {
          citarTrecho(alvo.itemId, alvo.selecao)
          setAlvo(null)
        }}
        className={cn(controle("chip"), "text-foreground transition-colors hover:bg-sel-hover")}
      >
        <Quote className="size-3 text-muted-foreground" />
        Citar
      </button>
    </BarraDeSelecao>
  )
}
