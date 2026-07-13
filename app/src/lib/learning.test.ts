import { describe, expect, it, vi } from "vitest"
import {
  distillLesson,
  isNovelRule,
  parseDistilledRule,
} from "./learning"

describe("parseDistilledRule", () => {
  it("limpa marcadores/aspas e pega a 1ª linha útil", () => {
    expect(parseDistilledRule('- "Sempre trate o erro de rede."')).toBe(
      "Sempre trate o erro de rede.",
    )
    expect(parseDistilledRule("\n\n1) Valide a entrada antes de gravar")).toBe(
      "Valide a entrada antes de gravar",
    )
  })
  it("NENHUMA / vazio → null", () => {
    expect(parseDistilledRule("NENHUMA")).toBeNull()
    expect(parseDistilledRule("  ")).toBeNull()
    expect(parseDistilledRule("")).toBeNull()
  })
})

describe("isNovelRule", () => {
  it("regra inédita passa", () => {
    expect(isNovelRule("Sempre feche conexões abertas", ["Valide a entrada"])).toBe(
      true,
    )
  })
  it("regra quase igual é bloqueada (dedup)", () => {
    expect(
      isNovelRule("Sempre trate o erro de rede no fetch", [
        "Trate o erro de rede no fetch sempre",
      ]),
    ).toBe(false)
  })
  it("vazia não é novel", () => {
    expect(isNovelRule("   ", [])).toBe(false)
  })
})

describe("distillLesson", () => {
  it("helperModel null → não chama o helper", async () => {
    const run = vi.fn()
    const r = await distillLesson({
      projectId: "p",
      cwd: "/tmp",
      helperModel: null,
      reviewerFeedback: "faltou tratar erro",
      run: run as never,
    })
    expect(r).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it("feedback vazio → não chama o helper", async () => {
    const run = vi.fn()
    const r = await distillLesson({
      projectId: "p",
      cwd: "/tmp",
      helperModel: "haiku",
      reviewerFeedback: "   ",
      run: run as never,
    })
    expect(r).toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it("destila a regra do feedback (sem DB no teste → grava no-op, mas retorna a regra)", async () => {
    // fora do Tauri getDb() é null: listLessons=[] e insertLesson=no-op, então
    // a regra é sempre nova e a função devolve o texto destilado.
    const run = vi.fn().mockResolvedValue("Trate o timeout de rede explicitamente")
    const r = await distillLesson({
      projectId: "p",
      cwd: "/tmp",
      helperModel: "haiku",
      reviewerFeedback: "o fetch estoura sem timeout; adicione um",
      run: run as never,
    })
    expect(run).toHaveBeenCalledOnce()
    expect(r).toBe("Trate o timeout de rede explicitamente")
  })

  it("helper responde NENHUMA → null", async () => {
    const run = vi.fn().mockResolvedValue("NENHUMA")
    const r = await distillLesson({
      projectId: "p",
      cwd: "/tmp",
      helperModel: "haiku",
      reviewerFeedback: "nada generalizável aqui",
      run: run as never,
    })
    expect(r).toBeNull()
  })
})
