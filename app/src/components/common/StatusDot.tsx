import { cn } from "@/lib/utils"
import type { AgentStatus } from "@/lib/types"

// STYLEGUIDE §2: este dot FICA na tela representando "a última vez deu certo"
// — isso é estado ambiente, e estado ambiente saudável é cinza. Verde é marco
// (transição), não decoração permanente. O que aconteceu segue dito no
// title/aria-label; a tinta fica reservada pro que pede decisão.
const COLOR: Record<AgentStatus, string> = {
  idle: "bg-st-idle",
  running: "bg-st-running",
  queued: "bg-st-queued",
  success: "bg-st-idle",
  error: "bg-st-error",
}

const LABEL: Record<AgentStatus, string> = {
  idle: "ocioso",
  running: "rodando",
  queued: "na fila",
  success: "concluído",
  error: "erro",
}

export function StatusDot({
  status = "idle",
  className,
}: {
  status?: AgentStatus
  className?: string
}) {
  return (
    <span
      className={cn("relative inline-flex size-2 shrink-0", className)}
      title={LABEL[status]}
      aria-label={LABEL[status]}
    >
      <span className={cn("size-2 rounded-full", COLOR[status])} />
      {status === "running" && (
        <span
          className={cn(
            "animate-cockpit-pulse absolute inset-0 rounded-full",
            COLOR[status],
          )}
        />
      )}
    </span>
  )
}

export { LABEL as STATUS_LABEL }
