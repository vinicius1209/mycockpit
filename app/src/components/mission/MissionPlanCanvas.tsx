import { useCallback, useEffect, useMemo, useState } from "react"
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
import { CheckCircle2, Route, Trash2 } from "lucide-react"
import { useApp } from "@/store/app"
import type {
  MissionPersona,
  MissionPlanEdgeCondition,
  MissionPreset,
} from "@/lib/missionTypes"
import {
  autoLayoutMissionPlan,
  enableGraphMode,
  updateMissionNodePositions,
} from "@/lib/missionPlans"
import {
  missionVisualEdgeHandles,
  missionVisualEdgeLabel,
  missionVisualTerminals,
} from "@/lib/missionGraphPresentation"
import { cn } from "@/lib/utils"
import { SELECTED_ON_SURFACE } from "@/lib/selection"

interface PhaseNodeData extends Record<string, unknown> {
  kind: "phase"
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

interface TerminalNodeData extends Record<string, unknown> {
  kind: "terminal"
  sourceNodeId: string
}

type TerminalNode = Node<TerminalNodeData, "missionTerminal">
type CanvasNode = PhaseNode | TerminalNode

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
        selected ? SELECTED_ON_SURFACE : "border-border",
      )}
    >
      <Handle
        id="target-left"
        type="target"
        position={Position.Left}
        className="!size-2.5 !border-2 !border-card !bg-brass"
      />
      <Handle id="target-right" type="target" position={Position.Right} isConnectable={false} className="!size-px !border-0 !bg-transparent !opacity-0" />
      <Handle id="target-top-in" type="target" position={Position.Top} isConnectable={false} className="!left-[36%] !size-px !border-0 !bg-transparent !opacity-0" />
      <Handle id="target-bottom-return" type="target" position={Position.Bottom} isConnectable={false} className="!left-[64%] !size-px !border-0 !bg-transparent !opacity-0" />
      <div className="flex items-center justify-between px-2.5 pt-2 pb-0.5">
        <span className="font-mono text-[11px] tracking-[0.14em] text-brass">
          FASE {String(data.order + 1).padStart(2, "0")}
        </span>
        <span className="text-[11px] tracking-wide text-muted-foreground">
          {PERSONA_LABEL[data.persona]}
        </span>
      </div>
      <div className="px-2.5 pt-1 pb-2.5">
        <div className="truncate text-[13px] font-medium text-foreground">
          {data.label || "Fase sem nome"}
        </div>
        <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
          {data.agent}
          {data.model ? ` / ${data.model}` : " / default"}
        </div>
        {(data.entryCount > 0 || data.exitCount > 0) && (
          <div className="mt-2 flex items-center gap-2 border-t border-border/50 pt-1.5 text-[11px] text-muted-foreground">
            <span>ENT {data.entryCount}</span>
            <span className="text-border-strong">/</span>
            <span>SAÍ {data.exitCount}</span>
          </div>
        )}
      </div>
      <Handle
        id="source-right"
        type="source"
        position={Position.Right}
        className="!size-2.5 !border-2 !border-card !bg-brass"
      />
      <Handle id="source-left" type="source" position={Position.Left} isConnectable={false} className="!size-px !border-0 !bg-transparent !opacity-0" />
      <Handle id="source-bottom-out" type="source" position={Position.Bottom} isConnectable={false} className="!left-[36%] !size-px !border-0 !bg-transparent !opacity-0" />
      <Handle id="source-top-return" type="source" position={Position.Top} isConnectable={false} className="!left-[64%] !size-px !border-0 !bg-transparent !opacity-0" />
    </div>
  )
}

function MissionTerminalNode() {
  return (
    <div className="flex w-40 items-center gap-2.5 rounded-full border border-brass/35 bg-brass/[0.06] px-3 py-2 text-brass shadow-sm">
      <Handle
        id="target-left"
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!size-px !border-0 !bg-transparent !opacity-0"
      />
      <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
      <span className="text-[12px] font-medium">Missão concluída</span>
    </div>
  )
}

const NODE_TYPES = {
  missionPhase: MissionPhaseNode,
  missionTerminal: MissionTerminalNode,
}

