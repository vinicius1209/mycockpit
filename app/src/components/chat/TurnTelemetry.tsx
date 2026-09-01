import { AlertCircle, Check, Gauge } from "lucide-react"
import { TurnoTokens } from "@/components/chat/turnoTokens"
import { fmtCost, fmtDuration } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ChatItem } from "@/store/chat"

/** Legenda de fim de turno: estado, duração, tokens, modelo e custo. A peça é
 * compartilhada pelo resultado comum e pelo disclosure do incidente; nenhum
 * cálculo ou dado muda quando a apresentação externa muda. */
export function TurnTelemetry({
  it,
  incidentTone,
}: {
  it: Extract<ChatItem, { kind: "result" }>
  incidentTone?: "limit"
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/80">
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            "flex items-center gap-1 font-medium",
            it.ok
              ? "text-st-success"
              : incidentTone === "limit"
                ? "text-muted-foreground"
                : "text-st-error",
          )}
        >
          {it.ok ? (
            <Check className="size-3" />
          ) : incidentTone === "limit" ? (
            <Gauge className="size-3" />
          ) : (
            <AlertCircle className="size-3" />
          )}
          {it.ok
            ? "concluído"
            : incidentTone === "limit"
              ? "turno encerrado"
              : "erro"}
        </span>
        {it.durationMs != null && (
          <>
            <TelemetrySeparator />
            <span className="tabular-nums">{fmtDuration(it.durationMs)}</span>
          </>
        )}
      </span>

      <TurnoTokens usage={it.usage} />

      {(it.model || it.costUsd != null) && (
        <span className="flex items-center gap-1.5">
          {it.model && <span className="truncate">{it.model}</span>}
          {it.costUsd != null && (
            <>
              {it.model && <TelemetrySeparator />}
              <span
                className="font-medium tabular-nums"
                title={
                  it.costSource === "estimated"
                    ? "estimado: tokens × tabela de preço"
                    : undefined
                }
              >
                {fmtCost(it.costUsd, it.costSource)}
              </span>
            </>
          )}
        </span>
      )}
    </div>
  )
}

function TelemetrySeparator() {
  return <span className="text-muted-foreground/30">·</span>
}
