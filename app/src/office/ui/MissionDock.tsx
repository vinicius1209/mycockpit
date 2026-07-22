// Dock da MESA DE REUNIÃO (O-2 — §8 do docs/agent-office.md): painel direito
// no lugar do DeskDock quando o alvo é a mesa de reunião da sala comum.
// Duas caras: FORMULÁRIO (projeto + tarefa com ditado + TIME editável: seletor
// de preset, chips de fase que expandem em selects de agent/modelo — lógica
// pura em lib/missionDraft, mesma do MissionLauncher — + teto US$ opcional) e
// ACOMPANHAMENTO (fases com status,
// custo, gate humano respondível — GateCard/PhaseRow de ./missionPanel,
// fonte única compartilhada com o painel de missão do DeskDock).
// O lançamento é REAL: bridge/mission.launchTableMission → useMission.launch
// direto (nunca requestMissionLaunch). As mesas da sala do projeto acendem
// sozinhas — o derive já mapeia missão→mesas; aqui só o cockpit da missão.
import { Fragment, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertTriangle,
  Loader2,
  Mic,
  Minus,
  RefreshCw,
  Rocket,
  RotateCcw,
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
  effortsFor,
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
  clonePhases,
  editPhase,
  launchTableMission,
  missionTablePreset,
  missionTablePresets,
  parseCapInput,
  phasesCustomized,
  useMissionTableRun,
  type MissionPhaseDef,
  type MissionRun,
  type PhaseEdit,
} from "../bridge/mission"
import {
  cancelDictation,
  onDictationEnded,
  onDictationPartial,
  startDictation,
  stopDictation,
} from "../bridge/voice"
import { DictationOverlay } from "@/components/chat/DictationOverlay"
import { formatHotkey, registerDictationTarget } from "@/lib/dictationHotkey"
import { useApp } from "@/store/app"
import { GateCard, PhaseRow, phaseRowData } from "./missionPanel"
import {
  MISSION_TABLE_ID,
  launchFromTable,
  missionLaunchBlock,
  phaseAgentOptions,
  presetDraft,
  presetOptionLabel,
} from "./missionTable"
import { activeDockWidth, useOfficeUi } from "./store"

// --- pedaços ----------------------------------------------------------------

/** Chip de UMA fase do rascunho (form): nº + rótulo + agent na cor de
 *  identidade. CLICÁVEL — expande a linha de edição do time da fase (o rótulo
 *  é o papel e não muda; o time — agent/modelo — é quem muda). */
function PhaseChip({
  index,
  label,
  agent,
  expanded,
  onToggle,
}: {
  index: number
  label: string
  agent: string
  expanded: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      title={`Editar o time da fase ${index + 1} (agent/modelo)`}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] text-foreground/85 transition-colors",
        expanded
          ? "border-brass/60 bg-brass-soft"
          : "border-border bg-background hover:border-brass/40",
      )}
    >
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
        {index + 1}
      </span>
      {label}
      <span
        className="size-1.5 rounded-full"
        style={{ background: agentCssColor(agent) }}
      />
      <span className="text-muted-foreground">{agentLabel(agent)}</span>
    </button>
  )
}

/** Linha de EDIÇÃO da fase expandida: selects compactos de agent (disponíveis;
 *  indisponíveis fora — phaseAgentOptions) e modelo ("Padrão" primeiro, via
 *  modelsFor) — mesma linguagem visual do RecoveryCard. Estado imutável via
 *  editPhase (trocar de agent re-semeia modelo/effort pro default). */
function PhaseEditRow({
  phase,
  index,
  onEdit,
}: {
  phase: MissionPhaseDef
  index: number
  onEdit: (edit: PhaseEdit) => void
}) {
  const agents = phaseAgentOptions(availableAgents(), phase.agent)
  const models = modelsFor(phase.agent)
  return (
    <div className="grid basis-full grid-cols-2 gap-2 rounded-lg border border-brass/30 bg-secondary/30 p-2">
      <label className="flex min-w-0 flex-col gap-1">
        <span className="label-mono">Agent</span>
        <select
          value={phase.agent}
          onChange={(e) => onEdit({ agent: e.target.value })}
          aria-label={`Agent da fase ${index + 1}`}
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-[13px] text-foreground outline-none focus:border-ring"
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
          value={phase.model ?? "default"}
          onChange={(e) =>
            onEdit({ model: e.target.value === "default" ? null : e.target.value })
          }
          disabled={models.length === 0}
          aria-label={`Modelo da fase ${index + 1}`}
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
  )
}

