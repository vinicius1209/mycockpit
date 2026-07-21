// Modo Missão — "plano de voo" (mock A aprovado). A missão TOMA a área (o
// ChatPanel suprime o empty state quando há missão), não é mais um card solto.
// 3 estados: rodando (fase corrente expande com atividade AO VIVO), concluída
// (resumo + custos, card recolhível), erro/abortada. O gate humano
// ("precisa de você") entra na onda 2 (precisa pausar o runner).
import { useEffect, useMemo, useState } from "react"
import { Check, Rocket, X } from "lucide-react"
import { useMission } from "@/store/mission"
import { useActiveProject } from "@/store/app"
import type { ChatItem } from "@/store/chat"
import type {
  GateAnswer,
  MissionPhaseRun,
  MissionRun,
} from "@/lib/missionTypes"
import type { InteractionRequest } from "@/lib/interaction"
import { useContextualSplit } from "@/store/interactions"
import { agentCaps, agentDef } from "@/lib/agents"
import { GateAnswerForm } from "@/components/mission/GateAnswerForm"
import { InteractionCard } from "@/components/chat/InteractionHost"
import { MicButton } from "@/components/chat/MicButton"
import { fmtCost, fmtDuration } from "@/lib/format"
import { presentTool } from "@/lib/toolview"
import { Markdown } from "@/components/common/Markdown"
import { cn } from "@/lib/utils"

const PERSONA_LABEL: Record<string, string> = {
  planner: "planejador",
  executor: "executor",
  reviewer: "revisor",
}

/** "Claude · Opus" — agent (shortLabel) + modelo. null = default (não inventa). */
export function phaseAgentModel(def: MissionPhaseRun["def"]): string {
  const a = agentDef(def.agent)
  const agent = a?.shortLabel ?? def.agent
  if (!def.model) return agent
  const model = a?.models.find((m) => m.value === def.model)?.label ?? def.model
  return `${agent} · ${model}`
}

/** Cronômetro vivo (só liga o interval quando ativo). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

/** Deriva a atividade AO VIVO de uma fase a partir dos itens (stream reduzido):
 *  os últimos tool steps + uma linha "Agora:…" do que está acontecendo. */
function phaseActivity(items: ChatItem[] | undefined) {
  const tools = (items ?? []).filter(
    (i): i is Extract<ChatItem, { kind: "tool" }> => i.kind === "tool",
  )
  const last = items?.[items.length - 1]
  let now = "preparando…"
  if (last?.kind === "tool") now = presentTool(last.name, last.input).label
  else if (last?.kind === "text") now = "redigindo resposta…"
  else if (tools.length > 0) now = "trabalhando…"
  return { tools, now }
}

/** Último texto significativo de uma fase (o resumo/veredito do agent). */
function lastText(phase: MissionPhaseRun | undefined): string | null {
  const items = phase?.items ?? []
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if ((it.kind === "text" || it.kind === "result") && it.text?.trim()) {
      return it.text
    }
  }
  return null
}

function StepDot({ status }: { status: "ok" | "run" | "pending" }) {
  return (
    <span
      className={cn(
        "size-2.5 shrink-0 rounded-full",
        status === "ok" && "bg-st-success",
        status === "run" &&
          "animate-cockpit-pulse bg-st-running shadow-[0_0_0_3px_color-mix(in_srgb,var(--st-running)_22%,transparent)]",
        status === "pending" && "border-[1.5px] border-muted-foreground/40",
      )}
    />
  )
}

/** A timeline hospeda o card inline das aprovações contextuais quando o bloco
 *  da fase corrente (LiveActivity) está na tela: missão rodando, sem gate e a
 *  fase corrente de fato running. Fora disso (gate/recovery/done) o ChatPanel
 *  renderiza o card acima do composer — mesma régua nos dois lados. */
export function missionHostsInline(m: MissionRun | undefined | null): boolean {
  if (!m || m.status !== "running" || m.gate) return false
  const cur = m.phases[Math.min(m.current, m.phases.length - 1)]
  return cur?.status === "running"
}

/** Atividade ao vivo da fase corrente: header (agent + cronômetro), scan e os
 *  últimos passos + "Agora:…". O dado JÁ existe no store (onProgress).
 *  `interactions` = pedidos pendentes DESTA conversa (aprovações contextuais):
 *  o card entra AQUI, junto da cena que ele interrompeu — acima do "Agora:". */
