import { afterEach, describe, expect, it, vi } from "vitest"
import { STORAGE_KEY, clearRecord, readRecord, writeRecord } from "./persistence"
import { FLOW_VERSION } from "./flow"

/** localStorage de mentira, com gatilho de falha (disco cheio, modo privado). */
function fakeStorage(opts: { failWrites?: boolean } = {}) {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (opts.failWrites) throw new Error("QuotaExceededError")
      data.set(k, v)
    },
    removeItem: (k: string) => {
      data.delete(k)
    },
  }
}

function install(storage: unknown) {
  vi.stubGlobal("localStorage", storage)
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("registro de onboarding no disco", () => {
  it("ida e volta preserva versão e último passo concluído", () => {
    install(fakeStorage())
    expect(writeRecord({ flowVersion: FLOW_VERSION, lastCompletedStep: 1 })).toBe(
      true,
    )
    expect(readRecord()).toEqual({
      flowVersion: FLOW_VERSION,
      lastCompletedStep: 1,
    })
  })

  it("vive numa chave PRÓPRIA, fora das settings do app", () => {
    const s = fakeStorage()
    install(s)
    writeRecord({ flowVersion: FLOW_VERSION, lastCompletedStep: 0 })
    expect(STORAGE_KEY).toBe("mc.onboarding")
    expect([...s.data.keys()]).toEqual(["mc.onboarding"])
    expect(s.data.has("mc.app")).toBe(false)
  })

  it("sem registro devolve null (fluxo começa do zero)", () => {
    install(fakeStorage())
    expect(readRecord()).toBeNull()
  })

  it("conteúdo corrompido devolve null em vez de registro pela metade", () => {
    const s = fakeStorage()
    install(s)
    s.data.set(STORAGE_KEY, "{isto não é json")
    expect(readRecord()).toBeNull()
    s.data.set(STORAGE_KEY, JSON.stringify({ lastCompletedStep: 2 }))
    expect(readRecord()).toBeNull()
  })

  it("gravação que falha devolve false, nunca engole a falha", () => {
    install(fakeStorage({ failWrites: true }))
    expect(writeRecord({ flowVersion: FLOW_VERSION, lastCompletedStep: 0 })).toBe(
      false,
    )
  })

  it("storage indisponível não derruba a leitura", () => {
    install(undefined)
    expect(readRecord()).toBeNull()
    expect(writeRecord({ flowVersion: FLOW_VERSION, lastCompletedStep: 0 })).toBe(
      false,
    )
  })

  it("limpar apaga o progresso (o Refazer onboarding depende disso)", () => {
    install(fakeStorage())
    writeRecord({ flowVersion: FLOW_VERSION, lastCompletedStep: 2 })
    expect(clearRecord()).toBe(true)
    expect(readRecord()).toBeNull()
  })
})
