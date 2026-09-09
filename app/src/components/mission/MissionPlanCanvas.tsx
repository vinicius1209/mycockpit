import { useCallback, useEffect, useMemo, useState } from "react"
import {
  BaseEdge,
  Background,
  BackgroundVariant,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  getSmoothStepPath,
  useNodesState,
  type Connection,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { CheckCircle2 } from "lucide-react"
import { useApp } from "@/store/app"
import type { MissionPersona, MissionPreset } from "@/lib/missionTypes"
import { enableGraphMode, updateMissionNodePositions } from "@/lib/missionPlans"
import {
  missionVisualEdgeHandles,
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

interface MissionEdgeData extends Record<string, unknown> {
  label: string
  limit?: number
  offsetX: number
  offsetY: number
  showLabel: boolean
  tone: "neutral" | "failure" | "always"
}

const PERSONA_LABEL: Record<MissionPersona, string> = {
  planner: "PLANEJADOR",
  executor: "EXECUTOR",
  reviewer: "REVISOR",
}

function HiddenHandle({
  id,
  type,
  position,
  className,
}: {
  id: string
  type: "source" | "target"
  position: Position
  className?: string
}) {
  return (
    <Handle
      id={id}
      type={type}
      position={position}
      isConnectable={false}
      className={cn("!size-px !border-0 !bg-transparent !opacity-0", className)}
    />
  )
}

function MissionPhaseNode({ data, selected }: NodeProps<PhaseNode>) {
  return (
    <div
      className={cn(
        "w-52 rounded-lg border bg-card shadow-sm transition-[border-color,box-shadow]",
        selected ? SELECTED_ON_SURFACE : "border-border",
      )}
    >
      <Handle
        id="target-left"
        type="target"
        position={Position.Left}
        className="!size-2.5 !border-2 !border-card !bg-muted-foreground"
      />
      <HiddenHandle id="target-right" type="target" position={Position.Right} />
      <HiddenHandle id="target-top-in" type="target" position={Position.Top} className="!left-[36%]" />
      <HiddenHandle id="target-bottom-return" type="target" position={Position.Bottom} className="!left-[64%]" />

      <div className="flex items-center justify-between gap-3 px-3 pt-2.5">
        <span className="font-mono text-[11px] tracking-[0.14em] text-brass">
          FASE {String(data.order + 1).padStart(2, "0")}
        </span>
        <span className="truncate text-[11px] tracking-wide text-muted-foreground">
          {PERSONA_LABEL[data.persona]}
        </span>
      </div>
      <div className="px-3 pt-1.5 pb-3">
        <div className="truncate text-[13px] font-medium text-foreground">
          {data.label || "Fase sem nome"}
        </div>
        <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
          {data.agent}{data.model ? ` · ${data.model}` : " · padrão"}
        </div>
        {(data.entryCount > 0 || data.exitCount > 0) && (
          <div className="mt-2 flex items-center gap-2 border-t border-border/40 pt-2 font-mono text-[11px] text-muted-foreground">
            <span>entrada {data.entryCount}</span>
            <span>·</span>
            <span>saída {data.exitCount}</span>
          </div>
        )}
      </div>

      <Handle
        id="source-right"
        type="source"
        position={Position.Right}
        className="!size-2.5 !border-2 !border-card !bg-muted-foreground"
      />
      <HiddenHandle id="source-left" type="source" position={Position.Left} />
      <HiddenHandle id="source-bottom-out" type="source" position={Position.Bottom} className="!left-[36%]" />
      <HiddenHandle id="source-top-return" type="source" position={Position.Top} className="!left-[64%]" />
    </div>
  )
}

function MissionTerminalNode() {
  return (
    <div className="flex w-44 items-center gap-2.5 rounded-full border bg-secondary px-3 py-2 text-foreground shadow-sm">
      <HiddenHandle id="target-left" type="target" position={Position.Left} />
      <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
      <span className="text-[12px] font-medium">Missão concluída</span>
    </div>
  )
}

const NODE_TYPES = {
  missionPhase: MissionPhaseNode,
  missionTerminal: MissionTerminalNode,
}

function MissionEdgeLabel(props: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX: props.sourceX,
    sourceY: props.sourceY,
    sourcePosition: props.sourcePosition,
    targetX: props.targetX,
    targetY: props.targetY,
    targetPosition: props.targetPosition,
  })
  const data = props.data as MissionEdgeData | undefined

  return (
    <>
      <BaseEdge id={props.id} path={path} markerEnd={props.markerEnd} style={props.style} />
      {data?.showLabel && (
        <EdgeLabelRenderer>
          <div
            className={cn(
              "pointer-events-none absolute z-10 flex items-center gap-1 rounded bg-card px-1.5 py-0.5 text-[11px] whitespace-nowrap shadow-sm",
              data.tone === "failure"
                ? "text-st-error"
                : data.tone === "always"
                  ? "text-brass"
                  : "text-muted-foreground",
            )}
            style={{
              transform: `translate(-50%, -50%) translate(${labelX + data.offsetX}px, ${labelY + data.offsetY}px)`,
            }}
          >
            <span>{data.label}</span>
            {data.limit !== undefined && (
              <span className="font-mono opacity-75">×{data.limit}</span>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

const EDGE_TYPES = { missionEdge: MissionEdgeLabel }

function toFlowNodes(
  preset: MissionPreset,
  selectedPhaseId?: string | null,
): CanvasNode[] {
  const graph = enableGraphMode(preset).graph!
  const phases = new Map(preset.phases.map((phase) => [phase.id, phase]))
  const phaseNodes: CanvasNode[] = graph.nodes.flatMap((node) => {
    const phase = phases.get(node.phaseId)
    if (!phase) return []
    return [{
      id: node.id,
      type: "missionPhase" as const,
      position: node.position,
      selected: phase.id === selectedPhaseId,
      data: {
        kind: "phase" as const,
        phaseId: phase.id,
        order: preset.phases.findIndex((candidate) => candidate.id === phase.id),
        label: phase.label,
        persona: phase.persona,
        agent: phase.agent,
        model: phase.model,
        entryCount: phase.entryCriteria?.filter((item) => item.trim()).length ?? 0,
        exitCount: phase.exitCriteria?.filter((item) => item.trim()).length ?? 0,
      },
    }]
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

function edgeStroke(condition: "success" | "failure" | "always"): string {
  if (condition === "success") return "var(--muted-foreground)"
  if (condition === "failure") return "var(--st-error)"
  return "var(--brass)"
}

function edgeLabelOffset(
  source: { x: number; y: number } | undefined,
  target: { x: number; y: number } | undefined,
): { offsetX: number; offsetY: number } {
  if (!source || !target) return { offsetX: 0, offsetY: -14 }
  const dx = target.x - source.x
  const dy = target.y - source.y
  if (Math.abs(dy) <= Math.abs(dx) * 0.55) {
    return { offsetX: 0, offsetY: -15 }
  }
  if (dy < 0) return { offsetX: 68, offsetY: 18 }
  return dx < 0
    ? { offsetX: 76, offsetY: -18 }
    : { offsetX: -76, offsetY: -18 }
}

function toFlowEdges(preset: MissionPreset, selectedEdgeId: string | null): Edge[] {
  const graph = enableGraphMode(preset).graph!
  const executable = graph.edges.map((edge) => {
    const handles = missionVisualEdgeHandles(graph, edge)
    const stroke = edgeStroke(edge.condition)
    const source = graph.nodes.find((node) => node.id === edge.source)?.position
    const target = graph.nodes.find((node) => node.id === edge.target)?.position
    const offset = edgeLabelOffset(source, target)
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: handles.sourceHandle,
      targetHandle: handles.targetHandle,
      type: "missionEdge",
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
      style: { stroke, strokeWidth: edge.id === selectedEdgeId ? 2.4 : 1.5 },
      data: {
        label: edge.label?.trim() || (edge.condition === "success"
          ? "Concluiu"
          : edge.condition === "failure"
            ? "Falhou"
            : "Sempre"),
        limit: edge.maxTraversals,
        ...offset,
        showLabel:
          edge.condition !== "success" ||
          Boolean(source && target && Math.abs(target.y - source.y) > 80),
        tone: edge.condition === "failure"
          ? "failure"
          : edge.condition === "always"
            ? "always"
            : "neutral",
      } satisfies MissionEdgeData,
    }
  })
  const terminals: Edge[] = missionVisualTerminals(graph).map((terminal) => ({
    id: `mission-terminal-edge:${terminal.sourceNodeId}`,
    source: terminal.sourceNodeId,
    target: terminal.id,
    sourceHandle: "source-right",
    targetHandle: "target-left",
    type: "missionEdge",
    selectable: false,
    focusable: false,
    markerEnd: { type: MarkerType.ArrowClosed, color: "var(--muted-foreground)" },
    style: { stroke: "var(--muted-foreground)", strokeWidth: 1.5 },
    data: {
      label: "aprovado",
      offsetX: 0,
      offsetY: -15,
      showLabel: false,
      tone: "neutral",
    } satisfies MissionEdgeData,
  }))
  return [...executable, ...terminals]
}

/** Projeção do grafo executável. A configuração dos agents continua nas fases. */
export function MissionPlanCanvas({
  preset,
  onChange,
  selectedPhaseId: controlledSelectedPhaseId,
  selectedEdgeId: controlledSelectedEdgeId,
  onSelectPhase,
  onSelectEdge,
  interactive = true,
  className,
}: {
  preset: MissionPreset
  onChange: (next: MissionPreset) => void
  selectedPhaseId?: string | null
  selectedEdgeId?: string | null
  onSelectPhase?: (phaseId: string | null) => void
  onSelectEdge?: (edgeId: string | null) => void
  interactive?: boolean
  className?: string
}) {
  const theme = useApp((state) => state.theme)
  const [internalPhaseId, setInternalPhaseId] = useState<string | null>(
    preset.phases[0]?.id ?? null,
  )
  const [internalEdgeId, setInternalEdgeId] = useState<string | null>(null)
  const selectedPhaseId = controlledSelectedPhaseId === undefined ? internalPhaseId : controlledSelectedPhaseId
  const selectedEdgeId = controlledSelectedEdgeId === undefined ? internalEdgeId : controlledSelectedEdgeId
  const graphSignature = JSON.stringify(enableGraphMode(preset).graph)
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(
    toFlowNodes(preset, selectedPhaseId),
  )
  const edges = useMemo(
    () => toFlowEdges(preset, selectedEdgeId),
    [preset, selectedEdgeId],
  )

  useEffect(() => {
    setNodes(toFlowNodes(preset, selectedPhaseId))
  }, [graphSignature, preset, selectedPhaseId, setNodes])

  useEffect(() => {
    if (!selectedPhaseId || preset.phases.some((phase) => phase.id === selectedPhaseId)) return
    const fallback = preset.phases[0]?.id ?? null
    setInternalPhaseId(fallback)
    onSelectPhase?.(fallback)
  }, [onSelectPhase, preset.phases, selectedPhaseId])

  function selectPhase(phaseId: string | null) {
    setInternalPhaseId(phaseId)
    onSelectPhase?.(phaseId)
  }

  function selectEdge(edgeId: string | null) {
    setInternalEdgeId(edgeId)
    onSelectEdge?.(edgeId)
  }

  const connect = useCallback(
    (connection: Connection) => {
      if (!interactive || !connection.source || !connection.target) return
      if (connection.source === connection.target) return
      const withGraph = enableGraphMode(preset)
      const id = `edge-${connection.source}-${connection.target}-${crypto.randomUUID().slice(0, 6)}`
      onChange({
        ...withGraph,
        graph: {
          ...withGraph.graph!,
          edges: [
            ...withGraph.graph!.edges,
            { id, source: connection.source, target: connection.target, condition: "success" },
          ],
        },
      })
      setInternalPhaseId(null)
      onSelectPhase?.(null)
      setInternalEdgeId(id)
      onSelectEdge?.(id)
    },
    [interactive, onChange, onSelectEdge, onSelectPhase, preset],
  )

  return (
    <div className={cn("min-h-0 overflow-hidden bg-background", className)}>
      <ReactFlow<CanvasNode>
        className="h-full w-full"
        colorMode={theme}
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => {
          if (node.data.kind !== "phase") return
          selectEdge(null)
          selectPhase(node.data.phaseId)
        }}
        onPaneClick={() => {
          selectPhase(null)
          selectEdge(null)
        }}
        onEdgeClick={(_, edge) => {
          selectPhase(null)
          selectEdge(edge.id)
        }}
        onConnect={connect}
        onNodeDragStop={(_, node) => {
          if (!interactive || node.data.kind !== "phase") return
          onChange(updateMissionNodePositions(preset, {
            [node.data.phaseId]: node.position,
          }))
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
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--border-strong)" />
        <Controls
          position="bottom-right"
          showInteractive={false}
          className="!overflow-hidden !rounded-md !border !border-border !bg-card !shadow-sm [&_button]:!border-border/40 [&_button]:!bg-card [&_button]:!fill-foreground"
        />
      </ReactFlow>
    </div>
  )
}
