// RECOVERY da missão (MH1.3): a fase parou num limite recuperável e o motor
// aguarda a troca de agent (re-roda a MESMA fase) ou a desistência. Extraído da
// MissionTimeline sem mudança de comportamento.

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import {
  AGENTS,
  agentEfforts,
  agentModels,
  defaultModelFor,
} from "@/lib/agents"
import { buildRecoveryChoice } from "@/lib/recoveryChoice"
import type { MissionRecovery, RecoveryChoice } from "@/lib/missionTypes"

/** RECOVERY — precisa de você (MH1.3): a fase parou num limite recuperável e o
 *  motor aguarda a troca de agent (resolveRecovery re-roda a MESMA fase) ou a
 *  desistência (abortRecovery → error). Mesmas ações do card do Escritório
 *  (office/ui/MissionDock.RecoveryCard); aqui a superfície é o Trabalho, no
 *  bloco da própria fase. "default" nos seletores = null (o agent decide),
 *  mesma semântica do resto do app. */
export function RecoveryCard({
  convId,
  recovery,
  failedAgent,
  onResolve,
  onAbort,
}: {
  convId: string
  recovery: MissionRecovery
  /** Agent que rodava a fase que parou — semente do seletor. */
  failedAgent: string
  onResolve: (convId: string, choice: RecoveryChoice) => void
  onAbort: (convId: string) => void
}) {
  const agents = useMemo(
    () =>
      AGENTS.filter((a) => a.available && a.kind === "agent").map((a) => ({
        id: a.id,
        label: a.label,
      })),
    [],
  )
  const [agent, setAgent] = useState<string>(
    () =>
      (agents.some((a) => a.id === failedAgent)
        ? failedAgent
        : agents[0]?.id) ?? "",
  )
  const models = useMemo(() => agentModels(agent), [agent])
  const [model, setModel] = useState<string>(() => defaultModelFor(agent))
  const efforts = useMemo(() => agentEfforts(agent, model), [agent, model])
  const [effort, setEffort] = useState<string>("default")
  // trocar de agent re-semeia modelo/effort (opções e default mudam por agent).
  useEffect(() => {
    setModel(defaultModelFor(agent))
    setEffort("default")
  }, [agent])

  const selectCls =
    "h-8 w-full rounded-md border border-input bg-background px-2 text-[13px] text-foreground outline-none focus:border-ring disabled:opacity-50"

  return (
    <div className="mt-2.5 overflow-hidden rounded-xl border-[1.5px] border-st-warning/50 bg-st-warning/[0.05]">
      <div className="flex items-center gap-2.5 border-b border-st-warning/25 px-4 py-3">
        <AlertTriangle className="size-4 shrink-0 text-st-warning" />
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">
            A fase parou por limite, precisa de você
          </div>
          <div className="text-[12px] text-muted-foreground">
            {recovery.message}
          </div>
        </div>
      </div>
      {recovery.error && (
        <p className="mx-4 mt-3 rounded-md border border-st-warning/30 bg-background/60 px-2 py-1.5 font-mono text-[11px] leading-snug break-words whitespace-pre-wrap text-foreground/80">
          {recovery.error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2 px-4 pt-3">
        <label className="flex min-w-0 flex-col gap-1">
          <span className="label-mono">Agent</span>
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            aria-label="Agent que retoma a fase"
            className={selectCls}
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="label-mono">Modelo</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={models.length === 0}
            aria-label="Modelo do agent que retoma a fase"
            className={selectCls}
          >
            {models.length === 0 ? (
              <option value="default">Padrão</option>
            ) : (
              models.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))
            )}
          </select>
        </label>
        {efforts.length > 0 && (
          <label className="flex min-w-0 flex-col gap-1">
            <span className="label-mono">Raciocínio</span>
            <select
              value={effort}
              onChange={(e) => setEffort(e.target.value)}
              aria-label="Esforço do agent que retoma a fase"
              className={selectCls}
            >
              {efforts.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          disabled={!agent}
          onClick={() =>
            onResolve(convId, buildRecoveryChoice(agent, model, effort))
          }
          className="flex items-center gap-1.5 rounded-lg bg-brass px-3.5 py-1.5 text-[12px] font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <RefreshCw className="size-3.5" />
          Trocar e retomar
        </button>
        <button
          type="button"
          onClick={() => onAbort(convId)}
          className="rounded-lg border border-border-strong px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-st-error/50 hover:text-st-error"
        >
          Desistir
        </button>
      </div>
    </div>
  )
}
