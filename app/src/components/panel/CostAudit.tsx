// Auditoria de custos: o detalhe que nasce do clique no custo do Painel —
// abas Hoje/7d/30d, total, gasto diário, ranking por agente e por projeto.
// Consome o MESMO ledger do Painel (turnos de chat + entregas de missão).

import { useMemo, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  costByAgent,
  costByProject,
  dailySpend,
  ledgerTokens,
  windowRows,
  type LedgerRow,
} from "@/lib/panel"
import { fmtCost, fmtTokens } from "@/lib/format"
import { cn } from "@/lib/utils"

// Cor categórica por agente. Antigravity era verde (--st-success) e colidia
// com o vocabulário de status (STYLEGUIDE §2: verde não identifica agent);
// virou o violeta de identidade, que não significa nada em estado.
const AGENT_COLOR: Record<string, string> = {
  "claude-code": "var(--brass)",
  codex: "var(--st-running)",
  agy: "var(--id-violet)",
}
const agentColor = (id: string) => AGENT_COLOR[id] ?? "var(--st-idle)"
const agentShort = (id: string) =>
  ({ "claude-code": "Claude Code", codex: "Codex", agy: "Antigravity" })[id] ??
  id

type Win = "today" | "7d" | "30d"
const WINS: { id: Win; label: string }[] = [
  { id: "today", label: "Hoje" },
  { id: "7d", label: "7 dias" },
  { id: "30d", label: "30 dias" },
]

function Bars({ data }: { data: number[] }) {
  const max = Math.max(...data, 0.000001)
  return (
    <div className="flex h-14 items-end gap-[2px]" aria-hidden>
      {data.map((v, i) => (
        <span
          key={i}
          className={cn(
            "min-w-[2px] flex-1 rounded-t-[2px]",
            // Janela corrente destacada por LUMINÂNCIA, não por tinta: o §2
            // fechou que custo não é gesto (nunca brass).
            i === data.length - 1 ? "bg-foreground" : "bg-muted-foreground/25",
          )}
          style={{ height: `${Math.max(5, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}

export function CostAudit({
  open,
  onOpenChange,
  ledger,
  projectNames,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  ledger: LedgerRow[]
  projectNames: Map<string, string>
}) {
  const [win, setWin] = useState<Win>("30d")
  const view = useMemo(() => {
    const now = Date.now()
    const rows = windowRows(ledger, win, now)
    const total = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0)
    return {
      total,
      tokens: ledgerTokens(rows),
      byAgent: costByAgent(rows),
      byProject: costByProject(rows),
      daily: dailySpend(ledger, win === "30d" ? 30 : 14, now),
    }
  }, [ledger, win])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-[460px]">
        <DialogHeader className="border-b px-5 py-3.5 text-left">
          <DialogTitle className="text-[14px] font-semibold">
            Auditoria de custos
          </DialogTitle>
          <DialogDescription className="sr-only">
            Detalhe de custo por janela, agente e projeto
          </DialogDescription>
          <div className="mt-3 inline-flex gap-0.5 rounded-lg border bg-card p-0.5">
            {WINS.map((w) => (
              <button
                key={w.id}
                onClick={() => setWin(w.id)}
                aria-selected={win === w.id}
                className={cn(
                  "rounded-md px-3 py-1 text-[12px] font-medium transition-colors",
                  win === w.id
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {w.label}
              </button>
            ))}
          </div>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-auto px-5 py-4">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[30px] font-semibold tracking-[-0.02em] tabular-nums">
              {fmtCost(view.total)}
            </span>
            <span className="ml-auto font-mono text-[12px] text-muted-foreground tabular-nums">
              {fmtTokens(view.tokens)} tokens
            </span>
          </div>

          <div className="mt-4">
            <Bars data={view.daily} />
            <div className="mt-1 flex justify-between font-mono text-[11px] text-muted-foreground">
              <span>{win === "30d" ? "30 d" : "14 d"} atrás</span>
              <span>hoje</span>
            </div>
          </div>

          {view.byAgent.length > 0 && (
            <>
              <div className="label-mono mt-5 mb-1">Por agente</div>
              {view.byAgent.map((a) => (
                <div
                  key={a.agent}
                  className="flex items-center gap-3 border-t py-2.5 first:border-t-0"
                >
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ background: agentColor(a.agent) }}
                  />
                  <span className="min-w-0 flex-1 text-[13px] font-medium">
                    {agentShort(a.agent)}
                    <span className="ml-2 font-mono text-[11px] font-normal text-muted-foreground">
                      {fmtTokens(a.tokens)} tok
                    </span>
                  </span>
                  <span className="text-right font-mono text-[13px] tabular-nums">
                    <b className="font-semibold">{fmtCost(a.costUsd)}</b>
                    <span className="block text-[11px] text-muted-foreground">
                      {Math.round(a.share * 100)}%
                    </span>
                  </span>
                </div>
              ))}
            </>
          )}

          {view.byProject.length > 0 && (
            <>
              <div className="label-mono mt-5 mb-2">Por projeto</div>
              {view.byProject.map((p) => (
                <div key={p.projectId} className="flex items-center gap-3 py-1.5">
                  <span className="w-28 shrink-0 truncate text-[12px]">
                    {projectNames.get(p.projectId) ?? "projeto"}
                  </span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted-foreground/15">
                    <span
                      className="block h-full rounded-full bg-muted-foreground"
                      style={{ width: `${Math.round(p.share * 100)}%` }}
                    />
                  </span>
                  <span className="w-16 shrink-0 text-right font-mono text-[12px] text-muted-foreground tabular-nums">
                    {fmtCost(p.costUsd)}
                  </span>
                </div>
              ))}
            </>
          )}

          {view.byAgent.length === 0 && (
            <p className="py-8 text-center text-[13px] text-muted-foreground">
              Nenhum gasto nesta janela ainda.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
