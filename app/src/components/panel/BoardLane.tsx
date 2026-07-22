// E1 (S1.5) — Board de intenção no Painel: três colunas (Backlog · Em
// andamento · Feito) alimentadas pelo useCards, entre AÇÕES e "PRECISAM DE
// VOCÊ". Segue o visual das seções vizinhas (SectionTitle label-mono, cards
// com a moldura da fila, ações brass/ghost). Custo por card v1 = turn_costs
// por conv_id (chat + disputas); missão e SDD ficam fora, e a UI diz isso.

import { useEffect, useMemo, useState } from "react"
import { Lightbulb, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { useApp } from "@/store/app"
import { openCardConversation, useCards } from "@/store/cards"
import { listCardCosts, type CardRecord, type CardState } from "@/lib/db"
import { fmtCost } from "@/lib/format"
import { isOpenCardState, proposePlan } from "@/lib/lead"
import { cn } from "@/lib/utils"

type CardCosts = Record<string, { total: number; estimated: boolean }>

const COST_HINT = "Custo de chat e disputas. Missão e SDD ficam fora no v1."

/** Rótulo pt-BR de cada estado (badge do card). */
const STATE_LABEL: Record<CardState, string> = {
  backlog: "backlog",
  working: "em andamento",
  review: "em revisão",
  blocked: "bloqueado",
  done: "feito",
  cancelled: "cancelado",
}

/** Executa uma ação do board; violação de gate/transição vira toast, não
 *  crash. Retorna se a ação COMPLETOU (o caller decide limpar formulário etc). */
async function tryAction(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn()
    return true
  } catch (e) {
    toast.error(e instanceof Error ? e.message : "Ação inválida no board")
    return false
  }
}

/** Inicia o card (S1.4, gesto humano): dispatch cria a conversa nova, liga e
 *  vira working — depois navega até ela (newConversation já a abriu no chat). */
async function startCard(card: CardRecord): Promise<void> {
  await tryAction(async () => {
    const convId = await useCards.getState().dispatch(card.id)
    if (!convId) return
    const app = useApp.getState()
    app.setActiveProject(card.projectId)
    app.setViewMode("linear")
  })
}

