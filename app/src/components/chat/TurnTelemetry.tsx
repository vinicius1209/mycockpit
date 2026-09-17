import { AlertCircle, Check, Gauge } from "lucide-react"
import { resumoDosTokens } from "@/components/chat/turnoTokens"
import { useNasceuAgora } from "@/lib/nascimento"
import { fmtCost, fmtDuration } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { ChatItem } from "@/store/chat"

/** Legenda de fim de turno: desfecho, duração e, na ponta, custo OU modelo,
 * com a quebra de tokens no tooltip dessa ponta (ADR-199: tokens e contexto
 * reenviado não mudam decisão, então não ocupam a linha). A peça é compartilhada pelo resultado comum e pelo disclosure do
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
  // O ✓ assenta só quando o turno ACABOU de fechar; relido, chega pronto (ADR-179).
  const nasceu = useNasceuAgora(it.ts)
  const tokens = resumoDosTokens(it.usage)
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground/80">
      <span className="flex items-center gap-1.5">
        <span
          className={cn(
            "flex items-center gap-1 font-medium",
            it.ok
              ? // Sucesso é o normal: verde só no turno que ACABOU de fechar.
                nasceu
                ? "text-st-success"
                : "text-muted-foreground/60"
              : incidentTone === "limit"
                ? "text-muted-foreground"
                : "text-st-error",
          )}
        >
          {it.ok ? (
            <Check className={cn("size-3", nasceu && "fio-assenta")} aria-hidden />
          ) : incidentTone === "limit" ? (
            <Gauge className="size-3" />
          ) : (
            <AlertCircle className="size-3" />
          )}
          {/* A palavra só sobra para exceção; em sucesso, fica para leitor de tela. */}
          {it.ok ? (
            <span className="sr-only">concluído</span>
          ) : incidentTone === "limit" ? (
            "turno encerrado"
          ) : (
            "erro"
          )}
        </span>
        {it.durationMs != null && (
          <>
            <TelemetrySeparator />
            <span className="tabular-nums">{fmtDuration(it.durationMs)}</span>
          </>
        )}
      </span>

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
              ...tokens,
            ]
              .filter(Boolean)
              .join("\n") || undefined
          }
        >
          {fmtCost(it.costUsd, it.costSource)}
        </span>
      ) : (
        it.model && (
          <span className="truncate" title={tokens.join("\n") || undefined}>
            {it.model}
          </span>
        )
      )}
    </div>
  )
}

function TelemetrySeparator() {
  return <span className="text-muted-foreground/30">·</span>
}
