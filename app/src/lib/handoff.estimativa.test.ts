import { describe, expect, it } from "vitest"
import { estimativaDoHandoff, orcamentoDoHandoff, rotuloDaEstimativa } from "./handoff"
import type { ChatItem } from "@/store/chat"

const fio = (n: number): ChatItem[] =>
  Array.from({ length: n }, (_, i) =>
    i % 2 === 0
      ? ({ kind: "user", id: `u${i}`, text: `Pedido ${i}: ${"contexto ".repeat(40)}` } as ChatItem)
      : ({ kind: "text", id: `t${i}`, text: `Resposta ${i}: ${"detalhe ".repeat(200)}` } as ChatItem),
  )

describe("custo estimado do revezamento", () => {
  it("nunca passa do orçamento da janela do destino, em tokens pela régua do orçamento", () => {
    const tokens = estimativaDoHandoff(fio(200), "claude-code", 1_000_000)
    expect(tokens).toBeGreaterThan(5_000)
    expect(tokens).toBeLessThanOrEqual(Math.ceil(orcamentoDoHandoff(1_000_000) / 3) + 200)
    const pequena = estimativaDoHandoff(fio(200), "agy", null)
    expect(pequena).toBeLessThan(tokens)
  })

  it("fio vazio não leva nada e o rótulo diz que é estimativa", () => {
    expect(estimativaDoHandoff([], "codex")).toBe(0)
    expect(rotuloDaEstimativa(0)).toBe("sem histórico para levar")
    expect(rotuloDaEstimativa(640)).toBe("leva menos de mil tokens do histórico (estimativa)")
    expect(rotuloDaEstimativa(12_400)).toBe("leva ~12 mil tokens do histórico (estimativa)")
  })
})
