import { useEffect, useMemo, useState } from "react"
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { ArrowLeft, ArrowRight, CheckCircle2, Route } from "lucide-react"
import { useApp } from "@/store/app"
import type { MissionPersona, MissionPreset } from "@/lib/missionTypes"
import {
  enableGraphMode,
  moveMissionPhase,
  updateMissionNodePositions,
} from "@/lib/missionPlans"
import { cn } from "@/lib/utils"

interface PhaseNodeData extends Record<string, unknown> {
  phaseId: string
  order: number
  label: string
  persona: MissionPersona
  agent: string
  model: string | null
  entryCount: number
  exitCount: number
}

type PhaseNode = Node<PhaseNodeData, "missionPhase">

const PERSONA_LABEL: Record<MissionPersona, string> = {
  planner: "PLANNER",
  executor: "EXECUTOR",
  reviewer: "REVIEWER",
}

function MissionPhaseNode({ data, selected }: NodeProps<PhaseNode>) {
  return (
    <div
      className={cn(
        "w-48 rounded-lg border bg-card shadow-sm transition-[border-color,box-shadow]",
        selected
          ? "border-brass/70 shadow-[0_0_0_3px_var(--brass-soft)]"
          : "border-border-strong",
      )}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-2.5 !border-2 !border-card !bg-brass"
      />
      <div className="flex items-center justify-between border-b border-border/60 px-2.5 py-1.5">
        <span className="font-mono text-[9px] tracking-[0.14em] text-brass">
          TRECHO {String(data.order + 1).padStart(2, "0")}
        </span>
        <span className="text-[9px] tracking-wide text-muted-foreground">
          {PERSONA_LABEL[data.persona]}
        </span>
      </div>
      <div className="px-2.5 py-2">
        <div className="truncate text-[13px] font-medium text-foreground">
          {data.label || "Fase sem nome"}
        </div>
        <div className="mt-1 truncate font-mono text-[10.5px] text-muted-foreground">
          {data.agent}
          {data.model ? ` / ${data.model}` : " / default"}
        </div>
        {(data.entryCount > 0 || data.exitCount > 0) && (
          <div className="mt-2 flex items-center gap-2 border-t border-border/50 pt-1.5 text-[9.5px] text-muted-foreground">
            <span>ENT {data.entryCount}</span>
            <span className="text-border-strong">/</span>
            <span>SAÍ {data.exitCount}</span>
          </div>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!size-2.5 !border-2 !border-card !bg-brass"
      />
    </div>
  )
}

const NODE_TYPES = { missionPhase: MissionPhaseNode }

function toFlowNodes(preset: MissionPreset): PhaseNode[] {
  const graph = enableGraphMode(preset).graph!
  const phases = new Map(preset.phases.map((phase) => [phase.id, phase]))
  return graph.nodes.flatMap((node) => {
    const phase = phases.get(node.phaseId)
    if (!phase) return []
    const order = preset.phases.findIndex((candidate) => candidate.id === phase.id)
    return [
      {
        id: node.id,
        type: "missionPhase" as const,
        position: node.position,
        data: {
          phaseId: phase.id,
          order,
          label: phase.label,
          persona: phase.persona,
          agent: phase.agent,
          model: phase.model,
          entryCount: phase.entryCriteria?.filter((c) => c.trim()).length ?? 0,
          exitCount: phase.exitCriteria?.filter((c) => c.trim()).length ?? 0,
        },
      },
    ]
  })
}

function toFlowEdges(preset: MissionPreset): Edge[] {
  return enableGraphMode(preset).graph!.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    type: "smoothstep",
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--brass)" },
    style: { stroke: "var(--brass)", strokeWidth: 1.4 },
  }))
}

/** Canvas operacional do motor linear: pan/zoom/drag de layout e reordenação
 *  real da rota. Conexões são somente leitura por enquanto — assim toda edição
 *  salva continua executável pelo mesmo engine que já roda Mission hoje. */