function LiveActivity({
  phase,
  interactions,
}: {
  phase: MissionPhaseRun
  interactions?: InteractionRequest[]
}) {
  const now = useNow(true)
  const { tools, now: nowLabel } = phaseActivity(phase.items)
  const elapsed = phase.startedAt ? now - phase.startedAt : 0
  const shown = tools.slice(-4)
  return (
    <div className="mt-2.5 overflow-hidden rounded-[11px] border border-st-running/25 bg-st-running/[0.04]">
      <div className="flex items-center gap-2 px-3.5 py-2.5">
        <span className="animate-cockpit-pulse size-2 shrink-0 rounded-full bg-st-running" />
        <span className="text-[12.5px] font-medium">
          {agentDef(phase.def.agent)?.shortLabel ?? phase.def.agent}
          <span className="ml-1.5 font-mono text-[11px] font-normal text-muted-foreground">
            {phaseAgentModel(phase.def)}
          </span>
        </span>
        <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
          {fmtDuration(elapsed)}
        </span>
      </div>
      <div className="tray-telemetry mx-3.5">
        <span />
      </div>
      {shown.length > 0 && (
        <div className="px-3.5 py-2">
          {shown.map((t) => {
            const p = presentTool(t.name, t.input)
            const done = t.result != null
            return (
              <div
                key={t.id}
                className="grid grid-cols-[14px_1fr] items-center gap-2.5 py-[3px]"
              >
                <span className="grid place-items-center">
                  <StepDot status={done ? "ok" : "run"} />
                </span>
                <span
                  className={cn(
                    "truncate font-mono text-[11px]",
                    done ? "text-foreground/60" : "text-foreground",
                  )}
                >
                  {p.label}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {/* Aprovação contextual: o pedido pausou ESTA fase — o card mora na cena
          (FIFO, um por vez), não num toast desconectado no canto. */}
      {interactions && interactions.length > 0 && (
        <div className="px-3.5 pt-2">
          <InteractionCard
            key={interactions[0].id}
            req={interactions[0]}
            extra={interactions.length - 1}
          />
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-border px-3.5 py-2 text-[12px] text-muted-foreground">
        <span className="animate-cockpit-pulse size-1.5 shrink-0 rounded-full bg-st-running" />
        <span className="min-w-0 truncate">
          Agora: <span className="text-foreground">{nowLabel}</span>
        </span>
      </div>
    </div>
  )
}

/** GATE — precisa de você: a missão pausou com as perguntas da fase anterior.
 *  Card RICO inline (a coluna do Trabalho é larga): textarea auto-grow + ditado
 *  (MicButton/stt) + anexos por resposta, via GateAnswerForm compartilhado com
 *  o dock do Escritório. "Continuar" retoma o pipeline injetando as respostas
 *  (texto → diretriz; anexos → runPhase da próxima fase). */
function GateCard({
  convId,
  questions,
  nextAgent,
  onContinue,
}: {
  convId: string
  questions: string[]
  /** Agent da PRÓXIMA fase — destino dos anexos (aviso visual de capacidade). */
  nextAgent: string | null
  onContinue: (answers: GateAnswer[]) => void
}) {
  return (
    <div className="mt-2.5 overflow-hidden rounded-xl border-[1.5px] border-brass/45 bg-brass/[0.04] shadow-[0_0_0_3px_var(--brass-soft)]">
      <div className="flex items-center gap-2.5 border-b border-brass/20 px-4 py-3">
        <span className="animate-cockpit-pulse size-2 shrink-0 rounded-full bg-brass" />
        <div className="min-w-0">
          <div className="text-[13px] font-semibold">
            {questions.length === 1
              ? "O agente tem 1 pergunta"
              : `O agente tem ${questions.length} perguntas`}
          </div>
          <div className="text-[11.5px] text-muted-foreground">
            A missão está pausada — responda pra continuar (em branco = o
            agente decide)
          </div>
        </div>
      </div>
      <GateAnswerForm
        convId={convId}
        questions={questions}
        caps={agentCaps(nextAgent ?? "")}
        destLabel={
          nextAgent
            ? (agentDef(nextAgent)?.label ?? nextAgent)
            : "o próximo agent"
        }
        submitLabel="Continuar missão →"
        renderMic={(insert) => <MicButton onText={insert} />}
        onSubmit={onContinue}
      />
    </div>
  )
}

/** Uma fase como estação no plano de voo (nó na espinha + linha). */
function PhaseNode({
  p,
  active,
  last,
  interactions,
}: {
  p: MissionPhaseRun
  active: boolean
  last: boolean
  /** Aprovações contextuais desta conversa (só a fase corrente recebe). */
  interactions?: InteractionRequest[]
}) {
  const nodeState =
    p.status === "done"
      ? "done"
      : p.status === "error" || p.status === "aborted"
        ? "error"
        : active && p.status === "running"
          ? "run"
          : "pending"
  return (
    <div className="relative mb-4 last:mb-0">
      {/* nó */}
      <span
        className={cn(
          "absolute top-[11px] -left-[28px] z-[1] size-3.5 rounded-full border-2 bg-card",
          nodeState === "done" && "border-st-success bg-st-success",
          nodeState === "run" &&
            "border-st-running bg-st-running shadow-[0_0_0_4px_color-mix(in_srgb,var(--st-running)_20%,transparent)]",
          nodeState === "error" && "border-st-error bg-st-error",
          nodeState === "pending" && "border-border-strong",
        )}
      />
      <div className={cn("flex items-center gap-2.5", nodeState === "pending" && "opacity-50")}>
        <span className="text-[14px] font-semibold">{p.def.label}</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {PERSONA_LABEL[p.def.persona]} · {phaseAgentModel(p.def)}
        </span>
        {p.attempt > 1 && (
          <span className="rounded border border-brass/40 px-1 py-px text-[10px] tracking-wide text-brass uppercase">
            tentativa {p.attempt}/{p.def.maxRetries}
          </span>
        )}
        <span className="ml-auto font-mono text-[12px] tabular-nums">
          {p.costUsd > 0 ? (
            <span className="font-semibold text-brass">{fmtCost(p.costUsd)}</span>
          ) : p.status === "queued" ? (
            <span className="text-muted-foreground">na fila</span>
          ) : null}
        </span>
      </div>
      {p.error && (p.status === "error" || p.status === "aborted") && (
        <p className="mt-1 text-[12px] leading-snug text-st-error">{p.error}</p>
      )}
      {nodeState === "run" && (
        <LiveActivity phase={p} interactions={interactions} />
      )}
      {!last && <span className="sr-only">↓</span>}
    </div>
  )
}

/** Resumo da conclusão: veredito (texto final da última fase) + ações genéricas.
 *  O entregável NÃO é sempre um app — a ação primária é "ver as mudanças", não
 *  "abrir a entrega" (obs. do Vinícius). Resumo estruturado (open questions,
 *  como testar) vem na onda 2, lendo os handoffs. */
function DoneSummary({ mission }: { mission: MissionRun }) {
  const verdict = useMemo(() => {
    for (let i = mission.phases.length - 1; i >= 0; i--) {
      const t = lastText(mission.phases[i])
      if (t) return t
    }
    return null
  }, [mission.phases])
  const ok = mission.status === "done"
  return (
    <div className="mt-4 overflow-hidden rounded-xl border bg-card">
      <div
        className={cn(
          "flex items-center gap-2.5 border-b px-4 py-3",
          ok ? "bg-st-success/[0.05]" : "bg-st-error/[0.05]",
        )}
      >
        {ok ? (
          <Check className="size-4 shrink-0 text-st-success" />
        ) : (
          <X className="size-4 shrink-0 text-st-error" />
        )}
        <span
          className={cn(
            "text-[13px] font-semibold",
            ok ? "text-st-success" : "text-st-error",
          )}
        >
          {ok ? "Missão concluída" : "Missão interrompida"}
        </span>
        <span className="ml-auto font-mono text-[11.5px] tabular-nums text-muted-foreground">
          {mission.phases.length} fases · {fmtCost(mission.costTotal)}
        </span>
      </div>
      {verdict ? (
        <div className="px-4 py-3">
          <div className="label-mono mb-1.5 text-[9.5px]">Resumo do revisor</div>
          <div className="max-h-72 overflow-y-auto text-[13px] leading-relaxed">
            <Markdown text={verdict} />
          </div>
        </div>
      ) : mission.doneSummary?.intent ? (
        <div className="px-4 py-3">
          <div className="label-mono mb-1.5 text-[9.5px]">O que foi feito</div>
          <p className="text-[13px] leading-relaxed">
            {mission.doneSummary.intent}
          </p>
        </div>
      ) : (
        <p className="px-4 py-3 text-[12.5px] text-muted-foreground">
          As mudanças estão no projeto. Continue a conversa abaixo pra pedir o
          resumo, testar ou seguir de onde parou.
        </p>
      )}
      {mission.doneSummary?.filesTouched &&
        mission.doneSummary.filesTouched.length > 0 && (
          <div className="border-t px-4 py-3">
            <div className="label-mono mb-1.5 text-[9.5px]">Arquivos</div>
            <div className="flex flex-wrap gap-1.5">
              {mission.doneSummary.filesTouched.slice(0, 8).map((f) => (
                <code
                  key={f}
                  className="rounded bg-accent px-1.5 py-0.5 font-mono text-[10.5px]"
                >
                  {f}
                </code>
              ))}
              {mission.doneSummary.filesTouched.length > 8 && (
                <code className="rounded bg-accent px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                  +{mission.doneSummary.filesTouched.length - 8}
                </code>
              )}
            </div>
          </div>
        )}
      {mission.doneSummary?.openQuestions &&
        mission.doneSummary.openQuestions.length > 0 && (
          <div className="border-t px-4 py-3">
            <div className="label-mono mb-1.5 text-[9.5px]">
              Pendências pra próxima etapa
            </div>
            {mission.doneSummary.openQuestions.slice(0, 5).map((q, i) => (
              <div key={i} className="flex items-start gap-2 py-1 text-[12.5px]">
                <span className="shrink-0 font-mono text-[11px] font-semibold text-brass">
                  {i + 1}
                </span>
                <span className="leading-relaxed">{q}</span>
              </div>
            ))}
          </div>
        )}
    </div>
  )
}

/** Card de RETOMADA (P1): o app fechou com uma missão em voo — o
 *  run-state.json do worktree ficou `running` e o boot detectou
 *  (useMission.detectInterrupted). Retomar relança da fase corrente (os
 *  handoffs .mission/ do disco reconstroem o contexto); Descartar marca o
 *  arquivo como abandoned (não re-oferece) e grava o marco na conversa.
 *  Renderiza null sem entrada detectada (o ChatPanel pode montar à vontade). */
export function MissionResumeCard({ convId }: { convId: string }) {
  const entry = useMission((s) => s.interrupted[convId])
  const resumeInterrupted = useMission((s) => s.resumeInterrupted)
  const discardInterrupted = useMission((s) => s.discardInterrupted)
  const project = useActiveProject()
  if (!entry || !project) return null
  const st = entry.state
  const n = st.preset.phases.length
  const cur = Math.min(Math.max(0, st.current), n - 1)
  const phaseLabel = st.preset.phases[cur]?.label ?? "?"
  return (
    <div className="mx-auto w-full max-w-[760px] px-8 pt-6">
      <div className="overflow-hidden rounded-xl border-[1.5px] border-brass/45 bg-brass/[0.04] shadow-[0_0_0_3px_var(--brass-soft)]">
        <div className="flex items-center gap-2.5 border-b border-brass/20 px-4 py-3">
          <Rocket className="size-4 shrink-0 text-brass" />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold">
              Missão interrompida na fase {cur + 1}/{n} · {phaseLabel}
            </div>
            <div className="text-[11.5px] text-muted-foreground">
              O app fechou com a missão em voo — o worktree e os handoffs
              continuam no disco ({fmtCost(st.costTotal)} já gastos)
            </div>
          </div>
        </div>
        {st.task && (
          <p className="line-clamp-2 px-4 pt-3 text-[12.5px] leading-relaxed text-muted-foreground">
            {st.task}
          </p>
        )}
        <div className="flex items-center gap-2 px-4 py-3">
          <button
            onClick={() =>
              resumeInterrupted(
                convId,
                project.id,
                project.path,
                project.permissionMode ?? "padrao",
              )
            }
            className="rounded-lg bg-brass px-3.5 py-1.5 text-[12px] font-semibold text-background transition-opacity hover:opacity-90"
          >
            Retomar missão →
          </button>
          <button
            onClick={() => void discardInterrupted(convId)}
            className="rounded-lg border border-border-strong px-3 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:border-st-error/50 hover:text-st-error"
          >
            Descartar
          </button>
        </div>
      </div>
    </div>
  )
}

/** Modo Missão no fio da conversa: cabeçalho (nome + estado + medidor de
 *  combustível + Parar/recolher) e o plano de voo. Renderiza null sem missão. */
export function MissionTimeline({ convId }: { convId: string }) {
  const mission = useMission((s) => s.byConv[convId])
  const abort = useMission((s) => s.abort)
  const clear = useMission((s) => s.clear)
  const answerGate = useMission((s) => s.answerGate)
  // Aprovações contextuais: pedidos pendentes DESTA conversa (a visível) —
  // renderizam dentro do bloco da fase corrente (o toast global os suprime).
  const split = useContextualSplit()
  const inlineReqs = split.inlineConvId === convId ? split.inline : []
  if (!mission) return null

  const gated = mission.status === "running" && mission.gate != null
  const running = mission.status === "running"
  const n = mission.phases.length
  const cur = Math.min(mission.current, n - 1)
  const pct =
    mission.maxCostUsd && mission.maxCostUsd > 0
      ? Math.min(100, (mission.costTotal / mission.maxCostUsd) * 100)
      : null
  // combustível: brass → queued (>70%) → error (>90%) — o teto é o "RISCO Nº1".
  const gaugeColor =
    pct == null || pct < 70
      ? "var(--brass)"
      : pct < 90
        ? "var(--st-queued)"
        : "var(--st-error)"

  return (
    <div className="mx-auto w-full max-w-[760px] px-8 pt-6 pb-4">
      {/* cabeçalho: estado + tarefa + medidor de combustível */}
      <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
        <div className="min-w-0 flex-1">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[9.5px] tracking-wide uppercase",
              gated
                ? "bg-brass-soft text-brass"
                : running
                  ? "bg-st-running/15 text-st-running"
                  : mission.status === "done"
                    ? "bg-st-success/15 text-st-success"
                    : "bg-st-error/15 text-st-error",
            )}
          >
            {gated ? (
              <>
                <span className="animate-cockpit-pulse size-1.5 rounded-full bg-brass" />
                pausada · precisa de você
              </>
            ) : running ? (
              <>
                <span className="animate-cockpit-pulse size-1.5 rounded-full bg-st-running" />
                em voo · fase {Math.min(mission.current + 1, n)}/{n}
              </>
            ) : mission.status === "done" ? (
              "✓ concluída"
            ) : (
              mission.status === "error" ? "falhou" : "abortada"
            )}
          </span>
          <h2 className="mt-1.5 flex items-center gap-2 text-[17px] font-semibold tracking-[-0.01em]">
            <Rocket className="size-4 shrink-0 text-brass" />
            Missão · {mission.presetName}
          </h2>
          {mission.task && (
            <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground">
              {mission.task}
            </p>
          )}
        </div>
        <div className="w-[220px] shrink-0">
          <div className="label-mono text-[9px]">
            {pct != null ? "Combustível · teto" : "Custo"}
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="font-mono text-[19px] font-semibold tabular-nums">
              {fmtCost(mission.costTotal)}
            </span>
            {mission.maxCostUsd != null && (
              <span className="font-mono text-[11px] text-muted-foreground">
                / {fmtCost(mission.maxCostUsd)}
              </span>
            )}
          </div>
          {pct != null && (
            <div className="mt-1.5 h-[7px] overflow-hidden rounded-full bg-[var(--track)]">
              <div
                className="h-full rounded-full transition-[width]"
                style={{ width: `${Math.max(3, pct)}%`, background: gaugeColor }}
              />
            </div>
          )}
        </div>
        {running ? (
          <button
            onClick={() => abort(convId)}
            className="shrink-0 rounded-lg border border-border-strong px-3 py-1.5 text-[11.5px] text-muted-foreground transition-colors hover:border-st-error/50 hover:text-st-error"
          >
            ■ Parar
          </button>
        ) : (
          <button
            onClick={() => clear(convId)}
            className="shrink-0 rounded p-1.5 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Recolher a missão"
            title="Recolher"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* plano de voo (espinha vertical); o GATE entra como estação logo após
          a fase que deixou as perguntas */}
      <div className="relative mt-6 pl-[34px] before:absolute before:top-3.5 before:bottom-5 before:left-3 before:w-0.5 before:bg-border">
        {mission.phases.map((p, i) => (
          <div key={p.def.id}>
            <PhaseNode
              p={p}
              active={running && !gated && i === cur}
              last={i === n - 1}
              interactions={
                running && !gated && i === cur ? inlineReqs : undefined
              }
            />
            {gated && mission.gate!.phase === i && (
              <div className="relative mb-4">
                <span className="absolute top-[11px] -left-[28px] z-[1] size-3.5 animate-cockpit-pulse rounded-full border-2 border-brass bg-brass shadow-[0_0_0_4px_var(--brass-soft)]" />
                <div className="flex items-center gap-2.5">
                  <span className="text-[14px] font-semibold text-brass">
                    Precisa de você
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {mission.gate!.questions.length}{" "}
                    {mission.gate!.questions.length === 1
                      ? "decisão pendente"
                      : "decisões pendentes"}
                  </span>
                </div>
                <GateCard
                  convId={convId}
                  questions={mission.gate!.questions}
                  nextAgent={
                    mission.phases[mission.gate!.phase + 1]?.def.agent ?? null
                  }
                  onContinue={(answers) => answerGate(convId, answers)}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {!running && <DoneSummary mission={mission} />}
    </div>
  )
}
