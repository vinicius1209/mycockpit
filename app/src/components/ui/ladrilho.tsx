// O LADRILHO da navegação global (ADR-245, mock
// `docs/mocks/barra-lateral-hierarquia.html`): ícone em cima, nome embaixo,
// contador no canto. Painel, Frota, Agenda e Planos viraram uma faixa de
// quatro em vez de quatro linhas com rótulo "GERAL", e isso devolveu à lista de
// conversas o espaço de três linhas.
//
// Não é um quinto degrau do §13: a escada mede o que se aperta NUMA LINHA
// (texto ao lado do ícone). O ladrilho empilha os dois, então a altura vem de
// ícone + nome, e é por isso que ele mora aqui, único dono dessa geometria.

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function Ladrilho({
  icone,
  rotulo,
  titulo,
  ativo = false,
  contador,
  onClick,
}: {
  icone: ReactNode
  /** Nome curto, cabe em ~60px ("Agenda", não "Agendamentos"). */
  rotulo: string
  /** O nome inteiro e o que a vista faz: hover e leitor de tela. */
  titulo: string
  ativo?: boolean
  /** Contagem ou próxima execução; ausente, o canto fica vazio. */
  contador?: string | number | null
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      aria-label={titulo}
      aria-current={ativo ? "page" : undefined}
      className={cn(
        "relative flex h-11 min-w-0 flex-col items-center justify-center gap-0.5 rounded-md text-[11px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        // Seleção é preenchimento neutro + peso, nunca tinta (§2, ADR-043).
        ativo ? "bg-sel font-medium text-foreground" : "text-muted-foreground hover:bg-sel-hover hover:text-foreground",
      )}
    >
      <span className="grid size-4 place-items-center [&_svg]:size-4">{icone}</span>
      <span className="max-w-full truncate px-1">{rotulo}</span>
      {contador != null && contador !== "" && contador !== 0 && (
        <span className="absolute top-1 right-1.5 min-w-4 rounded-full bg-sel px-1 text-center text-[11px] leading-4 text-foreground tabular-nums">
          {contador}
        </span>
      )}
    </button>
  )
}
