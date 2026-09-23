import {
  AlertTriangle,
  CheckCircle2,
  ListTree,
  Plus,
  Route,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { flightPlanStats, type FlightPlanKind } from "@/lib/flightPlanBuilder"
import { missionPlanMode, validateMissionPlan } from "@/lib/missionPlans"
import type { MissionPreset } from "@/lib/missionTypes"
import { cn } from "@/lib/utils"

function PlanCard({
  plan,
  onOpen,
}: {
  plan: MissionPreset
  onOpen: () => void
}) {
  const mode = missionPlanMode(plan)
  const stats = flightPlanStats(plan)
  const errors = validateMissionPlan(plan)

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group min-h-44 rounded-xl border bg-card p-4 text-left shadow-sm",
        "transition-[border-color,box-shadow] hover:border-border-strong hover:shadow-[0_0_0_3px_var(--sel)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
      )}
    >
      <span className="flex items-start justify-between gap-4">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
          {mode === "graph" ? <Route className="size-4" /> : <ListTree className="size-4" />}
        </span>
        <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
          {errors.length === 0 ? (
            <CheckCircle2 className="size-3.5 text-muted-foreground" />
          ) : (
            <AlertTriangle className="size-3.5 text-st-warning" />
          )}
          {errors.length === 0 ? "executável" : `${errors.length} pendência${errors.length === 1 ? "" : "s"}`}
        </span>
      </span>

      <span className="mt-4 block truncate text-[14px] font-medium text-foreground">
        {plan.name || "Plano sem nome"}
      </span>
      <span className="mt-1 line-clamp-2 min-h-9 text-[12px] leading-relaxed text-muted-foreground">
        {plan.description || "Sem descrição de uso."}
      </span>
      <span className="mt-4 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
        <span>{stats.phases} fases</span>
        <span>{stats.connections} conexões</span>
        {stats.returns > 0 && <span>{stats.returns} retornos</span>}
        <span>rev. {plan.revision ?? 1}</span>
      </span>
    </button>
  )
}

export function FlightPlanLibrary({
  plans,
  onOpen,
  onCreate,
  historico,
}: {
  plans: MissionPreset[]
  onOpen: (plan: MissionPreset) => void
  onCreate: (kind: FlightPlanKind) => void
  /** As missões já voadas neste projeto (ADR-237: saíram do painel direito,
   *  onde eram histórico no meio do que o agente vê agora). */
  historico?: React.ReactNode
}) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-end justify-between gap-6">
          <div>
            <h2 className="text-[20px] font-semibold tracking-tight text-foreground">
              Biblioteca de planos
            </h2>
            <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">
              Cada plano define quem trabalha, por onde a execução segue e em quais pontos o Frota deve pedir uma decisão.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="padrao" onClick={() => onCreate("linear")}>
              <ListTree className="size-4" />
              Nova rota
            </Button>
            <Button size="padrao" onClick={() => onCreate("graph")}>
              <Plus className="size-4" />
              Novo fluxo
            </Button>
          </div>
        </div>

        {plans.length > 0 ? (
          <div className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3">
            {plans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} onOpen={() => onOpen(plan)} />
            ))}
          </div>
        ) : (
          <div className="mt-10 grid min-h-72 place-items-center rounded-xl border bg-secondary/10 p-8 text-center">
            <div className="max-w-sm">
              <Route className="mx-auto size-8 text-muted-foreground" />
              <h3 className="mt-4 text-[14px] font-medium text-foreground">
                Sua biblioteca está vazia
              </h3>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                Comece com um fluxo visual para desenhar decisões ou com uma rota para uma sequência simples.
              </p>
              <Button size="padrao" className="mt-4" onClick={() => onCreate("graph")}>
                <Plus className="size-4" />
                Criar primeiro fluxo
              </Button>
            </div>
          </div>
        )}

        {historico && (
          <section className="mt-10 max-w-xl">
            <h3 className="text-[14px] font-medium text-foreground">Missões deste projeto</h3>
            <p className="mt-1 mb-3 text-[12px] text-muted-foreground">
              O que já voou: desfecho, custo e os arquivos de cada missão.
            </p>
            {historico}
          </section>
        )}
      </div>
    </main>
  )
}
