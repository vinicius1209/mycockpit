import { useEffect, useState } from "react"
import {
  ArrowDown,
  ArrowUp,
  ListTree,
  Plus,
  Route,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { agentDef } from "@/lib/agents"
import { graphFromPhases } from "@/lib/missionPlans"
import type {
  MissionPhaseDef,
  MissionPreset,
} from "@/lib/missionTypes"
import { SELECTED_ON_SURFACE } from "@/lib/selection"
import { cn } from "@/lib/utils"

const PERSONA_LABEL: Record<MissionPhaseDef["persona"], string> = {
  planner: "planejador",
  executor: "executor",
  reviewer: "revisor",
}

type LinearProjection =
  | { kind: "linear"; phases: MissionPhaseDef[] }
  | { kind: "visual-only" }

function phaseId(): string {
  return `phase-${Math.random().toString(36).slice(2, 9)}`
}

function newPhase(): MissionPhaseDef {
  return {
    id: phaseId(),
    label: "Nova fase",
    persona: "executor",
    agent: "claude-code",
    model: null,
    effort: null,
    maxRetries: 1,
  }
}

/**
 * Projeta um grafo que seja realmente uma cadeia simples. Qualquer condição
 * diferente de success, metadado de aresta, bifurcação, retorno, ciclo, nó
 * desconectado ou relação incompleta fica deliberadamente fora do editor
 * linear: reconstruir a cadeia nesses casos apagaria uma decisão que pertence
 * ao Fluxo visual.
 */
function projectLinearRoute(
  preset: Pick<MissionPreset, "phases" | "graph">,
): LinearProjection {
  const graph = preset.graph
  if (!graph) return { kind: "linear", phases: preset.phases }

  const phaseById = new Map(preset.phases.map((phase) => [phase.id, phase]))
  if (
    phaseById.size !== preset.phases.length ||
    graph.nodes.length !== preset.phases.length ||
    graph.edges.length !== Math.max(0, graph.nodes.length - 1)
  ) {
    return { kind: "visual-only" }
  }

  if (graph.nodes.length === 0) {
    return graph.entryNodeId === null
      ? { kind: "linear", phases: [] }
      : { kind: "visual-only" }
  }

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]))
  if (
    nodeById.size !== graph.nodes.length ||
    !graph.entryNodeId ||
    !nodeById.has(graph.entryNodeId)
  ) {
    return { kind: "visual-only" }
  }

  const outgoing = new Map<string, string>()
  const incoming = new Set<string>()
  for (const edge of graph.edges) {
    if (
      edge.condition !== "success" ||
      Boolean(edge.label?.trim()) ||
      edge.maxTraversals !== undefined ||
      !nodeById.has(edge.source) ||
      !nodeById.has(edge.target) ||
      outgoing.has(edge.source) ||
      incoming.has(edge.target)
    ) {
      return { kind: "visual-only" }
    }
    outgoing.set(edge.source, edge.target)
    incoming.add(edge.target)
  }

  const visited = new Set<string>()
  const phases: MissionPhaseDef[] = []
  let cursor: string | undefined = graph.entryNodeId
  while (cursor) {
    if (visited.has(cursor)) return { kind: "visual-only" }
    visited.add(cursor)
    const node = nodeById.get(cursor)
    const phase = node ? phaseById.get(node.phaseId) : undefined
    if (!phase) return { kind: "visual-only" }
    phases.push(phase)
    cursor = outgoing.get(cursor)
  }

  return visited.size === graph.nodes.length && phases.length === preset.phases.length
    ? { kind: "linear", phases }
    : { kind: "visual-only" }
}

function phaseAgentModel(phase: MissionPhaseDef): string {
  const agent = agentDef(phase.agent)
  const agentLabel = agent?.shortLabel ?? agent?.label ?? phase.agent
  if (!phase.model) return agentLabel
  const model = agent?.models.find((candidate) => candidate.value === phase.model)
  return `${agentLabel} · ${model?.label ?? phase.model}`
}

function updateLinearGraph(
  preset: MissionPreset,
  phases: MissionPhaseDef[],
  preservePositions = true,
): MissionPreset {
  const revision = (preset.revision ?? 1) + 1
  if (!preset.graph) return { ...preset, revision, phases }
  return {
    ...preset,
    revision,
    phases,
    graph: graphFromPhases(phases, preservePositions ? preset.graph : undefined),
  }
}

function ReadOnlyFlowNotice({ phaseCount }: { phaseCount: number }) {
  return (
    <div className="rounded-lg bg-secondary/45 px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-background text-muted-foreground">
          <Route className="size-3.5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-foreground">
            Este plano usa o Fluxo visual
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            As conexões deste plano não formam uma sequência simples. A visão
            Rota não pode reordenar{" "}
            {phaseCount === 1 ? "esta fase" : `estas ${phaseCount} fases`} sem
            apagar conexões, retornos ou condições. Abra o Fluxo visual para
            editar a execução.
          </p>
        </div>
      </div>
    </div>
  )
}

