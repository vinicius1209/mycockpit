import { beforeEach, describe, expect, it, vi } from "vitest"

const { cancelAgent, registrarTurnoCortado, stopManagedProcessesByConv, chat } = vi.hoisted(() => ({
  cancelAgent: vi.fn(),
  registrarTurnoCortado: vi.fn(async () => {}),
  stopManagedProcessesByConv: vi.fn(async () => []),
  chat: {
    byId: { c1: { runId: "run-real" } } as Record<string, Record<string, unknown>>,
    cancelAutoResume: vi.fn(),
    handleEvent: vi.fn(),
    finish: vi.fn(),
    persist: vi.fn(async () => {}),
  },
}))
vi.mock("@/lib/agent", () => ({ cancelAgent }))
vi.mock("@/lib/db/turnoCortado", () => ({ registrarTurnoCortado }))
vi.mock("@/lib/work", () => ({ stopManagedProcessesByConv }))
vi.mock("@/store/chat", () => ({ useChat: { getState: () => chat } }))

import { cancelLinearTurn } from "./cancelLinearTurn"
import { limparCausasDoCorte, marcarCausaDoCorte, tomarCausaDoCorte } from "@/lib/corte"

beforeEach(() => {
  vi.clearAllMocks()
  limparCausasDoCorte()
  chat.byId = { c1: { runId: "run-real" } }
})

describe("cancelLinearTurn", () => {
  it("interrompe subprocessos locais gerenciados da conversa ao cancelar", async () => {
    cancelAgent.mockResolvedValue(true)
    await cancelLinearTurn("c1")
    expect(stopManagedProcessesByConv).toHaveBeenCalledWith("c1")
  })

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

describe("cancelLinearTurn: a causa do gesto (ADR-180)", () => {
  it("carimba a causa antes de pedir o corte, e ela espera o cancelled do runner", async () => {
    cancelAgent.mockResolvedValue(true)
    await cancelLinearTurn("c1", "parada")
    expect(tomarCausaDoCorte("c1")).toBe("parada")
  })

  it("sem turno a cortar, um carimbo pendente não sobra para o próximo corte", async () => {
    marcarCausaDoCorte("c1", "correcao")
    chat.byId = { c1: { runId: null } }
    await expect(cancelLinearTurn("c1")).resolves.toBe("idle")
    expect(tomarCausaDoCorte("c1")).toBeUndefined()
  })

  it("gesto sem causa própria não apaga a causa que o envio forçado carimbou", async () => {
    cancelAgent.mockResolvedValue(true)
    marcarCausaDoCorte("c1", "correcao")
    await cancelLinearTurn("c1")
    expect(tomarCausaDoCorte("c1")).toBe("correcao")
  })
})

describe("cancelLinearTurn: o turno cortado entra no ledger (ADR-180)", () => {
  it("turno rodando ganha linha com o motor e o modelo que estavam no ar", async () => {
    cancelAgent.mockResolvedValue(true)
    chat.byId = {
      c1: {
        runId: "run-real",
        running: true,
        projectId: "seed-prime",
        agent: "codex",
        model: "gpt-5.6-sol",
      },
    }
    await cancelLinearTurn("c1", "correcao")
    expect(registrarTurnoCortado).toHaveBeenCalledWith({
      runId: "run-real",
      projectId: "seed-prime",
      convId: "c1",
      agent: "codex",
      model: "gpt-5.6-sol",
    })
  })

  it("durante um revezamento a linha fica com o motor de destino, sem misturar modelos", async () => {
    cancelAgent.mockResolvedValue(true)
    chat.byId = {
      c1: {
        runId: "run-real",
        running: true,
        projectId: "seed-prime",
        agent: "codex",
        model: "gpt-5.6-sol",
        pendingTransplant: { runId: "run-real", targetAgent: "claude-code", targetModel: "claude-opus-5" },
      },
    }
    await cancelLinearTurn("c1")
    expect(registrarTurnoCortado).toHaveBeenCalledWith(
      expect.objectContaining({ agent: "claude-code", model: "claude-opus-5" }),
    )
  })

  it("preparo que ainda não subiu processo não vira linha de consumo", async () => {
    cancelAgent.mockResolvedValue(true)
    chat.byId = { c1: { runId: "run-real", running: false } }
    await cancelLinearTurn("c1")
    expect(registrarTurnoCortado).not.toHaveBeenCalled()
  })
})
