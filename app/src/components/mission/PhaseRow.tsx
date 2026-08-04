// Linha COMUM do rascunho de fase (MH3.2): nº + rótulo + pílulas de
// autonomia/agent/modelo/effort. Extraída do MissionLauncher e consumida
// também pelo MissionDock (Escritório) — o formulário duplicado não se
// reescreve, mas a LINHA é uma só: effort existe nas duas superfícies por
// construção. Regras de edição continuam puras em lib/missionDraft
// (editPhase: trocar agent zera modelo/effort).
import { Zap } from "lucide-react"
import { RichSelect, type RichOption } from "@/components/ui/RichSelect"
import type { MissionPhaseDef } from "@/lib/missionTypes"
import type { PhaseEdit } from "@/lib/missionDraft"
import { LEAGUE_DESTINATIONS, agentEfforts, agentModels } from "@/lib/agents"
import { cn } from "@/lib/utils"

const SELECT_TRIGGER =
  "h-7 gap-1 px-2 text-[12px] text-muted-foreground data-[size=default]:h-7"

/** Pílula de autonomia POR MEMBRO: "auto" (roda sem pedir, com o freio do CLI)
 *  vs "herda" (permissão do projeto). Um clique alterna — é o override por
 *  membro que o toggle de missão seta em bloco. */
export function AutonomyPill({
  autonomy,
  label,
  onToggle,
}: {
  autonomy: "auto" | "inherit"
  label: string
  onToggle: () => void
}) {
  const on = autonomy === "auto"
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={on}
      title={
        on
          ? "Auto: roda sem pedir permissão (com o freio de segurança do CLI). Clique para herdar do projeto."
          : "Herda a permissão do projeto. Clique para deixar esta fase em Auto."
      }
      aria-label={label}
      className={cn(
        "flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[10.5px] font-medium transition-colors",
        on
          ? "border-brass/50 bg-brass/15 text-brass"
          : "border-border/60 text-muted-foreground hover:text-foreground",
      )}
    >
      <Zap className="size-3" />
      {on ? "Auto" : "Herda"}
    </button>
  )
}

/** UMA fase do rascunho: nº, rótulo e selects compactos de agent + modelo +
 *  effort (quando o agent tem níveis), mais a pílula de autonomia. As opções
 *  de agent vêm do registry (LEAGUE_DESTINATIONS) por default; o Dock passa a
 *  lista restrita aos disponíveis via `agentOptions`. */
export function MissionPhaseRow({
  phase,
  index,
  onEdit,
  agentOptions,
}: {
  phase: MissionPhaseDef
  index: number
  onEdit: (edit: PhaseEdit) => void
  /** Opções do select de agent (default: todos os destinos do registry). */
  agentOptions?: RichOption[]
}) {
  const agents =
    agentOptions ??
    LEAGUE_DESTINATIONS.map((d) => ({
      value: d.id,
      label: d.label,
      description: d.description,
    }))
  const efforts = agentEfforts(phase.agent)
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1">
      <span className="w-4 shrink-0 text-center font-mono text-[10px] tabular-nums text-muted-foreground/70">
        {index + 1}
      </span>
      <span className="min-w-0 truncate text-[12.5px] text-foreground/85">
        {phase.label}
      </span>
      <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-0.5">
        <AutonomyPill
          autonomy={phase.autonomy === "auto" ? "auto" : "inherit"}
          label={`Autonomia da fase ${index + 1}`}
          onToggle={() =>
            onEdit({
              autonomy: phase.autonomy === "auto" ? "inherit" : "auto",
            })
          }
        />
        <RichSelect
          value={phase.agent}
          onValueChange={(v) => onEdit({ agent: v })}
          aria-label={`Agent da fase ${index + 1}`}
          triggerClassName={SELECT_TRIGGER}
          options={agents}
        />
        <RichSelect
          value={phase.model ?? "default"}
          onValueChange={(v) => onEdit({ model: v === "default" ? null : v })}
          aria-label={`Modelo da fase ${index + 1}`}
          triggerClassName={SELECT_TRIGGER}
          options={agentModels(phase.agent)}
        />
        {efforts.length > 0 && (
          <RichSelect
            value={phase.effort ?? "default"}
            onValueChange={(v) =>
              onEdit({ effort: v === "default" ? null : v })
            }
            aria-label={`Effort da fase ${index + 1}`}
            triggerClassName={SELECT_TRIGGER}
            options={efforts}
          />
        )}
      </div>
    </div>
  )
}
