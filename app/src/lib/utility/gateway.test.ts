import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  record: vi.fn(),
}))

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }))
vi.mock("@/lib/db", () => ({ isTauri: () => true }))
vi.mock("@/lib/db/utilityUsage", () => ({
  recordUtilityUsage: h.record,
}))

import { generateUtility, generateUtilityText } from "./gateway"

beforeEach(() => {
  h.invoke.mockReset()
  h.record.mockReset()
  h.record.mockResolvedValue(undefined)
})

describe("gateway de inferência utilitária", () => {
  it("não chama transporte quando a finalidade está desligada", async () => {
    const result = await generateUtility({
      attemptId: "a",
      task: "turn_receipt",
      locale: "pt-BR",
      payload: {},
      inputDigest: "digest",
      routePolicy: "off",
      deadlineMs: 1_000,
    })

    expect(result.status).toBe("unavailable")
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it("encapsula o opt-in legado na finalidade pedida", async () => {
    h.invoke.mockResolvedValue({
      status: "ok",
      value: "[\"Rodar os testes\"]",
      source: { id: "legacy-helper-cli", locality: "remote" },
      timing: { startedAt: 1, durationMs: 12 },
      cost: { usd: null, source: "unknown" },
    })

    await expect(
      generateUtilityText({
        task: "composer_suggestions",
        model: "haiku",
        cwd: "/projeto",
        prompt: "Sugira ações",
      }),
    ).resolves.toBe("[\"Rodar os testes\"]")

    expect(h.invoke).toHaveBeenCalledWith(
      "utility_generate",
      expect.objectContaining({
        request: expect.objectContaining({
          task: "composer_suggestions",
          routePolicy: "approved_helper",
          remoteAuthorized: true,
          workingDirectory: "/projeto",
        }),
      }),
    )
    expect(h.record).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "composer_suggestions",
        sourceId: "legacy-helper-cli",
        ok: true,
      }),
    )
  })

  it("normaliza falha do transporte para o domínio", async () => {
    h.invoke.mockResolvedValue({
      status: "failed",
      source: { id: "legacy-helper-cli", locality: "remote" },
      timing: { startedAt: 1, durationMs: 20 },
      fallbackReason: "rate_limited",
    })

    await expect(
      generateUtilityText({
        task: "turn_receipt",
        model: "haiku",
        cwd: "/projeto",
        prompt: "Resuma",
      }),
    ).rejects.toThrow("rate_limited")
    expect(h.record).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false }),
    )
  })

  it("deduplica task, escopo e digest idênticos enquanto estão em voo", async () => {
    let release!: (value: unknown) => void
    h.invoke.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      }),
    )
    const base = {
      task: "composer_suggestions" as const,
      locale: "pt-BR",
      payload: { prompt: "Sugira ações" },
      inputDigest: "mesmo-digest",
      routePolicy: "approved_helper" as const,
      conversationId: "conversa-1",
      deadlineMs: 1_000,
    }
    const first = generateUtility({ ...base, attemptId: "a-1" })
    const second = generateUtility({ ...base, attemptId: "a-2" })

    expect(h.invoke).toHaveBeenCalledTimes(1)
    release({
      status: "ok",
      value: "[\"Rodar os testes\"]",
      source: { id: "legacy-helper-cli", locality: "remote" },
      timing: { startedAt: 1, durationMs: 12 },
    })
    await expect(Promise.all([first, second])).resolves.toHaveLength(2)
  })
})
