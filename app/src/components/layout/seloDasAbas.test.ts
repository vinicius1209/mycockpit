import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

type Modulo = typeof import("./seloDasAbas")
let m: Modulo

const tecla = (tipo: string, p: Record<string, unknown>) =>
  Object.assign(new Event(tipo), {
    key: "",
    code: "",
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    ...p,
  })

// O estado visível mora no módulo; o hook, com o React dublado no
// beforeEach, é só o getSnapshot.
const visivel = () => m.useSeloDasAbas()

describe("segurar ⌘ mostra os números das abas", () => {
  let alvo: EventTarget
  let desligar: () => void
  let bloqueado = false

  beforeEach(async () => {
    vi.resetModules()
    vi.useFakeTimers()
    vi.doMock("react", async (orig) => ({
      ...(await orig<typeof import("react")>()),
      useSyncExternalStore: (_s: unknown, snap: () => boolean) => snap(),
    }))
    m = await import("./seloDasAbas")
    alvo = new EventTarget()
    bloqueado = false
    desligar = m.ligarSeloDasAbas("MacIntel", () => bloqueado, alvo as unknown as Window)
  })

  afterEach(() => {
    desligar()
    vi.useRealTimers()
  })

  it("aparece depois da espera, e some ao soltar", () => {
    alvo.dispatchEvent(tecla("keydown", { key: "Meta", metaKey: true }))
    expect(visivel()).toBe(false)
    vi.advanceTimersByTime(m.ESPERA_DO_SELO_MS)
    expect(visivel()).toBe(true)
    alvo.dispatchEvent(tecla("keyup", { key: "Meta" }))
    expect(visivel()).toBe(false)
  })

  it("⌘C rápido não pisca o selo", () => {
    alvo.dispatchEvent(tecla("keydown", { key: "Meta", metaKey: true }))
    alvo.dispatchEvent(tecla("keydown", { key: "c", code: "KeyC", metaKey: true }))
    vi.advanceTimersByTime(m.ESPERA_DO_SELO_MS * 2)
    expect(visivel()).toBe(false)
  })

  it("com diálogo na frente, não aparece", () => {
    bloqueado = true
    alvo.dispatchEvent(tecla("keydown", { key: "Meta", metaKey: true }))
    vi.advanceTimersByTime(m.ESPERA_DO_SELO_MS)
    expect(visivel()).toBe(false)
  })

  it("perder o foco da janela esconde", () => {
    alvo.dispatchEvent(tecla("keydown", { key: "Meta", metaKey: true }))
    vi.advanceTimersByTime(m.ESPERA_DO_SELO_MS)
    alvo.dispatchEvent(new Event("blur"))
    expect(visivel()).toBe(false)
  })

  it("no Mac o Ctrl não conta; o número segue o ⌘1–9", () => {
    alvo.dispatchEvent(tecla("keydown", { key: "Control", ctrlKey: true }))
    vi.advanceTimersByTime(m.ESPERA_DO_SELO_MS)
    expect(visivel()).toBe(false)
    expect(m.numeroDoSelo(0)).toBe(2)
    expect(m.numeroDoSelo(7)).toBe(9)
    expect(m.numeroDoSelo(8)).toBeNull()
  })
})
