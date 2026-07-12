// Timeline vertical da MISSÃO no fio da conversa (padrão FusionBoard: vive
// dentro do scroll do ChatPanel, some quando não há missão). Code contra a API
// pública do useMission (byConv/abort/clear) — o motor roda em paralelo.
import { Ban, Check, Loader2, Rocket, X } from "lucide-react"
import { useMission } from "@/store/mission"
import type {
  MissionPersona,
  MissionPhaseDef,
  MissionPhaseRun,
} from "@/lib/missionTypes"
import { agentDef } from "@/lib/agents"
import { fmtCost } from "@/lib/format"
import { cn } from "@/lib/utils"

const PERSONA_LABEL: Record<MissionPersona, string> = {
  planner: "planejador",
  executor: "executor",
  reviewer: "revisor",
}

/** "Claude · Opus" — agent (shortLabel do registry) + modelo (label da opção).
 *  Modelo null = default do agent (não inventa nome). Reusado pelo Launcher. */
export function phaseAgentModel(def: MissionPhaseDef): string {
  const a = agentDef(def.agent)
  const agent = a?.shortLabel ?? def.agent
  if (!def.model) return agent
  const model =
    a?.models.find((m) => m.value === def.model)?.label ?? def.model
  return `${agent} · ${model}`
}

function PhaseDot({ status }: { status: MissionPhaseRun["status"] }) {
  switch (status) {
    case "running":
      return <Loader2 className="size-3.5 animate-spin text-brass" />
    case "done":
      return <Check className="size-3.5 text-st-success" />
    case "error":
      return <X className="size-3.5 text-st-error" />
    case "aborted":
      return <Ban className="size-3.5 text-muted-foreground" />
    default:
      // queued: dot cinza (ainda não começou)
      return <span className="size-1.5 rounded-full bg-st-idle" />
  }
}

function PhaseRow({ p, last }: { p: MissionPhaseRun; last: boolean }) {
  return (
    <li className="relative flex gap-2.5 pb-3 last:pb-0">
      {/* trilho que liga os dots (não desce após a última fase) */}
      {!last && (
        <span className="absolute top-5 bottom-0 left-[7px] w-px bg-border" />
      )}
      <span className="grid size-4 shrink-0 place-items-center pt-px">
        <PhaseDot status={p.status} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "truncate text-[13px]",
              p.status === "queued"
                ? "text-muted-foreground"
                : "text-foreground",
            )}
          >
            {p.def.label}
          </span>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {PERSONA_LABEL[p.def.persona]} · {phaseAgentModel(p.def)}
          </span>
          {p.attempt > 1 && (
            <span className="shrink-0 rounded border border-brass/40 px-1 py-px text-[10px] tracking-wide text-brass uppercase">
              tentativa {p.attempt}/{p.def.maxRetries}
            </span>
          )}
          {p.costUsd > 0 && (
            <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
              {fmtCost(p.costUsd)}
            </span>
          )}
        </div>
        {p.error && (p.status === "error" || p.status === "aborted") && (
          <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-st-error">
            {p.error}
          </p>
        )}
      </div>
    </li>
  )
}

/** Timeline da missão na conversa: cabeçalho (preset + status + custo/teto +
 *  Parar/fechar) e uma linha por fase (dot de status, persona, agent·modelo,
 *  custo, badge de retry). Renderiza null sem missão — o ChatPanel só monta. */
export function MissionTimeline({ convId }: { convId: string }) {
  const mission = useMission((s) => s.byConv[convId])
  const abort = useMission((s) => s.abort)
  const clear = useMission((s) => s.clear)
  if (!mission) return null

  const running = mission.status === "running"
  const n = mission.phases.length
  const statusText = running
    ? `fase ${Math.min(mission.current + 1, n)}/${n}`
    : mission.status === "done"
      ? "concluída"
      : mission.status === "error"
        ? "falhou"
        : "abortada"

  return (
    <div className="mx-auto w-full max-w-[760px] px-8 py-4">
      <div className="rounded-xl border bg-card">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Rocket className="size-3.5 shrink-0 text-brass" />
          <span className="truncate text-[13px] font-medium text-foreground">
            Missão · {mission.presetName}
          </span>
          <span
            className={cn(
              "shrink-0 text-[11px]",
              mission.status === "done"
                ? "text-st-success"
                : mission.status === "error"
                  ? "text-st-error"
                  : "text-muted-foreground",
            )}
          >
            {statusText}
          </span>
          <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
            {fmtCost(mission.costTotal)}
            {mission.maxCostUsd != null && (
              <span className="text-muted-foreground/60">
                {" "}
                / {fmtCost(mission.maxCostUsd)}
              </span>
            )}
          </span>
          {running ? (
            <button
              onClick={() => abort(convId)}
              className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:border-st-error/50 hover:text-st-error"
            >
              Parar
            </button>
          ) : (
            <button
              onClick={() => clear(convId)}
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Fechar timeline da missão"
              title="Fechar"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <ol className="px-3 py-2.5">
          {mission.phases.map((p, i) => (
            <PhaseRow key={p.def.id} p={p} last={i === n - 1} />
          ))}
        </ol>
      </div>
    </div>
  )
}
