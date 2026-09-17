// Barra que aparece junto de uma seleção de texto (capricho PRD R3, decisão 3).
//
// Primitiva própria porque Popover e DropdownMenu tiram o foco e desfazem a
// seleção ao abrir, e o gesto de citar depende de a seleção continuar ali.
// Aqui nada rouba foco: o `mousedown` é cancelado, a barra fica em portal com
// posição fixa perto do fim da seleção e some com Esc (quem monta decide).

import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

/** Folga entre o fim da seleção e a barra, e até a borda da janela. */
const FOLGA = 6

export function BarraDeSelecao({
  ancora,
  rotulo,
  className,
  children,
}: {
  /** Retângulo do fim da seleção, em coordenadas da janela. */
  ancora: { right: number; bottom: number; top: number }
  rotulo: string
  className?: string
  children: React.ReactNode
}) {
  const largura = typeof window === "undefined" ? 0 : window.innerWidth
  const altura = typeof window === "undefined" ? 0 : window.innerHeight
  // Abaixo do fim da seleção; sem espaço embaixo, sobe para acima dela.
  const top = ancora.bottom + FOLGA + 24 > altura ? ancora.top - FOLGA - 24 : ancora.bottom + FOLGA
  const left = Math.min(Math.max(ancora.right - 12, FOLGA), largura - FOLGA - 96)
  return createPortal(
    <div
      role="toolbar"
      aria-label={rotulo}
      style={{ top, left }}
      onMouseDown={(e) => e.preventDefault()}
      className={cn("fixed z-50 flex items-center rounded-full shadow-[var(--shadow-pop)]", className)}
    >
      {children}
    </div>,
    document.body,
  )
}
