import { motion } from "motion/react"
import { AlertCircle, Circle, Plane } from "lucide-react"
import { FrotaMark } from "@/components/brand/FrotaMark"
import type { HudRuntimeView } from "@/lib/hud"
import type { TrayActivity, TraySnapshot } from "@/lib/tray"
import { cn } from "@/lib/utils"

function elapsed(startedAt: number | null, now: number): string {
  if (!startedAt) return "em execução"
  const minutes = Math.max(0, Math.floor((now - startedAt) / 60_000))
  if (minutes < 1) return "agora"
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}min`
}

function HudStatusGlyph({ decisions, running }: { decisions: number; running: number }) {
  if (decisions > 0) return <AlertCircle className="size-3.5 text-st-warning" />
  if (running > 0) return <Plane className="size-3.5 text-st-running" />
  return <Circle className="size-2.5 fill-st-idle text-st-idle" />
}

export function DynamicHudCompact({
  runtime,
  snapshot,
  primary,
  statusText,
  now,
  onExpand,
}: {
  runtime: HudRuntimeView
  snapshot: TraySnapshot
  primary: TrayActivity | undefined
  statusText: string
  now: number
  onExpand: () => void
}) {
  const position = runtime.effectivePosition
  const notch = position === "notch"
  const side = position === "left" || position === "right"
  const requiresDecision = snapshot.decisions > 0

  return (
    <motion.button
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.12 }}
      type="button"
      className={cn(
        "h-full w-full overflow-hidden text-[12px] font-medium focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring",
        notch
          ? "grid items-center"
          : side
            ? "flex flex-col items-center justify-center gap-2"
            : "flex items-center justify-center gap-2 px-2",
      )}
      style={
        notch
          ? {
              gridTemplateColumns: `1fr ${runtime.screen?.notchWidth ?? 0}px 1fr`,
            }
          : undefined
      }
      onClick={onExpand}
      aria-label={`${statusText}. Expandir instrumento`}
    >
      {notch ? (
        <>
          <span className="flex h-full items-center justify-center" aria-hidden>
            <FrotaMark className="size-3.5 stroke-current text-foreground" />
          </span>
          <span aria-hidden />
          <span className="flex h-full items-center justify-center" aria-hidden>
            <HudStatusGlyph decisions={snapshot.decisions} running={snapshot.running} />
          </span>
        </>
      ) : side ? (
        <>
          <FrotaMark className="size-3.5 stroke-current text-foreground" />
          <HudStatusGlyph decisions={snapshot.decisions} running={snapshot.running} />
        </>
      ) : (
        <>
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              requiresDecision
                ? "bg-st-warning"
                : snapshot.running > 0
                  ? "bg-st-running"
                  : "bg-st-idle",
            )}
          />
          <span className="shrink-0 font-mono text-[11px]">
            {primary ? elapsed(primary.startedAt, now) : statusText}
          </span>
          <span className="min-w-0 truncate text-muted-foreground">
            {primary?.title ?? (requiresDecision ? "Aguardando você" : "Sem tarefa em voo")}
          </span>
        </>
      )}
    </motion.button>
  )
}
