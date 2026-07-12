import { type ReactNode } from "react"
import { ChevronDown, Plus, RotateCcw, Trash2 } from "lucide-react"
import { RichSelect } from "@/components/ui/RichSelect"
import { Switch } from "@/components/ui/switch"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { useApp } from "@/store/app"
import { LEAGUE_DESTINATIONS, agentModels, agentEfforts } from "@/lib/agents"
import {
  type MissionPreset,
  type MissionPhaseDef,
  type MissionPersona,
  DEFAULT_MISSION_PRESETS,
} from "@/lib/missionTypes"
import { cn } from "@/lib/utils"

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

/** ID estável e único dentro de uma lista (evita colisão de key). */
function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

/** Editor de UMA fase (persona · agent · modelo · effort · retries). */
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
  return (
    <div className="rounded-md border border-border/50 bg-secondary/20 p-2.5">
      <div className="mb-2 flex items-center gap-2">
        <Input
          value={phase.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Rótulo da fase"
          className="h-7 flex-1 text-[13px]"
          aria-label="Rótulo da fase"
        />
        <button
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
          onValueChange={(v) => onChange({ persona: v as MissionPersona })}
          options={PERSONA_OPTIONS}
          triggerClassName={SELECT_TRIGGER}
          aria-label="Persona"
        />
        <RichSelect
          value={phase.agent}
          onValueChange={(v) =>
            // troca de agent → zera modelo/effort p/ o default do novo agent
            onChange({ agent: v, model: null, effort: null })
          }
          options={LEAGUE_DESTINATIONS.map((d) => ({
            value: d.id,
            label: d.label,
            description: d.description,
          }))}
          triggerClassName={SELECT_TRIGGER}
          aria-label="Agent da fase"
        />
        <RichSelect
          value={phase.model ?? "default"}
          onValueChange={(v) => onChange({ model: v === "default" ? null : v })}
          options={agentModels(phase.agent)}
          triggerClassName={SELECT_TRIGGER}
          aria-label="Modelo da fase"
        />
        {efforts.length > 0 ? (
          <RichSelect
            value={phase.effort ?? "default"}
            onValueChange={(v) => onChange({ effort: v === "default" ? null : v })}
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
          onChange={(e) =>
            onChange({ maxRetries: Math.max(1, Number(e.target.value) || 1) })
          }
          className="h-7 w-16 text-[13px]"
          aria-label="Tentativas máximas"
        />
      </div>
    </div>
  )
}

/** Editor de UM preset (nome, fases, teto de custo, ações). */
function PresetCard({
  preset,
  onChange,
  onRemove,
}: {
  preset: MissionPreset
  onChange: (next: MissionPreset) => void
  onRemove: () => void
}) {
  function patchPhase(idx: number, patch: Partial<MissionPhaseDef>) {
    onChange({
      ...preset,
      phases: preset.phases.map((p, i) =>
        i === idx ? { ...p, ...patch } : p,
      ),
    })
  }
  function removePhase(idx: number) {
    onChange({
      ...preset,
      phases: preset.phases.filter((_, i) => i !== idx),
    })
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
    onChange({ ...preset, phases: [...preset.phases, next] })
  }

  return (
    <div className="rounded-lg border border-border/60 p-3">
      <div className="mb-2 flex items-center gap-2">
        <Input
          value={preset.name}
          onChange={(e) => onChange({ ...preset, name: e.target.value })}
          placeholder="Nome do time"
          className="h-8 flex-1 text-[13px] font-medium"
          aria-label="Nome do preset"
        />
        <button
          onClick={onRemove}
          className="grid size-8 shrink-0 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-st-error"
          aria-label="Remover preset"
          title="Remover time"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      <div className="space-y-1.5">
        {preset.phases.map((phase, idx) => (
          <PhaseRow
            key={phase.id}
            phase={phase}
            onChange={(patch) => patchPhase(idx, patch)}
            onRemove={() => removePhase(idx)}
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
          Teto de custo US$ (vazio = sem teto)
        </span>
        <Input
          type="number"
          min={0}
          step="0.5"
          value={preset.maxCostUsd ?? ""}
          onChange={(e) => {
            const raw = e.target.value.trim()
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
  )
}

export function MissionSettings() {
  const settings = useApp((s) => s.settings)
  const setSettings = useApp((s) => s.setSettings)
  const presets = settings.missionPresets

  function patchPreset(idx: number, next: MissionPreset) {
    setSettings({
      missionPresets: presets.map((p, i) => (i === idx ? next : p)),
    })
  }
  function removePreset(idx: number) {
    setSettings({ missionPresets: presets.filter((_, i) => i !== idx) })
  }
  function addPreset() {
    const next: MissionPreset = {
      id: uid("preset"),
      name: "Novo time",
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
    setSettings({ missionPresets: [...presets, next] })
  }
  function restoreDefaults() {
    // clona os presets de fábrica (imutável — nunca referencia o array global)
    setSettings({
      missionPresets: DEFAULT_MISSION_PRESETS.map((p) => ({
        ...p,
        phases: p.phases.map((ph) => ({ ...ph })),
      })),
    })
  }

  return (
    <div>
      <SectionTitle>Missions (beta)</SectionTitle>
      <div className="divide-y divide-border/50">
        <div className="flex items-center justify-between gap-4 py-2.5">
          <div className="min-w-0">
            <div className="text-[13px] text-foreground">Ativar Missions (beta)</div>
            <div className="text-[11.5px] leading-snug text-muted-foreground">
              Um time sequencial de agents no Linear: cada fase (planner →
              executor → reviewer) roda um agent, passando o diff do worktree
              adiante. Mostra o botão de missão no composer.
            </div>
          </div>
          <div className="shrink-0">
            <Switch
              checked={settings.missionEnabled}
              onCheckedChange={(v) => setSettings({ missionEnabled: v })}
              aria-label="Ativar Missions"
            />
          </div>
        </div>
      </div>

      <div className={cn("mt-4", !settings.missionEnabled && "opacity-60")}>
        <div className="mb-2 flex items-center justify-between">
          <SectionTitle>Times (presets)</SectionTitle>
          <Button
            size="sm"
            variant="ghost"
            onClick={restoreDefaults}
            className="h-7 gap-1.5 text-[12px] text-muted-foreground"
          >
            <RotateCcw className="size-3.5" />
            Restaurar padrão
          </Button>
        </div>

        <div className="space-y-3">
          {presets.map((preset, idx) => (
            <PresetCard
              key={preset.id}
              preset={preset}
              onChange={(next) => patchPreset(idx, next)}
              onRemove={() => removePreset(idx)}
            />
          ))}
          {presets.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border/60 py-6 text-center">
              <ChevronDown className="size-4 text-muted-foreground/50" />
              <span className="text-[12px] text-muted-foreground">
                Nenhum time. Adicione um ou restaure os padrões.
              </span>
            </div>
          )}
        </div>

        <Button
          size="sm"
          variant="secondary"
          onClick={addPreset}
          className="mt-3 h-8 w-full gap-1.5 text-[13px]"
        >
          <Plus className="size-4" />
          Adicionar time
        </Button>
      </div>
    </div>
  )
}
