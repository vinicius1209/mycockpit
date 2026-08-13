// F4 — Painel (mission control): o centro de controle cross-projeto.
// Anatomia: (1) instrumento de frota (gasto hoje/7d/30d, sparkline, custo por
// agente); (2) AÇÕES — atalhos Nova missão/disputa/feature; (3) Board de
// intenção; (4) ENTREGAS — ledger discreto com o custo da semana; (5) FROTA
// (detalhe) — CLIs + versões + agendadas, seção compacta fixa no rodapé. No
// primeiro load, as entregas mostram skeleton; refreshes seguintes (30s)
// atualizam em silêncio.
//
// A fila "Precisam de você" SAIU daqui (ADR-040): ela virou a faixa do chrome
// (components/decisions/DecisionStrip), visível de qualquer superfície. Uma
// aba não compra visibilidade — no instante em que você troca pro Trabalho, a
// fila que mora numa aba deixa de existir.

import { useEffect, useMemo, useState } from "react"
import { Clock, FileText, Rocket, Swords } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useFusion } from "@/store/fusion"
import { useMission } from "@/store/mission"
import { useSchedules } from "@/store/schedules"
import { fmtUntilShort } from "@/lib/schedules"
import {
  engineLabel,
  seenAgo,
  sessionPlace,
  statusLabel,
  statusTone,
  useExternalSessions,
  visibleSessions,
} from "@/lib/externalSessions"
import {
  listRecentDeliveries,
  loadLedger,
  type LedgerEntry,
  type RecentDelivery,
} from "@/lib/db"
import {
  costByAgent,
  dailySpend,
  ledgerTokens,
  ledgerWindows,
} from "@/lib/panel"
import { updateAvailable } from "@/lib/detect"
import { BoardLane } from "@/components/panel/BoardLane"
import { fmtAgo, fmtCost, fmtTokens } from "@/lib/format"
import { CostAudit } from "@/components/panel/CostAudit"
import { cn } from "@/lib/utils"

/** Cor categórica por agente: Claude=brass, Codex=azul (st-running),
 *  Antigravity=violeta de identidade. O verde saiu daqui porque cor de
 *  identidade não pode colidir com o vocabulário de status (STYLEGUIDE §2). */
const AGENT_COLOR: Record<string, string> = {
  "claude-code": "var(--brass)",
  codex: "var(--st-running)",
  agy: "var(--id-violet)",
}
function agentColor(id: string): string {
  return AGENT_COLOR[id] ?? "var(--st-idle)"
}
function agentShort(id: string): string {
  return { "claude-code": "Claude Code", codex: "Codex", agy: "Antigravity" }[id] ?? id
}

/** Sparkline de barras do gasto diário (últimos N dias, hoje em brass). Não
 *  inventa porcentagem — é o gasto real por dia, escala pelo pico. */
