// E1 (S1.5) — Board de intenção no Painel: três colunas (Backlog · Em
// andamento · Feito) alimentadas pelo useCards, entre AÇÕES e "PRECISAM DE
// VOCÊ". Segue o visual das seções vizinhas (SectionTitle label-mono, cards
// com a moldura da fila, ações brass/ghost). Custo por card v1 = turn_costs
// por conv_id (chat + disputas); missão e SDD ficam fora, e a UI diz isso.
// Ações/átomos do card moram em cardActions.tsx (compartilhados com o
// CardDetailDialog — fonte única, nenhum caminho novo de estado).

import { useEffect, useMemo, useState } from "react"
import { Archive, ChevronDown, ChevronRight, Lightbulb, Loader2, Plus } from "lucide-react"
import { toast } from "sonner"
import { useApp } from "@/store/app"
import { useCards } from "@/store/cards"
import { listCardCosts, type CardRecord } from "@/lib/db"
import { fmtCost } from "@/lib/format"
import { isOpenCardState, proposePlan } from "@/lib/lead"
import { cn } from "@/lib/utils"
import { CardDetailDialog } from "@/components/panel/CardDetailDialog"
import {
  CardStateActions,
  CardStateBadge,
  tryAction,
} from "@/components/panel/cardActions"

type CardCosts = Record<string, { total: number; estimated: boolean }>

const COST_HINT = "Custo de chat e disputas. Missão e SDD ficam fora no v1."

function BoardCard({
  card,
  projectName,
  archivedProject,
  cost,
  selected,
  onOpenDetail,
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
  onOpenDetail: (id: string) => void
}) {
  const terminal = card.state === "done" || card.state === "cancelled"
  // Clique no CORPO abre o DETALHE (pedido real de uso: ver/acrescentar
  // contexto). Navegar pra conversa continua a um clique, no botão "Abrir
  // conversa" do detalhe — a fila "Precisam de você" segue navegando direto.
  const open = () => {
    useCards.getState().select(card.id)
    onOpenDetail(card.id)
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
          card.state === "cancelled") && <CardStateBadge state={card.state} />}
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
      <CardStateActions
        card={card}
        archivedProject={archivedProject}
        className="mt-1.5"
      />
    </div>
  )
}

