import { describe, expect, it } from "vitest"
import type { OfficeSnapshot } from "../engine/types"
import { bossStandupLine, buildBossBriefing, deliveryAge } from "./bossBriefing"

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
      "Tudo tranquilo — nada pede sua atenção agora.",
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
