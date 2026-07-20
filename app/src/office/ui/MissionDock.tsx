// Dock da MESA DE REUNIÃO (O-2 — §8 do docs/agent-office.md): painel direito
// no lugar do DeskDock quando o alvo é a mesa de reunião da sala comum.
// Duas caras: FORMULÁRIO (projeto + tarefa com ditado + preset "feature" com
// as fases visíveis + teto US$ opcional) e ACOMPANHAMENTO (fases com status,
// custo, gate humano respondível — GateCard do DeskDock, fonte única).
// O lançamento é REAL: bridge/mission.launchTableMission → useMission.launch
// direto (nunca requestMissionLaunch). As mesas da sala do projeto acendem
// sozinhas — o derive já mapeia missão→mesas; aqui só o cockpit da missão.
import { useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Loader2,
  Mic,
  Minus,
  RefreshCw,
  Rocket,
  Square,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import {
  abortDeskRecovery,
  agentCssColor,
  agentLabel,
  answerDeskGate,
  availableAgents,
  defaultModelForAgent,
  dockLeaveCtx,
  exitOfficeToPainel,
  fmtCost,
  modelsFor,
  officeIsTauri,
  resolveDeskRecovery,
  useOfficeProjects,
} from "../bridge/hooks"
import { applyRecovery, buildRecoveryChoice, cancelRecovery } from "./recovery"
import {
  abortTableMission,
  launchTableMission,
  missionTablePreset,
  parseCapInput,
  useMissionTableRun,
  type MissionPhaseRun,
  type MissionRun,
} from "../bridge/mission"
import {
  onDictationEnded,
  onDictationPartial,
  startDictation,
  stopDictation,
} from "../bridge/voice"
import { DOCK_W, GateCard } from "./DeskDock"
import {
  MISSION_TABLE_ID,
  missionConversationTitle,
  missionLaunchBlock,
} from "./missionTable"
import { useOfficeUi } from "./store"

// --- pedaços ----------------------------------------------------------------

/** Badge compacto de UMA fase do preset (form): nº + rótulo + agent na cor de
 *  identidade — o time fica visível sem editor (fases se editam no Linear). */
function PhaseBadge({
  index,
  label,
  agent,
}: {
  index: number
  label: string
  agent: string
}) {
  return (
    <span className="flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-foreground/85">
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
        {index + 1}
      </span>
      {label}
      <span
        className="size-1.5 rounded-full"
        style={{ background: agentCssColor(agent) }}
      />
      <span className="text-muted-foreground">{agentLabel(agent)}</span>
    </span>
  )
}

/** Ícone de status de fase (acompanhamento). */
function PhaseStatusIcon({ status }: { status: MissionPhaseRun["status"] }) {
  switch (status) {
    case "running":
      return (
        <Loader2 className="size-3.5 animate-spin text-st-running motion-reduce:animate-none" />
      )
    case "done":
      return <Check className="size-3.5 text-st-success" />
    case "error":
      return <AlertCircle className="size-3.5 text-st-error" />
    case "aborted":
      return <Square className="size-3 text-muted-foreground" />
    default:
      return (
        <span className="mx-0.5 size-2 rounded-full border border-border-strong" />
      )
  }
}

/** Linha de UMA fase no acompanhamento: status + rótulo + agent + custo. */
function PhaseRow({ phase, index }: { phase: MissionPhaseRun; index: number }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 py-1",
        phase.status === "queued" && "opacity-60",
      )}
    >
      <span className="w-4 shrink-0 text-center font-mono text-[10px] tabular-nums text-muted-foreground/70">
        {index + 1}
      </span>
      <span className="flex w-4 shrink-0 items-center justify-center">
        <PhaseStatusIcon status={phase.status} />
      </span>
      <span className="min-w-0 truncate text-[12.5px] text-foreground/90">
        {phase.def.label}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <span
          className="size-1.5 rounded-full"
          style={{ background: agentCssColor(phase.def.agent) }}
        />
        {agentLabel(phase.def.agent)}
        {phase.costUsd > 0 && (
          <span className="font-mono tabular-nums">{fmtCost(phase.costUsd)}</span>
        )}
      </span>
    </div>
  )
}

