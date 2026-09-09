import {
  Bot,
  GitBranch,
  ListChecks,
  Network,
  Route,
  ShieldCheck,
  Sparkles,
  Undo2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import type { MissionPersona, MissionPreset } from "@/lib/missionTypes"
import { flightPlanStats } from "@/lib/flightPlanBuilder"

const PHASES: {
  persona: MissionPersona
  label: string
  description: string
  icon: typeof Bot
}[] = [
  {
    persona: "planner",
    label: "Planejar",
    description: "Define a abordagem",
    icon: Sparkles,
  },
  {
    persona: "executor",
    label: "Executar",
    description: "Realiza o trabalho",
    icon: Bot,
  },
  {
    persona: "reviewer",
    label: "Revisar",
    description: "Julga as evidências",
    icon: ShieldCheck,
  },
]

export function FlightPlanPalette({
  plan,
  mode,
  onAddPhase,
  onReorganize,
}: {
  plan: MissionPreset
  mode: "linear" | "graph"
  onAddPhase: (persona: MissionPersona) => void
  onReorganize: () => void
}) {
  const stats = flightPlanStats(plan)

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-secondary/10">
      <div className="border-b px-3 py-3">
        <div className="flex items-center gap-2">
          <Network className="size-3.5 text-brass" />
          <span className="label-mono text-foreground">Construir</span>
        </div>
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Adicione fases e conecte as portas para definir a execução.
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <section>
          <h2 className="label-mono">Fases</h2>
          <div className="mt-2 space-y-2">
            {PHASES.map((item) => {
              const Icon = item.icon
              return (
                <div key={item.persona} className="rounded-lg border bg-card p-2.5 shadow-sm">
                  <div className="flex items-start gap-2.5">
                    <span className="grid size-7 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground">
                      <Icon className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-medium text-foreground">
                        {item.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="compacto"
                    className="mt-2 w-full border border-border/40"
                    onClick={() => onAddPhase(item.persona)}
                  >
                    Adicionar ao plano
                  </Button>
                </div>
              )
            })}
          </div>
        </section>

        <section className="mt-5 border-t border-border/40 pt-4">
          <h2 className="label-mono">Conexões</h2>
          <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-muted-foreground">
            <p className="flex items-start gap-2">
              <GitBranch className="mt-0.5 size-3.5 shrink-0" />
              No fluxo visual, arraste de uma porta para outra e selecione a conexão para definir o resultado.
            </p>
            <p className="flex items-start gap-2">
              <Undo2 className="mt-0.5 size-3.5 shrink-0" />
              Retornos precisam de um limite de travessias para o plano ser executável.
            </p>
          </div>
          {mode === "graph" && (
            <Button variant="outline" size="padrao" className="mt-3 w-full" onClick={onReorganize}>
              <Route className="size-4" />
              Reorganizar mapa
            </Button>
          )}
        </section>
      </div>

      <div className="border-t p-3">
        <div className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
          <ListChecks className="size-3.5" />
          <span>{stats.phases} fases</span>
          <span>·</span>
          <span>{stats.connections} conexões</span>
        </div>
      </div>
    </aside>
  )
}
