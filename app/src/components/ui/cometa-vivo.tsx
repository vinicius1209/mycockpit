// O COMETA VIVO (ADR-259, mock `docs/mocks/sinal-de-vivo-v2.html`, variante
// B): o sinal de "rodando" do app, uma porta só. Um anel com cauda que se
// apaga, na cor que quem usa passa (a da conversa ou do projeto na barra
// lateral, cinza dentro do fio).
//
// Onde se diz "isto está trabalhando". Carregamento curto (botão, leitura de
// pasta) segue com o arco.
//
// O giro vem de `lib/relogioDoVivo.ts`, não de `@keyframes`: o ângulo é
// escrito direto no DOM a cada quadro do relógio único, sem re-render do React.

import { useEffect, useRef } from "react"
import { anguloEm, ANGULO_PARADO, assinarRelogio } from "@/lib/relogioDoVivo"
import { cn } from "@/lib/utils"

// A cauda: transparente no primeiro terço, acendendo até a cabeça. O furo do
// meio deixa um anel de ~1,5px num cometa de 12px.
const CAUDA = "conic-gradient(from var(--ang), transparent 0 30%, currentColor 100%)"
const FURO = "radial-gradient(circle, transparent 3.8px, #000 4.3px)"

export function CometaVivo({
  papel = "conversa",
  cor,
  rotulo,
  className,
}: {
  /** `conversa`: um turno trabalhando. `passo`: uma ação ou etapa executando. */
  papel?: "conversa" | "passo"
  /** Cor do cometa. Ausente = a cor do texto em volta (`currentColor`). */
  cor?: string | null
  /** Para leitor de tela. Ausente = decorativo. */
  rotulo?: string
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(
    () =>
      assinarRelogio((ms, parado) => {
        ref.current?.style.setProperty("--ang", `${parado ? ANGULO_PARADO : anguloEm(ms)}deg`)
      }),
    [],
  )
  return (
    <span
      ref={ref}
      data-vivo={papel}
      role={rotulo ? "img" : undefined}
      aria-label={rotulo}
      aria-hidden={rotulo ? undefined : true}
      style={{
        ...(cor ? { color: cor } : {}),
        ["--ang" as string]: `${ANGULO_PARADO}deg`,
        background: CAUDA,
        WebkitMask: FURO,
        mask: FURO,
      }}
      className={cn("inline-block size-3 shrink-0 rounded-full", className)}
    />
  )
}
