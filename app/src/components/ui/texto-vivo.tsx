// O TEXTO VIVO (ADR-259, mock `docs/mocks/sinal-de-vivo-v2.html`, T1): a
// frase é o próprio sinal. Uma faixa de luz atravessa o texto e descansa, sem
// ícone ao lado. Usado na linha viva do fio ("está trabalhando…").
//
// A frase NÃO muda por causa disto: o que ela diz continua vindo de evento
// real (WorkingIndicator). Só a luz anda.
//
// A faixa vem de `lib/relogioDoVivo.ts`, não de `@keyframes`, pelo mesmo
// motivo do cometa: a oclusão da janela no macOS congelava animação de CSS.
// Com reduced-motion, o texto fica parado em cor plena.

import { useEffect, useRef, type ReactNode } from "react"
import { assinarRelogio, faixaDoBrilhoEm } from "@/lib/relogioDoVivo"
import { cn } from "@/lib/utils"

const FAIXA =
  "linear-gradient(90deg, var(--muted-foreground) 0 38%, var(--foreground) 50%, var(--muted-foreground) 62% 100%)"

/** Veste ou despe o recorte da luz. Parado: a frase na cor do texto em volta. */
function vestir(el: HTMLElement, vivo: boolean) {
  el.dataset.parado = String(!vivo)
  el.style.backgroundImage = vivo ? FAIXA : ""
  el.style.backgroundSize = vivo ? "250% 100%" : ""
  el.style.backgroundClip = vivo ? "text" : ""
  el.style.setProperty("-webkit-background-clip", vivo ? "text" : "")
  el.style.color = vivo ? "transparent" : ""
}

export function TextoVivo({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let vestido = false
    return assinarRelogio((ms, parado) => {
      const el = ref.current
      if (!el) return
      if (vestido === parado) {
        vestir(el, !parado)
        vestido = !parado
      }
      if (!parado) el.style.backgroundPosition = `${faixaDoBrilhoEm(ms)}% 0`
    })
  }, [])
  return (
    <span ref={ref} data-vivo="texto" data-parado="true" className={cn(className)}>
      {children}
    </span>
  )
}
