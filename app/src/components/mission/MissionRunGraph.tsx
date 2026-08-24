import { useId, useMemo, useState } from "react"
import {
  Background,
  BackgroundVariant,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { Check, ChevronDown, CircleDashed, Route, X } from "lucide-react"
import type {
  MissionPhaseRun,
  MissionPlanEdge,
  MissionPlanGraph,
  MissionPreset,
  MissionRun,
  MissionTransition,
} from "@/lib/missionTypes"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app"

type RunNodeState = "current" | "done" | "failed" | "unvisited"

interface RunNodeData extends Record<string, unknown> {
  order: number
  label: string
  persona: string
  state: RunNodeState
  visits: number
}

type RunNode = Node<RunNodeData, "missionRun">

const PERSONA_LABEL = {
  planner: "PLANEJADOR",
  executor: "EXECUTOR",
  reviewer: "REVISOR",
} as const

const STATE_LABEL: Record<RunNodeState, string> = {
  current: "Em execução",
  done: "Concluído",
  failed: "Falhou",
  unvisited: "Não visitado",
}

function StateGlyph({ state }: { state: RunNodeState }) {
  if (state === "current") {
    return (
      <span
        className="animate-cockpit-pulse size-1.5 shrink-0 rounded-full bg-foreground/55 motion-reduce:animate-none"
        aria-hidden="true"
      />
    )
  }
  if (state === "done") {
    return <Check className="size-3 shrink-0" aria-hidden="true" />
  }
  if (state === "failed") {
    return <X className="size-3 shrink-0 text-st-error" aria-hidden="true" />
  }
  return <CircleDashed className="size-3 shrink-0" aria-hidden="true" />
}

function MissionRunNode({ data }: NodeProps<RunNode>) {
  return (
    <div
      className={cn(
        "w-44 rounded-lg border bg-card shadow-sm",
        data.state === "current" &&
          "border-border-strong shadow-[0_0_0_3px_var(--sel)]",
        data.state === "done" && "border-border-strong",
        data.state === "failed" && "border-st-error/50",
        data.state === "unvisited" && "border-border/70 opacity-60",
      )}
      aria-label={`${data.label}: ${STATE_LABEL[data.state]}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!size-px !border-0 !bg-transparent !opacity-0"
      />
      <div className="flex items-center justify-between border-b border-border/60 px-2.5 py-1.5">
        <span className="font-mono text-[11px] tracking-[0.12em] text-muted-foreground">
          TRECHO {String(data.order + 1).padStart(2, "0")}
        </span>
        <span className="text-[11px] tracking-wide text-muted-foreground">
          {data.persona}
        </span>
      </div>
      <div className="px-2.5 py-2">
        <div className="truncate text-[13px] font-medium text-foreground">
          {data.label}
        </div>
        <div
          className={cn(
            "mt-1.5 flex items-center gap-1.5 text-[11px] text-muted-foreground",
            data.state === "failed" && "text-st-error",
          )}
        >
          <StateGlyph state={data.state} />
          <span>{STATE_LABEL[data.state]}</span>
          {data.visits > 1 && (
            <span className="ml-auto font-mono">{data.visits} visitas</span>
          )}
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!size-px !border-0 !bg-transparent !opacity-0"
      />
    </div>
  )
}

const NODE_TYPES = { missionRun: MissionRunNode }

function nodeIdForVisit(
  visit: MissionPhaseRun,
  graph: MissionPlanGraph,
): string | null {
  if (visit.nodeId) return visit.nodeId
  return (
    graph.nodes.find((node) => node.phaseId === visit.def.id)?.id ?? null
  )
}

function failedVisit(visit: MissionPhaseRun): boolean {
  return (
    visit.status === "error" ||
    visit.status === "aborted" ||
    visit.outcome === "failure"
  )
}

function closedVisit(visit: MissionPhaseRun): boolean {
  return visit.status === "done" || failedVisit(visit)
}

function cyclicEdge(graph: MissionPlanGraph, edge: MissionPlanEdge): boolean {
  if (edge.source === edge.target) return true
  const neighbors = new Map<string, string[]>()
  for (const candidate of graph.edges) {
    const targets = neighbors.get(candidate.source) ?? []
    targets.push(candidate.target)
    neighbors.set(candidate.source, targets)
  }
  const pending = [edge.target]
  const seen = new Set<string>()
  while (pending.length > 0) {
    const nodeId = pending.pop()!
    if (nodeId === edge.source) return true
    if (seen.has(nodeId)) continue
    seen.add(nodeId)
    pending.push(...(neighbors.get(nodeId) ?? []))
  }
  return false
}

function edgeLabel(
  edge: MissionPlanEdge,
  graph: MissionPlanGraph,
  traversals: number,
): string | undefined {
  const condition =
    edge.condition === "failure"
      ? "Falhou"
      : edge.condition === "always"
        ? "Sempre"
        : undefined
  const base = edge.label?.trim() || condition
  if (!cyclicEdge(graph, edge)) return base
  const counter = `${traversals}/${edge.maxTraversals ?? "∞"}`
  return base ? `${base} · ${counter}` : `Retorno · ${counter}`
}

function buildRunMap(
  mission: MissionRun,
  snapshot: MissionPreset,
  graph: MissionPlanGraph,
  transitions: readonly MissionTransition[],
): { nodes: RunNode[]; edges: Edge[]; reached: number } {
  const visitsByNode = new Map<string, MissionPhaseRun[]>()
  for (const visit of mission.phases) {
    const nodeId = nodeIdForVisit(visit, graph)
    if (!nodeId) continue
    const visits = visitsByNode.get(nodeId) ?? []
    visits.push(visit)
    visitsByNode.set(nodeId, visits)
  }

  const currentVisit =
    mission.status === "running" &&
    mission.current >= 0 &&
    mission.current < mission.phases.length
      ? mission.phases[mission.current]
      : null
  const currentNodeId = currentVisit
    ? nodeIdForVisit(currentVisit, graph)
    : null
  let reached = 0

  const nodes: RunNode[] = graph.nodes.flatMap((node, graphIndex) => {
    const phase = snapshot.phases.find(
      (candidate) => candidate.id === node.phaseId,
    )
    if (!phase) return []
    const visits = visitsByNode.get(node.id) ?? []
    const lastClosed = [...visits].reverse().find(closedVisit)
    const currentHere = currentNodeId === node.id && currentVisit
    const state: RunNodeState = currentHere
      ? failedVisit(currentVisit)
        ? "failed"
        : "current"
      : lastClosed
        ? failedVisit(lastClosed)
          ? "failed"
          : "done"
        : "unvisited"
    if (state !== "unvisited") reached += 1
    const phaseIndex = snapshot.phases.findIndex(
      (candidate) => candidate.id === phase.id,
    )
    return [
      {
        id: node.id,
        type: "missionRun" as const,
        position: node.position,
        selectable: false,
        draggable: false,
        data: {
          order: phaseIndex >= 0 ? phaseIndex : graphIndex,
          label: phase.label || "Trecho sem nome",
          persona: PERSONA_LABEL[phase.persona],
          state,
          visits: visits.length,
        },
      },
    ]
  })

  const traversalCount = new Map<string, number>()
  for (const transition of transitions) {
    traversalCount.set(
      transition.edgeId,
      (traversalCount.get(transition.edgeId) ?? 0) + 1,
    )
  }
  const edges: Edge[] = graph.edges.map((edge) => {
    const traversals = traversalCount.get(edge.id) ?? 0
    const traversed = traversals > 0
    const stroke = traversed ? "var(--foreground)" : "var(--border-strong)"
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: "smoothstep",
      selectable: false,
      focusable: false,
      label: edgeLabel(edge, graph, traversals),
      markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
      style: {
        stroke,
        strokeWidth: traversed ? 1.7 : 1,
        strokeDasharray: traversed ? undefined : "4 5",
        opacity: traversed ? 0.72 : 0.5,
      },
      labelStyle: {
        fill: "var(--muted-foreground)",
        fontSize: 11,
      },
      labelBgStyle: { fill: "var(--card)", fillOpacity: 0.94 },
      labelBgPadding: [4, 2] as [number, number],
      labelBgBorderRadius: 4,
    }
  })
  return { nodes, edges, reached }
}

export function MissionRunGraph({
  mission,
  className,
}: {
  mission: MissionRun
  className?: string
}) {
  const [open, setOpen] = useState(true)
  const regionId = useId()
  const theme = useApp((state) => state.theme)
  const execution = mission.execution
  const graph = execution?.planSnapshot.graph
  const map = useMemo(
    () =>
      execution && graph
        ? buildRunMap(
            mission,
            execution.planSnapshot,
            graph,
            execution.transitions,
          )
        : null,
    [execution, graph, mission],
  )

  if (!execution || !graph || !map) return null

  const transitionCount = execution.transitions.length
  return (
    <section
      className={cn(
        "overflow-hidden rounded-lg border border-border/70 bg-background",
        className,
      )}
    >
      <button
        type="button"
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-secondary/25 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-controls={regionId}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-secondary/70 text-muted-foreground">
          <Route className="size-3.5" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="label-mono shrink-0 text-foreground">
              {mission.status === "running" ? "Rota em voo" : "Rota executada"}
            </span>
            <span className="truncate text-[12px] text-muted-foreground">
              {execution.planSnapshot.name}
            </span>
          </span>
          <span className="mt-1 block text-[11px] text-muted-foreground">
            {map.reached} de {graph.nodes.length} trechos percorridos ·{" "}
            {transitionCount} {transitionCount === 1 ? "transição" : "transições"}
          </span>
        </span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div id={regionId} className="border-t border-border/60">
          <div
            className="h-[250px] w-full bg-secondary/10"
            role="img"
            aria-label="Mapa somente leitura da rota executada pela missão"
          >
            <ReactFlow<RunNode>
              className="h-full w-full"
              colorMode={theme}
              nodes={map.nodes}
              edges={map.edges}
              nodeTypes={NODE_TYPES}
              nodesDraggable={false}
              nodesConnectable={false}
              nodesFocusable={false}
              edgesFocusable={false}
              elementsSelectable={false}
              panOnDrag
              zoomOnScroll={false}
              zoomOnPinch={false}
              zoomOnDoubleClick={false}
              deleteKeyCode={null}
              fitView
              fitViewOptions={{ padding: 0.25, maxZoom: 1.05 }}
              minZoom={0.3}
              maxZoom={1.25}
              proOptions={{ hideAttribution: true }}
            >
              <Background
                variant={BackgroundVariant.Dots}
                gap={20}
                size={1}
                color="var(--border)"
              />
            </ReactFlow>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="w-5 border-t-2 border-foreground/65" />
              caminho percorrido
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-5 border-t border-dashed border-border-strong" />
              caminho não percorrido
            </span>
            <span className="ml-auto font-mono">somente leitura</span>
          </div>
        </div>
      )}
    </section>
  )
}
