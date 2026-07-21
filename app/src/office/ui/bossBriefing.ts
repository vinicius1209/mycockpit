import type {
  DeskVisualState,
  OfficeAgentId,
  OfficeSnapshot,
} from "../engine/types"

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

export type BossBriefing = {
  attention: BossDeskItem[]
  running: BossDeskItem[]
  deliveries: BossDeliveryItem[]
  roomCosts: BossRoomCost[]
  teams: BossTeam[]
  totalCostUsd: number
}

const EMPTY_BRIEFING: BossBriefing = {
  attention: [],
  running: [],
  deliveries: [],
  roomCosts: [],
  teams: [],
  totalCostUsd: 0,
}

/** Converte o snapshot visual em um briefing operacional. Não infere trabalho:
 *  todas as linhas vêm de estados/entregas/custos que o Office já conhece. */
export function buildBossBriefing(snapshot: OfficeSnapshot | null): BossBriefing {
  if (!snapshot) return EMPTY_BRIEFING

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
    : "Tudo tranquilo — nada pede sua atenção agora."
}

export function deliveryAge(at: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000))
  if (seconds < 5) return "agora"
  if (seconds < 60) return `há ${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `há ${minutes}min`
}