function Lane({
  label,
  cards,
  projectNames,
  costs,
  selectedId,
  onOpenDetail,
  hiddenOlder = 0,
}: {
  label: string
  cards: CardRecord[]
  projectNames: Map<string, string>
  costs: CardCosts
  selectedId: string | null
  onOpenDetail: (id: string) => void
  /** F-F: quantos cards mais antigos ficaram FORA do corte (só honestidade,
   *  sem paginação). 0 = nada cortado. */
  hiddenOlder?: number
}) {
  return (
    <div className="min-w-0">
      {/* sub-cabeçalho de coluna: menor e mais apagado que o SectionTitle
          BOARD — dois label-mono iguais e colados viravam um bloco só. */}
      <div className="label-mono mb-1.5 px-1 text-[9px] opacity-70">
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
            onOpenDetail={onOpenDetail}
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
  const archived = useCards((s) => s.archived)
  const selectedId = useCards((s) => s.selectedId)
  const create = useCards((s) => s.create)
  // Detalhe do card (dialog): aberto pelo clique no corpo do card. A seleção
  // vinda da fila/BossCenter continua só destacando (não força modal em cima
  // de uma navegação que o usuário não pediu).
  const [detailId, setDetailId] = useState<string | null>(null)
  // Criar card: a linha de criação agora nasce no TOPO do board (o botão
  // "+ Novo" a abre) — antes ficava no rodapé e AFUNDAVA conforme os cards
  // enchiam as colunas. Some quando não se está criando.
  const [creating, setCreating] = useState(false)
  // "Arquivados": disclosure recolhido por padrão (fora do fluxo do board).
  const [showArchived, setShowArchived] = useState(false)

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
    // Mantém a linha ABERTA pra criação em sequência (fechar é o Esc/Cancelar).
    const ok = await tryAction(() => create(targetProject, t))
    if (ok) setTitle("")
  }

  return (
    <section aria-label="Board">
      {/* respiro título→colunas maior que o mb-1.5 das seções vizinhas de
          propósito: aqui o conteúdo abre com OUTRO label-mono (BACKLOG…), não
          com um card — sem o gap extra os dois títulos colavam num bloco só. */}
      <div className="mb-3 flex items-center gap-2 px-1">
        <h2 className="label-mono">Board</h2>
        <div className="ml-auto flex items-center gap-2">
          {/* "+ Novo" no TOPO: a criação não afunda mais com o board. */}
          <button
            onClick={() => setCreating((v) => !v)}
            aria-expanded={creating}
            title="Criar um card no backlog"
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11.5px] font-medium text-foreground transition-colors hover:bg-accent/60"
          >
            <Plus className="size-3" />
            Novo
          </button>
          {/* O lead SÓ propõe (texto na fila); despachar segue gesto humano. */}
          <button
            onClick={() => void askLead()}
            disabled={asking || !hasOpenCards}
            title={
              hasOpenCards
                ? "O lead lê os cards abertos e escreve uma proposta de triagem (nada é despachado)"
                : "Sem cards abertos, o lead não tem o que triar"
            }
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[11.5px] font-medium text-foreground transition-colors hover:bg-accent/60 disabled:opacity-40"
          >
            {asking ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <Lightbulb className="size-3 text-brass" />
            )}
            {asking ? "Pedindo…" : "Pedir proposta ao lead"}
          </button>
        </div>
      </div>

      {/* Linha de criação (topo, condicional): título + projeto + Criar. Esc
          fecha; o Criar mantém aberta pra criar em sequência. */}
      {creating && (
        <form
          onSubmit={submit}
          className="mb-3 flex items-center gap-2 px-1"
          onKeyDown={(e) => {
            if (e.key === "Escape") setCreating(false)
          }}
        >
          <input
            autoFocus
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
          <button
            type="button"
            onClick={() => setCreating(false)}
            className="h-8 shrink-0 rounded-md px-2 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Cancelar
          </button>
        </form>
      )}

      {cards.length === 0 ? (
        <p className="px-1 py-1 text-[12.5px] text-muted-foreground/80">
          Nenhum card ainda. Crie a primeira intenção no botão{" "}
          <span className="text-foreground">+ Novo</span>.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-3 px-1">
          <Lane
            label="Backlog"
            cards={lanes.backlog}
            projectNames={projectNames}
            costs={costs}
            selectedId={selectedId}
            onOpenDetail={setDetailId}
          />
          <Lane
            label="Em andamento"
            cards={lanes.doing}
            projectNames={projectNames}
            costs={costs}
            selectedId={selectedId}
            onOpenDetail={setDetailId}
          />
          <Lane
            label="Feito"
            cards={lanes.done}
            projectNames={projectNames}
            costs={costs}
            selectedId={selectedId}
            onOpenDetail={setDetailId}
            hiddenOlder={lanes.doneHidden}
          />
        </div>
      )}
      <CardDetailDialog
        cardId={detailId}
        onClose={() => setDetailId(null)}
        projectNames={projectNames}
        costs={costs}
      />

      {/* Arquivados: fora do fluxo do board, recolhido. Cada linha abre o mesmo
          detalhe (onde moram Restaurar e Apagar). */}
      {archived.length > 0 && (
        <div className="mt-4 border-t border-border/60 px-1 pt-3">
          <button
            onClick={() => setShowArchived((v) => !v)}
            aria-expanded={showArchived}
            className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase transition-colors hover:text-foreground"
          >
            {showArchived ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )}
            <Archive className="size-3" />
            Arquivados ({archived.length})
          </button>
          {showArchived && (
            <div className="mt-2 flex flex-col gap-1">
              {archived.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setDetailId(c.id)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/40"
                >
                  <span className="min-w-0 flex-1 truncate text-[12px] text-foreground/80">
                    {c.title}
                  </span>
                  <span className="shrink-0 truncate text-[11px] text-muted-foreground">
                    {projectNames.get(c.projectId) ?? "projeto arquivado"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
