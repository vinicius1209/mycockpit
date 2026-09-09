import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { flightPlanStats } from "@/lib/flightPlanBuilder"
import { validateMissionPlan } from "@/lib/missionPlans"
import type { MissionPreset } from "@/lib/missionTypes"
import { cn } from "@/lib/utils"

export function FlightPlanValidationBar({
  plan,
  missionEnabled,
}: {
  plan: MissionPreset
  missionEnabled: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const errors = validateMissionPlan(plan)
  const stats = flightPlanStats(plan)
  const valid = errors.length === 0

  return (
    <div className="shrink-0 border-t bg-card">
      {expanded && (
        <div className="border-b border-border/40 px-4 py-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-6">
            <div>
              <h2 className="label-mono text-foreground">Validação do plano</h2>
              {valid ? (
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Entrada, alcance, condições, saídas e limites de ciclo estão consistentes com o motor de Missões.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {errors.map((error) => (
                    <li key={error} className="flex items-start gap-2 text-[11px] leading-relaxed text-st-warning">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      {error}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <dl className="grid grid-cols-4 gap-4 font-mono text-[11px] text-muted-foreground">
              <div><dt>fases</dt><dd className="mt-1 text-foreground">{stats.phases}</dd></div>
              <div><dt>conexões</dt><dd className="mt-1 text-foreground">{stats.connections}</dd></div>
              <div><dt>retornos</dt><dd className="mt-1 text-foreground">{stats.returns}</dd></div>
              <div><dt>saídas</dt><dd className="mt-1 text-foreground">{stats.successExits}</dd></div>
            </dl>
          </div>
        </div>
      )}

      <div className="flex h-10 items-center justify-between gap-3 px-3">
        <div className="flex min-w-0 items-center gap-2">
          {valid ? (
            <CheckCircle2 className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <AlertTriangle className="size-3.5 shrink-0 text-st-warning" />
          )}
          <span className="truncate text-[11px] text-muted-foreground">
            {valid
              ? "Plano válido, alterações salvas automaticamente."
              : errors[0]}
          </span>
          <Button
            variant="ghost"
            size="chip"
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
            {expanded ? "Ocultar" : "Ver validação"}
          </Button>
        </div>
        <span className={cn(
          "shrink-0 font-mono text-[11px] uppercase",
          missionEnabled ? "text-foreground" : "text-muted-foreground",
        )}>
          Missões {missionEnabled ? "ativas" : "desativadas"}
        </span>
      </div>
    </div>
  )
}
