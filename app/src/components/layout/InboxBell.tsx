import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  BellPlus,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  EyeOff,
  FileText,
  Gauge,
  GitPullRequest,
  Inbox,
  Lightbulb,
  MessageCircleQuestion,
  ShieldQuestion,
  SquareKanban,
  Swords,
  Trash2,
  Undo2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { openCardConversation, useCards } from "@/store/cards"
import { useNotifs, type Notification } from "@/store/notifications"
import { agentLabel } from "@/lib/agent"
import { dismissProposal, setSddPlanIgnored } from "@/lib/db"
import {
  adoptPlan,
  cardDecisions,
  foundDecisions,
  ignoredDecisions,
  pendingDecisions,
  scanDecisions,
  type Decision,
} from "@/lib/inbox"
import { cn } from "@/lib/utils"

/** Navega direto pra ONDE a decisão mora: a conversa (Fusion), o card do
 *  board (E1) ou o plano (SDD). */
async function goTo(d: Decision) {
  const app = useApp.getState()
  // "Ver proposta" do sino: o card completo (expansível) mora na fila da FAIXA
  // do chrome (ADR-040 — antes morava no Painel). Abrir a fila é o gesto; ela
  // está visível de qualquer superfície (projectId opcional: board inteiro).
  if (d.kind === "proposal") {
    if (d.projectId) app.setActiveProject(d.projectId)
    app.setDecisionsOpen(true)
    return
  }
  app.setActiveProject(d.projectId)
  if (d.kind === "fusion") {
    await useChat.getState().openProject(d.projectId)
    await useChat.getState().switchConversation(d.convId)
    app.setViewMode("linear")
  } else if (d.kind === "card") {
    // Sem conversa ligada o card não tem tela própria (o Board saiu do Painel,
    // ADR-040): o lugar onde ele EXISTE é a fila da faixa. Abrir a fila é o
    // destino honesto; trocar de superfície pra nada seria clique morto.
    if (!(await openCardConversation(d.cardId))) app.setDecisionsOpen(true)
  } else {
    app.setSddFocus(d.slug)
    app.setViewMode("sdd")
  }
}

/** Abre a conversa de uma notificação. */
async function goToConv(n: Notification) {
  const app = useApp.getState()
  app.setActiveProject(n.projectId)
  await useChat.getState().openProject(n.projectId)
  if (n.convId) await useChat.getState().switchConversation(n.convId)
  app.setViewMode("linear")
}