/** Linha-resumo do estado terminal da missão (done/error/aborted). */
function RunOutcome({ run }: { run: MissionRun }) {
  if (run.status === "done") {
    return (
      <div className="rounded-lg border border-st-success/40 bg-st-success/10 px-3 py-2">
        <p className="text-[12px] font-semibold text-st-success">
          Missão concluída
        </p>
        {run.doneSummary?.intent && (
          <p className="mt-0.5 text-[12px] leading-snug text-foreground/85">
            {run.doneSummary.intent}
          </p>
        )}
        {run.doneSummary && run.doneSummary.filesTouched.length > 0 && (
          <p className="mt-1 font-mono text-[10.5px] text-muted-foreground">
            {run.doneSummary.filesTouched.length}{" "}
            {run.doneSummary.filesTouched.length === 1
              ? "arquivo tocado"
              : "arquivos tocados"}
          </p>
        )}
      </div>
    )
  }
  if (run.status === "error") {
    const failed = run.phases.find((p) => p.status === "error")
    return (
      <div className="rounded-lg border border-st-error/40 bg-st-error/10 px-3 py-2">
        <p className="text-[12px] font-semibold text-st-error">
          Missão parou com erro
        </p>
        {failed?.error && (
          <p className="mt-0.5 text-[12px] leading-snug text-foreground/85">
            {failed.error}
          </p>
        )}
      </div>
    )
  }
  return (
    <p className="text-[12px] text-muted-foreground italic">Missão abortada.</p>
  )
}

/** Card de RECUPERAÇÃO (entrega 3): uma fase parou num limite recuperável e o
 *  motor aguarda a troca de agent. Espelha o GateCard (cor st-warning, pausa a
 *  missão), mas com seletor de agent/modelo — "Trocar e retomar" re-roda a MESMA
 *  fase com a escolha (resolveRecovery); "Desistir" manda a missão a error
 *  (abortRecovery). As badges de fase refletem o agent trocado após retomar
 *  (o motor reescreve phase.def na resolução). */
function RecoveryCard({
  recovery,
  convId,
  failedAgent,
}: {
  recovery: NonNullable<MissionRun["recovery"]>
  convId: string
  /** Agent que rodava a fase que parou — semente do seletor (o usuário pode só
   *  trocar o modelo, ou escolher outro agent). */
  failedAgent: string
}) {
  const agents = useMemo(() => availableAgents(), [])
  const [agent, setAgent] = useState<string>(
    () => (agents.some((a) => a.id === failedAgent) ? failedAgent : agents[0]?.id) ?? "",
  )
  const models = useMemo(() => modelsFor(agent), [agent])
  const [model, setModel] = useState<string>(() => defaultModelForAgent(agent))
  // Trocar de agent re-semeia o modelo (opções e default mudam por agent).
  useEffect(() => setModel(defaultModelForAgent(agent)), [agent])

  const deps = { resolve: resolveDeskRecovery, abort: abortDeskRecovery }

  return (
    <div className="rounded-lg border border-st-warning/60 bg-st-warning/10 p-3">
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="size-3.5 shrink-0 text-st-warning" />
        <p className="text-[12px] font-semibold text-st-warning">
          A fase {recovery.phase + 1} parou — {recovery.message}
        </p>
      </div>
      {recovery.error && (
        <p className="mt-1.5 rounded-md border border-st-warning/30 bg-background/60 px-2 py-1.5 font-mono text-[11px] leading-snug break-words whitespace-pre-wrap text-foreground/80">
          {recovery.error}
        </p>
      )}
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        Escolha quem retoma esta fase — o contexto viaja pelo worktree; a fase
        re-roda do zero com o novo time.
      </p>
      <div className="mt-2 flex gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="label-mono">Agent</span>
          <select
            value={agent}
            onChange={(e) => setAgent(e.target.value)}
            aria-label="Agent que retoma a fase"
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-[13px] text-foreground outline-none focus:border-ring"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="label-mono">Modelo</span>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            disabled={models.length === 0}
            aria-label="Modelo do agent que retoma a fase"
            className="h-8 w-full rounded-md border border-input bg-background px-2 text-[13px] text-foreground outline-none focus:border-ring disabled:opacity-50"
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
      </div>
      <div className="mt-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={() =>
            cancelRecovery(deps, convId)
          }
          className="rounded-md border border-border px-2.5 py-1.5 text-[12px] text-foreground transition-colors hover:bg-secondary"
        >
          Desistir
        </button>
        <button
          type="button"
          disabled={!agent}
          onClick={() =>
            applyRecovery(deps, convId, buildRecoveryChoice(agent, model))
          }
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-brass px-3 py-1.5 text-[13px] font-medium text-brass-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <RefreshCw className="size-3.5" />
          Trocar e retomar
        </button>
      </div>
    </div>
  )
}

