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
import {
  Clock,
  FileText,
  GitPullRequest,
  Lightbulb,
  Rocket,
  SquareKanban,
  Swords,
} from "lucide-react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { toast } from "sonner"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useFusion } from "@/store/fusion"
import { useMission } from "@/store/mission"
import { useSchedules } from "@/store/schedules"
import { openCardConversation, useCards } from "@/store/cards"
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
  adoptPlan,
  cardDecisions,
  foundDecisions,
  pendingDecisions,
  scanDecisions,
  type Decision,
} from "@/lib/inbox"
import {
  dismissProposal,
  listRecentDeliveries,
  loadLedger,
  setSddPlanIgnored,
  type LedgerEntry,
  type RecentDelivery,
} from "@/lib/db"
import {
  cachedPrEnrichment,
  costByAgent,
  dailySpend,
  fetchPrEnrichment,
  ledgerTokens,
  ledgerWindows,
  mergeEligible,
  mergePr,
  orderQueue,
  prHealth,
  prResolved,
  type PrEnrichment,
} from "@/lib/panel"
import { updateAvailable } from "@/lib/detect"
import { BoardLane } from "@/components/panel/BoardLane"
import { confirm } from "@/lib/confirm"
import { fmtCost, fmtTokens } from "@/lib/format"
import { CostAudit } from "@/components/panel/CostAudit"
import { cn } from "@/lib/utils"

/** Cor categórica por agente (mesma linguagem dos mocks): Claude=brass,
 *  Codex=azul (st-running), Antigravity=verde (st-success). */
const AGENT_COLOR: Record<string, string> = {
  "claude-code": "var(--brass)",
  codex: "var(--st-running)",
  agy: "var(--st-success)",
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
      <div className="label-mono text-[9px]">{label}</div>
      <div className="mt-1.5 font-mono text-[19px] font-semibold tabular-nums tracking-[-0.01em]">
        {children}
      </div>
    </div>
  )
}

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
 *  (Fusion), o card do board (E1) ou o plano (SDD). */