function LaneAction({
  children,
  tone = "ghost",
  disabled,
  onClick,
}: {
  children: React.ReactNode
  tone?: "brass" | "ghost"
  disabled?: boolean
  onClick: (e: React.MouseEvent) => void
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "disabled:opacity-40",
        "shrink-0 rounded px-1.5 py-0.5 text-[10.5px] font-medium transition-colors",
        tone === "brass"
          ? "bg-brass text-background hover:opacity-90"
          : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

function BoardCard({
  card,
  projectName,
  archivedProject,
  cost,
  selected,
}: {
  card: CardRecord
  projectName: string
  /** F-E: o projeto do card foi arquivado (sumiu do useApp.projects). O card
   *  fica no board (a intenção sobrevive), mas Iniciar/abrir conversa são
   *  desabilitados — conversa em projeto invisível é armadilha. closeCard
   *  segue permitido: encerrar intenção órfã é gesto legítimo. */
  archivedProject: boolean
  cost: { total: number; estimated: boolean } | null
  selected: boolean
}) {
  const move = useCards((s) => s.move)
  const close = useCards((s) => s.closeCard)
  // D2: além da guarda in-flight do store, o botão trava enquanto o dispatch
  // voa — duplo-clique não cria segunda conversa nem pisca estado.
  const [starting, setStarting] = useState(false)
  const terminal = card.state === "done" || card.state === "cancelled"
  const open = () => {
    // projeto arquivado: nunca navega pra conversa invisível — só seleciona.
    if (card.conversationId && !archivedProject) void openCardConversation(card.id)
    else useCards.getState().select(card.id)
  }
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => {
        if (e.key === "Enter") open()
      }}
      className={cn(
        "cursor-pointer rounded-lg border border-border/70 bg-card/40 px-3 py-2 transition-colors hover:border-border hover:bg-accent/40",
        selected && "border-brass/60 ring-1 ring-brass/40",
        terminal && "opacity-70",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-foreground">
          {card.title}
        </span>
        {archivedProject && (
          <span className="shrink-0 rounded border border-border px-1.5 py-px text-[9.5px] tracking-wide text-muted-foreground uppercase">
            projeto arquivado
          </span>
        )}
        {(card.state === "review" ||
          card.state === "blocked" ||
          card.state === "cancelled") && (
          <span
            className={cn(
              "shrink-0 rounded border px-1.5 py-px text-[9.5px] tracking-wide uppercase",
              card.state === "blocked"
                ? "border-st-error/50 bg-st-error/10 text-st-error"
                : card.state === "review"
                  ? "border-st-warning/50 bg-st-warning/10 text-st-warning"
                  : "border-border text-muted-foreground",
            )}
          >
            {STATE_LABEL[card.state]}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
        <span className="min-w-0 truncate">{projectName}</span>
        {card.assigneeAgent && (
          <span className="shrink-0 truncate">· {card.assigneeAgent}</span>
        )}
        {cost && cost.total > 0 && (
          <span
            className="shrink-0 font-mono tabular-nums"
            title={COST_HINT}
          >
            {cost.estimated ? "~" : ""}
            {fmtCost(cost.total)}
          </span>
        )}
      </div>
      {!terminal && (
        <div className="mt-1.5 flex items-center gap-1">
          {card.state === "backlog" && (
            <>
              <LaneAction
                tone="brass"
                // F-E: projeto arquivado não ganha conversa nova (invisível).
                disabled={starting || archivedProject}
                onClick={(e) => {
                  e.stopPropagation()
                  if (starting || archivedProject) return
                  setStarting(true)
                  void startCard(card).finally(() => setStarting(false))
                }}
              >
                {starting ? "Iniciando…" : "Iniciar"}
              </LaneAction>
              <LaneAction
                onClick={(e) => {
                  e.stopPropagation()
                  void tryAction(() => close(card.id, "cancelled"))
                }}
              >
                Cancelar
              </LaneAction>
            </>
          )}
          {card.state === "working" && (
            <>
              <LaneAction
                onClick={(e) => {
                  e.stopPropagation()
                  void tryAction(() => move(card.id, "review"))
                }}
              >
                Revisão
              </LaneAction>
              <LaneAction
                onClick={(e) => {
                  e.stopPropagation()
                  void tryAction(() => move(card.id, "blocked"))
                }}
              >
                Bloqueado
              </LaneAction>
            </>
          )}
          {(card.state === "review" || card.state === "blocked") && (
            <>
              <LaneAction
                tone="brass"
                onClick={(e) => {
                  e.stopPropagation()
                  void tryAction(() => close(card.id, "done"))
                }}
              >
                Concluir
              </LaneAction>
              <LaneAction
                onClick={(e) => {
                  e.stopPropagation()
                  void tryAction(() => move(card.id, "working"))
                }}
              >
                Retomar
              </LaneAction>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Lane({
  label,
  cards,
  projectNames,
  costs,
  selectedId,
  hiddenOlder = 0,
}: {
  label: string
  cards: CardRecord[]
  projectNames: Map<string, string>
  costs: CardCosts
  selectedId: string | null
  /** F-F: quantos cards mais antigos ficaram FORA do corte (só honestidade,
   *  sem paginação). 0 = nada cortado. */
  hiddenOlder?: number
}) {
  return (
    <div className="min-w-0">
      <div className="label-mono mb-1.5 px-1 text-[9px]">
        {label} ({cards.length})
      </div>
      <div className="flex flex-col gap-1.5">
        {cards.map((c) => (
          <BoardCard
            key={c.id}
            card={c}
            projectName={projectNames.get(c.projectId) ?? "projeto"}
            archivedProject={!projectNames.has(c.projectId)}
            cost={
              c.conversationId ? (costs[c.conversationId] ?? null) : null
            }
            selected={selectedId === c.id}
          />
        ))}
        {hiddenOlder > 0 && (
          <div className="px-1 py-0.5 text-[10.5px] text-muted-foreground/70">
            e mais {hiddenOlder} {hiddenOlder === 1 ? "antigo" : "antigos"}
          </div>
        )}
      </div>
    </div>
  )
}

export function BoardLane({
  /** S4.3: proposta nova gravada — o Painel re-escaneia a fila na hora. */
  onProposal,
}: {
  onProposal?: () => void
} = {}) {
  const projects = useApp((s) => s.projects)
  const activeProjectId = useApp((s) => s.activeProjectId)
  const cards = useCards((s) => s.all)
  const selectedId = useCards((s) => s.selectedId)
  const create = useCards((s) => s.create)

  // ── S4.3: "Pedir proposta ao lead" (gesto manual, opt-in) ──
  // O board aqui é cross-projeto, então a triagem é do BOARD INTEIRO
  // (proposePlan sem projectId — helper resolvido pelo default global).
  // Desabilitado sem card aberto: lead sem board não tem o que triar.
  const [asking, setAsking] = useState(false)
  const hasOpenCards = cards.some((c) => isOpenCardState(c.state))
  async function askLead() {
    if (asking) return
    setAsking(true)
    const toastId = toast.loading("Pedindo a proposta ao lead…")
    try {
      const id = await proposePlan()
      if (id) {
        toast.success('Proposta pronta. Veja em "Precisam de você".', {
          id: toastId,
        })
        onProposal?.()
      } else {
        toast('O lead não teve o que propor.', { id: toastId })
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Falha ao pedir a proposta ao lead",
        { id: toastId },
      )
    } finally {
      setAsking(false)
    }
  }

  const projectNames = useMemo(
    () => new Map(projects.map((p) => [p.id, p.name])),
    [projects],
  )

  // Colunas: "Em andamento" agrega working + review + blocked (o badge
  // diferencia); "Feito" agrega done + cancelled, mais recentes primeiro,
  // cortada em 8 — o corte é ANUNCIADO ("e mais N antigos", F-F), não mudo.
  const lanes = useMemo(() => {
    const doneAll = cards
      .filter((c) => c.state === "done" || c.state === "cancelled")
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return {
      backlog: cards.filter((c) => c.state === "backlog"),
      doing: cards.filter(
        (c) =>
          c.state === "working" ||
          c.state === "review" ||
          c.state === "blocked",
      ),
      done: doneAll.slice(0, 8),
      doneHidden: Math.max(0, doneAll.length - 8),
    }
  }, [cards])

  // Custo por card: query direta em turn_costs por conv_id, refresh 30s (mesmo
  // ritmo das varreduras do Painel). Cobre chat + disputas; missão/SDD ficam
  // fora e o tooltip do valor admite isso.
  const convIds = useMemo(
    () =>
      cards
        .map((c) => c.conversationId)
        .filter((id): id is string => id != null),
    [cards],
  )
  const [costs, setCosts] = useState<CardCosts>({})
  useEffect(() => {
    let cancelled = false
    const refresh = () => {
      if (convIds.length === 0) {
        setCosts({}) // derivação real: nenhum card tem conversa ligada
        return
      }
      listCardCosts(convIds)
        .then((m) => {
          if (!cancelled) setCosts(m)
        })
        .catch(() => {
          // erro transitório NÃO apaga custo da tela: mantém o last-known
          // (o console.warn já saiu no listCardCosts).
        })
    }
    refresh()
    const timer = setInterval(refresh, 30_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [convIds])

  // Criar card inline: título + projeto (default: o projeto ativo).
  const [title, setTitle] = useState("")
  const [projectChoice, setProjectChoice] = useState("")
  const targetProject =
    projectChoice || activeProjectId || projects[0]?.id || ""

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const t = title.trim()
    if (!t || !targetProject) return
    // só limpa o rascunho se o create COMPLETOU (falha preserva o digitado).
    const ok = await tryAction(() => create(targetProject, t))
    if (ok) setTitle("")
  }

  return (
    <section aria-label="Board">
      <div className="mb-1.5 flex items-center px-1">
        <h2 className="label-mono">Board</h2>
        {/* O lead SÓ propõe (texto na fila); despachar segue gesto humano. */}
        <button
          onClick={() => void askLead()}
          disabled={asking || !hasOpenCards}
          title={
            hasOpenCards
              ? "O lead lê os cards abertos e escreve uma proposta de triagem (nada é despachado)"
              : "Sem cards abertos, o lead não tem o que triar"
          }
          className="ml-auto flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11.5px] font-medium text-foreground transition-colors hover:bg-accent/60 disabled:opacity-40"
        >
          {asking ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Lightbulb className="size-3 text-brass" />
          )}
          {asking ? "Pedindo…" : "Pedir proposta ao lead"}
        </button>
      </div>
      {cards.length === 0 ? (
        <p className="px-1 py-1 text-[12.5px] text-muted-foreground/80">
          Nenhum card ainda. Crie a primeira intenção abaixo.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 px-1">
          <Lane
            label="Backlog"
            cards={lanes.backlog}
            projectNames={projectNames}
            costs={costs}
            selectedId={selectedId}
          />
          <Lane
            label="Em andamento"
            cards={lanes.doing}
            projectNames={projectNames}
            costs={costs}
            selectedId={selectedId}
          />
          <Lane
            label="Feito"
            cards={lanes.done}
            projectNames={projectNames}
            costs={costs}
            selectedId={selectedId}
            hiddenOlder={lanes.doneHidden}
          />
        </div>
      )}
      <form onSubmit={submit} className="mt-2 flex items-center gap-2 px-1">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Novo card no backlog"
          className="h-8 min-w-0 flex-1 rounded-md border border-border/70 bg-secondary/20 px-2.5 text-[12.5px] text-foreground placeholder:text-muted-foreground/60 focus:border-brass/50 focus:outline-none"
        />
        <select
          value={targetProject}
          onChange={(e) => setProjectChoice(e.target.value)}
          aria-label="Projeto do card"
          className="h-8 shrink-0 rounded-md border border-border/70 bg-secondary/20 px-2 text-[12px] text-foreground focus:border-brass/50 focus:outline-none"
        >
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={!title.trim() || !targetProject}
          className="h-8 shrink-0 rounded-md bg-brass px-3 text-[12px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Criar
        </button>
      </form>
    </section>
  )
}
