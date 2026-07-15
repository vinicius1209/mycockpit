// F4 — Painel (mission control): o centro de controle cross-projeto.
// Anatomia FIXA (a ordem dos blocos nunca muda): (1) strip de frota no topo
// (contadores + custo hoje/7d, sempre visível); (2) AÇÕES — atalhos Nova
// missão/disputa/feature, sempre visíveis; (3) PRECISAM DE VOCÊ — a fila
// dominante, em cards com ação primária (PR mergeia daqui); fila vazia vira
// uma linha discreta, não um bloco; (4) ENTREGAS — ledger discreto com o
// custo da semana; (5) FROTA (detalhe) — CLIs + versões + agendadas, seção
// compacta fixa no rodapé. No primeiro load, fila e entregas mostram
// skeleton; refreshes seguintes (30s) atualizam em silêncio. Enriquecimento
// de PR via gh é lazy por card, com cache de 60s e degrade silencioso.

import { useEffect, useMemo, useState } from "react"
import { Clock, FileText, GitPullRequest, Rocket, Swords } from "lucide-react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { toast } from "sonner"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useFusion } from "@/store/fusion"
import { useMission } from "@/store/mission"
import { useSchedules } from "@/store/schedules"
import { fmtUntilShort } from "@/lib/schedules"
import { scanDecisions, type Decision } from "@/lib/inbox"
import { listRecentDeliveries, type RecentDelivery } from "@/lib/db"
import {
  cachedPrEnrichment,
  costWindows,
  fetchPrEnrichment,
  mergeEligible,
  mergePr,
  orderQueue,
  prHealth,
  prResolved,
  type PrEnrichment,
} from "@/lib/panel"
import { updateAvailable } from "@/lib/detect"
import { confirm } from "@/lib/confirm"
import { fmtCost } from "@/lib/format"
import { cn } from "@/lib/utils"