async function goTo(d: Decision) {
  const app = useApp.getState()
  // proposta do lead mora NA PRÓPRIA fila (expande inline): navegar é só
  // garantir o Painel na frente (o projectId é opcional — board inteiro).
  if (d.kind === "proposal") {
    if (d.projectId) app.setActiveProject(d.projectId)
    app.setViewMode("painel")
    return
  }
  app.setActiveProject(d.projectId)
  if (d.kind === "fusion") {
    await useChat.getState().openProject(d.projectId)
    await useChat.getState().switchConversation(d.convId)
    app.setViewMode("linear")
  } else if (d.kind === "card") {
    // com conversa ligada abre a conversa; sem, seleciona o card no board.
    await openCardConversation(d.cardId)
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

/** Card do board esperando você (E1: review/blocked): abrir leva à conversa
 *  ligada, ou seleciona o card no board quando não há conversa. Quando o vigia
 *  marcou o card como estagnado (S2.3), o destaque "parado há X min" entra
 *  aqui mesmo, sem layout novo. */
function BoardQueueCard({ d }: { d: Extract<Decision, { kind: "card" }> }) {
  const go = () => void goTo(d)
  // minutos calculados no render: a fila re-escaneia periodicamente, o valor
  // acompanha; precisão de relógio vivo não vale um timer por card.
  const stalledMin =
    d.stalledSince != null
      ? Math.max(1, Math.round((Date.now() - d.stalledSince) / 60_000))
      : null
  return (
    <QueueCard onClick={go}>
      <div className="flex items-center gap-2.5">
        <SquareKanban
          className={cn(
            "size-4 shrink-0",
            d.state === "blocked" ? "text-st-error" : "text-st-warning",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          {d.title}
        </span>
        <span className="shrink-0 text-[11.5px] text-muted-foreground">
          {d.projectName}
        </span>
        {stalledMin != null && (
          <span className="shrink-0 rounded border border-st-warning/50 bg-st-warning/10 px-1.5 py-px text-[10px] tracking-wide text-st-warning">
            parado há {stalledMin} min
          </span>
        )}
        <span
          className={cn(
            "shrink-0 rounded border px-1.5 py-px text-[10px] tracking-wide uppercase",
            d.state === "blocked"
              ? "border-st-error/50 bg-st-error/10 text-st-error"
              : "border-st-warning/50 bg-st-warning/10 text-st-warning",
          )}
        >
          {d.state === "blocked" ? "bloqueado" : "em revisão"}
        </span>
        <BrassButton
          onClick={(e) => {
            e.stopPropagation()
            go()
          }}
        >
          Abrir
        </BrassButton>
      </div>
    </QueueCard>
  )
}

/** Card de proposta do lead (S4.2): "Ver proposta" expande o texto INLINE no
 *  próprio card (sem modal novo); "Dispensar" marca dismissed e some da fila.
 *  O lead NUNCA despacha: não existe botão de dispatch aqui — aprovar um item
 *  é o gesto humano normal no board. */
function ProposalCard({
  d,
  onDismiss,
}: {
  d: Extract<Decision, { kind: "proposal" }>
  onDismiss: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <QueueCard onClick={() => setOpen((o) => !o)}>
      <div className="flex items-center gap-2.5">
        <Lightbulb className="size-4 shrink-0 text-brass" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">
          Proposta do lead: {d.excerpt}
        </span>
        <span className="shrink-0 text-[11.5px] text-muted-foreground">
          {d.projectName ?? "board inteiro"}
        </span>
        <span className="shrink-0 text-[11px] text-muted-foreground/60">
          {fmtRelative(d.createdAt)}
        </span>
        <GhostAction
          onClick={(e) => {
            e.stopPropagation()
            onDismiss()
          }}
        >
          Dispensar
        </GhostAction>
        <BrassButton
          onClick={(e) => {
            e.stopPropagation()
            setOpen((o) => !o)
          }}
        >
          {open ? "Fechar" : "Ver proposta"}
        </BrassButton>
      </div>
      {open && (
        <p className="mt-2 pl-[26px] text-[12.5px] leading-relaxed whitespace-pre-wrap text-foreground/90">
          {d.body}
        </p>
      )}
    </QueueCard>
  )
}

/** Linha de gate ENCONTRADO no disco (o app leu o .claude/plans do projeto e
 *  ninguém te chamou). Discreta de propósito: não é fila, é achado. Origem e
 *  idade explícitas — 68 dias de dívida não pode parecer urgência de hoje. */
function FoundRow({
  d,
  onAdopt,
  onIgnore,
}: {
  d: Extract<Decision, { kind: "prd" | "pr" }>
  onAdopt: () => void
  onIgnore: () => void
}) {
  const go = () => void goTo(d)
  const age = fmtRelativeIso(d.createdAt)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={go}
      onKeyDown={(e) => {
        if (e.key === "Enter") go()
      }}
      className="group flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-accent/50"
    >
      {d.kind === "prd" ? (
        <FileText className="size-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <GitPullRequest className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
        {d.kind === "prd" ? "PRD por aprovar" : "PR aberto"}: {d.planTitle}
      </span>
      <span className="shrink-0 text-[11.5px] text-muted-foreground/80">
        {d.projectName}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-muted-foreground/60">
        {d.origin.path}
        {age ? ` · criado ${age}` : ""}
      </span>
      {/* "Adotar" é o gesto explícito de trazer o plano pra fila (e o resgate
          de quem nasceu aqui, mas perdeu a marca da adoção). */}
      <GhostAction
        onClick={(e) => {
          e.stopPropagation()
          onAdopt()
        }}
      >
        Adotar
      </GhostAction>
      <GhostAction
        onClick={(e) => {
          e.stopPropagation()
          onIgnore()
        }}
      >
        Ignorar
      </GhostAction>
    </div>
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
      const scanP =
        projects.length > 0
          ? scanDecisions(projects).then((d) => {
              if (!cancelled) setDecisions(d)
            })
          : Promise.resolve(setDecisions([]))
      // entregas = a LISTA de entregas recentes (custo vem do ledger acima;
      // desde o MH2.1 deliveries é registro de entrega, não fonte de custo).
      const deliveriesP = listRecentDeliveries(60).then((d) => {
        if (!cancelled) setDeliveries(d)
      })
      const ledgerP = loadLedger(Date.now() - 30 * 24 * 60 * 60 * 1000).then((l) => {
        if (!cancelled) setLedger(l)
      })
      void Promise.allSettled([scanP, deliveriesP, ledgerP]).then(() => {
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
  // E1 (S1.6): cards em review/blocked entram na MESMA fila. Ref estável do
  // array do store (só muda em mutação real, nunca por delta de stream); a
  // saída da fila é derivação pura — card mudou de estado, some do memo.
  const allCards = useCards((s) => s.all)
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
    const all = [
      ...extra,
      ...decisions,
      ...cardDecisions(allCards, projects),
    ].filter(
      (d) =>
        d.kind !== "pr" ||
        (!merged.has(d.prUrl) && !prResolved(prData[d.prUrl])),
    )
    return orderQueue(all, prData)
  }, [decisions, decidingKey, projects, prData, merged, allCards])

  // "Precisam de você" = só PENDÊNCIA. Gate do SDD que o app apenas ACHOU no
  // disco (nenhum gesto seu por aqui) desce pra "Encontrados no projeto": a
  // fila é sinal de agora, não arqueologia do .claude/plans.
  const pending = useMemo(() => pendingDecisions(queue), [queue])
  const found = useMemo(
    () => foundDecisions(queue) as Extract<Decision, { kind: "prd" | "pr" }>[],
    [queue],
  )

  /** "Ignorar": some da lista (marca no BANCO DO APP, nunca no .claude/plans).
   *  Reverter é no sino, que é quem lista os ignorados. Falhou = não some (nem
   *  quando "falhar" é não ter banco: sumir na base de um no-op seria teatro). */
  function handleIgnorePlan(d: Extract<Decision, { kind: "prd" | "pr" }>) {
    void setSddPlanIgnored(d.projectId, d.slug, true)
      .then((saved) => {
        if (!saved) {
          toast.error("Sem banco: não dá pra ignorar o plano agora")
          return
        }
        setDecisions((prev) =>
          prev.filter(
            (x) =>
              !(
                (x.kind === "prd" || x.kind === "pr") &&
                x.projectId === d.projectId &&
                x.slug === d.slug
              ),
          ),
        )
      })
      .catch((e) => {
        console.error("[painel] falha ao ignorar o plano", d.projectId, d.slug, e)
        toast.error("Falha ao ignorar o plano")
      })
  }

  /** "Adotar": o plano passa a contar como pendência de verdade (sobe pra
   *  "Precisam de você"). É também o gesto de RECUPERAÇÃO quando o plano nasceu
   *  aqui mas a marca da adoção não gravou (banco travado no instante da
   *  criação) e ele apareceu, errado, como "encontrado no projeto". */
  function handleAdoptPlan(d: Extract<Decision, { kind: "prd" | "pr" }>) {
    void adoptPlan(d.projectId, d.slug).then((ok) => {
      if (!ok) {
        toast.error("Não consegui adotar o plano", {
          description: "Nada mudou. Tente de novo em instantes.",
        })
        return
      }
      setRefreshTick((t) => t + 1) // re-varre: o item muda de seção
    })
  }

  /** Dispensa a proposta do lead (persistido) e a tira da fila na hora. */
  async function handleDismissProposal(
    d: Extract<Decision, { kind: "proposal" }>,
  ) {
    try {
      await dismissProposal(d.proposalId)
      setDecisions((prev) =>
        prev.filter(
          (x) => !(x.kind === "proposal" && x.proposalId === d.proposalId),
        ),
      )
    } catch {
      toast.error("Falha ao dispensar a proposta")
    }
  }

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
      toast.success(`PR mergeado: ${d.planTitle}`)
      setMerged((prev) => new Set(prev).add(d.prUrl))
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha no merge")
    } finally {
      setMergingUrl(null)
    }
  }

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
                <div className="label-mono text-[9px]">Gasto hoje</div>
                <div className="mt-1.5 flex items-baseline gap-2.5">
                  <span className="font-mono text-[34px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
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
                    <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-full border border-muted-foreground/50"
                      />
                      Frota parada
                    </span>
                  ) : (
                    <button
                      onClick={() => setExpand(expand === "all" ? null : "all")}
                      className="flex items-center gap-2 text-[12.5px] text-foreground transition-colors hover:text-brass"
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
                  <span className="label-mono text-[9px]">Gasto diário</span>
                  <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
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
                  <span className="label-mono text-[9px]">
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
                      <span className="font-mono text-[11.5px] text-muted-foreground tabular-nums">
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

        {/* E1 (S1.5) — Board de intenção: entre AÇÕES e PRECISAM DE VOCÊ.
            S4.3: proposta nova do lead re-escaneia a fila na hora. */}
        <BoardLane onProposal={() => setRefreshTick((t) => t + 1)} />

        {/* 3. Precisam de você — a fila dominante; vazia vira linha discreta */}
        <section aria-label="Precisam de você">
          {!loaded ? (
            <>
              <SectionTitle>Precisam de você</SectionTitle>
              <SkeletonRows rows={2} />
            </>
          ) : pending.length === 0 ? (
            <EmptyLine>Nada esperando você. Bom voo.</EmptyLine>
          ) : (
            <>
              <SectionTitle>Precisam de você ({pending.length})</SectionTitle>
              <div className="flex flex-col gap-2">
                {pending.map((d) =>
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
                  ) : d.kind === "card" ? (
                    <BoardQueueCard key={`card:${d.cardId}`} d={d} />
                  ) : d.kind === "proposal" ? (
                    <ProposalCard
                      key={`proposal:${d.proposalId}`}
                      d={d}
                      onDismiss={() => void handleDismissProposal(d)}
                    />
                  ) : (
                    <PrdCard key={`prd:${d.projectId}:${d.slug}`} d={d} />
                  ),
                )}
              </div>
            </>
          )}

          {/* Encontrados no projeto — gates que o app LEU do .claude/plans e
              você ainda não tocou por aqui. Abaixo da fila, sem alarme. */}
          {loaded && found.length > 0 && (
            <div className="mt-4">
              <SectionTitle>Encontrados no projeto ({found.length})</SectionTitle>
              <div className="flex flex-col gap-px">
                {found.map((d) => (
                  <FoundRow
                    key={`found:${d.projectId}:${d.slug}`}
                    d={d}
                    onAdopt={() => handleAdoptPlan(d)}
                    onIgnore={() => handleIgnorePlan(d)}
                  />
                ))}
              </div>
            </div>
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
                  className="flex items-center gap-2.5 text-[12.5px]"
                  title={p.detail ?? undefined}
                >
                  <span
                    aria-hidden
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      ok ? "bg-st-success" : "bg-st-warning",
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
                    <span className="rounded border border-st-warning/50 bg-st-warning/10 px-1.5 py-px text-[10px] tracking-wide text-st-warning uppercase">
                      em rate limit{resetHint ? `, volta ${resetHint}` : ""}
                    </span>
                  )}
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
                      className="flex items-center gap-2.5 px-1 text-[12.5px]"
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
