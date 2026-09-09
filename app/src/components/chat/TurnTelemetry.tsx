import { AlertCircle, Check, Gauge } from "lucide-react"
import { TurnoTokens } from "@/components/chat/turnoTokens"
import { fmtCost, fmtDuration } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ChatItem } from "@/store/chat"

/** Legenda de fim de turno: estado, duração, tokens e, na ponta, custo OU
 * modelo. A peça é compartilhada pelo resultado comum e pelo disclosure do
 * incidente; nenhum cálculo ou dado muda quando a apresentação externa muda.
 *
 * A ponta é uma só de propósito (a linha é estreita): com custo conhecido ele
 * vence e o modelo vai pro tooltip; sem custo, o modelo é o que sobra pra
 * dizer o que rodou. O que não pode acontecer é a ponta ficar vazia. */
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

      {/* Custo é o titular desta ponta, e o modelo viaja no tooltip dele —
          decluttering deliberado. MAS o modelo NÃO pode depender do custo pra
          existir: `codex` e `agy` têm `reportsCost: false`, e num turno de
          `cost_source: "unknown"` o elemento inteiro sumia, levando junto a
          única menção ao modelo que rodou. Motor que reporta menos não pode
          contar menos: sem custo, o modelo assume o lugar visível. */}
      {it.costUsd != null ? (
        <span
          className="font-medium tabular-nums"
          title={
            [
              it.model ? `Modelo: ${it.model}` : null,
              it.costSource === "estimated" ? "estimado: tokens × tabela de preço" : null,
            ]
              .filter(Boolean)
              .join(" · ") || undefined
          }
        >
          {fmtCost(it.costUsd, it.costSource)}
        </span>
      ) : (
        it.model && <span className="truncate">{it.model}</span>
      )}
    </div>
  )
}

function TelemetrySeparator() {
  return <span className="text-muted-foreground/30">·</span>
}