export function MissionPlanCanvas({
  preset,
  onChange,
}: {
  preset: MissionPreset
  onChange: (next: MissionPreset) => void
}) {
  const theme = useApp((state) => state.theme)
  const [selectedPhaseId, setSelectedPhaseId] = useState(
    preset.phases[0]?.id ?? null,
  )
  const graphSignature = JSON.stringify(enableGraphMode(preset).graph)
  const [nodes, setNodes, onNodesChange] = useNodesState<PhaseNode>(
    toFlowNodes(preset),
  )
  const edges = useMemo(() => toFlowEdges(preset), [preset])

  useEffect(() => {
    setNodes(toFlowNodes(preset))
  }, [graphSignature, preset, setNodes])

  useEffect(() => {
    if (
      selectedPhaseId &&
      !preset.phases.some((phase) => phase.id === selectedPhaseId)
    ) {
      setSelectedPhaseId(preset.phases[0]?.id ?? null)
    }
  }, [preset.phases, selectedPhaseId])

  const selectedIndex = preset.phases.findIndex(
    (phase) => phase.id === selectedPhaseId,
  )
  const selected = selectedIndex >= 0 ? preset.phases[selectedIndex] : null

  function moveSelected(delta: -1 | 1) {
    if (selectedIndex < 0) return
    onChange(moveMissionPhase(enableGraphMode(preset), selectedIndex, selectedIndex + delta))
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/70 bg-background">
      <div className="flex items-center justify-between border-b border-border/60 bg-secondary/20 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-brass/10 text-brass">
            <Route className="size-3.5" />
          </span>
          <div className="min-w-0">
            <div className="text-[11.5px] font-medium text-foreground">
              Rota linear executável
            </div>
            <div className="text-[10px] text-muted-foreground">
              {preset.phases.length} nós · {Math.max(0, preset.phases.length - 1)} conexões
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => moveSelected(-1)}
            disabled={selectedIndex <= 0}
            className="grid size-7 place-items-center rounded border border-border/70 text-muted-foreground transition-colors hover:border-brass/40 hover:text-brass disabled:opacity-30"
            aria-label="Mover fase para antes"
            title="Mover fase para antes"
          >
            <ArrowLeft className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => moveSelected(1)}
            disabled={selectedIndex < 0 || selectedIndex >= preset.phases.length - 1}
            className="grid size-7 place-items-center rounded border border-border/70 text-muted-foreground transition-colors hover:border-brass/40 hover:text-brass disabled:opacity-30"
            aria-label="Mover fase para depois"
            title="Mover fase para depois"
          >
            <ArrowRight className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="h-64 bg-[radial-gradient(circle_at_50%_45%,var(--brass-soft),transparent_48%)]">
        <ReactFlow<PhaseNode>
          colorMode={theme}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onNodeClick={(_, node) => setSelectedPhaseId(node.data.phaseId)}
          onNodeDragStop={(_, node) =>
            onChange(
              updateMissionNodePositions(preset, {
                [node.data.phaseId]: node.position,
              }),
            )
          }
          nodesConnectable={false}
          deleteKeyCode={null}
          fitView
          fitViewOptions={{ padding: 0.25, maxZoom: 1.05 }}
          minZoom={0.35}
          maxZoom={1.5}
          proOptions={{ hideAttribution: true }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1}
            color="var(--border-strong)"
          />
          <Controls
            position="bottom-right"
            showInteractive={false}
            className="!overflow-hidden !rounded-md !border !border-border/70 !bg-card !shadow-sm [&_button]:!border-border/60 [&_button]:!bg-card [&_button]:!fill-foreground"
          />
        </ReactFlow>
      </div>

      <div className="flex min-h-10 items-center gap-2 border-t border-border/60 bg-secondary/15 px-3 py-2">
        <CheckCircle2 className="size-3.5 shrink-0 text-st-success" />
        <span className="min-w-0 truncate text-[10.5px] text-muted-foreground">
          {selected
            ? `${selected.label || "Fase sem nome"} selecionada · arraste para organizar o mapa ou use as setas para mudar a execução.`
            : "Selecione um nó para mudar sua posição na rota."}
        </span>
      </div>
    </div>
  )
}
