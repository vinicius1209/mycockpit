import { describe, expect, it } from "vitest"
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
} from "@/lib/retro"
import type { LedgerRow } from "@/lib/panel"

/** 13/08/2026, 18:30 LOCAL (o mapa é sempre em hora local do usuário). */
const AGORA = new Date(2026, 7, 13, 18, 30, 0).getTime()

function at(day: number, hour: number, costUsd: number | null): LedgerRow {
  return {
    agent: "codex",
    projectId: "p1",
    costUsd,
    tokens: 0,
    createdAt: new Date(2026, 7, day, hour, 12, 0).getTime(),
  }
}

describe("mapa de calor — bucketização por dia local × hora local", () => {
  it("cada linha cai no dia e na hora local do carimbo", () => {
    const map = hourlyHeatmap([at(13, 2, 10), at(13, 2, 5), at(12, 23, 7)], 14, AGORA)
    const hoje = map.days[13]
    const ontem = map.days[12]
    expect(hoje.label).toBe("13/08")
    expect(hoje.hours[2]).toBe(15)
    expect(hoje.total).toBe(15)
    expect(ontem.hours[23]).toBe(7)
  })

  it("14 dias sempre existem, mesmo sem gasto nenhum (a grade não muda de forma)", () => {
    const map = hourlyHeatmap([], 14, AGORA)
    expect(map.days).toHaveLength(14)
    expect(map.days.every((d) => d.hours.length === 24)).toBe(true)
    expect(map.peak).toBe(0)
    expect(map.total).toBe(0)
  })

  it("gasto mais velho que a janela e gasto no futuro ficam de fora", () => {
    // 30/07 é um dia antes do começo da janela de 14 dias (31/07 a 13/08).
    const velho: LedgerRow = {
      agent: "codex",
      projectId: "p1",
      costUsd: 99,
      tokens: 0,
      createdAt: new Date(2026, 6, 30, 9, 0, 0).getTime(),
    }
    const map = hourlyHeatmap([at(13, 9, 3), velho], 14, AGORA)
    expect(map.days[0].label).toBe("31/07")
    expect(map.total).toBe(3)
    const futuro: LedgerRow = {
      agent: "codex",
      projectId: "p1",
      costUsd: 50,
      tokens: 0,
      createdAt: AGORA + 60_000,
    }
    expect(hourlyHeatmap([futuro], 14, AGORA).total).toBe(0)
  })

  it("custo nulo (turno sem preço reportado) conta como zero, não quebra o mapa", () => {
    const map = hourlyHeatmap([at(13, 9, null), at(13, 9, 2)], 14, AGORA)
    expect(map.days[13].hours[9]).toBe(2)
  })

  it("o pico é a maior HORA do período, não o maior dia", () => {
    // 12/08 gasta mais no total, mas espalhado; 13/08 concentra numa hora só.
    const map = hourlyHeatmap(
      [at(12, 9, 20), at(12, 10, 20), at(12, 11, 20), at(13, 3, 30)],
      14,
      AGORA,
    )
    expect(map.days[12].total).toBe(60)
    expect(map.peak).toBe(30)
  })
})

describe("mapa de calor — a régua de medidor do §2", () => {
  it("cinza até 60% do pico, âmbar de 60 a 80, vermelho de 80 pra cima", () => {
    expect(heatTone(59, 100)).toBe("ok")
    expect(heatTone(60, 100)).toBe("warn")
    expect(heatTone(79, 100)).toBe("warn")
    expect(heatTone(80, 100)).toBe("danger")
    expect(heatTone(100, 100)).toBe("danger")
  })

  it("hora sem gasto não é 'saudável', é ausência", () => {
    expect(heatTone(0, 100)).toBe("none")
    expect(heatTone(5, 0)).toBe("none")
  })

  it("a rampa cinza tem piso visível e não encosta no âmbar", () => {
    expect(heatFillPct(0.01, 100)).toBeGreaterThanOrEqual(22)
    expect(heatFillPct(59, 100)).toBeLessThanOrEqual(78)
    expect(heatFillPct(5, 0)).toBe(0)
  })
})

