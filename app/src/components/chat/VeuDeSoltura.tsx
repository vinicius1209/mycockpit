// O véu de "solte aqui" sobre a coluna da conversa: o MESMO para o arquivo que
// vem do Finder e para o que vem da árvore (docs/explorador-de-arquivos-prd.md,
// D5). Cartão opaco por baixo (o rascunho não vaza pelo estado) e a superfície
// de seleção por cima, com o verbo do resultado.

import { createPortal } from "react-dom"

export interface RetanguloDoVeu {
  left: number
  top: number
  width: number
  height: number
}

/** A coluna da conversa, onde a soltura de arquivo vale; sem ela, o cartão do
 *  composer. */
export function alvoDoVeu(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>("[data-coluna-da-conversa]") ??
    document.querySelector<HTMLElement>("[data-composer-card]")
  )
}

export function VeuDeSoltura({ ret, rotulo }: { ret: RetanguloDoVeu; rotulo: string }) {
  return createPortal(
    <div aria-live="polite" style={{ ...ret }} className="pointer-events-none fixed z-40 rounded-2xl border bg-card">
      <div className="grid h-full place-items-center rounded-2xl bg-sel text-[13px] font-medium text-foreground">
        {rotulo}
      </div>
    </div>,
    document.body,
  )
}
