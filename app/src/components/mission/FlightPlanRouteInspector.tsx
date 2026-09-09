import { GitBranch, Trash2, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type {
  MissionPlanEdge,
  MissionPlanEdgeCondition,
  MissionPreset,
} from "@/lib/missionTypes"
import { enableGraphMode } from "@/lib/missionPlans"
import { cn } from "@/lib/utils"
import { SELECTED_FILL, UNSELECTED } from "@/lib/selection"

const CONDITION_LABEL: Record<MissionPlanEdgeCondition, string> = {
  success: "Concluiu",
  failure: "Falhou",
  always: "Sempre",
}

function edgeName(plan: MissionPreset, edge: MissionPlanEdge): string {
  const graph = enableGraphMode(plan).graph!
  const phaseById = new Map(plan.phases.map((phase) => [phase.id, phase]))
  const source = graph.nodes.find((node) => node.id === edge.source)
  const target = graph.nodes.find((node) => node.id === edge.target)
  const sourceName = source ? phaseById.get(source.phaseId)?.label : null
  const targetName = target ? phaseById.get(target.phaseId)?.label : null
  return `${sourceName || "Origem"} → ${targetName || "Destino"}`
}

export function FlightPlanRouteInspector({
  plan,
  mode,
  selectedEdgeId,
  onSelectEdge,
  onChange,
}: {
  plan: MissionPreset
  mode: "linear" | "graph"
  selectedEdgeId: string | null
  onSelectEdge: (edgeId: string | null) => void
  onChange: (next: MissionPreset) => void
}) {
  const graph = enableGraphMode(plan).graph!
  const selectedEdge = graph.edges.find((edge) => edge.id === selectedEdgeId) ?? null

  function patchSelected(patch: Partial<MissionPlanEdge>) {
    if (!selectedEdge) return
    onChange({
      ...plan,
      graph: {
        ...graph,
        edges: graph.edges.map((edge) =>
          edge.id === selectedEdge.id ? { ...edge, ...patch } : edge,
        ),
      },
    })
  }

  function removeSelected() {
    if (!selectedEdge) return
    onChange({
      ...plan,
      graph: {
        ...graph,
        edges: graph.edges.filter((edge) => edge.id !== selectedEdge.id),
      },
    })
    onSelectEdge(null)
  }

  if (mode === "linear") {
    return (
      <div className="p-4">
        <div className="flex items-start gap-3 rounded-lg bg-secondary/35 p-3">
          <GitBranch className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-[12px] font-medium text-foreground">Rota em sequência</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Nesta visão, cada fase concluída segue para a próxima. Abra o Fluxo visual para criar falhas, retornos e caminhos alternativos.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (!selectedEdge) {
    return (
      <div className="p-3">
        <div className="mb-3">
          <h2 className="label-mono text-foreground">Conexões</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Selecione uma linha no mapa ou na lista para configurar o resultado.
          </p>
        </div>
        {graph.edges.length > 0 ? (
          <div className="space-y-1.5">
            {graph.edges.map((edge) => (
              <Button
                key={edge.id}
                variant="ghost"
                size="padrao"
                className="w-full justify-between border border-border/40 px-2.5"
                onClick={() => onSelectEdge(edge.id)}
              >
                <span className="min-w-0 truncate">{edgeName(plan, edge)}</span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {CONDITION_LABEL[edge.condition]}
                </span>
              </Button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border bg-secondary/20 p-3 text-[11px] leading-relaxed text-muted-foreground">
            O mapa ainda não tem conexões. Arraste de uma porta de saída para a entrada de outra fase.
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="divide-y divide-border/40">
      <section className="space-y-3 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="font-mono text-[11px] tracking-wide text-brass uppercase">
              Conexão
            </span>
            <h2 className="mt-1 truncate text-[12px] font-medium text-foreground">
              {edgeName(plan, selectedEdge)}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icone-compacto"
            onClick={removeSelected}
            className="hover:text-st-error"
            aria-label="Remover conexão"
            title="Remover conexão"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>

        <div>
          <div className="mb-1 text-[11px] text-muted-foreground">Quando seguir</div>
          <div className="grid grid-cols-3 gap-1">
            {(["success", "failure", "always"] as const).map((condition) => (
              <Button
                key={condition}
                variant="ghost"
                size="compacto"
                onClick={() => patchSelected({ condition })}
                className={cn(
                  "border",
                  selectedEdge.condition === condition ? SELECTED_FILL : UNSELECTED,
                )}
              >
                {CONDITION_LABEL[condition]}
              </Button>
            ))}
          </div>
        </div>

        <label className="grid gap-1 text-[11px] text-muted-foreground">
          Rótulo opcional
          <Input
            value={selectedEdge.label ?? ""}
            onChange={(event) => patchSelected({ label: event.target.value || undefined })}
            placeholder="Ex.: precisa corrigir"
            className="h-8 text-[12px]"
          />
        </label>
      </section>

      <section className="space-y-3 p-3">
        <div className="flex items-start gap-2">
          <Undo2 className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div>
            <h2 className="text-[12px] font-medium text-foreground">Limite de travessias</h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Todo retorno que forma um ciclo precisa de um limite. Deixe vazio nas conexões que só avançam.
            </p>
          </div>
        </div>
        <Input
          type="number"
          min={1}
          value={selectedEdge.maxTraversals ?? ""}
          onChange={(event) => {
            const value = event.target.value
            patchSelected({
              maxTraversals: value ? Math.max(1, Number(value) || 1) : undefined,
            })
          }}
          placeholder="Sem limite"
          className="h-8 text-[12px]"
          aria-label="Limite de travessias da conexão"
        />
      </section>
    </div>
  )
}
