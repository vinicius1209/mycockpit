import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  Activity,
  ArrowUpRight,
  CheckCheck,
  Crown,
  MessageSquareText,
  ReceiptText,
  Rocket,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { openDeliveryDiff } from "@/lib/deliveryDiff"
import { agentLabel, fmtCost } from "../bridge/hooks"
import { useOfficeUi } from "./store"
import {
  bossStandupLine,
  buildBossBriefing,
  deliveryAge,
  type BossDeliveryItem,
  type BossDeskItem,
} from "./bossBriefing"

export const BOSS_CENTER_ID = "office-boss-center"
export const BOSS_CENTER_TRIGGER_ID = "office-boss-center-trigger"
export const BOSS_CENTER_W = 380

export type BossDeskTarget = Pick<
  BossDeskItem,
  "id" | "projectId" | "convId"
>

function SectionTitle({
  id,
  icon: Icon,
  title,
  count,
}: {
  id: string
  icon: typeof Crown
  title: string
  /** Ausente ⇒ sem contador (ex.: Delegar — capacidade não é fila). */
  count?: number
}) {
  return (
    <div className="mb-1.5 flex items-center gap-1.5">
      <Icon className="size-3.5 text-muted-foreground" aria-hidden="true" />
      <h3
        id={id}
        className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase"
      >
        {title}
      </h3>
      {count !== undefined && (
        <span className="ml-auto font-mono text-[10px] text-muted-foreground tabular-nums">
          {count}
        </span>
      )}
    </div>
  )
}

function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <p className="border-l-2 border-st-success/50 py-1 pl-2 text-[12px] text-muted-foreground">
      {children}
    </p>
  )
}

function DeskRow({
  item,
  attention = false,
  onOpen,
}: {
  item: BossDeskItem
  attention?: boolean
  onOpen: (item: BossDeskTarget) => void
}) {
  const detail = item.detail
    ? `${item.label} · ${item.detail}`
    : item.label
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="group flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      aria-label={`${agentLabel(item.agent)} em ${item.projectName}: ${detail}. Abrir conversa.`}
    >
      <span
        className={cn(
          "size-2 shrink-0 rounded-full",
          attention
            ? "bg-st-queued shadow-[0_0_7px_var(--st-queued)]"
            : "bg-st-running motion-safe:animate-cockpit-pulse",
        )}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-[12px] font-medium text-foreground">
            {agentLabel(item.agent)}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            {item.projectName}
          </span>
        </span>
        <span className={cn(
          "block truncate text-[11px]",
          attention ? "text-st-queued" : "text-muted-foreground",
        )}>
          {detail}
        </span>
      </span>
      <ArrowUpRight
        className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
        aria-hidden="true"
      />
    </button>
  )
}

function DeliveryRow({
  item,
  now,
  onOpenDelivery,
  onInspectRoom,
}: {
  item: BossDeliveryItem
  now: number
  onOpenDelivery: (item: BossDeliveryItem) => void
  onInspectRoom: (projectId: string) => void
}) {
  const action = item.convId
    ? "Abrir a conversa com o diff da entrega"
    : "Inspecionar sala"
  return (
    <button
      type="button"
      onClick={() => {
        if (!item.convId) return onInspectRoom(item.projectId)
        onOpenDelivery(item)
      }}
      className="group flex w-full items-start gap-2 rounded-md px-2 py-2 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      aria-label={`Entrega de ${agentLabel(item.agent)} em ${item.projectName}: ${item.text}. ${action}.`}
    >
      <CheckCheck className="mt-0.5 size-3.5 shrink-0 text-st-success" aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span className="truncate text-[12px] font-medium text-foreground">
            {agentLabel(item.agent)}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            {item.projectName} · {deliveryAge(item.at, now)}
          </span>
        </span>
        <span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
          {item.text}
        </span>
      </span>
      <ArrowUpRight
        className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
        aria-hidden="true"
      />
    </button>
  )
}