function fmtRelative(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 60) return "agora"
  const m = Math.floor(s / 60)
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h} h`
  return `há ${Math.floor(h / 24)} d`
}

/** Idade a partir de um ISO (created_at do manifest do SDD). null/inválido =
 *  sem idade (mesmo formatador relativo do resto do app). */
function fmtRelativeIso(iso: string | null): string | null {
  if (!iso) return null
  const ts = Date.parse(iso)
  return Number.isFinite(ts) ? fmtRelative(ts) : null
}

/** Chave estável por decisão (o índice do array mudaria de dono ao filtrar). */
function decisionKey(d: Decision): string {
  return d.kind === "fusion"
    ? `fusion:${d.convId}`
    : d.kind === "card"
      ? `card:${d.cardId}`
      : d.kind === "proposal"
        ? `proposal:${d.proposalId}`
        : `${d.kind}:${d.projectId}:${d.slug}`
}

function DecisionIcon({ d }: { d: Decision }) {
  if (d.kind === "fusion") return <Swords className="size-3.5 shrink-0 text-brass" />
  if (d.kind === "card")
    return <SquareKanban className="size-3.5 shrink-0 text-st-warning" />
  if (d.kind === "prd") return <FileText className="size-3.5 shrink-0 text-brass" />
  if (d.kind === "proposal")
    return <Lightbulb className="size-3.5 shrink-0 text-brass" />
  return <GitPullRequest className="size-3.5 shrink-0 text-st-success" />
}

function decisionTitle(d: Decision): string {
  return d.kind === "fusion"
    ? "Escolher o vencedor da disputa"
    : d.kind === "card"
      ? `Card ${d.state === "blocked" ? "bloqueado" : "em revisão"}: ${d.title}`
      : d.kind === "prd"
        ? `Aprovar PRD: ${d.planTitle}`
        : d.kind === "proposal"
          ? "Ver proposta do lead"
          : `PR aberto: ${d.planTitle}`
}

/** Tooltip: mostra o que o truncamento come (disputa/card mostram o título
 *  cru; a proposta explica pra onde o clique leva). */
function decisionHint(d: Decision): string {
  return d.kind === "fusion" || d.kind === "card"
    ? d.title
    : d.kind === "proposal"
      ? "Abrir a proposta do lead na fila"
      : decisionTitle(d)
}

/** 2ª linha: pros gates do SDD, ORIGEM e IDADE visíveis (de onde o app leu e
 *  quando o plano nasceu) — é o que separa "isso te espera" de "isso estava
 *  aqui desde maio". */
function decisionMeta(d: Decision): string {
  if (d.kind === "fusion") return `${d.title} · ${d.projectName}`
  if (d.kind === "proposal")
    return `${d.projectName ?? "board inteiro"} · ${d.excerpt}`
  if (d.kind === "card")
    return d.stalledSince != null
      ? // S2.3: card estagnado (vigia) ganha o "parado há X min"
        `${d.projectName} · parado há ${Math.max(1, Math.round((Date.now() - d.stalledSince) / 60_000))} min`
      : d.projectName
  const age = fmtRelativeIso(d.createdAt)
  return [
    d.projectName,
    d.origin.path,
    age ? `criado ${age}` : null,
    d.kind === "pr" ? "aguardando merge" : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

/** Uma linha do inbox. `action` é o gesto discreto do hover (dispensar a
 *  proposta, ignorar o plano descoberto, restaurar o ignorado). */
interface RowAction {
  icon: typeof X
  label: string
  run: () => void
}

function DecisionRow({
  d,
  actions,
  muted,
}: {
  d: Decision
  /** Ações da linha (aparecem no hover, sem navegar). */
  actions?: RowAction[]
  muted?: boolean
}) {
  return (
    <DropdownMenuItem
      onSelect={() => void goTo(d)}
      className="flex-col items-start gap-0.5 py-2"
    >
      <span
        className={cn(
          "group/decision flex w-full items-center gap-2 text-[13px]",
          muted ? "text-muted-foreground" : "text-foreground",
        )}
        title={decisionHint(d)}
      >
        <DecisionIcon d={d} />
        <span className="min-w-0 flex-1 truncate">{decisionTitle(d)}</span>
        {actions?.map(({ icon: Icon, label, run }) => (
          <button
            key={label}
            onClick={(e) => {
              // age SEM navegar (o item some/volta na hora).
              e.stopPropagation()
              e.preventDefault()
              run()
            }}
            title={label}
            aria-label={label}
            className="hidden shrink-0 rounded p-0.5 text-muted-foreground transition-colors group-hover/decision:block hover:text-foreground"
          >
            <Icon className="size-3" />
          </button>
        ))}
      </span>
      <span className="w-full truncate pl-[22px] text-[11px] text-muted-foreground">
        {decisionMeta(d)}
      </span>
    </DropdownMenuItem>
  )
}

function NotifIcon({ kind }: { kind: Notification["kind"] }) {
  if (kind === "run_error")
    return <AlertCircle className="size-3.5 shrink-0 text-st-error" />
  if (kind === "limit")
    return <Gauge className="size-3.5 shrink-0 text-st-warning" />
  if (kind === "gate")
    return <CircleHelp className="size-3.5 shrink-0 text-st-warning" />
  if (kind === "approval")
    return <ShieldQuestion className="size-3.5 shrink-0 text-st-warning" />
  // pergunta: mesma família âmbar do approval/gate (todos "esperam VOCÊ"), mas
  // ícone de fala — é conteúdo que falta, não autorização.
  if (kind === "question")
    return <MessageCircleQuestion className="size-3.5 shrink-0 text-st-warning" />
  return <Check className="size-3.5 shrink-0 text-st-success" />
}

/** Inbox do cockpit: decisões que esperam VOCÊ + feed de atividade (turnos
 *  concluídos, erros, limites), com lido/não-lido. */
export function InboxBell() {
  const projects = useApp((s) => s.projects)
  const limited = useApp((s) => s.limitedAgents)
  const [decisions, setDecisions] = useState<Decision[]>([])
  const notifs = useNotifs((s) => s.items)
  const markRead = useNotifs((s) => s.markRead)
  const markAllRead = useNotifs((s) => s.markAllRead)
  const removeNotif = useNotifs((s) => s.remove)
  const clearNotifs = useNotifs((s) => s.clear)
  const [filter, setFilter] = useState<"all" | "unread">("all")
  const [showIgnored, setShowIgnored] = useState(false)

  const refresh = useCallback(() => {
    if (projects.length === 0) return
    // E1 (S1.6): cards em review/blocked entram no sino também (D4) — o store
    // é hidratado no boot, então getState() dentro do refresh basta (mesmo
    // ritmo do scan: ao abrir o dropdown e na troca de projetos).
    // includeIgnored: o sino é o ÚNICO lugar que sabe reverter um "ignorar",
    // então ele carrega os ignorados junto (fora das duas listas visíveis).
    void scanDecisions(projects, { includeIgnored: true }).then((d) =>
      setDecisions([...d, ...cardDecisions(useCards.getState().all, projects)]),
    )
  }, [projects])

  useEffect(() => {
    refresh()
  }, [refresh])

  // Três listas com semânticas diferentes: o que ESPERA você (badge), o que o
  // app só ACHOU no seu disco e o que você mandou sumir.
  const pending = useMemo(() => pendingDecisions(decisions), [decisions])
  const found = useMemo(() => foundDecisions(decisions), [decisions])
  const ignored = useMemo(() => ignoredDecisions(decisions), [decisions])

  /** Ignorar/restaurar um gate do SDD. Persistido na tabela do app (o
   *  .claude/plans do usuário NUNCA é escrito). Falhou (inclusive "sem banco")
   *  = o item NÃO some. */
  const setIgnored = useCallback(
    (d: Extract<Decision, { kind: "prd" | "pr" }>, ignore: boolean) => {
      void setSddPlanIgnored(d.projectId, d.slug, ignore)
        .then((saved) => {
          if (!saved) {
            console.warn("[inbox] sem banco: o plano não foi ignorado/restaurado")
            return
          }
          refresh()
        })
        .catch((err) => {
          console.warn("[inbox] falha ao ignorar/restaurar o plano", err)
        })
    },
    [refresh],
  )

  /** Adotar um gate ACHADO no disco: ele sobe pra "Precisam de você" e passa a
   *  contar no badge. Também é o resgate do plano que nasceu no app e perdeu a
   *  marca da adoção (banco travado na hora da criação). */
  const adopt = useCallback(
    (d: Extract<Decision, { kind: "prd" | "pr" }>) => {
      void adoptPlan(d.projectId, d.slug).then((ok) => {
        // adoptPlan já avisou no console; sem gravação, nada muda de seção.
        if (ok) refresh()
      })
    },
    [refresh],
  )

  const unread = notifs.filter((n) => !n.read).length
  const limitedIds = Object.keys(limited)
  const feed = filter === "unread" ? notifs.filter((n) => !n.read) : notifs

  return (
    <DropdownMenu onOpenChange={(o) => o && refresh()}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="pointer-events-auto relative text-muted-foreground hover:text-foreground"
          title="Notificações"
          aria-label="Notificações"
        >
          <Inbox className="size-4" />
          {/* Decisões BLOQUEIAM você → contador brass (alarme). Só não-lidas →
              ponto discreto (informativo). Não somar os dois: "3" seria ambíguo
              entre "3 decisões esperando" e "3 turnos terminaram".
              O badge conta só o PENDENTE: gate do SDD que o app apenas achou no
              disco (sem gesto seu por aqui) vive na seção de baixo e não acende
              alarme, senão dívida de 68 dias vira "precisa de você agora". */}
          {pending.length > 0 ? (
            <span className="absolute -top-0.5 -right-0.5 grid size-4 place-items-center rounded-full bg-brass text-[11px] font-semibold text-background">
              {pending.length > 9 ? "9+" : pending.length}
            </span>
          ) : unread > 0 ? (
            <span
              className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-muted-foreground ring-2 ring-rail"
              title={`${unread} não lidas`}
            />
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      {/* sideOffset + z-[120]: mesmo clipping que a UsagePill tinha. O header
          da TitleBar é z-[110], então no z-50 padrão do dropdown a borda de
          cima do popover ficava ATRÁS da faixa de título. */}
      <DropdownMenuContent
        align="end"
        sideOffset={8}
        className="z-[120] max-h-[75vh] w-96 overflow-y-auto"
      >
        {/* Decisões — o que espera ação sua */}
        <DropdownMenuLabel className="text-[11px] tracking-wide text-muted-foreground uppercase">
          Precisam de você
        </DropdownMenuLabel>
        {pending.length === 0 ? (
          <div className="px-2 py-2 text-center text-[12px] text-muted-foreground">
            Nada esperando você.
          </div>
        ) : (
          pending.map((d) => (
            <DecisionRow
              key={decisionKey(d)}
              d={d}
              actions={
                d.kind === "proposal"
                  ? [
                      {
                        icon: X,
                        label: "Dispensar a proposta",
                        run: () =>
                          void dismissProposal(d.proposalId)
                            .then(refresh)
                            .catch((err) => {
                              // falhou = o item FICA na fila (não some mentindo).
                              console.warn(
                                "[inbox] falha ao dispensar a proposta",
                                err,
                              )
                            }),
                      },
                    ]
                  : d.kind === "prd" || d.kind === "pr"
                    ? [
                        {
                          icon: EyeOff,
                          label: "Ignorar este plano",
                          run: () => setIgnored(d, true),
                        },
                      ]
                    : undefined
              }
            />
          ))
        )}

        {/* Encontrados no projeto — o app LEU do disco, ninguém te chamou. Não
            conta no badge; conta a partir do 1º gesto seu pelo app no plano. */}
        {found.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[11px] tracking-wide text-muted-foreground uppercase">
              Encontrados no projeto ({found.length})
            </DropdownMenuLabel>
            {found.map((d) => (
              <DecisionRow
                key={decisionKey(d)}
                d={d}
                muted
                actions={
                  d.kind === "prd" || d.kind === "pr"
                    ? [
                        {
                          icon: BellPlus,
                          label: "Adotar (passa a contar como pendência)",
                          run: () => adopt(d),
                        },
                        {
                          icon: EyeOff,
                          label: "Ignorar este plano",
                          run: () => setIgnored(d, true),
                        },
                      ]
                    : undefined
                }
              />
            ))}
          </>
        )}

        {/* Ignorados — linha discreta que expande, pra ver e desfazer. */}
        {ignored.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <button
              onClick={() => setShowIgnored((v) => !v)}
              className="flex w-full items-center gap-1.5 px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            >
              {showIgnored ? (
                <ChevronDown className="size-3 shrink-0" />
              ) : (
                <ChevronRight className="size-3 shrink-0" />
              )}
              {ignored.length} ignorado{ignored.length > 1 ? "s" : ""}
            </button>
            {showIgnored &&
              ignored.map((d) => (
                <DecisionRow
                  key={decisionKey(d)}
                  d={d}
                  muted
                  actions={
                    d.kind === "prd" || d.kind === "pr"
                      ? [
                          {
                            icon: Undo2,
                            label: "Trazer de volta",
                            run: () => setIgnored(d, false),
                          },
                        ]
                      : undefined
                  }
                />
              ))}
          </>
        )}

        {limitedIds.length > 0 && (
          <>
            <DropdownMenuSeparator />
            {limitedIds.map((id) => (
              <div
                key={id}
                className="flex items-center gap-2 px-2 py-1.5 text-[12px] text-st-warning/80"
              >
                <Gauge className="size-3.5 shrink-0" />
                <span className="truncate">
                  {agentLabel(id)} limitado
                  {limited[id] ? `, volta ${limited[id]}` : ""}
                </span>
              </div>
            ))}
          </>
        )}

        {/* Atividade — feed de eventos (turnos, erros, limites) */}
        {notifs.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <div className="flex items-center justify-between gap-2 px-2 py-1">
              <span className="text-[11px] tracking-wide text-muted-foreground uppercase">
                Atividade
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setFilter("all")}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[11px] transition-colors",
                    filter === "all"
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Tudo
                </button>
                <button
                  onClick={() => setFilter("unread")}
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[11px] transition-colors",
                    filter === "unread"
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Não-lidas{unread > 0 ? ` (${unread})` : ""}
                </button>
                <button
                  onClick={() => markAllRead()}
                  disabled={unread === 0}
                  title="Marcar todas como lidas"
                  aria-label="Marcar todas como lidas"
                  className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                >
                  <CheckCheck className="size-3.5" />
                </button>
                <button
                  onClick={() => clearNotifs()}
                  title="Limpar a atividade"
                  aria-label="Limpar a atividade"
                  className="rounded p-1 text-muted-foreground transition-colors hover:text-st-error"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </div>
            {feed.length === 0 ? (
              <div className="px-2 py-2 text-center text-[12px] text-muted-foreground">
                Nada não-lido.
              </div>
            ) : (
              feed.map((n) => (
                <DropdownMenuItem
                  key={n.id}
                  onSelect={() => {
                    markRead(n.id)
                    void goToConv(n)
                  }}
                  className="flex-col items-start gap-0.5 py-2"
                >
                  <span className="group/notif flex w-full items-center gap-2 text-[13px] text-foreground">
                    <NotifIcon kind={n.kind} />
                    <span className="min-w-0 flex-1 truncate">{n.title}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground/60">
                      {fmtRelative(n.ts)}
                    </span>
                    {!n.read && (
                      <span className="size-1.5 shrink-0 rounded-full bg-brass group-hover/notif:hidden" />
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        e.preventDefault()
                        removeNotif(n.id)
                      }}
                      title="Dispensar"
                      aria-label="Dispensar notificação"
                      className="hidden shrink-0 rounded p-0.5 text-muted-foreground transition-colors group-hover/notif:block hover:text-st-error"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                  <span className="w-full truncate pl-[22px] text-[11px] text-muted-foreground">
                    {n.subtitle} ·{" "}
                    {n.kind === "run_error"
                      ? "turno falhou"
                      : n.kind === "limit"
                        ? "limite atingido"
                        : n.kind === "gate"
                          ? "missão pausada"
                          : n.kind === "approval" || n.kind === "question"
                            ? "turno parado"
                            : "turno concluído"}
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </>
        )}

        {decisions.length === 0 && notifs.length === 0 && (
          <div className="px-2 py-3 text-center text-[13px] text-muted-foreground">
            Tudo em dia. Nada por aqui.
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
