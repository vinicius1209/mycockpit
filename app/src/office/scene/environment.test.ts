import { describe, expect, it } from "vitest"
import {
  DAYLIGHT,
  DELIVERY_PILE_MAX,
  KANBAN_AREA,
  KANBAN_COLORS,
  MOVING_BOX_FADE_MS,
  MOVING_BOX_MS,
  dayPhase,
  deliveryPileCount,
  formatTvUsd,
  kanbanCardRects,
  movingBoxAlpha,
  tvStats,
} from "./environment"

describe("ambiente: fase do dia pela hora real", () => {
  it("mapeia as janelas do dia (manhã 6–11, meio-dia 11–15, tarde 15–19, noite 19–6)", () => {
    expect(dayPhase(6)).toBe("morning")
    expect(dayPhase(10)).toBe("morning")
    expect(dayPhase(11)).toBe("midday")
    expect(dayPhase(14)).toBe("midday")
    expect(dayPhase(15)).toBe("afternoon")
    expect(dayPhase(18)).toBe("afternoon") // crepúsculo fica na luz quente
    expect(dayPhase(19)).toBe("night")
    expect(dayPhase(23)).toBe("night")
    expect(dayPhase(0)).toBe("night")
    expect(dayPhase(5)).toBe("night")
  })

  it("meio-dia é neutro (overlay invisível, chão sem tint, lâmpada normal)", () => {
    const spec = DAYLIGHT.midday
    expect(spec.overlayAlpha).toBe(0)
    expect(spec.groundTint).toBe(0xffffff)
    expect(spec.lampBoost).toBe(1)
  })

  it("noite escurece SUTIL e acende as luminárias em âmbar", () => {
    const night = DAYLIGHT.night
    expect(night.overlayAlpha).toBeGreaterThan(0)
    expect(night.overlayAlpha).toBeLessThanOrEqual(0.2) // não destrói a direção de arte
    expect(night.lampBoost).toBeGreaterThan(1)
    expect(night.lampTint).not.toBe(DAYLIGHT.midday.lampTint)
    expect(night.groundTint).toBeLessThan(0xffffff)
  })

  it("todas as fases têm overlay discreto (alpha ≤ 0.2)", () => {
    for (const spec of Object.values(DAYLIGHT)) {
      expect(spec.overlayAlpha).toBeGreaterThanOrEqual(0)
      expect(spec.overlayAlpha).toBeLessThanOrEqual(0.2)
    }
  })
})

describe("ambiente: kanban do whiteboard", () => {
  it("todo status de fase tem cor de cartão", () => {
    for (const status of ["queued", "running", "done", "error", "aborted"] as const) {
      expect(KANBAN_COLORS[status]).toBeTypeOf("number")
    }
  })

  it("n cartões cabem centrados na área útil, com gap e sem vazar", () => {
    for (const n of [1, 2, 3, 5, 8]) {
      const rects = kanbanCardRects(n)
      expect(rects).toHaveLength(n)
      for (const r of rects) {
        expect(r.x).toBeGreaterThanOrEqual(KANBAN_AREA.x)
        expect(r.x + r.w).toBeLessThanOrEqual(KANBAN_AREA.x + KANBAN_AREA.w + 1e-9)
        expect(r.y).toBeGreaterThanOrEqual(KANBAN_AREA.y)
        expect(r.y + r.h).toBeLessThanOrEqual(KANBAN_AREA.y + KANBAN_AREA.h + 1e-9)
      }
      // cartões em ordem, sem sobreposição
      for (let i = 1; i < rects.length; i++) {
        expect(rects[i].x).toBeGreaterThan(rects[i - 1].x + rects[i - 1].w - 1e-9)
      }
    }
  })

  it("fileira é centrada e cartão nunca passa de 20px", () => {
    const [only] = kanbanCardRects(1)
    expect(only.w).toBe(20)
    expect(only.x + only.w / 2).toBeCloseTo(KANBAN_AREA.x + KANBAN_AREA.w / 2)
  })

  it("0 fases ⇒ sem cartões (quadro volta aos rabiscos)", () => {
    expect(kanbanCardRects(0)).toEqual([])
    expect(kanbanCardRects(-1)).toEqual([])
  })
})

describe("ambiente: TV da sala comum", () => {
  it("soma o custo total e ranqueia as 3 maiores salas", () => {
    const stats = tvStats([
      { costUsd: 1, color: "#aaa" },
      { costUsd: 4, color: "#bbb" },
      { costUsd: 2 },
      { costUsd: 3 },
    ])
    expect(stats.totalUsd).toBe(10)
    expect(stats.bars).toHaveLength(3)
    expect(stats.bars[0]).toEqual({ frac: 1, color: "#bbb" })
    expect(stats.bars[1].frac).toBeCloseTo(3 / 4)
    expect(stats.bars[2].frac).toBeCloseTo(2 / 4)
  })

  it("salas sem custo não ganham barra; sem custo nenhum ⇒ TV sem barras", () => {
    expect(tvStats([{ costUsd: 0 }, { costUsd: 0 }]).bars).toEqual([])
    expect(tvStats([]).totalUsd).toBe(0)
  })

  it("formata o custo em pt-BR", () => {
    expect(formatTvUsd(12.345)).toBe("US$ 12,35")
    expect(formatTvUsd(0)).toBe("US$ 0,00")
  })
})

describe("ambiente: caixas de mudança", () => {
  it("caixas ficam ~2min: alpha 1 até o fade, decaem e somem", () => {
    expect(movingBoxAlpha(0)).toBe(1)
    expect(movingBoxAlpha(MOVING_BOX_MS - MOVING_BOX_FADE_MS)).toBe(1)
    expect(movingBoxAlpha(MOVING_BOX_MS - MOVING_BOX_FADE_MS / 2)).toBeCloseTo(0.5)
    expect(movingBoxAlpha(MOVING_BOX_MS)).toBe(0)
    expect(movingBoxAlpha(MOVING_BOX_MS + 1)).toBe(0)
  })
})

describe("ambiente: pilha de entregas do boss", () => {
  it("clampa 0..8 e ignora lixo", () => {
    expect(deliveryPileCount(0)).toBe(0)
    expect(deliveryPileCount(3.9)).toBe(3)
    expect(deliveryPileCount(99)).toBe(DELIVERY_PILE_MAX)
    expect(deliveryPileCount(-2)).toBe(0)
    expect(deliveryPileCount(Number.NaN)).toBe(0)
  })
})