export function LinearRouteEditor({
  preset,
  onChange,
  selectedPhaseId: controlledSelectedPhaseId,
  onSelectPhase,
  className,
}: {
  preset: MissionPreset
  onChange: (next: MissionPreset) => void
  selectedPhaseId?: string | null
  onSelectPhase?: (phaseId: string | null) => void
  className?: string
}) {
  const projection = projectLinearRoute(preset)
  const phases =
    projection.kind === "linear" ? projection.phases : preset.phases
  const [internalSelectedPhaseId, setInternalSelectedPhaseId] = useState<
    string | null
  >(phases[0]?.id ?? null)
  const selectedPhaseId =
    controlledSelectedPhaseId === undefined
      ? internalSelectedPhaseId
      : controlledSelectedPhaseId

  useEffect(() => {
    if (selectedPhaseId && phases.some((phase) => phase.id === selectedPhaseId)) {
      return
    }
    const fallback = phases[0]?.id ?? null
    setInternalSelectedPhaseId(fallback)
    onSelectPhase?.(fallback)
  }, [onSelectPhase, phases, selectedPhaseId])

  function selectPhase(id: string | null) {
    setInternalSelectedPhaseId(id)
    onSelectPhase?.(id)
  }

  function addPhase() {
    if (projection.kind !== "linear") return
    const phase = newPhase()
    const selectedIndex = phases.findIndex(
      (candidate) => candidate.id === selectedPhaseId,
    )
    const insertAt = selectedIndex >= 0 ? selectedIndex + 1 : phases.length
    const next = [...phases]
    next.splice(insertAt, 0, phase)
    onChange(updateLinearGraph(preset, next))
    selectPhase(phase.id)
  }

  function movePhase(index: number, delta: -1 | 1) {
    if (projection.kind !== "linear") return
    const target = index + delta
    if (target < 0 || target >= phases.length) return
    const next = [...phases]
    const [phase] = next.splice(index, 1)
    next.splice(target, 0, phase)
    // Reordenar a rota também realinha o mapa. Preservar as coordenadas antigas
    // faria a nova conexão voltar visualmente para trás.
    onChange(updateLinearGraph(preset, next, false))
  }

  function removePhase(index: number) {
    if (projection.kind !== "linear" || phases.length <= 1) return
    const removed = phases[index]
    const next = phases.filter((_, candidateIndex) => candidateIndex !== index)
    onChange(updateLinearGraph(preset, next))
    if (removed.id === selectedPhaseId) {
      selectPhase(next[Math.min(index, next.length - 1)]?.id ?? null)
    }
  }

  const readOnly = projection.kind === "visual-only"

  return (
    <section className={cn("min-w-0", className)} aria-label="Rota da missão">
      <div className="mb-3 flex min-h-8 items-center gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="label-mono">Rota da missão</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {readOnly
              ? `${phases.length} ${phases.length === 1 ? "fase" : "fases"} · a ordem está nas conexões`
              : `${phases.length} ${phases.length === 1 ? "fase em sequência" : "fases em sequência"}`}
          </p>
        </div>
        {!readOnly && phases.length > 0 && (
          <Button variant="outline" size="sm" onClick={addPhase}>
            <Plus className="size-3.5" />
            Adicionar fase
          </Button>
        )}
      </div>

      {readOnly && <ReadOnlyFlowNotice phaseCount={phases.length} />}

      {phases.length === 0 ? (
        <div className="grid min-h-48 place-items-center rounded-xl bg-secondary/20 px-6 py-8 text-center">
          <div className="max-w-xs">
            <ListTree className="mx-auto size-7 text-muted-foreground" />
            <h3 className="mt-3 text-[13px] font-medium text-foreground">
              A rota ainda não tem fases
            </h3>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Adicione a primeira fase para definir quem começa a missão.
            </p>
            {!readOnly && (
              <Button size="sm" className="mt-4" onClick={addPhase}>
                <Plus className="size-3.5" />
                Adicionar primeira fase
              </Button>
            )}
          </div>
        </div>
      ) : (
        <ol className={cn("mt-3", readOnly && "opacity-80")}>
          {phases.map((phase, index) => {
            const selected = !readOnly && phase.id === selectedPhaseId
            const criteriaCount =
              (phase.entryCriteria?.filter((item) => item.trim()).length ?? 0) +
              (phase.exitCriteria?.filter((item) => item.trim()).length ?? 0)
            return (
              <li key={phase.id}>
                <article
                  className={cn(
                    "rounded-lg border bg-card shadow-sm transition-[border-color,box-shadow]",
                    selected ? SELECTED_ON_SURFACE : "border-border",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => selectPhase(phase.id)}
                    disabled={readOnly}
                    className="flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-default"
                    aria-pressed={selected}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-md bg-secondary font-mono text-[11px] tabular-nums text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-foreground">
                        {phase.label || "Fase sem nome"}
                      </span>
                      <span className="mt-1 block truncate font-mono text-[11px] text-muted-foreground">
                        {PERSONA_LABEL[phase.persona]} · {phaseAgentModel(phase)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                      {phase.maxRetries === 1
                        ? "1 tentativa"
                        : `${phase.maxRetries} tentativas`}
                      {criteriaCount > 0 && (
                        <span className="mt-1 block">
                          {criteriaCount} {criteriaCount === 1 ? "critério" : "critérios"}
                        </span>
                      )}
                    </span>
                  </button>

                  {selected && !readOnly && (
                    <div className="flex items-center justify-end gap-1 px-2 pb-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={index === 0}
                        onClick={() => movePhase(index, -1)}
                        title="Mover fase para cima"
                        aria-label={`Mover ${phase.label || "fase"} para cima`}
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={index === phases.length - 1}
                        onClick={() => movePhase(index, 1)}
                        title="Mover fase para baixo"
                        aria-label={`Mover ${phase.label || "fase"} para baixo`}
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        disabled={phases.length <= 1}
                        onClick={() => removePhase(index)}
                        title="Remover fase"
                        aria-label={`Remover ${phase.label || "fase"}`}
                        className="hover:text-st-error"
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  )}
                </article>

                {index < phases.length - 1 && !readOnly && (
                  <div
                    className="grid h-7 place-items-center text-border-strong"
                    aria-hidden="true"
                  >
                    <ArrowDown className="size-3.5" />
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
