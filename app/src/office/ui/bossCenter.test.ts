import { describe, expect, it } from "vitest"
import type { OfficeSnapshot } from "@/lib/fleet/types"
import {
  bossStandupLine,
  buildBossBriefing,
  deliveryAge,
  type BossBoardCard,
} from "./bossBriefing"

const snapshot: OfficeSnapshot = {
  rooms: [
    {
      projectId: "p1",
      name: "Frota",
      agg: "hand",
      costUsd: 4.25,
      desks: [
        {
          id: "p1::claude-code",
          projectId: "p1",
          agent: "claude-code",
          state: "hand",
          label: "Precisa de você",
          detail: "Aprovar plano",
          convId: "c1",
        },
        {
          id: "p1::codex",
          projectId: "p1",
          agent: "codex",
          state: "typing",
          label: "Digitando",
          detail: "Edit",
          convId: "c2",
        },
        {
          id: "p1::agy",
          projectId: "p1",
          agent: "agy",
          state: "idle",
          label: "Disponível",
        },
      ],
    },
    {
      projectId: "p2",
      name: "Prime",
      agg: "running",
      costUsd: 1.5,
      desks: [
        {
          id: "p2::claude-code",
          projectId: "p2",
          agent: "claude-code",
          state: "thinking",
          label: "Pensando",
          convId: "c3",
        },
        {
          id: "p2::codex",
          projectId: "p2",
          agent: "codex",
          state: "off",
          label: "Não detectado",
        },
        {
          id: "p2::agy",
          projectId: "p2",
          agent: "agy",
          state: "idle",
          label: "Disponível",
        },
      ],
    },
  ],
  deliveries: [
    {
      deskId: "p1::codex",
      convId: "delivery-c2",
      text: "Parser concluído",
      at: 1000,
    },
    {
      deskId: "p2::claude-code",
      convId: "delivery-c3",
      text: "Plano pronto",
      at: 2000,
    },
    { deskId: "mesa-removida", text: "Não deve aparecer", at: 3000 },
  ],
}

describe("buildBossBriefing", () => {
  it("separa atenção e execução sem incluir idle/off", () => {
    const briefing = buildBossBriefing(snapshot)
    expect(briefing.attention.map((item) => item.id)).toEqual([
      "p1::claude-code",
    ])
    expect(briefing.running.map((item) => item.id)).toEqual([
      "p1::codex",
      "p2::claude-code",
    ])
  })

  it("resolve entregas para mesa/sala e ordena da mais nova", () => {
    const briefing = buildBossBriefing(snapshot)
    expect(briefing.deliveries.map((item) => item.text)).toEqual([
      "Plano pronto",
      "Parser concluído",
    ])
    expect(briefing.deliveries[0]).toMatchObject({
      deskId: "p2::claude-code",
      projectId: "p2",
      projectName: "Prime",
      convId: "delivery-c3",
    })
  })

  it("agrega custos sem arredondar nem inventar parcelas", () => {
    const briefing = buildBossBriefing(snapshot)
    expect(briefing.roomCosts).toEqual([
      { projectId: "p1", projectName: "Frota", costUsd: 4.25 },
      { projectId: "p2", projectName: "Prime", costUsd: 1.5 },
    ])
    expect(briefing.totalCostUsd).toBe(5.75)
  })

  it("snapshot ausente produz briefing vazio", () => {
    expect(buildBossBriefing(null)).toEqual({
      attention: [],
      running: [],
      deliveries: [],
      roomCosts: [],
      teams: [],
      totalCostUsd: 0,
      board: { counts: { backlog: 0, working: 0, waiting: 0 }, byProject: [], highlights: [] },
    })
  })

  it("mantém toda a equipe disponível para delegação, inclusive idle/off", () => {
    const briefing = buildBossBriefing(snapshot)
    expect(briefing.teams).toHaveLength(2)
    expect(briefing.teams[0].desks.map((desk) => desk.agent)).toEqual([
      "claude-code",
      "codex",
      "agy",
    ])
    expect(briefing.teams[0].desks[2].state).toBe("idle")
    expect(briefing.teams[1].desks[1].state).toBe("off")
  })
})