function toFlowNodes(
  preset: MissionPreset,
  selectedPhaseId?: string | null,
): CanvasNode[] {
  const graph = enableGraphMode(preset).graph!
  const phases = new Map(preset.phases.map((phase) => [phase.id, phase]))
  const phaseNodes: CanvasNode[] = graph.nodes.flatMap((node) => {
    const phase = phases.get(node.phaseId)
    if (!phase) return []
    const order = preset.phases.findIndex((candidate) => candidate.id === phase.id)
    return [
      {
        id: node.id,
        type: "missionPhase" as const,
        position: node.position,
        selected: phase.id === selectedPhaseId,
        data: {
          kind: "phase" as const,
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
  const terminalNodes: CanvasNode[] = missionVisualTerminals(graph).map(
    (terminal) => ({
      id: terminal.id,
      type: "missionTerminal" as const,
      position: terminal.position,
      selectable: false,
      draggable: false,
      connectable: false,
      data: {
        kind: "terminal" as const,
        sourceNodeId: terminal.sourceNodeId,
      },
    }),
  )
  return [...phaseNodes, ...terminalNodes]
}

function toFlowEdges(preset: MissionPreset): Edge[] {
  const graph = enableGraphMode(preset).graph!
  const executable = graph.edges.map((edge) => {
    const handles = missionVisualEdgeHandles(graph, edge)
    const loop = edge.maxTraversals !== undefined
    const stroke = loop ? "var(--st-warning)" : "var(--brass)"
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
      style: { stroke, strokeWidth: 1.4 },
      label: missionVisualEdgeLabel(graph, edge),
      labelStyle: { fill: "var(--muted-foreground)", fontSize: 10 },
      labelBgStyle: { fill: "var(--card)", fillOpacity: 0.94 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
    }
  })
  const terminals: Edge[] = missionVisualTerminals(graph).map((terminal) => ({
    id: `mission-terminal-edge:${terminal.sourceNodeId}`,
    source: terminal.sourceNodeId,
    target: terminal.id,
    sourceHandle: "source-right",
    targetHandle: "target-left",
    type: "smoothstep",
    selectable: false,
    focusable: false,
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--brass)" },
    style: { stroke: "var(--brass)", strokeWidth: 1.4 },
    label: "Aprovado",
    labelStyle: { fill: "var(--muted-foreground)", fontSize: 10 },
    labelBgStyle: { fill: "var(--card)", fillOpacity: 0.94 },
    labelBgPadding: [4, 2] as [number, number],
    labelBgBorderRadius: 4,
  }))
  return [...executable, ...terminals]
}

/** Projeção visual do grafo executável: layout, seleção e conexões pertencem ao
 *  contrato de domínio, sem tipos do React Flow vazando para o runtime. */
export function MissionPlanCanvas({
  preset,
  onChange,
  selectedPhaseId: controlledSelectedPhaseId,
  onSelectPhase,
  interactive = true,
  className,
}: {
  preset: MissionPreset
  onChange: (next: MissionPreset) => void
  selectedPhaseId?: string | null
  onSelectPhase?: (phaseId: string) => void
  interactive?: boolean
  className?: string
}) {
  const theme = useApp((state) => state.theme)
  const [internalSelectedPhaseId, setInternalSelectedPhaseId] = useState(
    preset.phases[0]?.id ?? null,
  )
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const selectedPhaseId =
    controlledSelectedPhaseId === undefined
      ? internalSelectedPhaseId
      : controlledSelectedPhaseId
  const graphSignature = JSON.stringify(enableGraphMode(preset).graph)
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(
    toFlowNodes(preset, selectedPhaseId),
  )
  const edges = useMemo(() => toFlowEdges(preset), [preset])

  useEffect(() => {
    setNodes(toFlowNodes(preset, selectedPhaseId))
  }, [graphSignature, preset, selectedPhaseId, setNodes])

  useEffect(() => {
    if (
      selectedPhaseId &&
      !preset.phases.some((phase) => phase.id === selectedPhaseId)
    ) {
      const fallback = preset.phases[0]?.id ?? null
      setInternalSelectedPhaseId(fallback)
      if (fallback) onSelectPhase?.(fallback)
    }
  }, [onSelectPhase, preset.phases, selectedPhaseId])

  const selectedIndex = preset.phases.findIndex(
    (phase) => phase.id === selectedPhaseId,
  )
  const selected = selectedIndex >= 0 ? preset.phases[selectedIndex] : null
  const graph = enableGraphMode(preset).graph!
  const terminals = missionVisualTerminals(graph)
  const selectedEdge = graph.edges.find((edge) => edge.id === selectedEdgeId)

  const connect = useCallback(
    (connection: { source: string | null; target: string | null }) => {
      if (!interactive || !connection.source || !connection.target) return
      if (connection.source === connection.target) return
      const withGraph = enableGraphMode(preset)
      const id = `edge-${connection.source}-${connection.target}-${crypto.randomUUID().slice(0, 6)}`
      onChange({
        ...withGraph,
        revision: (withGraph.revision ?? 1) + 1,
        graph: {
          ...withGraph.graph!,
          edges: [
            ...withGraph.graph!.edges,
            {
              id,
              source: connection.source,
              target: connection.target,
              condition: "success",
            },
          ],
        },
      })
      setSelectedEdgeId(id)
    },
    [interactive, onChange, preset],
  )

  function patchSelectedEdge(patch: {
    condition?: MissionPlanEdgeCondition
    maxTraversals?: number
  }) {
    if (!selectedEdge) return
    onChange({
      ...preset,
      revision: (preset.revision ?? 1) + 1,
      graph: {
        ...graph,
        edges: graph.edges.map((edge) =>
          edge.id === selectedEdge.id ? { ...edge, ...patch } : edge,
        ),
      },
    })
  }

  function removeSelectedEdge() {
    if (!selectedEdge) return
    onChange({
      ...preset,
      revision: (preset.revision ?? 1) + 1,
      graph: {
        ...graph,
        edges: graph.edges.filter((edge) => edge.id !== selectedEdge.id),
      },
    })
    setSelectedEdgeId(null)
  }

  function selectPhase(phaseId: string) {
    setInternalSelectedPhaseId(phaseId)
    onSelectPhase?.(phaseId)
  }

  return (
    <div
      className={cn(
        "flex min-h-0 flex-col overflow-hidden rounded-lg border border-border/70 bg-background",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border/60 bg-secondary/20 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-md bg-brass/10 text-brass">
            <Route className="size-3.5" />
          </span>
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-foreground">
              Fluxo visual executável
            </div>
            <div className="text-[11px] text-muted-foreground">
              {preset.phases.length} fases · {terminals.length}{" "}
              {terminals.length === 1 ? "saída de sucesso" : "saídas de sucesso"}
            </div>
          </div>
        </div>
        <span className="font-mono text-[11px] tracking-wide text-muted-foreground uppercase">
          {interactive ? (
            <button
              type="button"
              onClick={() => onChange(autoLayoutMissionPlan(preset))}
              className="rounded px-2 py-1 transition-colors hover:bg-secondary hover:text-foreground"
            >
              Reorganizar
            </button>
          ) : (
            "somente leitura"
          )}
        </span>
      </div>

      <div className="min-h-64 w-full flex-1 bg-[radial-gradient(circle_at_50%_45%,var(--brass-soft),transparent_48%)]">
        <ReactFlow<CanvasNode>
          className="h-full w-full"
          colorMode={theme}
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onNodeClick={(_, node) => {
            if (node.data.kind === "phase") selectPhase(node.data.phaseId)
          }}
          onPaneClick={() => setSelectedEdgeId(null)}
          onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)}
          onConnect={connect}
          onNodeDragStop={(_, node) => {
            if (!interactive || node.data.kind !== "phase") return
            onChange(
              updateMissionNodePositions(preset, {
                [node.data.phaseId]: node.position,
              }),
            )
          }}
          nodesDraggable={interactive}
          nodesConnectable={interactive}
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
        {selectedEdge && interactive ? (
          <>
            <span className="font-mono text-[11px] text-muted-foreground">Quando</span>
            {(["success", "failure", "always"] as const).map((condition) => (
              <button
                key={condition}
                type="button"
                onClick={() => patchSelectedEdge({ condition })}
                className={cn(
                  "h-6 rounded px-2 text-[11px] transition-colors",
                  selectedEdge.condition === condition
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {condition === "success"
                  ? "Concluiu"
                  : condition === "failure"
                    ? "Falhou"
                    : "Sempre"}
              </button>
            ))}
            <label className="ml-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              Limite
              <input
                type="number"
                min={1}
                value={selectedEdge.maxTraversals ?? ""}
                onChange={(event) => {
                  const value = event.target.value
                  patchSelectedEdge({
                    maxTraversals: value
                      ? Math.max(1, Number(value) || 1)
                      : undefined,
                  })
                }}
                placeholder="—"
                className="h-6 w-14 rounded border bg-background px-1.5 font-mono text-[11px] text-foreground outline-none focus:border-brass/50"
                aria-label="Limite de travessias da conexão"
              />
            </label>
            <button
              type="button"
              onClick={removeSelectedEdge}
              className="ml-auto grid size-7 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-st-error"
              aria-label="Remover conexão"
            >
              <Trash2 className="size-3.5" />
            </button>
          </>
        ) : (
          <>
            <CheckCircle2 className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 truncate text-[11px] text-muted-foreground">
              {selected
                ? `${selected.label || "Fase sem nome"} selecionada · ${interactive ? "arraste ou conecte as portas; selecione uma conexão para definir o resultado." : "abra o Fluxo visual para editar conexões."}`
                : "Selecione um nó ou uma conexão para editar o fluxo."}
            </span>
          </>
        )}
      </div>
    </div>
  )
}
