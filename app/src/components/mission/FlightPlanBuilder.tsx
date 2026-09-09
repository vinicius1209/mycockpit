import { ListTree, Route } from "lucide-react"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { FlightPlanInspector } from "@/components/mission/FlightPlanInspector"
import { FlightPlanPalette } from "@/components/mission/FlightPlanPalette"
import { FlightPlanValidationBar } from "@/components/mission/FlightPlanValidationBar"
import { LinearRouteEditor } from "@/components/mission/LinearRouteEditor"
import { MissionPlanCanvas } from "@/components/mission/MissionPlanCanvas"
import { createFlightPlanPhase } from "@/lib/flightPlanBuilder"
import {
  autoLayoutMissionPlan,
  enableGraphMode,
  missionPlanMode,
  moveMissionPhase,
  syncMissionPlan,
} from "@/lib/missionPlans"
import type { MissionPhaseDef, MissionPersona, MissionPreset } from "@/lib/missionTypes"
import type { Project } from "@/lib/types"
import { cn } from "@/lib/utils"
import { SELECTED_FILL } from "@/lib/selection"

export function FlightPlanBuilder({
  plan,
  project,
  missionEnabled,
  onChange,
}: {
  plan: MissionPreset
  project: Project | null
  missionEnabled: boolean
  onChange: (next: MissionPreset) => void
}) {
  const [selectedPhaseId, setSelectedPhaseId] = useState<string | null>(
    plan.phases[0]?.id ?? null,
  )
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const mode = missionPlanMode(plan)
  const selectedPhaseIndex = plan.phases.findIndex((phase) => phase.id === selectedPhaseId)
  const selectedPhase = selectedPhaseIndex >= 0 ? plan.phases[selectedPhaseIndex] : null

  useEffect(() => {
    if (!selectedPhaseId) return
    if (plan.phases.some((phase) => phase.id === selectedPhaseId)) return
    setSelectedPhaseId(plan.phases[0]?.id ?? null)
  }, [plan.id, plan.phases, selectedPhaseId])

  useEffect(() => {
    if (!selectedEdgeId || plan.graph?.edges.some((edge) => edge.id === selectedEdgeId)) return
    setSelectedEdgeId(null)
  }, [plan.graph?.edges, plan.id, selectedEdgeId])

  function patchPhase(patch: Partial<MissionPhaseDef>) {
    if (selectedPhaseIndex < 0) return
    onChange({
      ...plan,
      phases: plan.phases.map((phase, index) =>
        index === selectedPhaseIndex ? { ...phase, ...patch } : phase,
      ),
    })
  }

  function addPhase(persona: MissionPersona) {
    const phase = createFlightPlanPhase(persona)
    onChange(syncMissionPlan({ ...plan, phases: [...plan.phases, phase] }))
    setSelectedEdgeId(null)
    setSelectedPhaseId(phase.id)
  }

  function removePhase() {
    if (selectedPhaseIndex < 0 || plan.phases.length <= 1) return
    const nextPhases = plan.phases.filter((_, index) => index !== selectedPhaseIndex)
    onChange(syncMissionPlan({ ...plan, phases: nextPhases }))
    setSelectedPhaseId(
      nextPhases[Math.min(selectedPhaseIndex, nextPhases.length - 1)]?.id ?? null,
    )
  }

  function movePhase(delta: -1 | 1) {
    if (selectedPhaseIndex < 0) return
    const moved = moveMissionPhase(
      enableGraphMode(plan),
      selectedPhaseIndex,
      selectedPhaseIndex + delta,
    )
    onChange(mode === "linear" ? { ...moved, mode: "linear" } : moved)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <Input
            value={plan.name}
            onChange={(event) => onChange({ ...plan, name: event.target.value })}
            className={cn(
              "h-8 border-transparent bg-transparent px-1 text-[14px] font-medium shadow-none",
              "hover:border-border focus-visible:border-brass/50",
            )}
            aria-label="Nome do Plano de voo"
          />
          <Input
            value={plan.description ?? ""}
            onChange={(event) => onChange({ ...plan, description: event.target.value })}
            placeholder="Quando usar este plano?"
            className={cn(
              "h-7 border-transparent bg-transparent px-1 text-[11px] text-muted-foreground shadow-none",
              "hover:border-border focus-visible:border-brass/50",
            )}
            aria-label="Descrição do Plano de voo"
          />
        </div>
        <div className="flex shrink-0 rounded-lg border bg-secondary/35 p-1">
          <Button
            variant="ghost"
            size="compacto"
            onClick={() => {
              setSelectedEdgeId(null)
              onChange({ ...plan, mode: "linear" })
            }}
            aria-pressed={mode === "linear"}
            className={cn(mode === "linear" && SELECTED_FILL)}
          >
            <ListTree className="size-3.5" />
            Rota
          </Button>
          <Button
            variant="ghost"
            size="compacto"
            onClick={() => {
              setSelectedEdgeId(null)
              onChange(enableGraphMode(plan))
            }}
            aria-pressed={mode === "graph"}
            className={cn(mode === "graph" && SELECTED_FILL)}
          >
            <Route className="size-3.5" />
            Fluxo visual
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        <FlightPlanPalette
          plan={plan}
          mode={mode}
          onAddPhase={addPhase}
          onReorganize={() => onChange(autoLayoutMissionPlan(plan))}
        />

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border/40 px-3">
            <div className="min-w-0">
              <span className="text-[12px] font-medium text-foreground">
                {mode === "graph" ? "Fluxo executável" : "Rota da missão"}
              </span>
              <span className="ml-2 text-[11px] text-muted-foreground">
                {mode === "graph"
                  ? "arraste os nós e conecte as portas"
                  : "a ordem da lista é a ordem de execução"}
              </span>
            </div>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              revisão {plan.revision ?? 1}
            </span>
          </div>

          {mode === "linear" ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <LinearRouteEditor
                preset={plan}
                onChange={onChange}
                selectedPhaseId={selectedPhaseId}
                onSelectPhase={(phaseId) => {
                  setSelectedEdgeId(null)
                  setSelectedPhaseId(phaseId)
                }}
                className="mx-auto max-w-3xl"
              />
            </div>
          ) : (
            <MissionPlanCanvas
              preset={plan}
              onChange={onChange}
              selectedPhaseId={selectedPhaseId}
              selectedEdgeId={selectedEdgeId}
              onSelectPhase={setSelectedPhaseId}
              onSelectEdge={setSelectedEdgeId}
              interactive
              className="h-full flex-1"
            />
          )}
        </main>

        <FlightPlanInspector
          plan={plan}
          mode={mode}
          phase={selectedPhase}
          phaseIndex={selectedPhaseIndex}
          selectedEdgeId={selectedEdgeId}
          project={project}
          onPatchPlan={onChange}
          onPatchPhase={patchPhase}
          onMovePhase={movePhase}
          onRemovePhase={removePhase}
          onSelectEdge={(edgeId) => {
            if (edgeId) setSelectedPhaseId(null)
            setSelectedEdgeId(edgeId)
          }}
        />
      </div>

      <FlightPlanValidationBar plan={plan} missionEnabled={missionEnabled} />
    </div>
  )
}
