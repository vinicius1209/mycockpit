import { cn } from "@/lib/utils"
import type { AgentStatus } from "@/lib/types"

const COLOR: Record<AgentStatus, string> = {
  idle: "bg-st-idle",
  running: "bg-st-running",
  queued: "bg-st-queued",
  success: "bg-st-success",
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