function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data, 0.000001)
  return (
    <div className="flex h-11 items-end gap-[3px]" aria-hidden>
      {data.map((v, i) => (
        <span
          key={i}
          className={cn(
            "min-w-[3px] flex-1 rounded-t-[2px]",
            i === data.length - 1 ? "bg-brass" : "bg-muted-foreground/25",
          )}
          style={{ height: `${Math.max(6, (v / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}

/** Leitura de instrumento: micro-label mono + valor grande tabular. */
function Readout({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border/60 bg-card/30 px-3.5 py-2.5">
      <div className="label-mono">{label}</div>
      <div className="mt-1.5 font-mono text-[20px] font-semibold tabular-nums tracking-[-0.01em]">
        {children}
      </div>
    </div>
  )
}

/** Abre a conversa dona do objeto vivo (turno/missão/disputa) no Trabalho. */
async function openConv(projectId: string, convId: string) {
  const app = useApp.getState()
  app.setActiveProject(projectId)
  await useChat.getState().openProject(projectId)
  await useChat.getState().switchConversation(convId)
  app.setViewMode("linear")
}

const SEP = ","
const split = (key: string) => (key ? key.split(SEP) : [])

type LiveKind = "turno" | "missão" | "disputa"

interface LiveRow {
  convId: string
  projectId: string
  projectName: string
  title: string
  kind: LiveKind
}

/** CLIs da seção Frota (detalhe) — mesmos rótulos das Configurações ▸ Agents. */
const CLI_TOOLS: { id: string; label: string }[] = [
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "agy", label: "Antigravity" },
]

/** Título de uma seção do painel — mesmo label-mono das Sections do app. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="label-mono mb-1.5 px-1">{children}</h2>
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1 py-2 text-[13px] text-muted-foreground/80">
      {children}
    </p>
  )
}

/** Skeleton do primeiro load — linhas com pulse suave no lugar do conteúdo,
 *  pra fila/entregas não "pularem" na tela. Refreshes seguintes não passam
 *  por aqui (atualizam em silêncio). */
function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full bg-accent/40" />
      ))}
    </div>
  )
}

/** Atalho compacto e SEMPRE visível (ícone + label, ~36px) — os launchers
 *  do painel não somem mais quando a fila enche. */
function QuickAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="flex h-9 items-center gap-2 rounded-lg border border-border/70 bg-secondary/20 px-3 text-[13px] font-medium text-foreground transition-colors hover:border-brass/50 hover:bg-accent/40"
    >
      <Icon className="size-3.5 text-brass" />
      {label}
    </button>
  )
}

/** Dot de estado: o sinal do painel. */
function Dot({ tone }: { tone: "live" | "need" | "done" }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2 shrink-0 rounded-full",
        tone === "live" && "animate-cockpit-pulse bg-st-running",
        tone === "need" && "bg-st-warning",
        tone === "done" && "bg-st-success",
      )}
    />
  )
}

export function MissionControl() {
  const projects = useApp((s) => s.projects)
  const detected = useApp((s) => s.settings.detected)
  // H1 — sessões externas vivas (hooks): seleciona a REF crua (selector com
  // array novo a cada chamada loopa o useSyncExternalStore) e filtra fora.
  const externalSessionsRaw = useExternalSessions((s) => s.sessions)
  const externalSessions = visibleSessions(externalSessionsRaw)
  // Agents com rate limit atingido (cross-conversa, efêmero: marcado por
  // limit_reached, curado por result ok) — a FROTA mostra o posto bloqueado.
  const limitedAgents = useApp((s) => s.limitedAgents)
  // Ref do MAPA inteiro (estável entre updates) — nunca um objeto derivado novo.
  const convsByProject = useChat((s) => s.conversationsByProject)

  // Regras duras: selectors devolvem STRINGS estáveis (padrão useRunningConvIds
  // do Sidebar) — só mudam em transição de estado, não a cada delta de stream.
  const runningKey = useChat((s) =>
    Object.entries(s.byId)
      .filter(([, c]) => c.running)
      .map(([id]) => id)
      .sort()
      .join(SEP),
  )
  const missionKey = useMission((s) =>
    Object.entries(s.byConv)
      .filter(([, m]) => m.status === "running")
      .map(([id]) => id)
      .sort()
      .join(SEP),
  )
  const fusionLiveKey = useFusion((s) =>
    Object.entries(s.byConv)
      .filter(
        ([, f]) =>
          f.phase === "running" ||
          f.phase === "judging" ||
          f.phase === "promoting",
      )
      .map(([id]) => id)
      .sort()
      .join(SEP),
  )

  // Strip de frota — turnos + missões + disputas vivas, cross-projeto.
  // Detalhes (projectId/task/prompt) lidos via getState() DENTRO do memo: são
  // imutáveis por run, e as keys acima disparam o recompute nas transições.
  const liveRows = useMemo<LiveRow[]>(() => {
    const projName = new Map(projects.map((p) => [p.id, p.name]))
    const byId = useChat.getState().byId
    const titleOf = (convId: string, projectId: string) =>
      convsByProject[projectId]?.find((c) => c.id === convId)?.title ??
      "Conversa"
    const rows: LiveRow[] = []
    const push = (convId: string, kind: LiveKind, title?: string | null) => {
      const projectId = byId[convId]?.projectId
      if (!projectId) return
      rows.push({
        convId,
        projectId,
        projectName: projName.get(projectId) ?? "projeto",
        title: title || titleOf(convId, projectId),
        kind,
      })
    }
    for (const id of split(runningKey)) push(id, "turno")
    for (const id of split(missionKey))
      push(id, "missão", useMission.getState().byConv[id]?.task)
    for (const id of split(fusionLiveKey))
      push(id, "disputa", useFusion.getState().byConv[id]?.prompt)
    return rows
  }, [runningKey, missionKey, fusionLiveKey, projects, convsByProject])

  // Varreduras assíncronas (SQL + fs) — só em useEffect com cancelamento,
  // ao montar e num refresh leve a cada 30s (interval limpo no unmount).
  // `loaded` vira true quando a 1ª varredura completa (skeleton → conteúdo);
  // nunca volta a false — refreshes seguintes atualizam em silêncio.
  const [deliveries, setDeliveries] = useState<RecentDelivery[]>([])
  // Ledger de custo dos últimos 30d (turn_costs: chat + disputa + fases de
  // missão desde o MH2.1; + etapas SDD) — alimenta o instrumento de frota
  // (gasto hoje/7d/30d, sparkline, custo por agente).
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  // S4.3: "Pedir proposta ao lead" (BoardLane) bumpa o tick pra proposta nova
  // aparecer na fila JÁ, sem esperar o refresh de 30s.
  const [refreshTick, setRefreshTick] = useState(0)
  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      // entregas = a LISTA de entregas recentes (custo vem do ledger acima;
      // desde o MH2.1 deliveries é registro de entrega, não fonte de custo).
      const deliveriesP = listRecentDeliveries(60).then((d) => {
        if (!cancelled) setDeliveries(d)
      })
      const ledgerP = loadLedger(Date.now() - 30 * 24 * 60 * 60 * 1000).then((l) => {
        if (!cancelled) setLedger(l)
      })
      void Promise.allSettled([deliveriesP, ledgerP]).then(() => {
        if (!cancelled) setLoaded(true)
      })
    }
    refresh()
    const timer = setInterval(refresh, 30_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [projects, refreshTick])

  // Custo por janela (hoje / 7d) — alimenta o strip, o Launchpad e o título
  // das Entregas.
  // Métricas do instrumento de frota (ledger unificado). now no deps p/ o memo
  // recomputar no refresh de 30s; o ledger muda de referência a cada load.
  const fleet = useMemo(() => {
    const now = Date.now()
    const daily = dailySpend(ledger, 14, now)
    const today = daily[daily.length - 1] ?? 0
    const yesterday = daily[daily.length - 2] ?? 0
    return {
      win: ledgerWindows(ledger, now),
      byAgent: costByAgent(ledger),
      daily,
      tokens: ledgerTokens(ledger),
      delta: yesterday > 0 ? (today - yesterday) / yesterday : null,
    }
  }, [ledger])
  const windows = fleet.win
  const hasDeliveries = deliveries.length > 0
  const shownDeliveries = useMemo(() => deliveries.slice(0, 8), [deliveries])
  const projectNames = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  )

  const missionCount = liveRows.filter((r) => r.kind === "missão").length
  const [expand, setExpand] = useState<"all" | "missão" | null>(null)
  const [auditOpen, setAuditOpen] = useState(false)
  const expandedRows =
    expand === "missão"
      ? liveRows.filter((r) => r.kind === "missão")
      : liveRows

  // F6 — as 2 PRÓXIMAS agendadas (habilitadas, com next_run) pro Launchpad.
  // O array do store é ref estável; a derivação fica no memo (não no selector).
  const allSchedules = useSchedules((s) => s.schedules)
  const upcoming = useMemo(
    () =>
      allSchedules
        .filter((s) => s.enabled && s.nextRun != null)
        .sort((a, b) => (a.nextRun ?? 0) - (b.nextRun ?? 0))
        .slice(0, 2),
    [allSchedules],
  )

  // "Nova missão"/"Nova disputa": cria uma CONVERSA NOVA no projeto ativo (os
  // launchers moram no composer de uma conversa) e pede a abertura do dialog
  // via contador. Antes só trocava pro Trabalho — caía na conversa ativa
  // antiga, que era exatamente o bug reportado.
  async function goNewWork(kind: "mission" | "fusion") {
    const app = useApp.getState()
    const projectId = app.activeProjectId ?? app.projects[0]?.id
    if (!projectId) return
    await useChat.getState().newConversation(projectId)
    app.setViewMode("linear")
    if (kind === "mission") app.requestMissionLaunch()
    else app.requestFusionLaunch()
  }
  function goNewFeature() {
    const app = useApp.getState()
    app.setViewMode("sdd")
    app.requestSddCreate()
  }

  return (
    <ScrollArea className="h-full w-full bg-background">
      <div className="mx-auto flex w-full max-w-[900px] flex-col gap-8 px-8 pt-8 pb-14">
        <div className="flex flex-col gap-2">
          {/* 1. Instrumento de frota — gasto hoje + sparkline + readouts +
              custo por agente. O gasto agora é o REAL (turnos de chat +
              missões), não só missões. */}
          <section aria-label="Frota">
          <div className="rounded-xl border border-border/60 bg-card/30 p-4">
            <div className="flex items-start justify-between gap-6">
              <div className="min-w-0">
                <div className="label-mono">Gasto hoje</div>
                <div className="mt-1.5 flex items-baseline gap-2.5">
                  <span className="font-mono text-[30px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
                    {fmtCost(windows.today)}
                  </span>
                  {fleet.delta != null && (
                    <span className="font-mono text-[12px] text-muted-foreground">
                      {fleet.delta >= 0 ? "▲" : "▼"}{" "}
                      {Math.abs(Math.round(fleet.delta * 100))}% vs ontem
                    </span>
                  )}
                </div>
                <div className="mt-3">
                  {liveRows.length === 0 ? (
                    <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full border border-muted-foreground/50"
                      />
                      Frota parada
                    </span>
                  ) : (
                    <button
                      onClick={() => setExpand(expand === "all" ? null : "all")}
                      className="flex items-center gap-2 text-[13px] text-foreground transition-colors hover:text-brass"
                    >
                      <Dot tone="live" />
                      {liveRows.length} em voo
                      {missionCount > 0 && (
                        <span className="text-muted-foreground">
                          · {missionCount}{" "}
                          {missionCount === 1 ? "missão" : "missões"}
                        </span>
                      )}
                    </button>
                  )}
                </div>
              </div>
              <div className="w-[42%] max-w-[280px] shrink-0">
                <div className="flex items-baseline justify-between">
                  <span className="label-mono">Gasto diário</span>
                  <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                    14 d
                  </span>
                </div>
                <div className="mt-2">
                  <Sparkline data={fleet.daily} />
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-4 gap-2">
              <Readout label="7 dias">{fmtCost(windows.week)}</Readout>
              <Readout label="30 dias">{fmtCost(windows.month)}</Readout>
              <Readout label="Tokens 30d">{fmtTokens(fleet.tokens)}</Readout>
              <Readout label="Média/dia">{fmtCost(windows.week / 7)}</Readout>
            </div>

            {fleet.byAgent.length > 0 && (
              <div className="mt-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="label-mono">
                    Custo por agente · 30 dias
                  </span>
                  <button
                    onClick={() => setAuditOpen(true)}
                    className="text-[11px] font-medium text-brass transition-opacity hover:opacity-80"
                  >
                    auditoria →
                  </button>
                </div>
                <div className="flex h-2.5 gap-[3px]">
                  {fleet.byAgent.map((a) => (
                    <span
                      key={a.agent}
                      className="rounded-[3px]"
                      style={{
                        flexGrow: Math.max(a.share, 0.02),
                        background: agentColor(a.agent),
                      }}
                    />
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
                  {fleet.byAgent.map((a) => (
                    <span
                      key={a.agent}
                      className="flex items-center gap-2 text-[12px]"
                    >
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: agentColor(a.agent) }}
                      />
                      {agentShort(a.agent)}
                      <span className="font-mono text-[12px] text-muted-foreground tabular-nums">
                        {fmtCost(a.costUsd)} · {Math.round(a.share * 100)}%
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          {expand && expandedRows.length > 0 && (
            <div className="mt-1 flex flex-col gap-px">
              {expandedRows.map((r) => (
                <button
                  key={`${r.kind}:${r.convId}`}
                  onClick={() => void openConv(r.projectId, r.convId)}
                  className="group flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent/50"
                >
                  <Dot tone="live" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                    {r.title}
                  </span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">
                    {r.projectName}
                  </span>
                  <span className="label-mono shrink-0 text-muted-foreground/70">
                    {r.kind}
                  </span>
                </button>
              ))}
            </div>
          )}
          </section>

          {/* 2. Ações — atalhos compactos, SEMPRE visíveis */}
          <section aria-label="Ações">
            <div className="flex flex-wrap items-center gap-2">
              <QuickAction
                icon={Rocket}
                label="Nova missão"
                onClick={() => void goNewWork("mission")}
              />
              <QuickAction
                icon={Swords}
                label="Nova disputa"
                onClick={() => void goNewWork("fusion")}
              />
              <QuickAction
                icon={FileText}
                label="Nova feature"
                onClick={goNewFeature}
              />
            </div>
          </section>
        </div>

        {/* E1 (S1.5) — Board de intenção: entre AÇÕES e PRECISAM DE VOCÊ.
            S4.3: proposta nova do lead re-escaneia a fila na hora. */}
        <BoardLane onProposal={() => setRefreshTick((t) => t + 1)} />

        {/* 4. Entregas — ledger discreto, custo da semana no título */}
        <section aria-label="Entregas">
          <SectionTitle>
            Entregas
            {hasDeliveries && ` · ${fmtCost(windows.week)} esta semana`}
          </SectionTitle>
          {!loaded ? (
            <SkeletonRows rows={3} />
          ) : shownDeliveries.length === 0 ? (
            <EmptyLine>Nenhuma entrega registrada ainda.</EmptyLine>
          ) : (
            <div className="flex flex-col gap-px">
              {shownDeliveries.map((d) => (
                <div
                  key={d.id}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2.5"
                >
                  <Dot tone="done" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                    {d.task}
                  </span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">
                    {projectNames.get(d.projectId) ?? "projeto"}
                  </span>
                  <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
                    {fmtCost(d.costUsd ?? undefined)}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground/60">
                    {fmtAgo(Date.now() - d.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 5. Frota (detalhe) — CLIs + versões + agendadas, fixo no rodapé */}
        <section
          aria-label="Frota (detalhe)"
          className="rounded-lg border border-border/60 bg-card/30 px-4 py-3"
        >
          <h2 className="label-mono mb-2">Frota</h2>
          <ul className="flex flex-col gap-1">
            {CLI_TOOLS.map((t) => {
              const p = detected[t.id]
              if (!p?.installed) return null
              const hasUpdate = updateAvailable(p)
              // Auth honesta (Sprint 0): CLI deslogada nunca ganha dot verde;
              // auth incerta também não (aviso, não bloqueio). Rate limit
              // bloqueia a linha com o hint de volta.
              const isLimited = t.id in limitedAgents
              const resetHint = limitedAgents[t.id]
              const noAuth = p.auth === "missing"
              const authUnknown = p.auth === "unknown"
              const ok = !noAuth && !authUnknown && !isLimited && !hasUpdate
              return (
                <li
                  key={t.id}
                  className="flex items-center gap-2.5 text-[13px]"
                  title={p.detail ?? undefined}
                >
                  {/* Motor saudável é ESTADO AMBIENTE: cinza (STYLEGUIDE §2).
                      Só o que pede decisão (sem login, limitado, update) puxa
                      o âmbar. */}
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      ok ? "bg-st-idle" : "bg-st-warning",
                    )}
                  />
                  <span className="text-foreground">{t.label}</span>
                  <span className="text-muted-foreground">
                    v{p.version ?? "?"}
                  </span>
                  {p.auth === "ok" && (
                    <span className="min-w-0 truncate text-muted-foreground/70">
                      logado{p.detail ? ` (${p.detail})` : ""}
                    </span>
                  )}
                  {noAuth && (
                    <span className="text-st-warning">sem login</span>
                  )}
                  {authUnknown && (
                    <span className="text-st-warning">auth desconhecida</span>
                  )}
                  {isLimited && (
                    <span className="rounded border border-st-warning/50 bg-st-warning/10 px-1.5 py-px text-[11px] tracking-wide text-st-warning uppercase">
                      em rate limit{resetHint ? `, volta ${resetHint}` : ""}
                    </span>
                  )}
                  {hasUpdate && (
                    <span className="rounded border border-st-warning/50 bg-st-warning/10 px-1.5 py-px text-[11px] tracking-wide text-st-warning uppercase">
                      update v{p.latest}
                    </span>
                  )}
                </li>
              )
            })}
            {CLI_TOOLS.every((t) => !detected[t.id]?.installed) && (
              <li className="text-[13px] text-muted-foreground">
                Nenhuma CLI detectada ainda. Verifique em Configurações ▸
                Agents.
              </li>
            )}
          </ul>
          {/* H1 (hooks-plan) — sessões EXTERNAS: abertas no terminal, vistas
              pelos hooks. O app OBSERVA, não dirige: sem botão de controle
              (não somos donos delas), nada persistido (some no restart). */}
          {externalSessions.length > 0 && (
            <div className="mt-3" aria-label="Sessões no terminal">
              <h3 className="label-mono mb-1">No terminal (observando)</h3>
              <ul className="flex flex-col gap-0.5">
                {externalSessions.map((s) => {
                  const tone = statusTone(s.status)
                  return (
                    <li
                      key={`${s.agent}:${s.sessionId}`}
                      className="flex items-center gap-2.5 px-1 text-[13px]"
                      title={s.cwd}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "size-1.5 shrink-0 rounded-full",
                          tone === "running" && "bg-st-running",
                          tone === "attention" && "bg-st-warning",
                          tone === "neutral" && "bg-st-idle",
                        )}
                      />
                      <span className="text-foreground">
                        {engineLabel(s.agent)}
                      </span>
                      <span className="min-w-0 truncate text-muted-foreground">
                        {sessionPlace(s, projects)}
                      </span>
                      <span
                        className={cn(
                          "shrink-0",
                          tone === "attention"
                            ? "text-st-warning"
                            : "text-muted-foreground/70",
                        )}
                      >
                        {statusLabel(s.status)}
                      </span>
                      <span className="ml-auto shrink-0 font-mono text-[11px] text-muted-foreground/70 tabular-nums">
                        {seenAgo(s.lastSeen)}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          {/* F6 — Próximas agendadas (2): clicar abre a view Agendado. */}
          {upcoming.length > 0 && (
            <div className="mt-3">
              <h3 className="label-mono mb-1">Próximas agendadas</h3>
              <ul className="flex flex-col gap-0.5">
                {upcoming.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => useApp.getState().setScheduledOpen(true)}
                      className="flex w-full items-center gap-2.5 rounded px-1 py-0.5 text-left text-[13px] transition-colors hover:bg-accent/50"
                    >
                      <Clock className="size-3.5 shrink-0 text-brass/80" />
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {s.name}
                      </span>
                      <span className="shrink-0 text-[12px] text-muted-foreground tabular-nums">
                        em {fmtUntilShort((s.nextRun ?? 0) - Date.now())}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      <CostAudit
        open={auditOpen}
        onOpenChange={setAuditOpen}
        ledger={ledger}
        projectNames={projectNames}
      />
    </ScrollArea>
  )
}