describe("buildBossBriefing — seção Board (S4.4)", () => {
  function makeCard(partial: Partial<BossBoardCard> & { id: string }): BossBoardCard {
    return {
      projectId: "p1",
      title: `Card ${partial.id}`,
      state: "backlog",
      updatedAt: 100,
      ...partial,
    }
  }

  it("conta backlog/em andamento/esperando você, agregado e por projeto (terminais fora)", () => {
    const cards: BossBoardCard[] = [
      makeCard({ id: "k1", state: "backlog" }),
      makeCard({ id: "k2", state: "working" }),
      makeCard({ id: "k3", state: "review" }),
      makeCard({ id: "k4", projectId: "p2", state: "blocked" }),
      makeCard({ id: "k5", projectId: "p2", state: "backlog" }),
      // terminais nunca contam nem destacam
      makeCard({ id: "k6", state: "done" }),
      makeCard({ id: "k7", projectId: "p2", state: "cancelled" }),
    ]
    const { board } = buildBossBriefing(snapshot, cards)
    expect(board.counts).toEqual({ backlog: 2, working: 1, waiting: 2 })
    // nomes vêm das salas do snapshot; ordem alfabética por nome
    expect(board.byProject).toEqual([
      { projectId: "p1", projectName: "Frota", backlog: 1, working: 1, waiting: 1 },
      { projectId: "p2", projectName: "Prime", backlog: 1, working: 0, waiting: 1 },
    ])
  })

  it("nome de projeto: mapa explícito vence a sala; sem os dois vira projeto arquivado", () => {
    const cards = [makeCard({ id: "k1", projectId: "p-sumiu" })]
    const named = buildBossBriefing(
      snapshot,
      cards,
      new Map([["p-sumiu", "Legado"]]),
    )
    expect(named.board.byProject[0].projectName).toBe("Legado")
    const orphan = buildBossBriefing(snapshot, cards)
    expect(orphan.board.byProject[0].projectName).toBe("projeto arquivado")
  })

  it("destaca blocked/review/estagnados na ordem: estagnado (mais mudo antes), bloqueado, revisão", () => {
    const cards: BossBoardCard[] = [
      makeCard({ id: "rev", state: "review", updatedAt: 50 }),
      makeCard({ id: "blq", state: "blocked", updatedAt: 10 }),
      // estagnado vence o estado no motivo; o mais antigo (stalledSince menor) vem primeiro
      makeCard({ id: "st-novo", state: "working", stalledSince: 900 }),
      makeCard({ id: "st-velho", state: "blocked", stalledSince: 200 }),
      // working sem estagnação NÃO destaca
      makeCard({ id: "ok", state: "working" }),
    ]
    const { board } = buildBossBriefing(snapshot, cards)
    expect(board.highlights.map((h) => `${h.id}:${h.reason}`)).toEqual([
      "st-velho:stalled",
      "st-novo:stalled",
      "blq:blocked",
      "rev:review",
    ])
    expect(board.highlights[0]).toMatchObject({
      projectId: "p1",
      projectName: "Frota",
      title: "Card st-velho",
      stalledSince: 200,
    })
  })

  it("lista de destaque corta em 5 (as contagens seguem inteiras)", () => {
    const cards: BossBoardCard[] = Array.from({ length: 7 }, (_, i) =>
      makeCard({ id: `b${i}`, state: "blocked", updatedAt: i }),
    )
    const { board } = buildBossBriefing(snapshot, cards)
    expect(board.highlights).toHaveLength(5)
    // esperando há mais tempo primeiro (updatedAt asc)
    expect(board.highlights.map((h) => h.id)).toEqual(["b0", "b1", "b2", "b3", "b4"])
    expect(board.counts.waiting).toBe(7)
  })

  it("snapshot ausente NÃO apaga o board (derivação independe do office montado)", () => {
    const { board } = buildBossBriefing(null, [
      makeCard({ id: "k1", state: "review" }),
    ])
    expect(board.counts).toEqual({ backlog: 0, working: 0, waiting: 1 })
    expect(board.highlights[0]).toMatchObject({ id: "k1", reason: "review" })
  })
})

describe("bossStandupLine — narrativa do standup", () => {
  const fmt = (usd: number) => `US$ ${usd.toFixed(2).replace(".", ",")}`

  it("monta a frase completa com plurais pt-BR e custo do dia", () => {
    expect(bossStandupLine(buildBossBriefing(snapshot), fmt)).toBe(
      "1 precisa de você · 2 rodando · 2 entregas recentes · US$ 5,75 hoje",
    )
  })

  it("esconde termos zerados (sem '0 rodando' poluindo a frase)", () => {
    const briefing = buildBossBriefing({
      rooms: [
        {
          projectId: "p1",
          name: "Frota",
          agg: "hand",
          costUsd: 0,
          desks: [
            {
              id: "p1::claude-code",
              projectId: "p1",
              agent: "claude-code",
              state: "hand",
              label: "Precisa de você",
            },
          ],
        },
      ],
      deliveries: [],
    })
    expect(bossStandupLine(briefing, fmt)).toBe("1 precisa de você")
  })

  it("plural de atenção e singular de entrega", () => {
    const briefing = buildBossBriefing({
      rooms: [
        {
          projectId: "p1",
          name: "Frota",
          agg: "hand",
          costUsd: 0,
          desks: [
            {
              id: "p1::claude-code",
              projectId: "p1",
              agent: "claude-code",
              state: "hand",
              label: "Gate",
            },
            {
              id: "p1::codex",
              projectId: "p1",
              agent: "codex",
              state: "hand",
              label: "Approval",
            },
          ],
        },
      ],
      deliveries: [{ deskId: "p1::codex", text: "Pronto", at: 10 }],
    })
    expect(bossStandupLine(briefing, fmt)).toBe(
      "2 precisam de você · 1 entrega recente",
    )
  })

  it("tudo zerado ⇒ frase de calmaria (nunca linha vazia)", () => {
    expect(bossStandupLine(buildBossBriefing(null), fmt)).toBe(
      "Tudo tranquilo. Nada pede sua atenção agora.",
    )
  })
})

describe("deliveryAge", () => {
  it("formata agora, segundos e minutos sem tempo negativo", () => {
    expect(deliveryAge(9_000, 10_000)).toBe("agora")
    expect(deliveryAge(0, 12_000)).toBe("há 12s")
    expect(deliveryAge(0, 125_000)).toBe("há 2min")
    expect(deliveryAge(20_000, 10_000)).toBe("agora")
  })
})