// PhaseStatusIcon/PhaseRow moraram aqui — agora vivem em ./missionPanel
// (compartilhados com o painel de missão do DeskDock, fonte única).

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
  const efforts = useMemo(() => effortsFor(agent), [agent])
  const [model, setModel] = useState<string>(() => defaultModelForAgent(agent))
  const [effort, setEffort] = useState<string>("default")
  // Trocar de agent re-semeia o modelo (opções e default mudam por agent).
  useEffect(() => {
    setModel(defaultModelForAgent(agent))
    setEffort("default")
  }, [agent])

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
      <div className="mt-2 grid grid-cols-2 gap-2">
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
        {efforts.length > 0 && (
          <label className="flex min-w-0 flex-col gap-1">
            <span className="label-mono">Raciocínio</span>
            <select
              value={effort}
              onChange={(e) => setEffort(e.target.value)}
              aria-label="Esforço do agent que retoma a fase"
              className="h-8 w-full rounded-md border border-input bg-background px-2 text-[13px] text-foreground outline-none focus:border-ring"
            >
              {efforts.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        )}
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
            applyRecovery(deps, convId, buildRecoveryChoice(agent, model, effort))
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
  const recordingSince = useOfficeUi((s) => s.recordingSince)
  const partial = useOfficeUi((s) => s.dictationPartial)
  const hotkey = useApp((s) => s.settings.dictationHotkey)
  // Gate card montado ⇒ painel ALARGADO (mesma regra do DeskDock).
  const dockWide = useOfficeUi((s) => s.dockWide)

  const projects = useOfficeProjects()
  const run = useMissionTableRun(missionConvId)
  const inApp = officeIsTauri()

  // presets da mesa (Settings; fallback fábrica) + default "feature". Memo por
  // abertura basta (Settings mudam fora do office).
  const presets = useMemo(() => missionTablePresets(), [])
  const defaultPreset = useMemo(() => missionTablePreset(), [])

  // rascunho do formulário — o componente fica MONTADO (retorna null fechado),
  // então fechar/minimizar não perde a tarefa digitada nem o TIME editado.
  // O time é POR LANÇAMENTO (independe do projeto): trocar de projeto NÃO
  // reseta; só "restaurar padrão", troca de preset e pós-lançamento resetam.
  const [projectId, setProjectId] = useState<string | null>(null)
  const [task, setTask] = useState("")
  const [presetId, setPresetId] = useState<string>(() => defaultPreset.id)
  const preset = presets.find((p) => p.id === presetId) ?? defaultPreset
  const [phases, setPhases] = useState<MissionPhaseDef[]>(() =>
    clonePhases(defaultPreset.phases),
  )
  const [expandedPhase, setExpandedPhase] = useState<number | null>(null)
  const [capUsd, setCapUsd] = useState<number | null>(() => preset.maxCostUsd)
  const [capInput, setCapInput] = useState("")
  const [capEditing, setCapEditing] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [micBusy, setMicBusy] = useState(false)

  // fases editadas ⇒ indicador "time personalizado" + "restaurar padrão"
  const customized = phasesCustomized(preset.phases, phases)

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

  // Alvo do atalho de ditado com a mesa de reunião aberta (mesmo padrão do DeskDock):
  // start/stop reusam o toggleMic (hoisted) via ref. Só o FORMULÁRIO tem mic —
  // na visão de acompanhamento o botão não existe (offsetParent null ⇒ pulado).
  const micBtnRef = useRef<HTMLButtonElement | null>(null)
  const hotkeyRef = useRef({ toggle: () => Promise.resolve() })
  hotkeyRef.current = { toggle: () => toggleMic() }
  const dockOpen = dockDeskId === MISSION_TABLE_ID && !dockMinimized
  useEffect(() => {
    if (!dockOpen) return
    return registerDictationTarget({
      start: () => {
        if (!useOfficeUi.getState().recording) return hotkeyRef.current.toggle()
      },
      stop: () => {
        if (useOfficeUi.getState().recording) return hotkeyRef.current.toggle()
      },
      cancel: () => cancelDictation(),
      isRecording: () => useOfficeUi.getState().recording,
      isAvailable: () => micBtnRef.current?.offsetParent != null,
    })
  }, [dockOpen])

  if (dockDeskId !== MISSION_TABLE_ID || dockMinimized) return null

  const block = missionLaunchBlock({
    hasProjects: projects.length > 0,
    isTauri: inApp,
    missionRunning: run?.status === "running",
    task,
  })

  /** Troca de preset / restaurar padrão: rascunho LIMPO do preset (fases
   *  clonadas + teto dele) — descarta edições, fecha a fase expandida. */
  function resetTeamTo(p: (typeof presets)[number]) {
    const draft = presetDraft(p)
    setPhases(draft.phases)
    setCapUsd(draft.capUsd)
    setCapEditing(false)
    setExpandedPhase(null)
  }

  function pickPreset(id: string) {
    const p = presets.find((x) => x.id === id)
    if (!p) return
    setPresetId(id)
    resetTeamTo(p)
  }

  async function handleLaunch() {
    if (block || launching || !chosenProject) return
    setLaunching(true)
    try {
      // preset EFETIVO: fases do rascunho (editadas ou não) + teto — mesma
      // régua do MissionLauncher (effectiveTablePreset via launchFromTable).
      const convId = await launchFromTable(
        { launch: launchTableMission },
        { projectId: chosenProject.id, task, preset, phases, capUsd },
      )
      if (convId) {
        useOfficeUi.getState().setMissionTableConv(convId)
        setTask("")
        // time é por lançamento: pós-lançamento volta ao padrão do preset
        resetTeamTo(preset)
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
      className="pointer-events-auto absolute top-11 right-0 bottom-6 z-30 flex flex-col border-l border-border bg-card shadow-xl transition-[width] motion-safe:animate-in motion-safe:slide-in-from-right-4 motion-safe:fade-in-0 motion-safe:duration-200 motion-safe:ease-out"
      style={{ width: activeDockWidth(dockWide) }}
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
                    <PhaseRow
                      key={`${ph.def.id}-${i}`}
                      phase={phaseRowData(ph)}
                      index={i}
                    />
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
                convId={missionConvId}
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
              {/* pill de gravação: overlay absoluto acima do campo — o form
                  não mexe um pixel durante o ditado (zero reflow) */}
              <div className="relative mt-1 rounded-lg border bg-background transition-colors focus-within:border-brass/50">
                <DictationOverlay
                  active={recording}
                  partial={partial}
                  since={recordingSince ?? Date.now()}
                  className="absolute inset-x-0 bottom-full mb-2"
                />
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
                    ref={micBtnRef}
                    type="button"
                    title={
                      recording
                        ? "Parar e revisar (Esc cancela)"
                        : hotkey
                          ? `Ditar (${formatHotkey(hotkey)})`
                          : "Ditar"
                    }
                    onClick={() => void toggleMic()}
                    disabled={micBusy || !inApp}
                    className={cn(
                      "rounded-md p-1.5 transition-colors hover:bg-secondary disabled:opacity-40",
                      recording
                        ? "text-st-error motion-safe:animate-pulse"
                        : "text-muted-foreground",
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
                <span className="label-mono">Time</span>
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
              {/* seletor de PRESET: ponto de partida do time (o "feature" das
                  Settings vem selecionado); trocar RESETA as edições de fase. */}
              <select
                value={preset.id}
                onChange={(e) => pickPreset(e.target.value)}
                aria-label="Preset do time da missão"
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-[13px] text-foreground outline-none focus:border-ring"
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {presetOptionLabel(p)}
                  </option>
                ))}
              </select>
              {/* chips das fases: clicar expande a edição do time da fase */}
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {phases.map((ph, i) => (
                  <Fragment key={ph.id}>
                    <PhaseChip
                      index={i}
                      label={ph.label}
                      agent={ph.agent}
                      expanded={expandedPhase === i}
                      onToggle={() =>
                        setExpandedPhase((cur) => (cur === i ? null : i))
                      }
                    />
                    {expandedPhase === i && (
                      <PhaseEditRow
                        phase={ph}
                        index={i}
                        onEdit={(edit) =>
                          setPhases((cur) => editPhase(cur, i, edit))
                        }
                      />
                    )}
                  </Fragment>
                ))}
              </div>
              {expandedPhase === null && !customized && (
                <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground/70">
                  Clique numa fase pra trocar o agent/modelo dela.
                </p>
              )}
              {customized && (
                <div className="mt-1.5 flex items-center justify-between">
                  <span className="text-[11px] text-brass">
                    time personalizado
                  </span>
                  <button
                    type="button"
                    onClick={() => resetTeamTo(preset)}
                    title="Descartar as edições e voltar ao time do preset"
                    className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <RotateCcw className="size-3" />
                    restaurar padrão
                  </button>
                </div>
              )}
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
