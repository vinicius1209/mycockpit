import type { CardRow } from "@/store/cards"
import type {
  DeskVisualState,
  OfficeAgentId,
  OfficeSnapshot,
} from "@/lib/fleet/types"

export type BossDeskItem = {
  id: string
  projectId: string
  projectName: string
  agent: OfficeAgentId
  state: DeskVisualState
  label: string
  detail?: string
  convId?: string
}

export type BossDeliveryItem = {
  id: string
  deskId: string
  projectId: string
  projectName: string
  agent: OfficeAgentId
  convId?: string
  text: string
  at: number
}

export type BossRoomCost = {
  projectId: string
  projectName: string
  costUsd: number
}

export type BossTeam = {
  projectId: string
  projectName: string
  desks: BossDeskItem[]
}

// ── board (S4.4): seção derivada do useCards — derivação PURA, sem estado novo

/** Subset estrutural do CardRow que o briefing consome (mantém o módulo puro:
 *  o import do store é só de tipo). */
export type BossBoardCard = Pick<
  CardRow,
  "id" | "projectId" | "title" | "state" | "updatedAt" | "stalledSince"
>

export type BossBoardCounts = {
  backlog: number
  /** working ("em andamento"). */
  working: number
  /** review + blocked ("esperando você"). */
  waiting: number
}

export type BossBoardProject = BossBoardCounts & {
  projectId: string
  projectName: string
}

export type BossBoardHighlight = {
  id: string
  projectId: string
  projectName: string
  title: string
  /** Por que o card pede olho: estagnado (vigia) vence o estado no rótulo. */
  reason: "stalled" | "blocked" | "review"
  stalledSince?: number
}

export type BossBoard = {
  counts: BossBoardCounts
  /** Contagens por projeto (ordem alfabética por nome — determinística). */
  byProject: BossBoardProject[]
  /** Máx. 5 cards que pedem olho: estagnados primeiro (mais tempo mudo antes),
   *  depois bloqueados, depois em revisão (esperando há mais tempo antes). */
  highlights: BossBoardHighlight[]
}

const BOARD_HIGHLIGHT_MAX = 5

const EMPTY_BOARD: BossBoard = {
  counts: { backlog: 0, working: 0, waiting: 0 },
  byProject: [],
  highlights: [],
}

const HIGHLIGHT_RANK: Record<BossBoardHighlight["reason"], number> = {
  stalled: 0,
  blocked: 1,
  review: 2,
}

/** Deriva a seção Board dos cards abertos (terminais ficam fora: histórico
 *  fechado não é board). `nameOf` resolve o nome do projeto do card. */
function buildBoard(
  cards: readonly BossBoardCard[],
  nameOf: (projectId: string) => string,
): BossBoard {
  if (cards.length === 0) return EMPTY_BOARD
  const counts: BossBoardCounts = { backlog: 0, working: 0, waiting: 0 }
  const perProject = new Map<string, BossBoardProject>()
  const highlights: (BossBoardHighlight & { sortAt: number })[] = []
  for (const card of cards) {
    if (card.state === "done" || card.state === "cancelled") continue
    const bucket =
      card.state === "backlog"
        ? "backlog"
        : card.state === "working"
          ? "working"
          : "waiting"
    counts[bucket] += 1
    let proj = perProject.get(card.projectId)
    if (!proj) {
      proj = {
        projectId: card.projectId,
        projectName: nameOf(card.projectId),
        backlog: 0,
        working: 0,
        waiting: 0,
      }
      perProject.set(card.projectId, proj)
    }
    proj[bucket] += 1
    // destaque: estagnado (qualquer estado aberto) OU esperando você
    const reason: BossBoardHighlight["reason"] | null =
      card.stalledSince != null
        ? "stalled"
        : card.state === "blocked"
          ? "blocked"
          : card.state === "review"
            ? "review"
            : null
    if (reason) {
      highlights.push({
        id: card.id,
        projectId: card.projectId,
        projectName: proj.projectName,
        title: card.title,
        reason,
        stalledSince: card.stalledSince,
        // esperando/mudo há mais tempo primeiro dentro de cada razão
        sortAt: card.stalledSince ?? card.updatedAt,
      })
    }
  }
  highlights.sort(
    (a, b) =>
      HIGHLIGHT_RANK[a.reason] - HIGHLIGHT_RANK[b.reason] || a.sortAt - b.sortAt,
  )
  return {
    counts,
    byProject: [...perProject.values()].sort((a, b) =>
      a.projectName.localeCompare(b.projectName),
    ),
    highlights: highlights
      .slice(0, BOARD_HIGHLIGHT_MAX)
      .map(({ sortAt: _sortAt, ...item }) => item),
  }
}

