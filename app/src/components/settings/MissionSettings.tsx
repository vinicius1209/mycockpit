import {
  type ChangeEvent,
  type ReactNode,
  Suspense,
  lazy,
  useRef,
  useState,
} from "react"
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  ListTree,
  Plus,
  RotateCcw,
  Route,
  Trash2,
  Upload,
} from "lucide-react"
import { toast } from "sonner"
import { RichSelect } from "@/components/ui/RichSelect"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { useApp } from "@/store/app"
import { LEAGUE_DESTINATIONS, agentModels, agentEfforts } from "@/lib/agents"
import { GATE_POLICY_OPTIONS, normalizeGatePolicy } from "@/lib/missionDraft"
import {
  enableGraphMode,
  missionPlanMode,
  parseMissionPlan,
  serializeMissionPlan,
  syncMissionPlan,
} from "@/lib/missionPlans"
import {
  type MissionGatePolicy,
  type MissionPreset,
  type MissionPhaseDef,
  type MissionPersona,
  DEFAULT_MISSION_PRESETS,
} from "@/lib/missionTypes"
import { cn } from "@/lib/utils"

const MissionPlanCanvas = lazy(() =>
  import("@/components/mission/MissionPlanCanvas").then((module) => ({
    default: module.MissionPlanCanvas,
  })),
)

const SELECT_TRIGGER =
  "h-8 gap-1.5 rounded-md border bg-secondary/40 px-2.5 text-[13px] text-foreground data-[size=default]:h-8"

const PERSONA_OPTIONS = [
  { value: "planner", label: "Planner", description: "Planeja a tarefa" },
  { value: "executor", label: "Executor", description: "Escreve o código" },
  { value: "reviewer", label: "Reviewer", description: "Revisa o diff" },
]

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
      {children}
    </h3>
  )
}

function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

function criteriaText(criteria: string[] | undefined): string {
  return (criteria ?? []).join("\n")
}

/** Editor de UM nó/fase. Critérios ficam recolhidos para preservar a densidade
 *  do instrumento e são injetados de verdade no prompt do agent. */
