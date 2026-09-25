// A MATRIZ VIVA (ADR-256, mock `docs/mocks/sinal-de-vivo.html`, variante B):
// o sinal de "rodando" do app, uma porta só. Nove pontos em 3×3 que acendem em
// onda, na cor que quem usa passa (a da conversa ou do projeto na barra
// lateral, cinza dentro do fio).
//
// Substitui os arcos (`Loader2`, `.conv-spin`) onde o que se diz é "isto está
// trabalhando". Carregamento curto (botão, leitura de pasta) segue com o arco.
//
// O movimento vem de `lib/relogioDoVivo.ts`, não de `@keyframes`: a matriz se
// pinta direto no DOM a cada quadro do relógio único, sem re-render do React.

import { useEffect, useRef } from "react"
import { assinarRelogio, brilho, type Onda } from "@/lib/relogioDoVivo"
import { cn } from "@/lib/utils"

const PONTOS = [0, 1, 2, 3, 4, 5, 6, 7, 8]

export function MatrizViva({
  onda = "diagonal",
  cor,
  grande = false,
  rotulo,
  className,
}: {
  onda?: Onda
  /** Cor dos pontos. Ausente = a cor do texto em volta (`currentColor`). */
  cor?: string | null
  /** 3,5px por ponto (rodapé do turno) em vez de 3px. */
  grande?: boolean
  /** Para leitor de tela. Ausente = decorativa. */
  rotulo?: string
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(
    () =>
      assinarRelogio((quadro, parado) => {
        const pontos = ref.current?.children
        if (!pontos) return
        for (let i = 0; i < pontos.length; i++) {
          ;(pontos[i] as HTMLElement).dataset.b = String(brilho(quadro, onda, i, parado))
        }
      }),
    [onda],
  )
  return (
    <span
      ref={ref}
      data-vivo={onda}
      role={rotulo ? "img" : undefined}
      aria-label={rotulo}
      aria-hidden={rotulo ? undefined : true}
      style={cor ? { color: cor } : undefined}
      className={cn("grid shrink-0 grid-cols-3", grande ? "gap-[2px]" : "gap-[1.5px]", className)}
    >
      {PONTOS.map((i) => (
        <span
          key={i}
          data-b={brilho(0, onda, i, true)}
          className={cn(
            "rounded-[1px] bg-current opacity-20 transition-opacity duration-75 data-[b=1]:opacity-50 data-[b=2]:opacity-100",
            grande ? "size-[3.5px]" : "size-[3px]",
          )}
        />
      ))}
    </span>
  )
}
