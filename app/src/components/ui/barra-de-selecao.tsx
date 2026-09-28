// Barra que aparece junto de uma seleção de texto (capricho PRD R3, decisão 3).
//
// Primitiva própria porque Popover e DropdownMenu tiram o foco e desfazem a
// seleção ao abrir, e o gesto de citar depende de a seleção continuar ali.
// Aqui nada rouba foco: o `mousedown` é cancelado, a barra fica em portal com
// posição fixa perto do fim da seleção e some com Esc (quem monta decide).
//
// A superfície é a E2 dos painéis flutuantes (STYLEGUIDE §4, §12): é comando,
// não dica, e não pode se vestir de tooltip.

import { createPortal } from "react-dom"
import { SUPERFICIE_DO_PAINEL } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

/** Folga entre o fim da seleção e a barra, e até a borda da janela. */
const FOLGA = 6
/** Altura da barra: um controle `chip` (24px) e 2px de respiro em volta. */
const ALTURA = 28
/** Largura estimada, só para não vazar da janela pela direita. */
const LARGURA = 96

export interface AncoraDaSelecao {
  right: number
  bottom: number
  top: number
}

/** Onde a barra fica. Acima da última linha da seleção, cobrindo no máximo o
 *  que você acabou de selecionar e nunca o texto que vem depois; sem espaço
 *  em cima, desce. Puro. */
export function posicaoDaBarra(
  ancora: AncoraDaSelecao,
  janela: { largura: number; altura: number },
): { top: number; left: number } {
  const acima = ancora.top - FOLGA - ALTURA
  const top = acima >= FOLGA ? acima : Math.min(ancora.bottom + FOLGA, janela.altura - FOLGA - ALTURA)
  const left = Math.min(Math.max(ancora.right - 12, FOLGA), janela.largura - FOLGA - LARGURA)
  return { top, left }
}

export function BarraDeSelecao({
  ancora,
  rotulo,
  className,
  children,
}: {
  /** Retângulo do fim da seleção, em coordenadas da janela. */
  ancora: AncoraDaSelecao
  rotulo: string
  className?: string
  children: React.ReactNode
}) {
  const janela =
    typeof window === "undefined"
      ? { largura: 0, altura: 0 }
      : { largura: window.innerWidth, altura: window.innerHeight }
  return createPortal(
    <div
      role="toolbar"
      aria-label={rotulo}
      style={posicaoDaBarra(ancora, janela)}
      onMouseDown={(e) => e.preventDefault()}
      className={cn(SUPERFICIE_DO_PAINEL, "fixed flex items-center rounded-lg p-0.5", className)}
    >
      {children}
    </div>,
    document.body,
  )
}