export type BossBriefing = {
  attention: BossDeskItem[]
  running: BossDeskItem[]
  deliveries: BossDeliveryItem[]
  roomCosts: BossRoomCost[]
  teams: BossTeam[]
  totalCostUsd: number
  board: BossBoard
}

const EMPTY_BRIEFING: BossBriefing = {
  attention: [],
  running: [],
  deliveries: [],
  roomCosts: [],
  teams: [],
  totalCostUsd: 0,
  board: EMPTY_BOARD,
}

/** Converte o snapshot visual em um briefing operacional. Não infere trabalho:
 *  todas as linhas vêm de estados/entregas/custos que o Office já conhece.
 *  `cards`/`projectNames` (S4.4): snapshot do useCards no momento do render do
 *  drawer — o board NÃO depende do office montado, só o resto do briefing.
 *  Nome de projeto: mapa explícito → sala do snapshot → "projeto arquivado"
 *  (a intenção sobrevive ao arquivamento, mesma honestidade do BoardLane). */
export function buildBossBriefing(
  snapshot: OfficeSnapshot | null,
  cards: readonly BossBoardCard[] = [],
  projectNames?: ReadonlyMap<string, string>,
): BossBriefing {
  const roomName = new Map<string, string>()
  for (const room of snapshot?.rooms ?? []) roomName.set(room.projectId, room.name)
  const nameOf = (pid: string): string =>
    projectNames?.get(pid) ?? roomName.get(pid) ?? "projeto arquivado"
  const board = buildBoard(cards, nameOf)
  if (!snapshot) return { ...EMPTY_BRIEFING, board }

  const attention: BossDeskItem[] = []
  const running: BossDeskItem[] = []
  const roomCosts: BossRoomCost[] = []
  const teams: BossTeam[] = []
  const deskById = new Map<string, BossDeskItem>()

  for (const room of snapshot.rooms) {
    roomCosts.push({
      projectId: room.projectId,
      projectName: room.name,
      costUsd: room.costUsd,
    })
    const team: BossDeskItem[] = []
    for (const desk of room.desks) {
      const item: BossDeskItem = {
        id: desk.id,
        projectId: room.projectId,
        projectName: room.name,
        agent: desk.agent,
        state: desk.state,
        label: desk.label,
        detail: desk.detail,
        convId: desk.convId,
      }
      deskById.set(desk.id, item)
      team.push(item)
      if (desk.state === "hand") attention.push(item)
      else if (desk.state === "typing" || desk.state === "thinking")
        running.push(item)
    }
    teams.push({ projectId: room.projectId, projectName: room.name, desks: team })
  }

  const deliveries = snapshot.deliveries
    .map((delivery): BossDeliveryItem | null => {
      const desk = deskById.get(delivery.deskId)
      if (!desk) return null
      return {
        id: `${delivery.deskId}:${delivery.at}`,
        deskId: delivery.deskId,
        projectId: desk.projectId,
        projectName: desk.projectName,
        agent: desk.agent,
        convId: delivery.convId,
        text: delivery.text,
        at: delivery.at,
      }
    })
    .filter((item): item is BossDeliveryItem => item !== null)
    .sort((a, b) => b.at - a.at)

  return {
    attention,
    running,
    deliveries,
    roomCosts,
    teams,
    totalCostUsd: roomCosts.reduce((total, room) => total + room.costUsd, 0),
    board,
  }
}

/** Linha-narrativa do standup (topo da Central): frase humana derivada do
 *  briefing, escondendo termos zerados — ex. "3 precisam de você · 2 rodando ·
 *  1 entrega recente · US$ 15,00 hoje". `fmtUsd` é injetado (bridge/hooks
 *  fmtCost) pra manter este módulo puro/hermético nos testes. Tudo zerado ⇒
 *  frase de calmaria. */
export function bossStandupLine(
  briefing: BossBriefing,
  fmtUsd: (usd: number) => string,
): string {
  const parts: string[] = []
  const att = briefing.attention.length
  if (att > 0) parts.push(att === 1 ? "1 precisa de você" : `${att} precisam de você`)
  const run = briefing.running.length
  if (run > 0) parts.push(run === 1 ? "1 rodando" : `${run} rodando`)
  const del = briefing.deliveries.length
  if (del > 0)
    parts.push(del === 1 ? "1 entrega recente" : `${del} entregas recentes`)
  if (briefing.totalCostUsd > 0) parts.push(`${fmtUsd(briefing.totalCostUsd)} hoje`)
  return parts.length > 0
    ? parts.join(" · ")
    : "Tudo tranquilo. Nada pede sua atenção agora."
}

export function deliveryAge(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000))
  if (seconds < 5) return "agora"
  if (seconds < 60) return `há ${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `há ${minutes}min`
}
