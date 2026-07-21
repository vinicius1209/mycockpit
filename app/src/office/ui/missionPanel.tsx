// Painel de missão COMPARTILHADO do office (mesa de reunião + dock da mesa):
// os componentes de fase (ícone/linha) extraídos do MissionDock — fonte única,
// sem duplicar —, o GateCard (movido do DeskDock; MissionDock e DeskDock
// consomem daqui) e o painel COMPACTO que toma o corpo do DeskDock quando a
// mesa está executando uma fase de missão (o status real da missão aparece na
// mesa do agent, não só na mesa de reunião). A decisão "mostra o painel?" e o
// sub-rótulo do cabeçalho são funções PURAS testáveis sem DOM (ui.test.ts).
import { useEffect, useState } from "react"
import { AlertCircle, Check, Loader2, Mic, Rocket, Square } from "lucide-react"
import { cn } from "@/lib/utils"
import type {
  GateAnswer,
  MissionPhaseRun,
  MissionPhaseStatus,
} from "@/lib/missionTypes"
import { GateAnswerForm } from "@/components/mission/GateAnswerForm"
import {
  agentCssColor,
  agentLabel,
  fmtCost,
  useDeskGateCaps,
  type DeskMissionView,
  type MissionGate,
} from "../bridge/hooks"
import { startDictation, stopDictation } from "../bridge/voice"
import { ElapsedSince } from "./DeskMenu"
import { useOfficeUi } from "./store"

// --- lógica pura (testável sem DOM) -----------------------------------------

/** O dock da mesa mostra o PAINEL DE MISSÃO em vez da conversa? Só quando a
 *  mesa hospeda uma fase de missão ATIVA (run rodando — gate e recovery mantêm
 *  status "running", então seguem no painel). Sem missão (null) ou missão
 *  terminada ⇒ comportamento atual do dock intacto. */
export function showsMissionPanel(view: { status: string } | null): boolean {
  return view?.status === "running"
}

/** Sub-rótulo do cabeçalho do dock em modo missão:
 *  "Executando missão · fase {i+1}/{N} · {persona}" (1-based, clampado). */
export function missionPanelSubtitle(
  view: Pick<DeskMissionView, "current" | "total" | "persona">,
): string {
  const phase = Math.min(view.current + 1, view.total)
  return `Executando missão · fase ${phase}/${view.total} · ${view.persona}`
}

// --- fases (extraídos do MissionDock — fonte única) -------------------------

/** Dados por VALOR de uma linha de fase (o useDeskMissionView já entrega
 *  assim; o MissionDock adapta MissionPhaseRun via phaseRowData). */
export type PhaseRowData = {
  label: string
  agent: string
  status: MissionPhaseStatus
  costUsd: number
}

/** Adapta a fase de runtime do motor pra linha compartilhada. */
export function phaseRowData(phase: MissionPhaseRun): PhaseRowData {
  return {
    label: phase.def.label,
    agent: phase.def.agent,
    status: phase.status,
    costUsd: phase.costUsd,
  }
}

/** Ícone de status de fase (acompanhamento). */
export function PhaseStatusIcon({ status }: { status: MissionPhaseStatus }) {
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
export function PhaseRow({
  phase,
  index,
}: {
  phase: PhaseRowData
  index: number
}) {
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
        {phase.label}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <span
          className="size-1.5 rounded-full"
          style={{ background: agentCssColor(phase.agent) }}
        />
        {agentLabel(phase.agent)}
        {phase.costUsd > 0 && (
          <span className="font-mono tabular-nums">{fmtCost(phase.costUsd)}</span>
        )}
      </span>
    </div>
  )
}

// --- gate de missão (movido do DeskDock — fonte única de resposta) ----------

/** Botão de ditado do gate no OFFICE: dono do mic é o bridge/voice (§5.5) —
 *  o mesmo recording do store; o texto final cai na RESPOSTA (onText). `mine`
 *  distingue esta instância (cada pergunta tem o seu botão): só quem iniciou
 *  para/entrega; recording alheio desabilita. */
function OfficeGateMic({ onText }: { onText: (text: string) => void }) {
  const recording = useOfficeUi((s) => s.recording)
  const [busy, setBusy] = useState(false)
  const [mine, setMine] = useState(false)
  // Fim do ditado por fora (Esc/sidecar morto) ⇒ solta o "meu" espelho.
  useEffect(() => {
    if (!recording) setMine(false)
  }, [recording])

  async function toggle() {
    if (busy) return
    const ui = useOfficeUi.getState()
    setBusy(true)
    try {
      if (ui.recording && mine) {
        const text = (await stopDictation()).trim()
        if (text) onText(text)
      } else if (!ui.recording) {
        await startDictation(["missão"])
        ui.setRecording(true)
        setMine(true)
      }
    } catch {
      // start recusado (fora do Tauri/mic ocupado): o store nunca ligou.
    } finally {
      setBusy(false)
    }
  }

  const active = recording && mine
  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy || (recording && !mine)}
      title={active ? "Parar e revisar" : "Ditar a resposta (pt-BR, local)"}
      aria-label={active ? "Parar o ditado" : "Ditar a resposta"}
      className={cn(
        "rounded-md p-1.5 transition-colors hover:bg-secondary disabled:opacity-40",
        active ? "text-st-error" : "text-muted-foreground",
      )}
    >
      {busy ? (
        <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" />
      ) : (
        <Mic className="size-3.5" />
      )}
    </button>
  )
}

