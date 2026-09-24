// A LINHA DE LISTA que se clica e empilha texto (ADR-250): o índice da régua
// de turnos, com o pedido em cima e a resposta embaixo.
//
// Mesma razão do `Ladrilho`: não é um degrau do §13. A escada mede o que se
// aperta NUMA linha; aqui a altura vem do conteúdo (duas ou três linhas de
// texto), e é por isso que a geometria mora aqui, com um dono só. A linha
// ativa é seleção, e seleção não é cor (`SELECTED_FILL`, §2): nada de barra
// de acento, o âmbar fica no traço da régua.

import type { ComponentProps } from "react"
import { SELECTED_FILL } from "@/lib/selection"
import { cn } from "@/lib/utils"

export function LinhaDeLista({
  ativo = false,
  destacado = false,
  className,
  children,
  ...resto
}: ComponentProps<"button"> & {
  /** É onde você está: a seleção do app. */
  ativo?: boolean
  /** O ponteiro está no par dela em outra superfície (o traço da régua). */
  destacado?: boolean
}) {
  return (
    <button
      type="button"
      data-ativo={ativo || undefined}
      aria-current={ativo ? "location" : undefined}
      {...resto}
      className={cn(
        "w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sel-hover",
        ativo ? SELECTED_FILL : destacado && "bg-sel-hover",
        className,
      )}
    >
      {children}
    </button>
  )
}
