import { beforeEach, describe, expect, it, vi } from "vitest"

const { cancelAgent, chat } = vi.hoisted(() => ({
  cancelAgent: vi.fn(),
  chat: {
    byId: { c1: { runId: "run-real" } } as Record<string, { runId: string | null }>,
    cancelAutoResume: vi.fn(),
    handleEvent: vi.fn(),
    finish: vi.fn(),
    persist: vi.fn(async () => {}),
  },
}))
vi.mock("@/lib/agent", () => ({ cancelAgent }))
vi.mock("@/store/chat", () => ({ useChat: { getState: () => chat } }))

import { cancelLinearTurn } from "./cancelLinearTurn"

beforeEach(() => {
  vi.clearAllMocks()
  chat.byId = { c1: { runId: "run-real" } }
})

describe("cancelLinearTurn", () => {
  it("deixa o runner vivo publicar o próprio terminal", async () => {
    cancelAgent.mockResolvedValue(true)
    await expect(cancelLinearTurn("c1")).resolves.toBe("signaled")
    expect(chat.handleEvent).not.toHaveBeenCalled()
  })

  it("reconcilia o turno quando o backend já perdeu o run", async () => {
    cancelAgent.mockResolvedValue(false)
    await expect(cancelLinearTurn("c1")).resolves.toBe("reconciled")
    expect(chat.handleEvent).toHaveBeenNthCalledWith(1, "c1", { type: "cancelled" })
    expect(chat.handleEvent).toHaveBeenNthCalledWith(2, "c1", {
      type: "done",
      code: null,
    })
    expect(chat.finish).toHaveBeenCalledWith("c1")
    expect(chat.persist).toHaveBeenCalledWith("c1")
  })
})