describe("hora mais cara — o episódio que explica o pico", () => {
  it("aponta dia, hora, valor e a fatia do dia que ela comeu", () => {
    const map = hourlyHeatmap([at(12, 3, 75), at(12, 14, 25)], 14, AGORA)
    const p = peakHour(map)
    expect(p?.dayLabel).toBe("12/08")
    expect(p?.hour).toBe(3)
    expect(p?.costUsd).toBe(75)
    expect(p?.dayTotal).toBe(100)
    expect(p?.shareOfDay).toBeCloseTo(0.75)
  })

  it("sem gasto nenhum não existe episódio (não inventa)", () => {
    expect(peakHour(hourlyHeatmap([], 14, AGORA))).toBeNull()
  })
})

describe("derivados — o denominador sempre à vista", () => {
  it("por dia é o total dividido pelos dias da janela", () => {
    expect(perDay(6260, 30)).toBeCloseTo(208.666, 2)
    expect(perDay(10, 0)).toBeNull()
  })

  it("sem entrega registrada, 'por entrega' é null (não é infinito nem zero)", () => {
    expect(perDelivery(6260, 5)).toBe(1252)
    expect(perDelivery(6260, 0)).toBeNull()
  })

  it("atribuído a entrega mede o REGISTRO, não o trabalho", () => {
    const a = attributedShare(6260, [{ costUsd: 60 }, { costUsd: 16.3 }, { costUsd: null }])
    expect(a?.costUsd).toBeCloseTo(76.3)
    expect(a?.share).toBeCloseTo(0.0122, 4)
    expect(attributedShare(0, [{ costUsd: 5 }])).toBeNull()
  })
})

describe("lado descartado da disputa — o único desperdício demonstrável", () => {
  const run = (chosenId: string | null) => ({
    createdAt: AGORA,
    chosenId,
    candidates: [
      { id: "a", agent: "codex", costUsd: 12 },
      { id: "b", agent: "claude-code", costUsd: 30 },
    ],
  })

  it("soma só os candidatos que NÃO foram escolhidos", () => {
    expect(discardedSpend([run("a")])).toEqual({ costUsd: 30, disputes: 1 })
    expect(discardedSpend([run("b")])).toEqual({ costUsd: 12, disputes: 1 })
  })

  it("disputa sem vencedor escolhido fica fora (sem escolha não há descarte)", () => {
    expect(discardedSpend([run(null)])).toEqual({ costUsd: 0, disputes: 0 })
  })

  it("vencedor que não existe mais entre os candidatos não vira descarte total", () => {
    expect(discardedSpend([run("fantasma")])).toEqual({ costUsd: 0, disputes: 0 })
  })

  it("candidato sem custo reportado conta como zero", () => {
    const r = {
      createdAt: AGORA,
      chosenId: "a",
      candidates: [
        { id: "a", agent: "codex", costUsd: 1 },
        { id: "b", agent: "claude-code", costUsd: null },
      ],
    }
    expect(discardedSpend([r]).costUsd).toBe(0)
  })
})

describe("custo por agente cruzado com entregas", () => {
  const rows: LedgerRow[] = [
    { agent: "codex", projectId: "p1", costUsd: 60, tokens: 0, createdAt: AGORA },
    { agent: "claude-code", projectId: "p1", costUsd: 40, tokens: 0, createdAt: AGORA },
  ]

  it("cruza custo, share e as entregas do MESMO agente", () => {
    const out = agentCross(rows, [
      { agent: "codex", createdAt: AGORA },
      { agent: "codex", createdAt: AGORA },
      { agent: "claude-code", createdAt: AGORA },
    ])
    expect(out[0]).toEqual({
      agent: "codex",
      costUsd: 60,
      share: 0.6,
      deliveries: 2,
      perDelivery: 30,
    })
    expect(out[1].perDelivery).toBe(40)
  })

  it("agente que gastou sem registrar entrega tem custo, não tem média", () => {
    const out = agentCross(rows, [])
    expect(out.every((a) => a.perDelivery === null)).toBe(true)
  })

  it("entrega de agente que não gastou nada na janela não inventa linha", () => {
    const out = agentCross(rows, [{ agent: "agy", createdAt: AGORA }])
    expect(out.map((a) => a.agent)).toEqual(["codex", "claude-code"])
  })
})
