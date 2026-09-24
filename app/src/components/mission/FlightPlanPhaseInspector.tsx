import { ArrowLeft, ArrowRight, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { RichSelect } from "@/components/ui/RichSelect"
import { Textarea } from "@/components/ui/textarea"
import { LEAGUE_DESTINATIONS, agentEfforts, agentModels } from "@/lib/agents"
import type { MissionPhaseDef, MissionPersona } from "@/lib/missionTypes"

const SELECT_TRIGGER =
  "h-8 w-full gap-1.5 rounded-md border bg-secondary/40 px-2.5 text-[12px] text-foreground data-[size=default]:h-8"

const PERSONA_OPTIONS = [
  { value: "planner", label: "Planejador", description: "Desenha a abordagem" },
  { value: "executor", label: "Executor", description: "Realiza o trabalho" },
  { value: "reviewer", label: "Revisor", description: "Julga as evidências" },
]

function criteriaText(criteria: string[] | undefined): string {
  return (criteria ?? []).join("\n")
}

export function FlightPlanPhaseInspector({
  phase,
  phaseIndex,
  phaseCount,
  onPatch,
  onMove,
  onRemove,
}: {
  phase: MissionPhaseDef | null
  phaseIndex: number
  phaseCount: number
  onPatch: (patch: Partial<MissionPhaseDef>) => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}) {
  if (!phase) {
    return (
      <div className="p-5 text-center text-[12px] leading-relaxed text-muted-foreground">
        Selecione uma fase no mapa para configurar o membro, as tentativas e os critérios.
      </div>
    )
  }

  const efforts = agentEfforts(phase.agent, phase.model)

  return (
    <div className="divide-y divide-border/40">
      <section className="space-y-3 p-3">
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-[11px] tracking-wide text-brass uppercase">
            Fase {String(phaseIndex + 1).padStart(2, "0")}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icone-compacto"
              onClick={() => onMove(-1)}
              disabled={phaseIndex <= 0}
              aria-label="Mover fase para antes"
              title="Mover para antes"
            >
              <ArrowLeft className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icone-compacto"
              onClick={() => onMove(1)}
              disabled={phaseIndex < 0 || phaseIndex >= phaseCount - 1}
              aria-label="Mover fase para depois"
              title="Mover para depois"
            >
              <ArrowRight className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icone-compacto"
              onClick={onRemove}
              disabled={phaseCount <= 1}
              className="hover:text-st-error"
              aria-label="Remover fase"
              title="Remover fase"
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>

        <label className="grid gap-1 text-[11px] text-muted-foreground">
          Nome da fase
          <Input
            value={phase.label}
            onChange={(event) => onPatch({ label: event.target.value })}
            className="h-8 text-[12px]"
          />
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="grid gap-1 text-[11px] text-muted-foreground">
            Papel
            <RichSelect
              value={phase.persona}
              onValueChange={(value) => onPatch({ persona: value as MissionPersona })}
              options={PERSONA_OPTIONS}
              triggerClassName={SELECT_TRIGGER}
            />
          </label>
          <label className="grid gap-1 text-[11px] text-muted-foreground">
            Code agent
            <RichSelect
              value={phase.agent}
              onValueChange={(value) => onPatch({ agent: value, model: null, effort: null })}
              options={LEAGUE_DESTINATIONS.map((agent) => ({
                value: agent.id,
                label: agent.label,
                description: agent.description,
              }))}
              triggerClassName={SELECT_TRIGGER}
            />
          </label>
          <label className="grid gap-1 text-[11px] text-muted-foreground">
            Modelo
            <RichSelect
              value={phase.model ?? "default"}
              onValueChange={(value) => onPatch({ model: value === "default" ? null : value })}
              options={agentModels(phase.agent)}
              triggerClassName={SELECT_TRIGGER}
            />
          </label>
          <label className="grid gap-1 text-[11px] text-muted-foreground">
            Effort
            {efforts.length > 0 ? (
              <RichSelect
                value={phase.effort ?? "default"}
                onValueChange={(value) => onPatch({ effort: value === "default" ? null : value })}
                options={efforts}
                triggerClassName={SELECT_TRIGGER}
              />
            ) : (
              <div className="flex h-8 items-center rounded-md border bg-secondary/20 px-2.5 text-[11px] text-muted-foreground">
                definido pelo modelo
              </div>
            )}
          </label>
        </div>

        <label className="grid gap-1 text-[11px] text-muted-foreground">
          Tentativas da fase
          <Input
            type="number"
            min={1}
            value={phase.maxRetries}
            onChange={(event) => onPatch({ maxRetries: Math.max(1, Number(event.target.value) || 1) })}
            className="h-8 text-[12px]"
          />
        </label>
      </section>

      <section className="space-y-3 p-3">
        <div>
          <h2 className="etiqueta text-foreground">Guardrails da fase</h2>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Estes critérios viajam no prompt e ficam visíveis no handoff.
          </p>
        </div>
        <label className="grid gap-1 text-[11px] text-muted-foreground">
          Entrada, um por linha
          <Textarea
            value={criteriaText(phase.entryCriteria)}
            onChange={(event) => onPatch({ entryCriteria: event.target.value.split("\n") })}
            placeholder="Ex.: plano aprovado"
            className="min-h-20 resize-y text-[11px]"
          />
        </label>
        <label className="grid gap-1 text-[11px] text-muted-foreground">
          Saída, um por linha
          <Textarea
            value={criteriaText(phase.exitCriteria)}
            onChange={(event) => onPatch({ exitCriteria: event.target.value.split("\n") })}
            placeholder="Ex.: testes passam"
            className="min-h-20 resize-y text-[11px]"
          />
        </label>
        <label className="grid gap-1 text-[11px] text-muted-foreground">
          Instrução específica
          <Textarea
            value={phase.instructions ?? ""}
            onChange={(event) => onPatch({ instructions: event.target.value })}
            placeholder="Contexto adicional para este agent"
            className="min-h-24 resize-y text-[11px]"
          />
        </label>
      </section>
    </div>
  )
}
