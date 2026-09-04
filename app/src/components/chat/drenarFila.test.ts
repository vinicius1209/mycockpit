import { beforeEach, describe, expect, it, vi } from "vitest"
import { dispatchQueuedNow } from "./drenarFila"
import { useChat } from "@/store/chat"
import { HUMANO } from "@/lib/sendOrigin"

const CONV = "conv-despacho-fila"
const PROJECT = "/tmp/projeto-fila"

function arm(over: { running?: boolean; finalizing?: boolean } = {}) {
  useChat.setState({
    byId: {
      [CONV]: {
        id: CONV,
        title: "Conversa da fila",
        agent: "claude-code",
        reqModel: null,
        sessionMode: null,
        items: [],
        createdAt: 1_756_000_000_000,
        updatedAt: 1_756_000_000_000,
        status: "idle",
        running: over.running ?? false,
        finalizing: over.finalizing ?? false,
        queued: [{ text: "corrija isso", attachments: [] }],
      } as any,
    },
  })
}

beforeEach(() => arm())

describe("dispatchQueuedNow", () => {
  it("sem projeto falha fechado e preserva a fila", async () => {
    const enviar = vi.fn()
    await expect(dispatchQueuedNow(CONV, undefined, enviar)).rejects.toThrow(
      "projeto indisponível",
    )
    expect(enviar).not.toHaveBeenCalled()
    expect(useChat.getState().byId[CONV]?.queued).toHaveLength(1)
  })

  it("despacha imediatamente quando a fila ficou sem turno", async () => {
    const enviar = vi.fn()
    const interromper = vi.fn(async () => undefined)

    await expect(
      dispatchQueuedNow(CONV, PROJECT, enviar, interromper),
    ).resolves.toBe("enviado")

    expect(interromper).not.toHaveBeenCalled()
    expect(enviar).toHaveBeenCalledWith(
      "corrija isso",
      undefined,
      [],
      HUMANO,
      CONV,
    )
    expect(useChat.getState().byId[CONV]?.queued).toEqual([])
  })

  it("interrompe e deixa o finally drenar quando o processo ainda fecha", async () => {
    arm({ running: true })
    const enviar = vi.fn()
    const interromper = vi.fn(async () => {
      useChat.setState((state) => ({
        byId: {
          ...state.byId,
          [CONV]: {
            ...state.byId[CONV],
            running: false,
            finalizing: true,
          },
        },
      }))
    })

    await expect(
      dispatchQueuedNow(CONV, PROJECT, enviar, interromper),
    ).resolves.toBe("aguardando")

    expect(interromper).toHaveBeenCalledWith(CONV)
    expect(enviar).not.toHaveBeenCalled()
    expect(useChat.getState().byId[CONV]?.queued).toHaveLength(1)
  })

  it("despacha após uma reconciliação que já concluiu o processo", async () => {
    arm({ running: true })
    const enviar = vi.fn()
    const interromper = vi.fn(async () => {
      useChat.setState((state) => ({
        byId: {
          ...state.byId,
          [CONV]: {
            ...state.byId[CONV],
            running: false,
            finalizing: false,
          },
        },
      }))
    })

    await expect(
      dispatchQueuedNow(CONV, PROJECT, enviar, interromper),
    ).resolves.toBe("enviado")
    expect(enviar).toHaveBeenCalledOnce()
  })
})
