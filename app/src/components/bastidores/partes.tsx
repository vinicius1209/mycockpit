// As peças que o índice, a faixa de abas e a cabeça da vista dividem: o nome do
// tipo e do estado, o glifo e o tempo. Moram fora de `BastidorVista` para a
// cabeça poder usá-las sem import circular.

import { Check, CircleAlert, CircleSlash } from "lucide-react"
import { Elapsed } from "@/components/chat/LiveTime"
import type { Bastidor, EstadoDeBastidor } from "@/lib/bastidores"
import { fmtDuration } from "@/lib/format"
import { cn } from "@/lib/utils"

export const TIPO: Record<Bastidor["tipo"], string> = {
  terminal: "terminal",
  subagente: "subagente",
  workflow: "workflow",
  tarefa: "tarefa",
  processo: "processo",
}

export const ESTADO: Record<Exclude<EstadoDeBastidor, "vivo">, string> = {
  concluido: "concluído",
  interrompido: "interrompido",
  falhou: "falhou",
}

/** O glifo do estado. `tom="terminal"` é o mesmo glifo na superfície escura. */
export function PontoDeEstado({ estado, tom = "app" }: { estado: EstadoDeBastidor; tom?: "app" | "terminal" }) {
  if (estado === "vivo") {
    return (
      <span
        aria-hidden
        className={cn(
          "size-1.5 shrink-0 animate-cockpit-pulse rounded-full",
          tom === "terminal" ? "bg-terminal-prompt" : "bg-foreground/45",
        )}
      />
    )
  }
  const Icone = estado === "concluido" ? Check : estado === "falhou" ? CircleAlert : CircleSlash
  return (
    <Icone
      aria-hidden
      className={cn(
        "size-3 shrink-0",
        // Verde é marco raro (§2): concluído é estado de lista, fica neutro.
        estado === "falhou"
          ? tom === "terminal" ? "text-terminal-error" : "text-st-error"
          : tom === "terminal" ? "text-terminal-dim" : "text-muted-foreground",
      )}
    />
  )
}

export function duracaoDe(b: Bastidor): string | null {
  return b.atualizadoEm > b.desde ? fmtDuration(b.atualizadoEm - b.desde) : null
}

/** Vivo conta o tempo; terminado mostra quanto durou. O estado já está no
 *  ícone à esquerda, então a palavra ("concluído") fica para o leitor de tela e
 *  para o `title`, sem repetir o ícone em texto em cada linha. */
export function RotuloDeTempo({ b, className }: { b: Bastidor; className?: string }) {
  const classe = cn("shrink-0 font-mono text-[11px] text-muted-foreground", className)
  if (b.estado === "vivo") return <Elapsed since={b.desde} className={classe} />
  const durou = duracaoDe(b)
  return (
    <span className={classe} title={durou ? `${ESTADO[b.estado]} em ${durou}` : ESTADO[b.estado]}>
      <span className="sr-only">{ESTADO[b.estado]}{durou ? " em " : ""}</span>
      {durou}
    </span>
  )
}