export function BossCenter({
  open,
  onClose,
  onOpenDesk,
  onInspectRoom,
  onOpenMission,
}: {
  open: boolean
  onClose: () => void
  onOpenDesk: (target: BossDeskTarget) => void
  onInspectRoom: (projectId: string) => void
  onOpenMission: () => void
}) {
  const snapshot = useOfficeUi((s) => s.snapshot)
  const briefing = useMemo(() => buildBossBriefing(snapshot), [snapshot])
  // "Falar com…" (delegar enxuto): seleção derivada com fallback — se o
  // projeto/agent escolhido sair do briefing, cai no primeiro válido em vez de
  // precisar de efeito de sincronização.
  const [talkProjectId, setTalkProjectId] = useState<string | null>(null)
  const [talkAgent, setTalkAgent] = useState<string | null>(null)
  const talkTeam =
    briefing.teams.find((team) => team.projectId === talkProjectId) ??
    briefing.teams[0]
  const talkDesk =
    talkTeam?.desks.find((desk) => desk.agent === talkAgent) ??
    talkTeam?.desks.find((desk) => desk.state !== "off") ??
    talkTeam?.desks[0]
  // Ranking "Maiores custos": ordena por custo DESC e mostra só as salas com
  // custo real (>0). Cópia — nunca muta o array do briefing.
  const topCosts = useMemo(
    () =>
      briefing.roomCosts
        .filter((room) => room.costUsd > 0)
        .sort((a, b) => b.costUsd - a.costUsd),
    [briefing.roomCosts],
  )
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) closeRef.current?.focus()
  }, [open])

  // Central aberta ⇒ os papéis deixados na mesa do Boss foram vistos: zera o
  // contador unseenDeliveries (incrementado pelo courier do pack mission).
  const clearUnseenDeliveries = useOfficeUi((s) => s.clearUnseenDeliveries)
  useEffect(() => {
    if (open) clearUnseenDeliveries()
  }, [open, clearUnseenDeliveries])

  if (!open) return null

  const closeAndRestoreFocus = () => {
    onClose()
    requestAnimationFrame(() =>
      document.getElementById(BOSS_CENTER_TRIGGER_ID)?.focus(),
    )
  }
  const openDesk = (target: BossDeskTarget) => {
    onClose()
    onOpenDesk(target)
  }
  const inspectRoom = (projectId: string) => {
    onClose()
    onInspectRoom(projectId)
  }
  // P3 — Entrega→diff em 1 clique: entrega clicada vai DIRETO pra conversa no
  // Trabalho com o diff do worktree aberto (helper navega + valida + toast
  // honesto quando não há mudanças). Não passa pelo dock do Office.
  const openDelivery = (item: BossDeliveryItem) => {
    if (!item.convId) return inspectRoom(item.projectId)
    onClose()
    void openDeliveryDiff({
      projectId: item.projectId,
      convId: item.convId,
      text: item.text,
    })
  }
  const now = Date.now()

  return (
    <aside
      id={BOSS_CENTER_ID}
      aria-labelledby={`${BOSS_CENTER_ID}-title`}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return
        event.preventDefault()
        closeAndRestoreFocus()
      }}
      className="pointer-events-auto absolute top-11 right-0 bottom-6 z-30 flex max-w-[calc(100%_-_16px)] flex-col border-l border-border bg-card shadow-xl motion-safe:animate-in motion-safe:slide-in-from-right-4 motion-safe:fade-in-0 motion-safe:duration-200"
      style={{ width: BOSS_CENTER_W }}
    >
      <header className="flex h-12 shrink-0 items-center gap-2.5 border-b border-border px-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-brass/50 bg-brass-soft text-brass">
          <Crown className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <h2 id={`${BOSS_CENTER_ID}-title`} className="text-[13px] font-semibold text-foreground">
            Central do Boss
          </h2>
          <p className="text-[11px] text-muted-foreground">Briefing ao vivo do escritório</p>
        </div>
        <button
          ref={closeRef}
          type="button"
          onClick={closeAndRestoreFocus}
          aria-label="Fechar Central do Boss"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </header>

      {/* Standup: linha-narrativa humana derivada do briefing (§8) — o custo
          do dia mora AQUI; o quad abaixo perdeu o stat Custo (sem duplicar). */}
      <p className="shrink-0 border-b border-border px-3 py-2 text-[12px] leading-snug text-foreground/90">
        {bossStandupLine(briefing, fmtCost)}
      </p>

      {/* Quad secundário (3 stats). ATENÇÃO é clicável: voa até a primeira
          mesa com a mão levantada (mesma coreografia do focusDesk da rail). */}
      <div className="grid shrink-0 grid-cols-3 border-b border-border bg-background/40">
        <button
          type="button"
          disabled={briefing.attention.length === 0}
          onClick={() => {
            const first = briefing.attention[0]
            if (first) openDesk(first)
          }}
          aria-label={
            briefing.attention.length > 0
              ? `Atenção: ${briefing.attention.length}. Ir até a primeira mesa com mão levantada.`
              : "Atenção: 0"
          }
          className={cn(
            "border-r border-border px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            briefing.attention.length > 0 &&
              "cursor-pointer transition-colors hover:bg-secondary",
          )}
        >
          <p
            className={cn(
              "truncate font-mono text-[11px] font-medium tabular-nums",
              briefing.attention.length > 0 ? "text-st-queued" : "text-foreground",
            )}
          >
            {briefing.attention.length}
          </p>
          <p className="truncate text-[9px] tracking-[0.06em] text-muted-foreground uppercase">
            Atenção
          </p>
        </button>
        {(
          [
            ["Ativos", briefing.running.length, true],
            ["Entregas", briefing.deliveries.length, false],
          ] as const
        ).map(([label, value, divider]) => (
          <div
            key={label}
            className={cn("px-2 py-2", divider && "border-r border-border")}
          >
            <p className="truncate font-mono text-[11px] font-medium text-foreground tabular-nums">
              {value}
            </p>
            <p className="truncate text-[9px] tracking-[0.06em] text-muted-foreground uppercase">
              {label}
            </p>
          </div>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
        <section aria-labelledby={`${BOSS_CENTER_ID}-actions`} className="mb-4">
          <SectionTitle
            id={`${BOSS_CENTER_ID}-actions`}
            icon={Crown}
            title="Delegar"
          />
          <button
            type="button"
            onClick={() => {
              onClose()
              onOpenMission()
            }}
            className="mb-2 flex w-full items-center justify-center gap-2 rounded-md bg-brass px-3 py-2 text-[12px] font-medium text-brass-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <Rocket className="size-3.5" aria-hidden="true" />
            Nova missão
          </button>
          {/* Falar com… (delegar enxuto): 1 linha projeto × agent no lugar da
              antiga parede de botões — capacidade preservada, ruído não. */}
          {talkTeam && talkDesk && (
            <div
              role="group"
              aria-label="Falar com um agent"
              className="flex items-center gap-1.5"
            >
              <select
                value={talkTeam.projectId}
                onChange={(event) => setTalkProjectId(event.target.value)}
                aria-label="Projeto"
                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {briefing.teams.map((team) => (
                  <option key={team.projectId} value={team.projectId}>
                    {team.projectName}
                  </option>
                ))}
              </select>
              <select
                value={talkDesk.agent}
                onChange={(event) => setTalkAgent(event.target.value)}
                aria-label="Agent"
                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 text-[11px] text-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {talkTeam.desks.map((desk) => (
                  <option
                    key={desk.agent}
                    value={desk.agent}
                    disabled={desk.state === "off"}
                  >
                    {agentLabel(desk.agent)}
                    {/* motivo real da mesa apagada (auth honesta) */}
                    {desk.state === "off" ? ` (${desk.label.toLowerCase()})` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={talkDesk.state === "off"}
                onClick={() => openDesk(talkDesk)}
                aria-label={`Falar com ${agentLabel(talkDesk.agent)} em ${talkTeam.projectName}`}
                title={`Falar com ${agentLabel(talkDesk.agent)}`}
                className="grid size-7 shrink-0 place-items-center rounded-md border border-border bg-background text-foreground/90 transition-colors hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <MessageSquareText className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
        </section>

        <section aria-labelledby={`${BOSS_CENTER_ID}-running`} className="mb-4">
          <SectionTitle
            id={`${BOSS_CENTER_ID}-running`}
            icon={Activity}
            title="Em execução"
            count={briefing.running.length}
          />
          <div className="flex flex-col">
            {briefing.running.length ? (
              briefing.running.map((item) => (
                <DeskRow key={item.id} item={item} onOpen={openDesk} />
              ))
            ) : (
              <EmptyLine>Nenhum agent em execução.</EmptyLine>
            )}
          </div>
        </section>

        <section aria-labelledby={`${BOSS_CENTER_ID}-deliveries`} className="mb-4">
          <SectionTitle
            id={`${BOSS_CENTER_ID}-deliveries`}
            icon={CheckCheck}
            title="Entregas recentes"
            count={briefing.deliveries.length}
          />
          <div className="flex flex-col">
            {briefing.deliveries.length ? (
              briefing.deliveries.map((item) => (
                <DeliveryRow
                  key={item.id}
                  item={item}
                  now={now}
                  onOpenDelivery={openDelivery}
                  onInspectRoom={inspectRoom}
                />
              ))
            ) : (
              <EmptyLine>Nenhuma entrega recente.</EmptyLine>
            )}
          </div>
        </section>

        <section aria-labelledby={`${BOSS_CENTER_ID}-costs`}>
          <SectionTitle
            id={`${BOSS_CENTER_ID}-costs`}
            icon={ReceiptText}
            title="Maiores custos"
            count={topCosts.length}
          />
          {/* Ranking por custo DESC — insight que a rail (em ordem espacial)
              não dá; o custo POR sala segue inline na rail. */}
          <div className="flex flex-col">
            {topCosts.map((room, index) => (
              <button
                key={room.projectId}
                type="button"
                onClick={() => inspectRoom(room.projectId)}
                className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                aria-label={`${index + 1}º maior custo: ${room.projectName}, ${fmtCost(room.costUsd)}. Inspecionar sala.`}
              >
                <span className="w-4 shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/90">
                  {room.projectName}
                </span>
                <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
                  {fmtCost(room.costUsd)}
                </span>
                <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
              </button>
            ))}
          </div>
        </section>
      </div>

      <footer className="flex shrink-0 items-center gap-1.5 border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
        <Crown className="size-3 text-brass" aria-hidden="true" />
        Dados do Office, sem chamadas adicionais aos agents
      </footer>
    </aside>
  )
}
