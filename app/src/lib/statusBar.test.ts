import { describe, expect, it } from "vitest"
import {
  STATUS_BAR_KINDS,
  statusBarAccepts,
  statusBuildItem,
  statusCostItem,
} from "./statusBar"

describe("statusBarAccepts (a fronteira faixa × linha viva)", () => {
  it("aceita só sinal ambiente permanente", () => {
    expect(statusBarAccepts("usage")).toBe(true)
    expect(statusBarAccepts("cost")).toBe(true)
    expect(statusBarAccepts("build")).toBe(true)
    expect(STATUS_BAR_KINDS).toHaveLength(3)
  })

  it("recusa o AGORA do turno: a linha viva não sai do composer", () => {
    expect(statusBarAccepts("liveLine")).toBe(false)
    expect(statusBarAccepts("turn")).toBe(false)
    expect(statusBarAccepts("elapsed")).toBe(false)
    expect(statusBarAccepts("tool")).toBe(false)
    expect(statusBarAccepts("streaming")).toBe(false)
  })

  it("recusa o que PEDE decisão (isso é acionável, e a faixa não age)", () => {
    expect(statusBarAccepts("approval")).toBe(false)
    expect(statusBarAccepts("question")).toBe(false)
  })
})

describe("statusCostItem", () => {
  const cost = (total: number, turns: number, estimated = false) => ({
    total,
    turns,
    estimated,
  })

  it("com um turno só, a zona não desenha nada", () => {
    expect(statusCostItem(cost(0.4, 1), null)).toBeNull()
  })

  it("sem gasto real, a zona não desenha nada (nem US$ 0,00)", () => {
    expect(statusCostItem(cost(0, 5), null)).toBeNull()
  })

  it("com ≥2 turnos e gasto real, entra em cinza quando não há teto", () => {
    const item = statusCostItem(cost(12.5, 4), null)
    expect(item?.kind).toBe("cost")
    expect(item?.text).toBe("US$ 12,50")
    expect(item?.label).toBe("sessão")
    expect(item?.tone).toBe("ok")
  })

  it("custo estimado se anuncia com ~ (não finge medição exata)", () => {
    expect(statusCostItem(cost(0.42, 2, true), null)?.text).toBe("~US$ 0,420")
  })

  it("com teto do usuário, sobe de tom pela régua do §2", () => {
    expect(statusCostItem(cost(5.9, 3), 10)?.tone).toBe("ok")
    expect(statusCostItem(cost(6, 3), 10)?.tone).toBe("warn")
    expect(statusCostItem(cost(8, 3), 10)?.tone).toBe("danger")
  })

  it("o tooltip diz o teto quando existe, e como definir quando não existe", () => {
    expect(statusCostItem(cost(6, 3), 10)?.title).toContain("US$ 10,00")
    expect(statusCostItem(cost(6, 3), null)?.title).toContain("Configurações")
  })
})

describe("statusBuildItem", () => {
  it("mostra a versão curta e guarda a completa no tooltip (nunca trunca)", () => {
    const item = statusBuildItem("0.1.0-test.177")
    expect(item.text).toBe("local · v0.1.0-t177")
    expect(item.title).toContain("0.1.0-test.177")
    expect(item.tone).toBe("ok")
  })

  it("sem versão carimbada fica 'local', nunca um 'v?' inventado", () => {
    const item = statusBuildItem(null)
    expect(item.text).toBe("local")
    expect(item.text).not.toContain("v")
  })
})