/** Mesmo formato do InboxBell (duplicado local de propósito — sem tocar lá). */
function fmtRelative(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return "agora"
  const m = Math.floor(s / 60)
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h} h`
  return `há ${Math.floor(h / 24)} d`
}

/** Idade a partir de um ISO (manifest do SDD). null/inválido = sem idade. */
function fmtRelativeIso(iso: string | null): string | null {
  if (!iso) return null
  const ts = Date.parse(iso)
  return Number.isFinite(ts) ? fmtRelative(ts) : null
}

/** Abre a conversa dona do objeto vivo (turno/missão/disputa) no Trabalho. */
async function openConv(projectId: string, convId: string) {
  const app = useApp.getState()
  app.setActiveProject(projectId)
  await useChat.getState().openProject(projectId)
  await useChat.getState().switchConversation(convId)
  app.setViewMode("linear")
}

/** Navega pra ONDE a decisão mora (mesmo padrão do InboxBell.goTo): a conversa
 *  (Fusion) ou o plano (SDD). */
async function goTo(d: Decision) {
  const app = useApp.getState()
  app.setActiveProject(d.projectId)
  if (d.kind === "fusion") {
    await useChat.getState().openProject(d.projectId)
    await useChat.getState().switchConversation(d.convId)
    app.setViewMode("linear")
  } else {
    app.setSddFocus(d.slug)
    app.setViewMode("sdd")
  }
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
    <p className="px-1 py-2 text-[12.5px] text-muted-foreground/80">
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
      className="flex h-9 items-center gap-2 rounded-lg border border-border/70 bg-secondary/20 px-3 text-[12.5px] font-medium text-foreground transition-colors hover:border-brass/50 hover:bg-accent/40"
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

/** Botão brass (padrão do app: MessageList/aprovações). */
function BrassButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode
  disabled?: boolean
  onClick: (e: React.MouseEvent) => void
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className="shrink-0 rounded-md bg-brass px-2.5 py-1 text-[11.5px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
    >
      {children}
    </button>
  )
}

/** Ação secundária discreta dos cards. */
function GhostAction({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick: (e: React.MouseEvent) => void
}) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 rounded-md px-2 py-1 text-[11.5px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
    >
      {children}
    </button>
  )
}

/** Moldura comum dos cards da fila. */
function QueueCard({
  onClick,
  children,
  className,
}: {
  onClick: () => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter") onClick()
      }}
      className={cn(
        "cursor-pointer rounded-lg border border-border/70 bg-card/40 px-4 py-3 transition-colors hover:border-border hover:bg-accent/40",
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Card de PR: corpo e primária abrem a PR no browser; Merge (brass) só com
 *  tudo verde; "Ver no SDD" é a navegação antiga, agora secundária. */
function PrCard({
  d,
  enrich,
  merging,
  onMerge,
}: {
  d: Extract<Decision, { kind: "pr" }>
  enrich: PrEnrichment | null
  merging: boolean
  onMerge: () => void
}) {
  const health = prHealth(enrich)
  const failing = health === "failing"
  const canMerge = mergeEligible(enrich)
  const open = () => void openUrl(d.prUrl).catch(() => {})
  return (
    <QueueCard onClick={open}>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <GitPullRequest
              className={cn(
                "size-4 shrink-0",
                failing ? "text-st-error" : "text-st-success",
              )}
            />
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
              {d.planTitle}
            </span>
            <span className="shrink-0 text-[11.5px] text-muted-foreground">
              {d.projectName}
            </span>
            {enrich?.updatedAt != null && (
              <span className="shrink-0 text-[11px] text-muted-foreground/60">
                {fmtRelative(enrich.updatedAt)}
              </span>
            )}
          </div>
          {enrich && (
            <p
              className={cn(
                "mt-1 pl-[26px] text-[11.5px] tabular-nums",
                failing ? "text-st-error" : "text-muted-foreground",
              )}
            >
              {enrich.checksTotal > 0 && (
                <>
                  {failing ? "✗" : health === "green" ? "✓" : ""}{" "}
                  {enrich.checksPassed}/{enrich.checksTotal} checks ·{" "}
                </>
              )}
              +{enrich.additions} −{enrich.deletions}
              {enrich.mergeable === "MERGEABLE"
                ? " · mergeable"
                : enrich.mergeable === "CONFLICTING"
                  ? " · conflito"
                  : ""}
              {enrich.isDraft ? " · draft" : ""}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5 pt-px">
          <button
            onClick={(e) => {
              e.stopPropagation()
              open()
            }}
            className={cn(
              "shrink-0 rounded-md border px-2.5 py-1 text-[11.5px] font-medium transition-colors",
              failing
                ? "border-st-error/50 text-st-error hover:bg-st-error/10"
                : "border-border text-foreground hover:bg-accent/60",
            )}
          >
            {failing ? "Ver falha ↗" : "Abrir PR ↗"}
          </button>
          {canMerge && (
            <BrassButton
              disabled={merging}
              onClick={(e) => {
                e.stopPropagation()
                onMerge()
              }}
            >
              {merging ? "Mergeando…" : "Merge"}
            </BrassButton>
          )}
          <GhostAction
            onClick={(e) => {
              e.stopPropagation()
              void goTo(d)
            }}
          >
            Ver no SDD
          </GhostAction>
        </div>
      </div>
    </QueueCard>
  )
}

/** Card de disputa: julgar é a única ação — corpo e primária navegam. */
function FusionCard({ d }: { d: Extract<Decision, { kind: "fusion" }> }) {
  const go = () => void goTo(d)
  return (
    <QueueCard onClick={go}>
      <div className="flex items-center gap-2.5">
        <Swords className="size-4 shrink-0 text-brass" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {d.title}
        </span>
        <span className="shrink-0 text-[11.5px] text-muted-foreground">
          {d.projectName}
        </span>
        <BrassButton
          onClick={(e) => {
            e.stopPropagation()
            go()
          }}
        >
          Julgar
        </BrassButton>
      </div>
    </QueueCard>
  )
}

/** Card de PRD: revisar no SDD (aqui o SDD É o destino certo). */
function PrdCard({ d }: { d: Extract<Decision, { kind: "prd" }> }) {
  const go = () => void goTo(d)
  const age = fmtRelativeIso(d.createdAt)
  return (
    <QueueCard onClick={go}>
      <div className="flex items-center gap-2.5">
        <FileText className="size-4 shrink-0 text-brass" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {d.planTitle}
        </span>
        <span className="shrink-0 text-[11.5px] text-muted-foreground">
          {d.projectName}
        </span>
        {age && (
          <span className="shrink-0 text-[11px] text-muted-foreground/60">
            {age}
          </span>
        )}
        <BrassButton
          onClick={(e) => {
            e.stopPropagation()
            go()
          }}
        >
          Revisar PRD
        </BrassButton>
      </div>
    </QueueCard>
  )
}

export function MissionControl() {
  const projects = useApp((s) => s.projects)
  const detected = useApp((s) => s.settings.detected)
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
  const decidingKey = useFusion((s) =>
    Object.entries(s.byConv)
      .filter(([, f]) => f.phase === "deciding")
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
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [deliveries, setDeliveries] = useState<RecentDelivery[]>([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      const scanP =
        projects.length > 0
          ? scanDecisions(projects).then((d) => {
              if (!cancelled) setDecisions(d)
            })
          : Promise.resolve(setDecisions([]))
      // 60 entregas dão a janela de 7d do custo; o ledger mostra as 8 últimas.
      const deliveriesP = listRecentDeliveries(60).then((d) => {
        if (!cancelled) setDeliveries(d)
      })
      void Promise.allSettled([scanP, deliveriesP]).then(() => {
        if (!cancelled) setLoaded(true)
      })
    }
    refresh()
    const timer = setInterval(refresh, 30_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [projects])

  // Enriquecimento gh por PR: lazy (não bloqueia o render), cache de 60s no
  // lib/panel, fail-soft (null → card sem 2ª linha). Estado inicial vem do
  // cache síncrono pra não piscar ao remontar o painel.
  const [prData, setPrData] = useState<Record<string, PrEnrichment | null>>({})
  useEffect(() => {
    let cancelled = false
    for (const d of decisions) {
      if (d.kind !== "pr") continue
      const url = d.prUrl
      const hit = cachedPrEnrichment(url)
      if (hit) setPrData((m) => (m[url] === hit ? m : { ...m, [url]: hit }))
      void fetchPrEnrichment(url)
        .then((e) => {
          if (cancelled) return
          setPrData((m) => (m[url] === e ? m : { ...m, [url]: e }))
        })
        .catch(() => {})
    }
    return () => {
      cancelled = true
    }
  }, [decisions])

  // Fila "Precisam de você" — scanDecisions (persistido) + disputas 'deciding'
  // ao vivo que a varredura ainda não viu (dedupe por convId), menos os PRs já
  // mergeados nesta sessão, ordenada por rank (lib/panel.orderQueue).
  const [merged, setMerged] = useState<ReadonlySet<string>>(() => new Set())
  const [mergingUrl, setMergingUrl] = useState<string | null>(null)
  const queue = useMemo<Decision[]>(() => {
    const seen = new Set(
      decisions.filter((d) => d.kind === "fusion").map((d) => d.convId),
    )
    const projName = new Map(projects.map((p) => [p.id, p.name]))
    const byId = useChat.getState().byId
    const extra: Decision[] = []
    for (const convId of split(decidingKey)) {
      if (seen.has(convId)) continue
      const projectId = byId[convId]?.projectId
      if (!projectId) continue
      extra.push({
        kind: "fusion",
        convId,
        projectId,
        projectName: projName.get(projectId) ?? "projeto",
        title:
          useFusion.getState().byConv[convId]?.prompt ??
          "Disputa aguardando decisão",
      })
    }
    // PR sai da fila se: mergeada nesta sessão OU o GitHub diz que já foi
    // resolvida (merge feito fora do app — o manifest SDD local fica velho).
    const all = [...extra, ...decisions].filter(
      (d) =>
        d.kind !== "pr" ||
        (!merged.has(d.prUrl) && !prResolved(prData[d.prUrl])),
    )
    return orderQueue(all, prData)
  }, [decisions, decidingKey, projects, prData, merged])

  async function handleMerge(d: Extract<Decision, { kind: "pr" }>) {
    const ok = await confirm({
      title: `Fazer merge de "${d.planTitle}"?`,
      description:
        `Squash merge do PR em ${d.projectName}. ` +
        "O GitHub ainda valida as proteções da branch.",
      confirmLabel: "Merge",
    })
    if (!ok) return
    setMergingUrl(d.prUrl)
    try {
      await mergePr(d.prUrl)
      toast.success(`PR mergeado — ${d.planTitle}`)
      setMerged((prev) => new Set(prev).add(d.prUrl))
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha no merge")
    } finally {
      setMergingUrl(null)
    }
  }

  // Custo por janela (hoje / 7d) — alimenta o strip, o Launchpad e o título
  // das Entregas.
  const windows = useMemo(() => costWindows(deliveries), [deliveries])
  const hasDeliveries = deliveries.length > 0
  const shownDeliveries = useMemo(() => deliveries.slice(0, 8), [deliveries])
  const projectNames = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  )

  const missionCount = liveRows.filter((r) => r.kind === "missão").length
  const [expand, setExpand] = useState<"all" | "missão" | null>(null)
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
          {/* 1. Strip de frota — 1 linha, sempre visível */}
          <section aria-label="Frota">
          <div className="flex min-h-[38px] items-center gap-2 rounded-lg border border-border/60 bg-card/30 px-4 py-2">
            {liveRows.length === 0 ? (
              <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full border border-muted-foreground/50"
                />
                Frota parada
              </span>
            ) : (
              <>
                <button
                  onClick={() => setExpand(expand === "all" ? null : "all")}
                  className="flex items-center gap-2 rounded px-1 text-[12.5px] text-foreground transition-colors hover:text-brass"
                >
                  <Dot tone="live" />
                  {liveRows.length} rodando
                </button>
                {missionCount > 0 && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <button
                      onClick={() =>
                        setExpand(expand === "missão" ? null : "missão")
                      }
                      className="rounded px-1 text-[12.5px] text-foreground transition-colors hover:text-brass"
                    >
                      {missionCount}{" "}
                      {missionCount === 1 ? "missão" : "missões"}
                    </button>
                  </>
                )}
              </>
            )}
            {hasDeliveries && (
              <span className="ml-auto shrink-0 text-[11.5px] text-muted-foreground tabular-nums">
                hoje {fmtCost(windows.today)} · 7d {fmtCost(windows.week)}
              </span>
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
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                    {r.title}
                  </span>
                  <span className="shrink-0 text-[11.5px] text-muted-foreground">
                    {r.projectName}
                  </span>
                  <span className="label-mono shrink-0 text-[9.5px] text-muted-foreground/70">
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

        {/* 3. Precisam de você — a fila dominante; vazia vira linha discreta */}
        <section aria-label="Precisam de você">
          {!loaded ? (
            <>
              <SectionTitle>Precisam de você</SectionTitle>
              <SkeletonRows rows={2} />
            </>
          ) : queue.length === 0 ? (
            <EmptyLine>Nada esperando você — bom voo.</EmptyLine>
          ) : (
            <>
              <SectionTitle>Precisam de você ({queue.length})</SectionTitle>
              <div className="flex flex-col gap-2">
                {queue.map((d) =>
                  d.kind === "pr" ? (
                    <PrCard
                      key={`pr:${d.prUrl}`}
                      d={d}
                      enrich={prData[d.prUrl] ?? null}
                      merging={mergingUrl === d.prUrl}
                      onMerge={() => void handleMerge(d)}
                    />
                  ) : d.kind === "fusion" ? (
                    <FusionCard key={`fusion:${d.convId}`} d={d} />
                  ) : (
                    <PrdCard key={`prd:${d.projectId}:${d.slug}`} d={d} />
                  ),
                )}
              </div>
            </>
          )}
        </section>

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
                  <span className="shrink-0 text-[11.5px] text-muted-foreground">
                    {projectNames.get(d.projectId) ?? "projeto"}
                  </span>
                  <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">
                    {fmtCost(d.costUsd ?? undefined)}
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground/60">
                    {fmtRelative(d.createdAt)}
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
              return (
                <li
                  key={t.id}
                  className="flex items-center gap-2.5 text-[12.5px]"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      hasUpdate ? "bg-st-warning" : "bg-st-success",
                    )}
                  />
                  <span className="text-foreground">{t.label}</span>
                  <span className="text-muted-foreground">
                    v{p.version ?? "?"}
                  </span>
                  {hasUpdate && (
                    <span className="rounded border border-st-warning/50 bg-st-warning/10 px-1.5 py-px text-[10px] tracking-wide text-st-warning uppercase">
                      update v{p.latest}
                    </span>
                  )}
                </li>
              )
            })}
            {CLI_TOOLS.every((t) => !detected[t.id]?.installed) && (
              <li className="text-[12.5px] text-muted-foreground">
                Nenhuma CLI detectada ainda — verifique em Configurações ▸
                Agents.
              </li>
            )}
          </ul>
          {/* F6 — Próximas agendadas (2): clicar abre a view Agendado. */}
          {upcoming.length > 0 && (
            <div className="mt-3">
              <h3 className="label-mono mb-1">Próximas agendadas</h3>
              <ul className="flex flex-col gap-0.5">
                {upcoming.map((s) => (
                  <li key={s.id}>
                    <button
                      onClick={() => useApp.getState().setScheduledOpen(true)}
                      className="flex w-full items-center gap-2.5 rounded px-1 py-0.5 text-left text-[12.5px] transition-colors hover:bg-accent/50"
                    >
                      <Clock className="size-3.5 shrink-0 text-brass/80" />
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {s.name}
                      </span>
                      <span className="shrink-0 text-[11.5px] text-muted-foreground tabular-nums">
                        em {fmtUntilShort((s.nextRun ?? 0) - Date.now())}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="mt-3 text-[11.5px] text-muted-foreground tabular-nums">
            hoje {fmtCost(windows.today)} · 7d {fmtCost(windows.week)}
          </p>
        </section>
      </div>
    </ScrollArea>
  )
}