function PhaseRow({
  phase,
  onChange,
  onRemove,
  canRemove,
}: {
  phase: MissionPhaseDef
  onChange: (patch: Partial<MissionPhaseDef>) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const efforts = agentEfforts(phase.agent)
  const criteriaCount =
    (phase.entryCriteria?.filter((c) => c.trim()).length ?? 0) +
    (phase.exitCriteria?.filter((c) => c.trim()).length ?? 0)
  return (
    <div className="rounded-md border border-border/50 bg-secondary/20 p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <Input
          value={phase.label}
          onChange={(event) => onChange({ label: event.target.value })}
          placeholder="Rótulo da fase"
          className="h-7 flex-1 text-[13px]"
          aria-label="Rótulo da fase"
        />
        <button
          type="button"
          onClick={onRemove}
          disabled={!canRemove}
          className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-st-error disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
          aria-label="Remover fase"
          title={canRemove ? "Remover fase" : "A missão precisa de ao menos 1 fase"}
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <RichSelect
          value={phase.persona}
          onValueChange={(value) => onChange({ persona: value as MissionPersona })}
          options={PERSONA_OPTIONS}
          triggerClassName={SELECT_TRIGGER}
          aria-label="Persona"
        />
        <RichSelect
          value={phase.agent}
          onValueChange={(value) =>
            onChange({ agent: value, model: null, effort: null })
          }
          options={LEAGUE_DESTINATIONS.map((destination) => ({
            value: destination.id,
            label: destination.label,
            description: destination.description,
          }))}
          triggerClassName={SELECT_TRIGGER}
          aria-label="Agent da fase"
        />
        <RichSelect
          value={phase.model ?? "default"}
          onValueChange={(value) =>
            onChange({ model: value === "default" ? null : value })
          }
          options={agentModels(phase.agent)}
          triggerClassName={SELECT_TRIGGER}
          aria-label="Modelo da fase"
        />
        {efforts.length > 0 ? (
          <RichSelect
            value={phase.effort ?? "default"}
            onValueChange={(value) =>
              onChange({ effort: value === "default" ? null : value })
            }
            options={efforts}
            triggerClassName={SELECT_TRIGGER}
            aria-label="Effort da fase"
          />
        ) : (
          <div />
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11.5px] text-muted-foreground">
          Tentativas (1 = sem retry)
        </span>
        <Input
          type="number"
          min={1}
          value={phase.maxRetries}
          onChange={(event) =>
            onChange({ maxRetries: Math.max(1, Number(event.target.value) || 1) })
          }
          className="h-7 w-16 text-[13px]"
          aria-label="Tentativas máximas"
        />
      </div>

      <details className="group mt-2 border-t border-border/50 pt-2">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[10.5px] text-muted-foreground hover:text-foreground">
          <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
          Critérios e instruções
          {criteriaCount > 0 && (
            <span className="rounded bg-brass/10 px-1.5 py-px font-mono text-[9px] text-brass">
              {criteriaCount}
            </span>
          )}
        </summary>
        <div className="mt-2 grid gap-2">
          <label className="grid gap-1 text-[10.5px] text-muted-foreground">
            Critérios de entrada · um por linha
            <Textarea
              value={criteriaText(phase.entryCriteria)}
              onChange={(event) =>
                onChange({ entryCriteria: event.target.value.split("\n") })
              }
              placeholder="Ex.: plano aprovado"
              className="min-h-16 resize-y text-[11.5px]"
            />
          </label>
          <label className="grid gap-1 text-[10.5px] text-muted-foreground">
            Critérios de saída · um por linha
            <Textarea
              value={criteriaText(phase.exitCriteria)}
              onChange={(event) =>
                onChange({ exitCriteria: event.target.value.split("\n") })
              }
              placeholder="Ex.: testes passam"
              className="min-h-16 resize-y text-[11.5px]"
            />
          </label>
          <label className="grid gap-1 text-[10.5px] text-muted-foreground">
            Instrução específica
            <Textarea
              value={phase.instructions ?? ""}
              onChange={(event) => onChange({ instructions: event.target.value })}
              placeholder="Contexto adicional para este agent"
              className="min-h-16 resize-y text-[11.5px]"
            />
          </label>
        </div>
      </details>
    </div>
  )
}

function downloadPlan(preset: MissionPreset) {
  const raw = serializeMissionPlan(preset)
  const blob = new Blob([raw], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = `${preset.name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "plano-de-voo"}.mycockpit-plan.json`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
  toast(`Plano “${preset.name}” exportado.`)
}

function PresetCard({
  preset,
  onChange,
  onDuplicate,
  onRemove,
}: {
  preset: MissionPreset
  onChange: (next: MissionPreset) => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const mode = missionPlanMode(preset)

  function patchPhase(index: number, patch: Partial<MissionPhaseDef>) {
    onChange({
      ...preset,
      phases: preset.phases.map((phase, phaseIndex) =>
        phaseIndex === index ? { ...phase, ...patch } : phase,
      ),
    })
  }
  function removePhase(index: number) {
    onChange(
      syncMissionPlan({
        ...preset,
        phases: preset.phases.filter((_, phaseIndex) => phaseIndex !== index),
      }),
    )
  }
  function addPhase() {
    const next: MissionPhaseDef = {
      id: uid("phase"),
      label: "Nova fase",
      persona: "executor",
      agent: "claude-code",
      model: null,
      effort: null,
      maxRetries: 1,
    }
    onChange(syncMissionPlan({ ...preset, phases: [...preset.phases, next] }))
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/60 bg-card/20">
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={expanded ? "Recolher plano" : "Editar plano"}
        >
          <ChevronRight
            className={cn("size-3.5 transition-transform", expanded && "rotate-90")}
          />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-foreground">
              {preset.name || "Plano sem nome"}
            </span>
            <span
              className={cn(
                "shrink-0 rounded border px-1.5 py-px font-mono text-[9px] tracking-wide uppercase",
                mode === "graph"
                  ? "border-brass/35 bg-brass/10 text-brass"
                  : "border-border/70 text-muted-foreground",
              )}
            >
              {mode === "graph" ? "canvas" : "linear"}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
            {preset.phases.length} fases · {preset.phases.map((phase) => phase.agent).join(" → ")}
          </div>
        </div>
        <button
          type="button"
          onClick={() => downloadPlan(preset)}
          className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-brass"
          aria-label="Exportar Plano de voo"
          title="Exportar JSON"
        >
          <Download className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Duplicar Plano de voo"
          title="Duplicar plano"
        >
          <Copy className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="grid size-7 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-st-error"
          aria-label="Remover Plano de voo"
          title="Remover plano"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border/60 px-3 py-3">
          <div className="grid gap-2">
            <Input
              value={preset.name}
              onChange={(event) => onChange({ ...preset, name: event.target.value })}
              placeholder="Nome do Plano de voo"
              className="h-8 text-[13px] font-medium"
              aria-label="Nome do Plano de voo"
            />
            <Input
              value={preset.description ?? ""}
              onChange={(event) =>
                onChange({ ...preset, description: event.target.value })
              }
              placeholder="Quando usar este plano?"
              className="h-8 text-[12px]"
              aria-label="Descrição do Plano de voo"
            />
          </div>

          <div className="my-3 flex items-center justify-between border-y border-border/50 py-2">
            <div>
              <div className="text-[11.5px] text-foreground">Forma de autoria</div>
              <div className="text-[10px] text-muted-foreground">
                Os dois formatos executam pelo mesmo motor de Mission.
              </div>
            </div>
            <div className="flex rounded-md border border-border/70 bg-secondary/30 p-0.5">
              <button
                type="button"
                onClick={() => onChange({ ...preset, mode: "linear" })}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded px-2.5 text-[11px] transition-colors",
                  mode === "linear"
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <ListTree className="size-3.5" />
                Linear
              </button>
              <button
                type="button"
                onClick={() => onChange(enableGraphMode(preset))}
                className={cn(
                  "flex h-7 items-center gap-1.5 rounded px-2.5 text-[11px] transition-colors",
                  mode === "graph"
                    ? "bg-card text-brass shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Route className="size-3.5" />
                Canvas
              </button>
            </div>
          </div>

          {mode === "graph" && (
            <div className="mb-3">
              <Suspense
                fallback={
                  <div className="grid h-64 place-items-center rounded-lg border border-border/70 bg-secondary/20 text-[11px] text-muted-foreground">
                    Preparando o canvas…
                  </div>
                }
              >
                <MissionPlanCanvas preset={preset} onChange={onChange} />
              </Suspense>
            </div>
          )}

          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[9.5px] tracking-wide text-muted-foreground uppercase">
              {mode === "graph" ? "Configuração dos nós" : "Rota de execução"}
            </span>
            <span className="text-[9.5px] text-muted-foreground">
              ordem de cima para baixo
            </span>
          </div>
          <div className="space-y-1.5">
            {preset.phases.map((phase, index) => (
              <PhaseRow
                key={phase.id}
                phase={phase}
                onChange={(patch) => patchPhase(index, patch)}
                onRemove={() => removePhase(index)}
                canRemove={preset.phases.length > 1}
              />
            ))}
          </div>

          <Button
            size="sm"
            variant="ghost"
            onClick={addPhase}
            className="mt-1.5 h-7 gap-1.5 text-[12px] text-muted-foreground"
          >
            <Plus className="size-3.5" />
            Adicionar fase
          </Button>

          <div className="mt-2 flex items-center justify-between gap-2 border-t border-border/50 pt-2.5">
            <span className="text-[11.5px] text-muted-foreground">
              Gate humano
            </span>
            <RichSelect
              value={normalizeGatePolicy(preset.gatePolicy)}
              onValueChange={(value) =>
                onChange({ ...preset, gatePolicy: value as MissionGatePolicy })
              }
              options={GATE_POLICY_OPTIONS}
              triggerClassName={SELECT_TRIGGER}
              aria-label="Política de gate humano do plano"
            />
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="text-[11.5px] text-muted-foreground">
              Teto de custo US$ (vazio = sem teto)
            </span>
            <Input
              type="number"
              min={0}
              step="0.5"
              value={preset.maxCostUsd ?? ""}
              onChange={(event) => {
                const raw = event.target.value.trim()
                onChange({
                  ...preset,
                  maxCostUsd: raw === "" ? null : Math.max(0, Number(raw) || 0),
                })
              }}
              placeholder="sem teto"
              className="h-7 w-24 text-[13px]"
              aria-label="Teto de custo em dólares"
            />
          </div>
        </div>
      )}
    </div>
  )
}

function newLinearPlan(): MissionPreset {
  return {
    id: uid("plan"),
    name: "Novo plano linear",
    description: "Uma rota direta para uma tarefa bem definida.",
    mode: "linear",
    maxCostUsd: null,
    phases: [
      {
        id: uid("phase"),
        label: "Executar",
        persona: "executor",
        agent: "claude-code",
        model: null,
        effort: null,
        maxRetries: 1,
      },
    ],
  }
}

function newCanvasPlan(): MissionPreset {
  return enableGraphMode({
    id: uid("plan"),
    name: "Novo plano no canvas",
    description: "Planejar, executar e revisar numa rota visual.",
    maxCostUsd: null,
    phases: [
      {
        id: uid("plan"),
        label: "Planejar",
        persona: "planner",
        agent: "claude-code",
        model: null,
        effort: null,
        maxRetries: 1,
      },
      {
        id: uid("build"),
        label: "Executar",
        persona: "executor",
        agent: "codex",
        model: null,
        effort: null,
        maxRetries: 2,
      },
      {
        id: uid("review"),
        label: "Revisar",
        persona: "reviewer",
        agent: "claude-code",
        model: null,
        effort: null,
        maxRetries: 1,
      },
    ],
  })
}

export function MissionSettings() {
  const settings = useApp((state) => state.settings)
  const setSettings = useApp((state) => state.setSettings)
  const importInput = useRef<HTMLInputElement>(null)
  const presets = settings.missionPresets

  function patchPreset(index: number, next: MissionPreset) {
    setSettings({
      missionPresets: presets.map((preset, presetIndex) =>
        presetIndex === index ? next : preset,
      ),
    })
  }
  function removePreset(index: number) {
    setSettings({ missionPresets: presets.filter((_, i) => i !== index) })
  }
  function duplicatePreset(index: number) {
    const source = presets[index]
    const duplicate: MissionPreset = {
      ...source,
      id: uid("plan"),
      name: `${source.name} · cópia`,
      phases: source.phases.map((phase) => ({
        ...phase,
        entryCriteria: phase.entryCriteria ? [...phase.entryCriteria] : undefined,
        exitCriteria: phase.exitCriteria ? [...phase.exitCriteria] : undefined,
      })),
      graph: source.graph
        ? {
            ...source.graph,
            nodes: source.graph.nodes.map((node) => ({
              ...node,
              position: { ...node.position },
            })),
            edges: source.graph.edges.map((edge) => ({ ...edge })),
          }
        : undefined,
    }
    setSettings({ missionPresets: [...presets, duplicate] })
    toast(`Plano “${source.name}” duplicado.`)
  }
  function restoreDefaults() {
    setSettings({
      missionPresets: DEFAULT_MISSION_PRESETS.map((preset) => ({
        ...preset,
        phases: preset.phases.map((phase) => ({ ...phase })),
      })),
    })
  }
  async function importPlan(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ""
    if (!file) return
    const result = parseMissionPlan(await file.text())
    if (!result.ok) {
      toast(result.error)
      return
    }
    const collision = presets.some((preset) => preset.id === result.plan.id)
    const plan = collision
      ? { ...result.plan, id: uid("plan"), name: `${result.plan.name} · importado` }
      : result.plan
    setSettings({ missionPresets: [...presets, plan] })
    toast(`Plano “${plan.name}” importado.`)
  }

  return (
    <div>
      <SectionTitle>Missions (beta)</SectionTitle>
      <div className="divide-y divide-border/50">
        <div className="flex items-center justify-between gap-4 py-2.5">
          <div className="min-w-0">
            <div className="text-[13px] text-foreground">Ativar Missions</div>
            <div className="text-[11.5px] leading-snug text-muted-foreground">
              Uma missão executa um Plano de voo. Os planos lineares preservam o
              fluxo atual; o canvas oferece a mesma rota como nós visuais.
            </div>
          </div>
          <div className="shrink-0">
            <Switch
              checked={settings.missionEnabled}
              onCheckedChange={(value) => setSettings({ missionEnabled: value })}
              aria-label="Ativar Missions"
            />
          </div>
        </div>
      </div>

      <div className={cn("mt-4", !settings.missionEnabled && "opacity-60")}>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <SectionTitle>Biblioteca de Planos de voo</SectionTitle>
            <p className="text-[10.5px] leading-snug text-muted-foreground">
              Reutilizáveis, exportáveis e independentes do projeto.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <input
              ref={importInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(event) => void importPlan(event)}
            />
            <Button
              size="sm"
              variant="ghost"
              onClick={() => importInput.current?.click()}
              className="h-7 gap-1.5 text-[11.5px] text-muted-foreground"
            >
              <Upload className="size-3.5" />
              Importar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={restoreDefaults}
              className="h-7 gap-1.5 text-[11.5px] text-muted-foreground"
            >
              <RotateCcw className="size-3.5" />
              Restaurar
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          {presets.map((preset, index) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              onChange={(next) => patchPreset(index, next)}
              onDuplicate={() => duplicatePreset(index)}
              onRemove={() => removePreset(index)}
            />
          ))}
          {presets.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 py-6 text-center">
              <ChevronDown className="size-4 text-muted-foreground/50" />
              <span className="text-[12px] text-muted-foreground">
                Nenhum Plano de voo. Crie uma rota ou restaure os padrões.
              </span>
            </div>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setSettings({ missionPresets: [...presets, newLinearPlan()] })}
            className="h-8 gap-1.5 text-[12px]"
          >
            <ListTree className="size-3.5" />
            Novo linear
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setSettings({ missionPresets: [...presets, newCanvasPlan()] })}
            className="h-8 gap-1.5 text-[12px]"
          >
            <Route className="size-3.5 text-brass" />
            Novo no canvas
          </Button>
        </div>
      </div>
    </div>
  )
}
