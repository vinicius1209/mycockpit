import { beforeEach, describe, expect, it, vi } from "vitest"

const estado = vi.hoisted(() => ({
  byId: {} as Record<string, unknown>,
  setAutoResume: vi.fn(),
  handleEvent: vi.fn(),
}))
vi.mock("@/store/chat", () => ({ useChat: { getState: () => estado } }))

import { dispararRetomada } from "./autoResumeDisparo"
import { retomadaAgendada } from "./autoResume"

const agendada = { tries: 1, maxTries: 3, nextAt: Date.parse("2026-09-23T19:40:00-03:00"), reason: "limit", timer: 7 }

beforeEach(() => {
  estado.setAutoResume.mockReset()
  estado.handleEvent.mockReset()
  estado.byId = { c1: { autoResume: agendada, running: false, finalizing: false } }
})

describe("o disparo da retomada automática", () => {
  it("marca o disparo, avisa no fio e devolve o prompt do gatilho real", () => {
    const prompt = dispararRetomada("c1", 1, 3, "limit")
    expect(prompt).toBeTruthy()
    const novo = estado.setAutoResume.mock.calls[0][1]
    expect(novo).toMatchObject({ tries: 1, disparou: true })
    // é isto que as telas perguntam: depois do disparo, não está mais agendada
    expect(retomadaAgendada({ autoResume: novo })).toBe(false)
    expect(estado.handleEvent).toHaveBeenCalledWith("c1", {
      type: "notice",
      message: "auto-resume: retomando (tentativa 1/3)",
    })
  })

  it("a pessoa cancelou ou já há turno rodando: não reenvia nem marca", () => {
    estado.byId = { c1: { autoResume: undefined } }
    expect(dispararRetomada("c1", 1, 3, "limit")).toBeNull()
    estado.byId = { c1: { autoResume: agendada, running: true } }
    expect(dispararRetomada("c1", 1, 3, "limit")).toBeNull()
    expect(estado.setAutoResume).not.toHaveBeenCalled()
  })
})
