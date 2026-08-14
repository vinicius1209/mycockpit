// Configurações ▸ Uso e custo, bloco "Histórico de custo" (ADR-033).
// Manutenção do ledger de custo:
// as linhas gravadas ANTES da correção do usage acumulado por thread guardam o
// total da conversa como se fosse o gasto de um turno. Aqui o usuário vê
// quantas linhas estão nessa base e, por ação EXPLÍCITA, manda reconstruir.
//
// Nada é automático e nada é apagado: os valores originais vão pra
// turn_costs_usage_raw e a linha fica carimbada "recomputed".

import { useEffect, useMemo, useState } from "react"
import { Calculator, ChevronDown, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { cumulativeUsageAgents } from "@/lib/agentRoster"
import { fmtCost } from "@/lib/format"
import {
  countCumulativeLedgerRows,
  isTauri,
  recomputeCumulativeLedger,
} from "@/lib/db"

export function CostMaintenance() {
  // Quais motores reportam acumulado sai do REGISTRY, nunca de nome fixo.
  const affected = useMemo(() => cumulativeUsageAgents(), [])
  const ids = useMemo(() => affected.map((a) => a.id), [affected])
  const names = affected.map((a) => a.label).join(", ")
  const [pending, setPending] = useState<{ rows: number; total: number } | null>(
    null,
  )
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{
    rows: number
    before: number
    after: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [details, setDetails] = useState(false)

  useEffect(() => {
    if (!isTauri() || !ids.length) return
    let cancelled = false
    countCumulativeLedgerRows(ids)
      .then((r) => {
        if (!cancelled) setPending(r)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [ids])

  async function recompute() {
    setBusy(true)
    setError(null)
    try {
      const out = await recomputeCumulativeLedger(ids)
      setDone(out)
      setPending(await countCumulativeLedgerRows(ids))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const nada = pending != null && pending.rows === 0

  return (
    <div>
      {/* Disclosure progressiva: o ESTADO (quantas linhas, quanto somam) e a
          ação ficam na cara; o porquê técnico da reconstrução fica a 1 clique. */}
      <div className="rounded-lg border border-border/60 bg-secondary/20 p-3">
        {pending == null && !error && (
          <div className="text-[13px] text-muted-foreground">
            Conferindo o histórico...
          </div>
        )}
        {pending != null && (
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[13px] text-foreground">
                {nada
                  ? "Nada a recalcular"
                  : `${pending.rows} ${pending.rows === 1 ? "linha" : "linhas"} na base antiga`}
              </div>
              <div className="text-[12px] text-muted-foreground">
                {nada
                  ? "Todo o histórico já está no gasto por turno."
                  : `Somam ${fmtCost(pending.total, "estimated")} no ledger de hoje.`}
              </div>
            </div>
            {!nada && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => void recompute()}
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Calculator className="size-3.5" />
                )}
                Recalcular
              </Button>
            )}
          </div>
        )}
        {done && (
          <div className="mt-3 border-t border-border/50 pt-3 text-[13px] text-foreground">
            {done.rows} {done.rows === 1 ? "linha reconstruída" : "linhas reconstruídas"}:{" "}
            {fmtCost(done.before, "estimated")} → {fmtCost(done.after, "estimated")}.
            <div className="text-[12px] text-muted-foreground">
              Os valores originais ficaram guardados (nada foi apagado).
            </div>
          </div>
        )}
        {error && (
          <div className="mt-3 text-[13px] text-destructive">
            Falhou: {error}
          </div>
        )}
      </div>

      <div className="mt-2">
        <button
          onClick={() => setDetails((v) => !v)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronDown
            className={cn("size-3 transition-transform", details && "rotate-180")}
          />
          ver o que a reconstrução faz
        </button>
        {details && (
          <div className="mt-1.5 space-y-2 text-[12px] leading-snug text-muted-foreground">
            <p>
              O {names} reporta, no fim de cada turno, o total de tokens da
              conversa inteira, não do turno. Até a correção do ADR-033 o app
              lia esse número como gasto do turno e somava totais em cima de
              totais, então o histórico anterior está superestimado (Painel,
              custo por conversa e custo por card).
            </p>
            <p>
              A reconstrução recalcula cada linha antiga pela diferença para a
              linha anterior da mesma conversa. Ela nunca inventa custo (o total
              só cai), guarda os valores originais e pode ser rodada uma vez só:
              linhas novas já nascem com o gasto do turno.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