// --- o dock -----------------------------------------------------------------

export function MissionDock() {
  const dockDeskId = useOfficeUi((s) => s.dockDeskId)
  const dockMinimized = useOfficeUi((s) => s.dockMinimized)
  const missionConvId = useOfficeUi((s) => s.missionTableConvId)
  const recording = useOfficeUi((s) => s.recording)
  const partial = useOfficeUi((s) => s.dictationPartial)

  const projects = useOfficeProjects()
  const run = useMissionTableRun(missionConvId)
  const inApp = officeIsTauri()

  // preset fixo da mesa ("feature" das Settings): fases NÃO se editam aqui —
  // só o teto. Memo por abertura basta (Settings mudam fora do office).
  const preset = useMemo(() => missionTablePreset(), [])

  // rascunho do formulário — o componente fica MONTADO (retorna null fechado),
  // então fechar/minimizar não perde a tarefa digitada.
  const [projectId, setProjectId] = useState<string | null>(null)
  const [task, setTask] = useState("")
  const [capUsd, setCapUsd] = useState<number | null>(() => preset.maxCostUsd)
  const [capInput, setCapInput] = useState("")
  const [capEditing, setCapEditing] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [micBusy, setMicBusy] = useState(false)

  // projeto default = primeiro da lista (e auto-corrige se o escolhido sumir)
  const chosenProject =
    projects.find((p) => p.id === projectId) ?? projects[0] ?? null

  // Espelho do ditado (mesmo padrão do DeskDock — parciais viram legenda, o
  // FIM solta recording). Duplicar a assinatura é inócuo: setters idempotentes.
  useEffect(() => {
    const offPartial = onDictationPartial((t) =>
      useOfficeUi.getState().setDictationPartial(t),
    )
    const offEnded = onDictationEnded(() =>
      useOfficeUi.getState().setRecording(false),
    )
    return () => {
      offPartial()
      offEnded()
    }
  }, [])

  if (dockDeskId !== MISSION_TABLE_ID || dockMinimized) return null

  const block = missionLaunchBlock({
    hasProjects: projects.length > 0,
    isTauri: inApp,
    missionRunning: run?.status === "running",
    task,
  })

  async function handleLaunch() {
    if (block || launching || !chosenProject) return
    setLaunching(true)
    try {
      // preset EFETIVO: só o teto muda por aqui (vazio/0 = sem teto)
      const convId = await launchTableMission({
        projectId: chosenProject.id,
        title: missionConversationTitle(task),
        task,
        preset: { ...preset, maxCostUsd: capUsd },
      })
      if (convId) {
        useOfficeUi.getState().setMissionTableConv(convId)
        setTask("")
      }
    } finally {
      setLaunching(false)
    }
  }

  async function toggleMic() {
    if (micBusy) return
    const ui = useOfficeUi.getState()
    setMicBusy(true)
    try {
      if (ui.recording) {
        const text = (await stopDictation()).trim()
        if (text)
          setTask((cur) => (cur.trim() ? `${cur.replace(/\s+$/, "")} ${text}` : text))
      } else {
        await startDictation(
          [chosenProject?.name, "missão"].filter((v): v is string => !!v),
        )
        ui.setRecording(true)
      }
    } catch {
      // start recusado (fora do app / mic ocupado): o store nunca ligou.
    } finally {
      setMicBusy(false)
    }
  }

  function commitCap() {
    const parsed = parseCapInput(capInput)
    if (parsed !== undefined) setCapUsd(parsed)
    setCapEditing(false)
  }

  function requestClose() {
    useOfficeUi.getState().closeOrMinimizeDock(dockLeaveCtx(missionConvId))
  }

  return (
    <aside
      className="pointer-events-auto absolute top-11 right-0 bottom-6 z-30 flex flex-col border-l border-border bg-card shadow-xl motion-safe:animate-in motion-safe:slide-in-from-right-4 motion-safe:fade-in-0 motion-safe:duration-200 motion-safe:ease-out"
      style={{ width: DOCK_W }}
      aria-label="Mesa de reunião — missões"
    >
      {/* cabeçalho */}
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brass-soft">
          <Rocket className="size-4 text-brass" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="truncate text-[13px] font-semibold text-foreground">
            Mesa de reunião
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {run?.status === "running"
              ? `Missão em andamento · ${fmtCost(run.costTotal)}`
              : "Lançar missão — time de agents em fases"}
          </p>
        </div>
        {run?.status === "running" && missionConvId && (
          <button
            type="button"
            title="Parar a missão"
            onClick={() => abortTableMission(missionConvId)}
            className="rounded-md p-1.5 text-st-error transition-colors hover:bg-secondary"
          >
            <Square className="size-3.5" />
          </button>
        )}
        <button
          type="button"
          title="Minimizar pro chip"
          onClick={() => useOfficeUi.getState().minimizeDock()}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Minus className="size-3.5" />
        </button>
        <button
          type="button"
          title="Fechar"
          onClick={requestClose}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {/* ── guarda: sem projetos ⇒ CTA (não há onde rodar a missão) ── */}
        {projects.length === 0 && (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-secondary/30 p-3">
            <p className="text-[12.5px] leading-snug text-muted-foreground">
              Nenhum projeto no cockpit — a missão roda dentro de um projeto.
            </p>
            <button
              type="button"
              onClick={exitOfficeToPainel}
              className="rounded-md bg-brass px-2.5 py-1 text-[12px] font-medium text-brass-foreground transition-opacity hover:opacity-90"
            >
              Ir para o painel
            </button>
          </div>
        )}

        {/* ── ACOMPANHAMENTO: missão lançada daqui (rodando ou terminada) ── */}
        {projects.length > 0 && run && missionConvId && (
          <div className="flex flex-col gap-3">
            {/* RECUPERAÇÃO (entrega 3): fase parada num limite recuperável ⇒ o
                card assume; o resto do acompanhamento fica esmaecido/inerte. */}
            {run.recovery && (
              <RecoveryCard
                recovery={run.recovery}
                convId={missionConvId}
                failedAgent={
                  run.phases[run.recovery.phase]?.def.agent ?? run.phases[0]?.def.agent ?? ""
                }
              />
            )}

            <div
              className={cn(
                "flex flex-col gap-3",
                run.recovery && "pointer-events-none opacity-50",
              )}
            >
              <div>
                <span className="label-mono">Tarefa</span>
                <p className="mt-1 line-clamp-3 text-[12.5px] leading-snug text-foreground/90">
                  {run.task}
                </p>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="label-mono">Fases</span>
                  <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
                    {fmtCost(run.costTotal)}
                    {run.maxCostUsd != null && ` / teto ${fmtCost(run.maxCostUsd)}`}
                  </span>
                </div>
                <div className="rounded-lg border bg-secondary/30 px-2 py-1">
                  {run.phases.map((ph, i) => (
                    <PhaseRow key={`${ph.def.id}-${i}`} phase={ph} index={i} />
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
                  As mesas da sala do projeto acendem com a fase corrente — o
                  detalhe do turno vive lá.
                </p>
              </div>
            </div>

            {run.gate && (
              <GateCard
                gate={run.gate}
                onAnswer={(a) => answerDeskGate(missionConvId, a)}
              />
            )}

            {run.status !== "running" && (
              <>
                <RunOutcome run={run} />
                <button
                  type="button"
                  onClick={() => useOfficeUi.getState().setMissionTableConv(null)}
                  className="flex items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12px] text-foreground transition-colors hover:bg-secondary"
                >
                  <Rocket className="size-3.5" />
                  Nova missão
                </button>
              </>
            )}
          </div>
        )}

        {/* ── FORMULÁRIO: projeto + tarefa + time visível + teto ── */}
        {projects.length > 0 && !(run && missionConvId) && (
          <div className="flex flex-col gap-3.5">
            <div>
              <label className="label-mono" htmlFor="mission-project">
                Projeto
              </label>
              <select
                id="mission-project"
                value={chosenProject?.id ?? ""}
                onChange={(e) => setProjectId(e.target.value)}
                className="mt-1 h-8 w-full rounded-md border border-input bg-background px-2 text-[13px] text-foreground outline-none focus:border-ring"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="label-mono">Tarefa</span>
              {recording && (
                <div className="mt-1 mb-1.5 flex items-center gap-2 rounded-md border border-st-running/40 bg-background px-2.5 py-1.5 text-[12px]">
                  <span className="size-1.5 shrink-0 rounded-full bg-st-error motion-safe:animate-pulse" />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    {partial?.trim() ? partial : "Ouvindo…"}
                  </span>
                  <span className="shrink-0 text-[10px] text-muted-foreground uppercase">
                    Esc cancela
                  </span>
                </div>
              )}
              <div className="mt-1 rounded-lg border bg-background transition-colors focus-within:border-brass/50">
                <textarea
                  value={task}
                  onChange={(e) => setTask(e.target.value)}
                  rows={5}
                  placeholder="Descreva a tarefa da missão… (🎤 dita)"
                  aria-label="Tarefa da missão"
                  className="max-h-48 w-full resize-none rounded-lg bg-transparent px-2.5 py-2 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground"
                />
                <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
                  <button
                    type="button"
                    title={recording ? "Parar e revisar" : "Ditar (pt-BR, local)"}
                    onClick={() => void toggleMic()}
                    disabled={micBusy || !inApp}
                    className={cn(
                      "rounded-md p-1.5 transition-colors hover:bg-secondary disabled:opacity-40",
                      recording ? "text-st-error" : "text-muted-foreground",
                    )}
                  >
                    {micBusy ? (
                      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" />
                    ) : (
                      <Mic className="size-4" />
                    )}
                  </button>
                  <span className="ml-auto font-mono text-[10.5px] tabular-nums text-muted-foreground/60">
                    {task.length > 0 ? task.length.toLocaleString("pt-BR") : ""}
                  </span>
                </div>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="label-mono">Time · {preset.name}</span>
                {capEditing ? (
                  <label className="flex items-center gap-1 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                    teto US$
                    <input
                      value={capInput}
                      onChange={(e) => setCapInput(e.target.value)}
                      onBlur={commitCap}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault()
                          commitCap()
                        }
                      }}
                      inputMode="decimal"
                      placeholder="sem teto"
                      aria-label="Teto de custo da missão em US$ (vazio ou 0 = sem teto)"
                      className="h-5 w-14 rounded border bg-background px-1 text-right font-mono text-[10.5px] tabular-nums text-foreground outline-none focus:border-brass/50"
                      autoFocus
                    />
                  </label>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setCapInput(
                        capUsd != null ? String(capUsd).replace(".", ",") : "",
                      )
                      setCapEditing(true)
                    }}
                    title="Editar teto de custo (vazio ou 0 = sem teto)"
                    className="font-mono text-[10.5px] tabular-nums text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {capUsd != null ? (
                      <>teto {fmtCost(capUsd)}</>
                    ) : (
                      <span className="text-muted-foreground/60">sem teto</span>
                    )}
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {preset.phases.map((ph, i) => (
                  <PhaseBadge
                    key={ph.id}
                    index={i}
                    label={ph.label}
                    agent={ph.agent}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* rodapé: lançar (form) */}
      {projects.length > 0 && !(run && missionConvId) && (
        <div className="shrink-0 border-t border-border p-3">
          <button
            type="button"
            onClick={() => void handleLaunch()}
            disabled={block !== null || launching}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-brass px-3 py-2 text-[13px] font-medium text-brass-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {launching ? (
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
            ) : (
              <Rocket className="size-3.5" />
            )}
            Lançar missão
          </button>
          {block === "fora-do-app" && (
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">
              Lançar de verdade requer o app (bun run tauri dev) — aqui é só a
              simulação do escritório.
            </p>
          )}
        </div>
      )}
    </aside>
  )
}