/** Card de gate humano da missão — DeskDock e MissionDock reusam o MESMO card
 *  (fonte única de resposta = answerGate via bridge), agora RICO: textarea
 *  auto-grow + ditado + anexos por resposta (GateAnswerForm compartilhado com
 *  a MissionTimeline do Trabalho). Enquanto MONTADO, o dock ALARGA pra
 *  DOCK_W_WIDE (push/pop no store — a cena permanece visível ao lado). */
export function GateCard({
  gate,
  convId,
  onAnswer,
}: {
  gate: MissionGate
  /** Conversa da missão (blobs dos anexos + caps da próxima fase). */
  convId: string
  onAnswer: (answers: GateAnswer[]) => void
}) {
  const next = useDeskGateCaps(convId)
  // Card de decisão visível ⇒ painel alargado; some ⇒ volta a DOCK_W.
  useEffect(() => {
    const ui = useOfficeUi.getState()
    ui.pushDockWide()
    return () => ui.popDockWide()
  }, [])

  return (
    <div className="overflow-hidden rounded-lg border border-st-warning/50 bg-st-warning/10">
      <p className="px-2.5 pt-2.5 pb-1 text-[12px] font-semibold text-st-warning">
        A missão precisa de você (fase {gate.phase + 1})
      </p>
      {/* key = fase: gate novo zera o rascunho (o form também se re-semeia) */}
      <GateAnswerForm
        key={gate.phase}
        compact
        convId={convId}
        questions={gate.questions}
        caps={next.caps}
        destLabel={next.label}
        submitLabel="Responder e retomar"
        renderMic={(insert) => <OfficeGateMic onText={insert} />}
        onSubmit={onAnswer}
      />
    </div>
  )
}

// --- atividade ao vivo (mini LiveActivity da MissionTimeline) ---------------

/** Pontinho de um tool-step recente (ok = concluído; senão rodando). */
function StepDot({ done }: { done: boolean }) {
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full",
        done
          ? "bg-st-success"
          : "bg-st-running motion-safe:animate-pulse",
      )}
    />
  )
}

// --- o painel compacto (corpo do DeskDock em modo missão) -------------------

/** Painel de missão do DOCK DA MESA: fases em lista compacta + atividade AO
 *  VIVO da fase corrente (últimos tool-steps do useDeskMissionView) + gate
 *  respondível + "Abrir na mesa de reunião"/Parar. Substitui o estado vazio/
 *  composer da conversa da mesa enquanto a missão roda — o wiring (abrir dock
 *  da mesa de reunião, abort, answerGate) fica com o DeskDock. */
export function DeskMissionPanel({
  view,
  gate,
  onAnswerGate,
  onOpenTable,
  onStop,
}: {
  view: DeskMissionView
  gate: MissionGate | null
  onAnswerGate: (answers: GateAnswer[]) => void
  /** Só quando a missão FOI lançada da mesa de reunião (missionTableConvId
   *  bate) — para missões do Trabalho o MissionDock abriria o FORMULÁRIO
   *  vazio, não o acompanhamento. Ausente ⇒ botão some. */
  onOpenTable?: () => void
  onStop: () => void
}) {
  const curAgent = view.phases[view.current]?.agent ?? null
  return (
    <div data-testid="desk-mission-panel" className="flex flex-col gap-3">
      {/* fases com status/agent/custo (mesma linguagem do MissionDock) */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="label-mono">Missão · fases</span>
          <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
            {fmtCost(view.costTotal)}
            {view.maxCostUsd != null && ` / teto ${fmtCost(view.maxCostUsd)}`}
          </span>
        </div>
        <div className="rounded-lg border bg-secondary/30 px-2 py-1">
          {view.phases.map((ph, i) => (
            <PhaseRow key={`${ph.label}-${i}`} phase={ph} index={i} />
          ))}
        </div>
      </div>

      {/* atividade AO VIVO da fase corrente (gate pendente ⇒ o card assume) */}
      {!gate && (
        <div className="overflow-hidden rounded-lg border border-st-running/25 bg-st-running/[0.04]">
          <div className="flex items-center gap-2 px-2.5 py-2">
            <span className="size-1.5 shrink-0 rounded-full bg-st-running motion-safe:animate-pulse" />
            <span className="min-w-0 truncate text-[12px] font-medium text-foreground">
              {curAgent ? agentLabel(curAgent) : "Fase corrente"}
            </span>
            {view.startedAt != null && (
              <span className="ml-auto shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">
                <ElapsedSince since={view.startedAt} />
              </span>
            )}
          </div>
          {view.steps.length > 0 && (
            <div className="px-2.5 pb-2">
              {view.steps.map((s, i) => (
                <div key={i} className="flex items-center gap-2 py-[3px]">
                  <StepDot done={s.done} />
                  <span
                    className={cn(
                      "min-w-0 truncate font-mono text-[11px]",
                      s.done ? "text-foreground/60" : "text-foreground",
                    )}
                  >
                    {s.label}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2 border-t border-border px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
            <span className="min-w-0 truncate">
              Agora: <span className="text-foreground">{view.now}</span>
            </span>
          </div>
        </div>
      )}

      {gate && (
        <GateCard gate={gate} convId={view.convId} onAnswer={onAnswerGate} />
      )}

      <div className="flex items-center gap-2">
        {onOpenTable && (
          <button
            type="button"
            onClick={onOpenTable}
            className="flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[12px] text-foreground transition-colors hover:bg-secondary"
          >
            <Rocket className="size-3.5 shrink-0 text-brass" />
            <span className="truncate">Abrir na mesa de reunião</span>
          </button>
        )}
        <button
          type="button"
          title="Parar a missão"
          onClick={onStop}
          className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-[12px] text-st-error transition-colors hover:bg-secondary"
        >
          <Square className="size-3" />
          Parar
        </button>
      </div>
    </div>
  )
}
