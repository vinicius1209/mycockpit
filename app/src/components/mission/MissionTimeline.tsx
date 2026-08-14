// Modo Missão — "plano de voo" (mock A aprovado). A missão TOMA a área (o
// ChatPanel suprime o empty state quando há missão), não é mais um card solto.
// 3 estados: rodando (fase corrente expande com atividade AO VIVO), concluída
// (resumo + custos, card recolhível), erro/abortada. O gate humano
// ("precisa de você") entra na onda 2 (precisa pausar o runner).
import { useEffect, useState, type ReactNode } from "react"
import { FolderOpen, Rocket, X } from "lucide-react"
import { useMission } from "@/store/mission"
import { useActiveProject, useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { MissionFilesDialog } from "@/components/mission/MissionFilesDialog"
import { PhaseLive } from "@/components/mission/PhaseLive"
import { PhaseReceiptBlock } from "@/components/mission/PhaseReceipt"
import { HoldCard } from "@/components/mission/HoldCard"
import { DoneSummary } from "@/components/mission/DoneSummary"
import { GateCard } from "@/components/mission/GateCard"
import { RecoveryCard } from "@/components/mission/RecoveryCard"
import {
  phaseProvenance,
  planCounts,
  planGrowthNote,
  type MissionPhaseRun,
  type MissionRun,
} from "@/lib/missionTypes"
import type { InteractionRequest } from "@/lib/interaction"
import { useContextualSplit } from "@/store/interactions"
import { agentDef } from "@/lib/agents"
import { fmtCost, fmtDuration, fmtTime } from "@/lib/format"
import { fmtMissionCost, missionCostState, phaseCostState } from "@/lib/missionCost"
import { queuedGranularityNote } from "@/lib/missionQuiet"
import { stopPrice } from "@/lib/missionGestures"
import { missionRuler, missionWindow } from "@/lib/missionWindow"
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

/** Marca de PROCEDÊNCIA: tipografia, não tinta (mono 11, borda tracejada,
 *  cinza). Cor é para estado e decisão; procedência não é nem uma nem outra, e
 *  um plano longo gastaria o orçamento de tinta inteiro se cada qualificador de
 *  fase pedisse a sua. */
function ProvenanceMark({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-dashed border-border-strong px-1.5 py-px font-mono text-[11px] whitespace-nowrap text-muted-foreground">
      {children}
    </span>
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

/** Uma fase como estação no plano de voo (nó na espinha + linha). */
function PhaseNode({
  p,
  active,
  last,
  now,
  index,
  cwd,
  dir,
  receiptOpen,
  onToggleReceipt,
  interactions,
  holdRequested,
  onToggleHold,
  onInterrupt,
}: {
  p: MissionPhaseRun
  active: boolean
  last: boolean
  /** O agora, injetado: um relógio vivo só na tela (B2.2). */
  now: number
  /** Índice da fase no plano (o handoff dela é nomeado por ele). */
  index: number
  /** Worktree da missão (o aviso de repetição pergunta a ele). */
  cwd: string
  /** Pasta da missão sob o cwd (onde moram os handoffs). */
  dir: string
  receiptOpen?: boolean
  onToggleReceipt?: () => void
  /** Interações contextuais desta conversa, permissão ou pergunta (só a fase
   *  corrente recebe). */
  interactions?: InteractionRequest[]
  holdRequested?: boolean
  onToggleHold?: (on: boolean) => void
  onInterrupt?: () => void
}) {
  const nodeState =
    p.status === "done"
      ? "done"
      : p.status === "error" || p.status === "aborted"
        ? "error"
        : active && p.status === "running"
          ? "run"
          : "pending"
  // procedência: esta fase entrou DEPOIS da decolagem (o revisor reprovou e o
  // motor acrescentou a correção). Sem a marca ela pareceria nativa do plano.
  const born = phaseProvenance(p.def)
  const cost = phaseCostState(p)
  const fechada =
    p.status === "done" || p.status === "error" || p.status === "aborted"
  // R4/Warp R1 — o cronômetro pertence à fase CORRENTE e congela no fim; ele é
  // IRMÃO do que anima (fora do elemento com pulse), `tabular-nums` e largura
  // reservada, e quem cede na disputa por espaço é o NOME.
  const elapsed =
    p.startedAt != null
      ? Math.max(0, (p.endedAt ?? (active ? now : p.startedAt)) - p.startedAt)
      : null
  // a fase NA FILA declara o que o motor dela consegue reportar, antes de
  // rodar: assim a quietude vira contrato em vez de virar bug.
  const granularity =
    p.status === "queued" ? queuedGranularityNote(p.def.agent) : null
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
        {/* IDENTIDADE UMA VEZ POR CONTEXTO (ADR-037): motor e modelo são
            escritos AQUI e em lugar nenhum abaixo. O "Claude · Claude · Opus 5"
            do build 193 saía do bloco vivo, que repetia o shortLabel antes do
            phaseAgentModel; agora nenhuma linha filha fala de motor. */}
        <span className="shrink-0 text-[14px] font-semibold">{p.def.label}</span>
        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
          {PERSONA_LABEL[p.def.persona]} · {phaseAgentModel(p.def)}
          {granularity ? ` · ${granularity}` : ""}
        </span>
        {born && (
          <ProvenanceMark>
            {born.at
              ? `acrescentada no voo às ${fmtTime(born.at)}`
              : "acrescentada no voo"}
          </ProvenanceMark>
        )}
        {p.attempt > 1 && (
          <span className="rounded border border-brass/40 px-1 py-px text-[11px] tracking-wide text-brass uppercase">
            tentativa {p.attempt}/{p.def.maxRetries}
          </span>
        )}
        {/* R3 — três estados e nenhum é zero: o número medido, "não mede" com
            o motivo, ou "—" com o momento em que fecha. Quem decide é a
            capability do motor (lib/missionCost), nunca o nome dele. */}
        <span
          className="ml-auto shrink-0 font-mono text-[12px] tabular-nums"
          title={cost.hint ?? undefined}
        >
          {cost.kind === "medido" ? (
            <span className="font-semibold text-brass">{cost.value}</span>
          ) : (
            <span className="text-muted-foreground">{cost.value}</span>
          )}
        </span>
        {elapsed != null && elapsed >= 1000 && (
          <span className="w-16 shrink-0 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
            {fmtDuration(elapsed)}
          </span>
        )}
        {p.status === "queued" && (
          <span className="shrink-0 text-[11px] text-faint">na fila</span>
        )}
      </div>
      {p.error && (p.status === "error" || p.status === "aborted") && (
        <p className="mt-1 text-[12px] leading-snug text-st-error">{p.error}</p>
      )}
      {/* R6 — a fase concluída ABRE e mostra o que fez (ações, arquivos,
          duração, custo) e o que DECIDIU. Antes daqui saía só o custo. */}
      {fechada && (
        <PhaseReceiptBlock
          phase={p}
          index={index}
          cwd={cwd}
          dir={dir}
          open={Boolean(receiptOpen)}
          onToggle={onToggleReceipt ?? (() => {})}
        />
      )}
      {nodeState === "run" && (
        <PhaseLive
          phase={p}
          now={now}
          cwd={cwd}
          interactions={interactions}
          holdRequested={holdRequested}
          onToggleHold={onToggleHold}
          onInterrupt={onInterrupt}
        />
      )}
      {!last && <span className="sr-only">↓</span>}
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
  // o plano persistido pode ter crescido antes do crash: o card diz "3/6" de
  // uma missão que decolou com 4, e quem for retomar precisa saber disso aqui,
  // não depois de relançar.
  const growth = planGrowthNote(planCounts(st.preset.phases))
  return (
    <div className="mx-auto w-full max-w-[760px] px-8 pt-6">
      <div className="overflow-hidden rounded-xl border-[1.5px] border-brass/45 bg-brass/[0.04] shadow-[0_0_0_3px_var(--brass-soft)]">
        <div className="flex items-center gap-2.5 border-b border-brass/20 px-4 py-3">
          <Rocket className="size-4 shrink-0 text-brass" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13px] font-semibold">
                Missão interrompida na fase {cur + 1}/{n} · {phaseLabel}
              </span>
              {growth && <ProvenanceMark>{growth}</ProvenanceMark>}
            </div>
            <div className="text-[12px] text-muted-foreground">
              O app fechou com a missão em voo, e o worktree e os handoffs
              continuam no disco ({fmtCost(st.costTotal)} já gastos)
            </div>
          </div>
        </div>
        {st.task && (
          <p className="line-clamp-2 px-4 pt-3 text-[13px] leading-relaxed text-muted-foreground">
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
            className="rounded-lg border border-border-strong px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-st-error/50 hover:text-st-error"
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
  const resolveRecovery = useMission((s) => s.resolveRecovery)
  const abortRecovery = useMission((s) => s.abortRecovery)
  const holdAfterPhase = useMission((s) => s.holdAfterPhase)
  const interruptPhase = useMission((s) => s.interruptPhase)
  const releaseHold = useMission((s) => s.releaseHold)
  // cwd pro viewer de arquivos: worktree da conversa, senão a pasta do projeto.
  const conv = useChat((s) => s.byId[convId])
  const projects = useApp((s) => s.projects)
  const [filesOpen, setFilesOpen] = useState(false)
  // R9 — fases que VOCÊ abriu à mão são a quarta exceção que nunca recolhe.
  // Vive na UI (é preferência de leitura), não no run.
  const [manuallyOpen, setManuallyOpen] = useState<ReadonlySet<number>>(
    () => new Set(),
  )
  // Interações contextuais: pedidos pendentes DESTA conversa (a visível), de
  // permissão ou de pergunta — renderizam dentro do bloco da fase corrente (o
  // toast global os suprime).
  // UM relógio vivo na tela (B2.2): ele nasce aqui e desce por prop pra fase
  // corrente. Nenhum filho monta interval próprio, e o interval só existe
  // enquanto a missão roda (missão fechada não tica nada).
  const now = useNow(
    useMission((s) => s.byConv[convId]?.status === "running") ?? false,
  )
  const split = useContextualSplit()
  const inlineReqs = split.inlineConvId === convId ? split.inline : []
  if (!mission) return null

  const cwd =
    conv?.worktreePath ??
    projects.find((p) => p.id === conv?.projectId)?.path ??
    ""
  const missionSlug = mission.dir.slice(mission.dir.lastIndexOf("/") + 1)

  const gated = mission.status === "running" && mission.gate != null
  const running = mission.status === "running"
  // MH1.3 — a pausa por limite recuperável agora tem cara no Trabalho (antes
  // só o Escritório mostrava; aqui a missão parecia rodando pra sempre).
  const inRecovery = running && mission.recovery != null
  // segurando: nada roda agora, e "em voo" mentiria (estado real, nunca teatro).
  const held = running && mission.hold != null
  const n = mission.phases.length
  const cur = Math.min(mission.current, n - 1)
  // O denominador CRESCE em voo (o revisor reprova, o motor acrescenta a
  // correção), e o crescimento é correto. O que não pode é trocar calado: o
  // contador passa a carregar os dois números, com o de lançamento ao lado.
  const growth = planGrowthNote(planCounts(mission.phases.map((p) => p.def)))
  const total = missionCostState(mission.costTotal, mission.phases)
  const ruler = missionRuler(mission)
  // A JANELA VIVA: com 3 fases ela cobre o plano inteiro e nenhum stub aparece;
  // com 12, é ela que impede a fase viva de sair da tela.
  const rows = missionWindow(mission.phases, cur, {
    holdPhase: mission.hold?.phase ?? null,
    manuallyOpen,
  })
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

  /** Uma fase da janela + os cartões que pertencem a ELA (segurando, gate,
   *  recuperação). Extraído do map porque agora quem decide QUEM aparece é a
   *  janela viva (lib/missionWindow), não a lista inteira. */
  const renderFase = (p: MissionPhaseRun, i: number) => (
          <div key={p.def.id}>
            <PhaseNode
              p={p}
              active={running && !gated && i === cur}
              last={i === n - 1}
              now={now}
              index={i}
              cwd={cwd}
              dir={mission.dir}
              receiptOpen={manuallyOpen.has(i)}
              onToggleReceipt={() =>
                setManuallyOpen((prev) => {
                  const next = new Set(prev)
                  if (next.has(i)) next.delete(i)
                  else next.add(i)
                  return next
                })
              }
              holdRequested={
                running && !gated && i === cur
                  ? mission.hold?.reason === "pedido"
                  : undefined
              }
              onToggleHold={
                running && !gated && i === cur
                  ? (on) => holdAfterPhase(convId, on)
                  : undefined
              }
              onInterrupt={
                running && !gated && i === cur && !mission.hold
                  ? () => interruptPhase(convId)
                  : undefined
              }
              interactions={
                running && !gated && i === cur ? inlineReqs : undefined
              }
            />
            {inRecovery && mission.recovery!.phase === i && (
              <div className="relative mb-4">
                <span className="absolute top-[11px] -left-[28px] z-[1] size-3.5 animate-cockpit-pulse rounded-full border-2 border-st-warning bg-st-warning shadow-[0_0_0_4px_color-mix(in_srgb,var(--st-warning)_20%,transparent)]" />
                <div className="flex items-center gap-2.5">
                  <span className="text-[14px] font-semibold text-st-warning">
                    Precisa de você
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    a fase {i + 1} parou por limite
                  </span>
                </div>
                <RecoveryCard
                  convId={convId}
                  recovery={mission.recovery!}
                  failedAgent={p.def.agent}
                  onResolve={resolveRecovery}
                  onAbort={abortRecovery}
                />
              </div>
            )}
            {running && mission.hold?.phase === i && (
              <HoldCard
                reason={mission.hold.reason}
                phaseNumber={i + 1}
                nextLabel={mission.phases[i + 1]?.def.label ?? null}
                price={stopPrice({ current: i, total: n, costLabel: total.value })}
                onRelease={() => releaseHold(convId)}
              />
            )}
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
  )

  return (
    <div className="mx-auto w-full max-w-[760px] px-8 pt-6 pb-4">
      {/* cabeçalho: estado + tarefa + medidor de combustível */}
      <div className="flex flex-wrap items-start gap-x-5 gap-y-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-[11px] tracking-wide uppercase",
                held
                  ? "bg-st-warning/15 text-st-warning"
                  : gated
                  ? "bg-brass-soft text-brass"
                  : inRecovery
                    ? "bg-st-warning/15 text-st-warning"
                    : running
                      ? "bg-st-running/15 text-st-running"
                      : mission.status === "done"
                        ? mission.reviewCaveat
                          ? "bg-st-warning/15 text-st-warning"
                          : "bg-st-success/15 text-st-success"
                        : "bg-st-error/15 text-st-error",
              )}
            >
              {held ? (
                <>
                  <span className="size-1.5 rounded-full bg-st-warning" />
                  segurando · fase {Math.min(mission.current + 1, n)}/{n}
                </>
              ) : gated ? (
                <>
                  <span className="animate-cockpit-pulse size-1.5 rounded-full bg-brass" />
                  pausada · precisa de você
                </>
              ) : inRecovery ? (
                <>
                  <span className="animate-cockpit-pulse size-1.5 rounded-full bg-st-warning" />
                  pausada · limite na fase {Math.min(mission.current + 1, n)}/{n}
                </>
              ) : running ? (
                <>
                  <span className="animate-cockpit-pulse size-1.5 rounded-full bg-st-running" />
                  em voo · fase {Math.min(mission.current + 1, n)}/{n}
                </>
              ) : mission.status === "done" ? (
                mission.reviewCaveat ? "✓ concluída com ressalva" : "✓ concluída"
              ) : (
                mission.status === "error" ? "falhou" : "abortada"
              )}
            </span>
            {/* o denominador não muda calado: quando o plano cresceu no voo, o
                número de lançamento fica ao lado do de agora */}
            {growth && <ProvenanceMark>{growth}</ProvenanceMark>}
          </div>
          <h2 className="mt-1.5 flex items-center gap-2 text-[14px] font-semibold tracking-[-0.01em]">
            <Rocket className="size-4 shrink-0 text-brass" />
            Missão · {mission.presetName}
          </h2>
          {mission.task && (
            <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-muted-foreground">
              {mission.task}
            </p>
          )}
          {/* Ver arquivos: abre o plano/relatórios/handoffs DESTA missão no app
              (conserta o "concern 2" — não manda mais abrir arquivo gitignorado). */}
          {cwd && (
            <button
              onClick={() => setFilesOpen(true)}
              className="mt-2 flex items-center gap-1.5 rounded-md border border-border/60 px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
              title="Ver plano, relatórios e handoffs desta missão"
            >
              <FolderOpen className="size-3 text-brass" />
              Ver arquivos
            </button>
          )}
        </div>
        <div className="w-[220px] shrink-0">
          <div className="label-mono">
            {pct != null ? "Combustível · teto" : "Custo"}
          </div>
          <div className="mt-1 flex items-baseline justify-between">
            <span
              className={cn(
                "font-mono text-[20px] font-semibold tabular-nums",
                total.kind === "medido" ? "" : "text-muted-foreground",
              )}
            >
              {total.value}
            </span>
            {mission.maxCostUsd != null && (
              <span className="font-mono text-[11px] text-muted-foreground">
                / {fmtMissionCost(mission.maxCostUsd)}
              </span>
            )}
          </div>
          {/* a cobertura na cara: somar 5 fases e apresentar como 6 é a mesma
              ficção do zero, só que agregada */}
          {total.hint && (
            <div className="mt-1 text-[11px] leading-snug text-faint">
              {total.hint}
            </div>
          )}
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
            className="shrink-0 rounded-lg border border-border-strong px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-st-error/50 hover:text-st-error"
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

      {/* R8 — A RÉGUA: uma linha que NÃO rola, com a posição, o denominador
          declarado e o que vem a seguir. É a única concessão à tese do painel
          de voo, e é uma linha: sem estações, sem seleção e SEM barra de
          percentual (uma barra que recua sozinha, de 60% pra 50% quando duas
          fases foram apendadas, é pior que não ter barra). Só aparece em voo,
          que é quando "onde estou" é pergunta. */}
      {running && (
        <div className="sticky top-0 z-[5] -mx-8 mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b border-border bg-background/90 px-8 py-2 text-[12px] text-muted-foreground backdrop-blur">
          <span className="font-mono text-[13px] font-semibold tabular-nums text-foreground">
            {ruler.position}
          </span>
          {ruler.launched && (
            <ProvenanceMark>{ruler.launched}</ProvenanceMark>
          )}
          {ruler.next && (
            <span className="min-w-0 truncate">{ruler.next}</span>
          )}
          {ruler.queued && (
            <span className="shrink-0 font-mono text-[11px] tabular-nums text-faint">
              {ruler.queued}
            </span>
          )}
        </div>
      )}

      {/* plano de voo (espinha vertical); o GATE entra como estação logo após
          a fase que deixou as perguntas */}
      <div className="relative mt-6 pl-[34px] before:absolute before:top-3.5 before:bottom-5 before:left-3 before:w-0.5 before:bg-border">
        {rows.map((row) =>
          row.kind === "stub" ? (
            // R9 — o stub É um recibo, não uma contagem, e declara o que
            // engoliu. Clicar abre as fases que ele cobre (nenhuma some).
            <div key={`stub-${row.side}-${row.indexes[0]}`} className="relative mb-4">
              <span className="absolute top-[9px] -left-[26px] z-[1] size-2.5 rounded-full border border-border-strong bg-background" />
              <button
                type="button"
                onClick={() =>
                  setManuallyOpen((prev) => {
                    const next = new Set(prev)
                    for (const i of row.indexes) next.add(i)
                    return next
                  })
                }
                className="flex w-full min-w-0 items-center gap-2.5 text-left"
              >
                <span className="shrink-0 text-[13px] font-medium text-muted-foreground">
                  {row.label}
                </span>
                {row.declares && (
                  <span className="min-w-0 truncate font-mono text-[11px] tabular-nums text-faint">
                    {row.declares}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-[11px] text-faint underline decoration-border-strong underline-offset-2">
                  mostrar
                </span>
              </button>
            </div>
          ) : (
            renderFase(mission.phases[row.index], row.index)
          ),
        )}
      </div>

      {!running && <DoneSummary mission={mission} />}

      {cwd && (
        <MissionFilesDialog
          open={filesOpen}
          onOpenChange={setFilesOpen}
          cwd={cwd}
          dir={mission.dir}
          slug={missionSlug}
        />
      )}
    </div>
  )
}
