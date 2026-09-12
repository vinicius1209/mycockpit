import { beforeEach, describe, expect, it, vi } from "vitest"

const { fusion, cancelLinearTurn, fecharTurnoLocalmente, stopManagedProcessesByConv } = vi.hoisted(() => ({
  fusion: {
    byConv: {} as Record<string, { phase: string }>,
    abort: vi.fn(),
  },
  cancelLinearTurn: vi.fn(async () => "signaled"),
  fecharTurnoLocalmente: vi.fn(async () => {}),
  stopManagedProcessesByConv: vi.fn(async () => []),
}))
vi.mock("@/store/fusion", () => ({ useFusion: { getState: () => fusion } }))
vi.mock("@/lib/cancelLinearTurn", () => ({ cancelLinearTurn, fecharTurnoLocalmente }))
vi.mock("@/lib/work", () => ({ stopManagedProcessesByConv }))

import { abortarDisputa, cancelConversationTurn } from "./cancelConversationTurn"
import { limparCausasDoCorte, marcarCausaDoCorte, tomarCausaDoCorte } from "@/lib/corte"

beforeEach(() => {
  vi.clearAllMocks()
  limparCausasDoCorte()
  fusion.byConv = {}
})

describe("disputa abortada deixa marco no fio (ADR-180)", () => {
  it("aborta os candidatos e fecha o turno com a causa 'disputa'", async () => {
    fusion.byConv = { c1: { phase: "running" } }
    await expect(cancelConversationTurn("c1", "parada")).resolves.toBe(true)
    expect(fusion.abort).toHaveBeenCalledWith("c1")
    expect(stopManagedProcessesByConv).toHaveBeenCalledWith("c1")
    expect(fecharTurnoLocalmente).toHaveBeenCalledWith("c1", "disputa")
    expect(cancelLinearTurn).not.toHaveBeenCalled()
  })

  it("o juiz em curso também conta como disputa", async () => {
    fusion.byConv = { c1: { phase: "judging" } }
    await expect(cancelConversationTurn("c1")).resolves.toBe(true)
    expect(fecharTurnoLocalmente).toHaveBeenCalledWith("c1", "disputa")
  })

  it("um envio forçado carimbado antes não descreve o corte da disputa", async () => {
    marcarCausaDoCorte("c1", "correcao")
    await abortarDisputa("c1")
    expect(tomarCausaDoCorte("c1")).toBeUndefined()
  })
})

describe("conversa linear", () => {
  it("repassa a causa do gesto para o corte do turno", async () => {
    await expect(cancelConversationTurn("c1", "parada")).resolves.toBe(false)
    expect(cancelLinearTurn).toHaveBeenCalledWith("c1", "parada")
    expect(fecharTurnoLocalmente).not.toHaveBeenCalled()
  })
})
