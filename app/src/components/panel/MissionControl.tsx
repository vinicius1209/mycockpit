// Painel — a RETROSPECTIVA (ADR-040, direção E dos mocks).
//
// O que esta tela é: auditoria. Poucos números, muito ar, e um mapa de onde o
// dinheiro queimou. O que ela NÃO é mais: a fila de decisões (foi pro chrome,
// em components/decisions/DecisionStrip — uma aba não compra visibilidade) e o
// Board de intenção (zero card em uso real; a intenção de trabalho já existe
// como conversa, entrega e plano de voo).
//
// Anatomia, de cima pra baixo:
//  1. hero do gasto da janela (o 30px volta a ser o dinheiro, e aqui está
//     certo: numa tela de auditoria o gasto É a manchete);
//  2. três derivados em 20px, cada um com a RESSALVA DE MÉTODO em 11px;
//  3. mapa de calor de US$ por hora (14 dias × hora) — medidor, régua do §2;
//  4. custo por agente cruzado com as entregas do mesmo agente;
//  5. as entregas da janela + o diagnóstico do denominador;
//  6. gaveta (aprendizados, auditoria por turno, projetos);
//  7. Frota (detalhe) — CLIs, sessões observadas no terminal e agendadas.
//
// Regras que a tela obedece: só número MEDIDO (nada de gráfico de tendência
// com n=5, nada de streak — o app não mede isso); seção sem conteúdo não
// renderiza título nem moldura; e todo derivado imprime o denominador.

import { useEffect, useMemo, useState } from "react"
import { Clock } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { useApp } from "@/store/app"
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
  countActiveLessons,
  countConversationsSince,
  listDeliveriesSince,
  listFusionOutcomes,
  loadLedger,
  type LedgerEntry,
  type RecentDelivery,
} from "@/lib/db"
import { ledgerTokens, windowRows } from "@/lib/panel"
import {
  agentCross,
  attributedShare,
  discardedSpend,
  heatFillPct,
  heatTone,
  hourlyHeatmap,
  peakHour,
  perDay,
  perDelivery,
  type FusionOutcome,
} from "@/lib/retro"
import { updateAvailable } from "@/lib/detect"
import { fmtAgo, fmtCost, fmtTokens } from "@/lib/format"
import { CostAudit } from "@/components/panel/CostAudit"
import { cn } from "@/lib/utils"

const DAY_MS = 24 * 60 * 60 * 1000
/** A janela do mapa de calor é fixa em 14 dias: é o recorte em que uma célula
 *  de hora ainda é legível, e ele não muda com o seletor da tela. */
const HEATMAP_DAYS = 14

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

/** CLIs da seção Frota (detalhe) — mesmos rótulos das Configurações ▸ Agents. */
const CLI_TOOLS: { id: string; label: string }[] = [
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "agy", label: "Antigravity" },
]

/** Título de seção — mesmo label-mono das Sections do app. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="label-mono mb-2 px-1">{children}</h2>
}

/** Skeleton do primeiro load (refreshes seguintes atualizam em silêncio). */
function SkeletonRows({ rows }: { rows: number }) {
  return (
    <div aria-hidden className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-9 w-full bg-accent/40" />
      ))}
    </div>
  )
}

/** Um derivado: valor em 20px (métrica de seção), rótulo em 13px e a RESSALVA
 *  DE MÉTODO em 11px. A ressalva não é rodapé opcional: é o que separa um
 *  número auditável de um veredito. */
function Derived({
  value,
  label,
  caveat,
}: {
  value: string
  label: string
  caveat: string
}) {
  return (
    <div className="border-l border-border py-0.5 pl-3.5">
      <div className="font-mono text-[20px] leading-tight font-semibold tabular-nums">
        {value}
      </div>
      <div className="mt-1 text-[13px] text-muted-foreground">{label}</div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-faint">{caveat}</p>
    </div>
  )
}

/** Uma linha da gaveta: o que NÃO virou tile de propósito (um "1" em 20px é
 *  vaidade com cara de instrumento), mas continua contado. */
