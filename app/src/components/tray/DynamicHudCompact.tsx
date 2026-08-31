import { motion } from "motion/react"
import { AlertCircle, Circle, LoaderCircle, Plane } from "lucide-react"
import { FrotaMark } from "@/components/brand/FrotaMark"
import type { HudRuntimeView } from "@/lib/hud"
import {
  elapsedLabel,
} from "@/lib/hudPresentation"
import type { TrayActivity } from "@/lib/tray"
import { cn } from "@/lib/utils"

function HudStatusGlyph({ status }: { status: "loading" | "unavailable" | "decision" | "flight" | "idle" }) {
  if (status === "loading") return <LoaderCircle className="size-3.5 text-st-idle" />
  if (status === "unavailable") return <AlertCircle className="size-3.5 text-st-idle" />
  if (status === "decision") return <AlertCircle className="size-3.5 text-st-warning" />
  if (status === "flight") return <Plane className="size-3.5 text-st-running" />
  return <Circle className="size-2.5 fill-st-idle text-st-idle" />
}

export function DynamicHudCompact({
  runtime,
  statusKind,
  primary,
  statusText,
  now,
  onExpand,
}: {
  runtime: HudRuntimeView
  statusKind: "loading" | "unavailable" | "decision" | "flight" | "idle"
  primary: TrayActivity | undefined
  statusText: string
  now: number
  onExpand: () => void
}) {
  const position = runtime.effectivePosition
  const notch = position === "notch"
  const side = position === "left" || position === "right"
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
            <HudStatusGlyph status={statusKind} />
          </span>
        </>
      ) : side ? (
        <>
          <FrotaMark className="size-3.5 stroke-current text-foreground" />
          <HudStatusGlyph status={statusKind} />
        </>
      ) : (
        <>
          <span
            className={cn(
              "size-1.5 shrink-0 rounded-full",
              statusKind === "decision"
                ? "bg-st-warning"
                : statusKind === "flight"
                  ? "bg-st-running"
                  : "bg-st-idle",
            )}
          />
          <span className="shrink-0 font-mono text-[11px]">
            {primary ? elapsedLabel(primary.startedAt, now) : statusText}
          </span>
          <span className="min-w-0 truncate text-muted-foreground">
            {primary?.title ?? (statusKind === "decision" ? "Aguardando você" : statusText)}
          </span>
        </>
      )}
    </motion.button>
  )
}
