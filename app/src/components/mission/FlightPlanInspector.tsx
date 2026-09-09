import { GitBranch, Settings2, ShieldCheck } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { FlightPlanPhaseInspector } from "@/components/mission/FlightPlanPhaseInspector"
import { FlightPlanRouteInspector } from "@/components/mission/FlightPlanRouteInspector"
import { FlightPlanSafetyInspector } from "@/components/mission/FlightPlanSafetyInspector"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"
import type { Project } from "@/lib/types"
import { cn } from "@/lib/utils"
import { SELECTED_FILL } from "@/lib/selection"

type InspectorTab = "phase" | "safety" | "routes"

const TABS: { id: InspectorTab; label: string; icon: typeof Settings2 }[] = [
  { id: "phase", label: "Fase", icon: Settings2 },
  { id: "safety", label: "Segurança", icon: ShieldCheck },
  { id: "routes", label: "Rotas", icon: GitBranch },
]

export function FlightPlanInspector({
  plan,
  mode,
  phase,
  phaseIndex,
  selectedEdgeId,
  project,
  onPatchPlan,
  onPatchPhase,
  onMovePhase,
  onRemovePhase,
  onSelectEdge,
}: {
  plan: MissionPreset
  mode: "linear" | "graph"
  phase: MissionPhaseDef | null
  phaseIndex: number
  selectedEdgeId: string | null
  project: Project | null
  onPatchPlan: (next: MissionPreset) => void
  onPatchPhase: (patch: Partial<MissionPhaseDef>) => void
  onMovePhase: (delta: -1 | 1) => void
  onRemovePhase: () => void
  onSelectEdge: (edgeId: string | null) => void
}) {
  const [tab, setTab] = useState<InspectorTab>("phase")

  useEffect(() => {
    if (selectedEdgeId) setTab("routes")
  }, [selectedEdgeId])

  useEffect(() => {
    if (phase) setTab((current) => current === "routes" ? "phase" : current)
  }, [phase])

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l bg-secondary/10">
      <div className="border-b px-2 py-2">
        <div className="grid grid-cols-3 gap-1 rounded-lg bg-secondary/50 p-1">
          {TABS.map((item) => {
            const Icon = item.icon
            return (
              <Button
                key={item.id}
                variant="ghost"
                size="compacto"
                onClick={() => setTab(item.id)}
                aria-pressed={tab === item.id}
                className={cn(tab === item.id && SELECTED_FILL)}
              >
                <Icon className="size-3.5" />
                {item.label}
              </Button>
            )
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "phase" && (
          <FlightPlanPhaseInspector
            phase={phase}
            phaseIndex={phaseIndex}
            phaseCount={plan.phases.length}
            onPatch={onPatchPhase}
            onMove={onMovePhase}
            onRemove={onRemovePhase}
          />
        )}
        {tab === "safety" && (
          <FlightPlanSafetyInspector
            plan={plan}
            phase={phase}
            project={project}
            onPatchPlan={onPatchPlan}
            onPatchPhase={onPatchPhase}
          />
        )}
        {tab === "routes" && (
          <FlightPlanRouteInspector
            plan={plan}
            mode={mode}
            selectedEdgeId={selectedEdgeId}
            onSelectEdge={onSelectEdge}
            onChange={onPatchPlan}
          />
        )}
      </div>
    </aside>
  )
}