function DrawerLine({
  label,
  value,
  onClick,
}: {
  label: string
  value: string
  onClick?: () => void
}) {
  const content = (
    <>
      <span className="text-faint">›</span>
      <span>{label}</span>
      <span className="ml-auto font-mono text-[12px] text-faint tabular-nums">
        {value}
      </span>
    </>
  )
  const base =
    "flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left text-[13px] text-muted-foreground"
  return onClick ? (
    <button
      onClick={onClick}
      className={cn(base, "transition-colors hover:bg-accent/50 hover:text-foreground")}
    >
      {content}
    </button>
  ) : (
    <div className={base}>{content}</div>
  )
}

/** O fundo de uma célula do mapa: cinza-rampa até 60% do pico, âmbar de 60 a
 *  80, vermelho acima (a régua ÚNICA de medidor, lib/meter.ts). */
function cellBackground(value: number, peak: number): string {
  const tone = heatTone(value, peak)
  if (tone === "none")
    return "color-mix(in srgb, var(--muted-foreground) 8%, transparent)"
  if (tone === "warn") return "var(--st-queued)"
  if (tone === "danger") return "var(--st-error)"
  return `color-mix(in srgb, var(--muted-foreground) ${heatFillPct(value, peak)}%, transparent)`
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

  /** Janela da retrospectiva. O dado é carregado SEMPRE em 30 dias (a maior);
   *  trocar pra 7 d é recorte em memória, nunca uma ida nova ao banco. */
  const [win, setWin] = useState<7 | 30>(30)

  // Varreduras assíncronas (SQL) — em useEffect com cancelamento, ao montar e
  // num refresh leve a cada 30s. `loaded` vira true quando a 1ª varredura
  // completa (skeleton → conteúdo) e nunca volta a false.
  const [ledger, setLedger] = useState<LedgerEntry[]>([])
  const [deliveries, setDeliveries] = useState<RecentDelivery[]>([])
  const [fusions, setFusions] = useState<FusionOutcome[]>([])
  const [convCounts, setConvCounts] = useState<{
    d7: number | null
    d30: number | null
  }>({ d7: null, d30: null })
  const [lessons, setLessons] = useState<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      const now = Date.now()
      const since30 = now - 30 * DAY_MS
      const ledgerP = loadLedger(since30).then((l) => {
        if (!cancelled) setLedger(l)
      })
      // entregas = registro de ENTREGA (o custo vem do ledger; desde o MH2.1
      // deliveries deixou de ser fonte de custo pra não contar em dobro).
      const deliveriesP = listDeliveriesSince(since30).then((d) => {
        if (!cancelled) setDeliveries(d)
      })
      const fusionsP = listFusionOutcomes(since30).then((f) => {
        if (!cancelled) setFusions(f)
      })
      const convP = Promise.all([
        countConversationsSince(since30),
        countConversationsSince(now - 7 * DAY_MS),
      ]).then(([d30, d7]) => {
        if (!cancelled) setConvCounts({ d7, d30 })
      })
      const lessonsP = countActiveLessons().then((n) => {
        if (!cancelled) setLessons(n)
      })
      void Promise.allSettled([
        ledgerP,
        deliveriesP,
        fusionsP,
        convP,
        lessonsP,
      ]).then(() => {
        if (!cancelled) setLoaded(true)
      })
    }
    refresh()
    const timer = setInterval(refresh, 30_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  // Todo o recorte da janela num memo só: as agregações varrem o ledger UMA
  // vez por carga (e por troca de janela), nunca por render.
  const view = useMemo(() => {
    const now = Date.now()
    const start = now - win * DAY_MS
    const rows = windowRows(ledger, win === 7 ? "7d" : "30d", now)
    const total = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0)
    const dels = deliveries.filter((d) => d.createdAt >= start && d.createdAt <= now)
    const runs = fusions.filter((f) => f.createdAt >= start && f.createdAt <= now)
    return {
      total,
      rows,
      deliveries: dels,
      discarded: discardedSpend(runs),
      disputes: runs.length,
      projects: new Set(rows.map((r) => r.projectId)),
      byAgent: agentCross(rows, dels),
      attributed: attributedShare(total, dels),
      tokens: ledgerTokens(rows),
      perDay: perDay(total, win),
      perDelivery: perDelivery(total, dels.length),
    }
  }, [ledger, deliveries, fusions, win])

  // O mapa de calor é sempre de 14 dias, independente do seletor.
  const heat = useMemo(
    () => hourlyHeatmap(ledger, HEATMAP_DAYS, Date.now()),
    [ledger],
  )
  const hottest = useMemo(() => peakHour(heat), [heat])

  const projectNames = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  )
  const spentProjects = useMemo(
    () =>
      [...view.projects]
        .map((id) => projectNames.get(id) ?? "projeto")
        .sort((a, b) => a.localeCompare(b, "pt-BR")),
    [view.projects, projectNames],
  )

  const [auditOpen, setAuditOpen] = useState(false)

  // F6 — as 2 PRÓXIMAS agendadas (habilitadas, com next_run).
  const allSchedules = useSchedules((s) => s.schedules)
  const upcoming = useMemo(
    () =>
      allSchedules
        .filter((s) => s.enabled && s.nextRun != null)
        .sort((a, b) => (a.nextRun ?? 0) - (b.nextRun ?? 0))
        .slice(0, 2),
    [allSchedules],
  )

  const convCount = win === 7 ? convCounts.d7 : convCounts.d30
  // corte ANUNCIADO: lista cortada em silêncio é o começo de um número que
  // ninguém confere.
  const shownDeliveries = view.deliveries.slice(0, 12)
  const hiddenDeliveries = view.deliveries.length - shownDeliveries.length

  const subline = [
    convCount != null ? `${convCount} conversa${convCount === 1 ? "" : "s"}` : null,
    `${view.deliveries.length} entrega${view.deliveries.length === 1 ? "" : "s"} registrada${view.deliveries.length === 1 ? "" : "s"}`,
    view.disputes > 0
      ? `${view.disputes} disputa${view.disputes === 1 ? "" : "s"}`
      : null,
    view.projects.size > 0
      ? `${view.projects.size} projeto${view.projects.size === 1 ? "" : "s"}`
      : null,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <ScrollArea className="h-full w-full bg-background">
      <div className="mx-auto flex w-full max-w-[940px] flex-col gap-7 px-8 pt-7 pb-14">
        <div className="flex items-center gap-3">
          <h1 className="text-[20px] leading-tight font-semibold tracking-[-0.01em]">
            Retrospectiva
          </h1>
          <div className="ml-auto flex items-center gap-0.5 rounded-lg border p-0.5">
            {([7, 30] as const).map((d) => (
              <button
                key={d}
                onClick={() => setWin(d)}
                className={cn(
                  "rounded-md px-2.5 py-0.5 text-[11px] transition-colors",
                  win === d
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {d} d
              </button>
            ))}
          </div>
        </div>

        {!loaded ? (
          <SkeletonRows rows={4} />
        ) : (
          <>
            {/* 1. HERO — numa tela de auditoria, o gasto É a manchete. */}
            <section aria-label="Gasto na janela">
              <div className="flex flex-wrap items-end gap-3">
                <span className="font-mono text-[30px] leading-none font-semibold tracking-[-0.02em] tabular-nums">
                  {fmtCost(view.total)}
                </span>
                <span className="label-mono pb-1">em {win} dias</span>
              </div>
              <p className="mt-2 text-[13px] text-muted-foreground">{subline}</p>
            </section>

            {/* 2. TRIO DERIVADO — cada um com o denominador à vista. */}
            <section aria-label="Derivados" className="grid gap-3 sm:grid-cols-3">
              <Derived
                value={view.perDay != null ? fmtCost(view.perDay) : "—"}
                label="por dia"
                caveat={`${fmtCost(view.total)} ÷ ${win}. O número de orçamento, o único que não depende de nada além do ledger.`}
              />
              <Derived
                value={
                  view.perDelivery != null ? fmtCost(view.perDelivery) : "—"
                }
                label="por entrega registrada"
                caveat={
                  view.perDelivery != null
                    ? `${fmtCost(view.total)} ÷ ${view.deliveries.length}. Mede eficiência e disciplina de registro juntas: conversa que virou código sem virar entrega não entra no denominador.`
                    : "Nenhuma entrega registrada nesta janela, então não existe denominador. O app não divide por zero pra ter um número."
                }
              />
              <Derived
                value={
                  view.discarded.disputes > 0
                    ? fmtCost(view.discarded.costUsd)
                    : "—"
                }
                label="no lado descartado"
                caveat={
                  view.discarded.disputes > 0
                    ? `Soma dos turnos do agent que você não escolheu em ${view.discarded.disputes} disputa${view.discarded.disputes === 1 ? "" : "s"} julgada${view.discarded.disputes === 1 ? "" : "s"}. É o único desperdício que o app consegue provar.`
                    : "Nenhuma disputa julgada nesta janela. Desperdício provável não vira número: só o lado descartado de uma disputa é demonstrável."
                }
              />
            </section>

            {/* 3. MAPA DE CALOR — só existe se alguém gastou algo. */}
            {heat.total > 0 && (
              <section aria-label="Mapa de calor de custo por hora">
                <SectionTitle>
                  Onde o dinheiro queimou · {HEATMAP_DAYS} dias × hora
                </SectionTitle>
                <div className="flex flex-col gap-[3px]">
                  {heat.days.map((day) => (
                    <div key={day.dayStart} className="flex items-center gap-[3px]">
                      <span className="w-[46px] shrink-0 font-mono text-[11px] text-faint tabular-nums">
                        {day.label}
                      </span>
                      {day.hours.map((v, h) => (
                        <span
                          key={h}
                          title={`${day.label}, ${String(h).padStart(2, "0")}h · ${v > 0 ? fmtCost(v) : "sem gasto"}`}
                          className="h-4 min-w-[6px] flex-1 rounded-[3px]"
                          style={{ background: cellBackground(v, heat.peak) }}
                        />
                      ))}
                      <span className="w-[56px] shrink-0 pl-1.5 text-right font-mono text-[11px] text-faint tabular-nums">
                        {day.total > 0 ? fmtCost(day.total) : ""}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center gap-[3px]">
                    <span className="w-[46px] shrink-0" />
                    {Array.from({ length: 24 }, (_, h) => (
                      <span
                        key={h}
                        className="min-w-[6px] flex-1 text-center font-mono text-[11px] text-faint tabular-nums"
                      >
                        {h % 6 === 0 ? String(h).padStart(2, "0") : ""}
                      </span>
                    ))}
                    <span className="w-[56px] shrink-0" />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[12px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-3.5 rounded-[2px]"
                      style={{ background: cellBackground(0, heat.peak) }}
                    />
                    sem gasto
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-3.5 rounded-[2px]"
                      style={{ background: cellBackground(heat.peak * 0.3, heat.peak) }}
                    />
                    até {fmtCost(heat.peak * 0.6)}/h
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-3.5 rounded-[2px]"
                      style={{ background: "var(--st-queued)" }}
                    />
                    {fmtCost(heat.peak * 0.6)} a {fmtCost(heat.peak * 0.8)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span
                      className="inline-block h-2.5 w-3.5 rounded-[2px]"
                      style={{ background: "var(--st-error)" }}
                    />
                    daí pra cima
                  </span>
                  <span className="font-mono text-[11px] text-faint tabular-nums">
                    pico {fmtCost(heat.peak)}/h · 60% e 80% do pico, a régua de
                    medidor do §2
                  </span>
                </div>
                {hottest && (
                  <p className="mt-2.5 px-1 text-[13px] text-muted-foreground">
                    Hora mais cara:{" "}
                    <span className="text-foreground">
                      {hottest.dayLabel}, {String(hottest.hour).padStart(2, "0")}h
                    </span>{" "}
                    <span className="font-mono tabular-nums">
                      {fmtCost(hottest.costUsd)}
                    </span>
                    , {Math.round(hottest.shareOfDay * 100)}% do dia inteiro.
                  </p>
                )}
              </section>
            )}

            {/* 4. POR AGENTE — custo sozinho não decide nada; ao lado das
                entregas do mesmo agent, vira pergunta respondível. */}
            {view.byAgent.length > 0 && (
              <section aria-label="Custo por agente">
                <SectionTitle>Por agente · {win} dias</SectionTitle>
                <div className="flex h-2 gap-[3px]">
                  {view.byAgent.map((a) => (
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
                <div className="mt-3 flex flex-col gap-1.5">
                  {view.byAgent.map((a) => (
                    <div
                      key={a.agent}
                      className="flex items-center gap-2.5 px-1 text-[13px]"
                    >
                      <span
                        aria-hidden
                        className="size-2 shrink-0 rounded-[2px]"
                        style={{ background: agentColor(a.agent) }}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {agentShort(a.agent)}
                      </span>
                      <span className="shrink-0 font-mono text-[12px] text-muted-foreground tabular-nums">
                        {fmtCost(a.costUsd)}
                      </span>
                      <span className="w-[210px] shrink-0 text-right font-mono text-[12px] text-faint tabular-nums">
                        {a.perDelivery != null
                          ? `${a.deliveries} entrega${a.deliveries === 1 ? "" : "s"} · ${fmtCost(a.perDelivery)} cada`
                          : "sem entrega registrada"}
                      </span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* 5. ENTREGAS — a lista É o gráfico enquanto o dado não sustentar
                um: barras de n=5 desenham ruído amostral com cara de
                tendência. A régua fica escrita, não implícita. */}
            <section aria-label="Entregas">
              <SectionTitle>
                {view.deliveries.length > 0
                  ? `As ${view.deliveries.length} entregas · ${win} dias`
                  : `Entregas · ${win} dias`}
              </SectionTitle>
              {view.deliveries.length === 0 ? (
                <p className="px-1 text-[13px] text-muted-foreground">
                  Nenhuma entrega registrada nesta janela. Sem elas, o custo por
                  entrega acima fica sem denominador.
                </p>
              ) : (
                <>
                  <div className="flex flex-col gap-px">
                    {shownDeliveries.map((d) => (
                      <div
                        key={d.id}
                        className="flex w-full items-center gap-3 rounded-md px-2.5 py-2"
                      >
                        {/* Entrega concluída é ESTADO AMBIENTE: cinza. Verde é
                            marco de turno no fio, nunca dot permanente (§2). */}
                        <span
                          aria-hidden
                          className="size-1.5 shrink-0 rounded-full bg-st-idle"
                        />
                        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
                          {d.task}
                        </span>
                        <span className="shrink-0 text-[12px] text-muted-foreground">
                          {projectNames.get(d.projectId) ?? "projeto"}
                        </span>
                        <span className="w-[76px] shrink-0 text-right font-mono text-[12px] text-muted-foreground tabular-nums">
                          {fmtCost(d.costUsd ?? undefined)}
                        </span>
                        <span className="w-[56px] shrink-0 text-right font-mono text-[11px] text-faint tabular-nums">
                          {fmtAgo(Date.now() - d.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {hiddenDeliveries > 0 && (
                    <p className="mt-1.5 px-2.5 text-[12px] text-muted-foreground">
                      e mais {hiddenDeliveries} nesta janela
                    </p>
                  )}
                  {view.attributed && (
                    <p className="mt-3 px-1 text-[13px] leading-relaxed text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {fmtCost(view.attributed.costUsd)} dos{" "}
                        {fmtCost(view.total)} (
                        {(view.attributed.share * 100).toFixed(1).replace(".", ",")}
                        %)
                      </span>{" "}
                      estão atribuídos a uma entrega registrada. O resto está em
                      conversa que ninguém fechou. Isso não é um julgamento do
                      trabalho, é um diagnóstico do denominador.
                    </p>
                  )}
                </>
              )}
            </section>

            {/* 6. GAVETA — o que não virou tile de propósito. */}
            <div className="flex flex-col gap-0.5 border-t pt-3">
              {lessons != null && (
                <DrawerLine
                  label="Aprendizados"
                  value={`${lessons} regra${lessons === 1 ? "" : "s"} ativa${lessons === 1 ? "" : "s"}`}
                />
              )}
              <DrawerLine
                label="Tokens e auditoria por turno"
                value={`${fmtTokens(view.tokens)} tokens · abrir`}
                onClick={() => setAuditOpen(true)}
              />
              {spentProjects.length > 0 && (
                <DrawerLine
                  label="Projetos com gasto na janela"
                  value={spentProjects.join(" · ")}
                />
              )}
            </div>
          </>
        )}

        {/* 7. Frota (detalhe) — CLIs + sessões observadas + agendadas. Fica no
            Painel de propósito, mesmo fora do mock: é o único lugar onde o
            estado real das CLIs e das sessões vistas pelos hooks aparece, e
            §1 diz que a UI mostra o estado real da frota. */}
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
                  {noAuth && <span className="text-st-warning">sem login</span>}
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
                Nenhuma CLI detectada ainda. Verifique em Configurações ▸ Agents.
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
                      <Clock className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {s.name}
                      </span>
                      <span className="shrink-0 font-mono text-[12px] text-muted-foreground tabular-nums">
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
