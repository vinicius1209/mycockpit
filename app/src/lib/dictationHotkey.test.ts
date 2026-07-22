// Atalho de ditado (lib/dictationHotkey): tap × hold com relógio fake, repeat
// ignorado, modificador extra/faltando rejeitado, combo CONFIGURÁVEL (parse/
// format/matching por e.code), captura pura (exige modificador, bloqueia ⌘K),
// null inerte, sem alvo ⇒ aviso, e o registro de alvos (último registrado E
// disponível vence).
import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  DEFAULT_DICTATION_HOTKEY,
  HOLD_MS,
  _resetDictationTargets,
  activeDictationTarget,
  captureHotkey,
  createDictationHotkey,
  formatHotkey,
  matchesHotkey,
  parseHotkey,
  registerDictationTarget,
  serializeHotkey,
  type DictationTarget,
  type HotkeyEvent,
} from "./dictationHotkey"

function ev(over: Partial<HotkeyEvent> = {}): HotkeyEvent {
  return {
    code: "Space",
    altKey: true,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    repeat: false,
    preventDefault: vi.fn(),
    ...over,
  }
}

function makeTarget(over: Partial<DictationTarget> = {}): DictationTarget {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    isRecording: vi.fn(() => false),
    ...over,
  }
}

/** Harness com relógio fake e deps padrão (tudo sobrescritível). */
function makeHotkey(over: {
  target?: DictationTarget | null
  combo?: string | null
  enabled?: boolean
  blocked?: boolean
  onNoTarget?: () => void
} = {}) {
  let now = 0
  const target = "target" in over ? over.target : makeTarget()
  const onNoTarget = over.onNoTarget ?? vi.fn()
  let combo = "combo" in over ? over.combo : DEFAULT_DICTATION_HOTKEY
  const h = createDictationHotkey({
    target: () => target ?? null,
    combo: () => combo ?? null,
    enabled: () => over.enabled ?? true,
    blocked: () => over.blocked ?? false,
    onNoTarget,
    now: () => now,
  })
  return {
    ...h,
    target,
    onNoTarget,
    advance: (ms: number) => {
      now += ms
    },
    setCombo: (c: string | null) => {
      combo = c
    },
  }
}

/** Drena as microtasks do encadeamento start→stop do hold. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

beforeEach(() => {
  _resetDictationTargets()
})

describe("parseHotkey / serializeHotkey", () => {
  it("parseia o padrão alt+Space", () => {
    expect(parseHotkey("alt+Space")).toEqual({
      code: "Space",
      ctrl: false,
      alt: true,
      shift: false,
      meta: false,
    })
  })

  it("parseia combo composto ctrl+alt+KeyD", () => {
    expect(parseHotkey("ctrl+alt+KeyD")).toEqual({
      code: "KeyD",
      ctrl: true,
      alt: true,
      shift: false,
      meta: false,
    })
  })

  it("rejeita: sem modificador, token estranho, duplicado, sem tecla principal", () => {
    expect(parseHotkey("Space")).toBeNull() // dispararia digitando espaço
    expect(parseHotkey("super+Space")).toBeNull()
    expect(parseHotkey("alt+alt+Space")).toBeNull()
    expect(parseHotkey("alt+meta")).toBeNull() // "meta" não é tecla principal
    expect(parseHotkey("ctrl+AltLeft")).toBeNull() // modificador como principal
    expect(parseHotkey("")).toBeNull()
  })

  it("serializa na ordem canônica ctrl, alt, shift, meta + code", () => {
    expect(
      serializeHotkey({
        code: "KeyD",
        ctrlKey: true,
        altKey: true,
        shiftKey: false,
        metaKey: false,
      }),
    ).toBe("ctrl+alt+KeyD")
    expect(
      serializeHotkey({
        code: "Space",
        ctrlKey: false,
        altKey: true,
        shiftKey: true,
        metaKey: true,
      }),
    ).toBe("alt+shift+meta+Space")
  })

  it("serialize → parse → matches fecha o ciclo (round-trip)", () => {
    const e = ev({ code: "KeyD", altKey: true, ctrlKey: true })
    const p = parseHotkey(serializeHotkey(e))!
    expect(matchesHotkey(e, p)).toBe(true)
  })
})

describe("matchesHotkey", () => {
  it("casa por e.code (independente de layout) com os modificadores exatos", () => {
    const p = parseHotkey("ctrl+alt+KeyD")!
    expect(
      matchesHotkey(ev({ code: "KeyD", ctrlKey: true, altKey: true }), p),
    ).toBe(true)
  })

  it("modificador EXTRA rejeita; modificador faltando rejeita; code errado rejeita", () => {
    const p = parseHotkey("ctrl+alt+KeyD")!
    const base = { code: "KeyD", ctrlKey: true, altKey: true }
    expect(matchesHotkey(ev({ ...base, shiftKey: true }), p)).toBe(false)
    expect(matchesHotkey(ev({ ...base, metaKey: true }), p)).toBe(false)
    expect(matchesHotkey(ev({ ...base, altKey: false }), p)).toBe(false)
    expect(matchesHotkey(ev({ ...base, code: "KeyE" }), p)).toBe(false)
  })
})

describe("formatHotkey", () => {
  it("nomes pt + símbolos mac na ordem ⌃⌥⇧⌘", () => {
    expect(formatHotkey("alt+Space")).toBe("⌥ Espaço")
    expect(formatHotkey("ctrl+alt+KeyD")).toBe("⌃⌥ D")
    expect(formatHotkey("shift+meta+KeyP")).toBe("⇧⌘ P")
    expect(formatHotkey("alt+Digit3")).toBe("⌥ 3")
    expect(formatHotkey("alt+ArrowUp")).toBe("⌥ ↑")
  })

  it("null (desativado) ⇒ string vazia; inválido volta cru", () => {
    expect(formatHotkey(null)).toBe("")
    expect(formatHotkey("banana")).toBe("banana")
  })
})

describe("captureHotkey (Configurações ▸ Gravar atalho)", () => {
  it("keydown válido com modificador ⇒ ok com o combo serializado", () => {
    expect(
      captureHotkey(ev({ code: "KeyD", ctrlKey: true, altKey: true })),
    ).toEqual({ kind: "ok", combo: "ctrl+alt+KeyD" })
  })

  it("tecla sem modificador ⇒ needs-modifier", () => {
    expect(captureHotkey(ev({ code: "KeyD", altKey: false }))).toEqual({
      kind: "needs-modifier",
    })
  })

  it("só modificador pressionado ⇒ pending (segue capturando)", () => {
    for (const code of ["AltLeft", "ControlRight", "ShiftLeft", "MetaRight"]) {
      expect(captureHotkey(ev({ code, altKey: false }))).toEqual({
        kind: "pending",
      })
    }
  })

  it("⌘K (paleta do app) ⇒ reserved; ⌘⇧K passa", () => {
    expect(
      captureHotkey(ev({ code: "KeyK", altKey: false, metaKey: true })),
    ).toEqual({ kind: "reserved" })
    expect(
      captureHotkey(
        ev({ code: "KeyK", altKey: false, metaKey: true, shiftKey: true }),
      ),
    ).toEqual({ kind: "ok", combo: "shift+meta+KeyK" })
  })
})

describe("createDictationHotkey — tap × hold", () => {
  it("tap (<350ms) inicia e SEGUE gravando (toggle ligado)", async () => {
    const h = makeHotkey()
    h.onKeyDown(ev())
    h.advance(HOLD_MS - 1)
    h.onKeyUp(ev())
    await flush()
    expect(h.target!.start).toHaveBeenCalledTimes(1)
    expect(h.target!.stop).not.toHaveBeenCalled()
  })

  it("tap com gravação em andamento PARA e insere", async () => {
    const h = makeHotkey({
      target: makeTarget({ isRecording: vi.fn(() => true) }),
    })
    h.onKeyDown(ev())
    h.advance(100)
    h.onKeyUp(ev())
    await flush()
    expect(h.target!.start).not.toHaveBeenCalled()
    expect(h.target!.stop).toHaveBeenCalledTimes(1)
  })

  it("hold (≥350ms) é push-to-talk: soltar para e insere", async () => {
    const h = makeHotkey()
    h.onKeyDown(ev())
    h.advance(HOLD_MS)
    h.onKeyUp(ev())
    await flush()
    expect(h.target!.start).toHaveBeenCalledTimes(1)
    expect(h.target!.stop).toHaveBeenCalledTimes(1)
  })

  it("hold: o stop espera o start (async) assentar", async () => {
    const order: string[] = []
    let release!: () => void
    const started = new Promise<void>((r) => {
      release = r
    })
    const h = makeHotkey({
      target: makeTarget({
        start: vi.fn(() => {
          order.push("start")
          return started
        }),
        stop: vi.fn(() => {
          order.push("stop")
        }),
      }),
    })
    h.onKeyDown(ev())
    h.advance(HOLD_MS + 50)
    h.onKeyUp(ev())
    await flush()
    expect(order).toEqual(["start"]) // stop ainda esperando o start
    release()
    await flush()
    expect(order).toEqual(["start", "stop"])
  })

  it("keyup sem os modificadores (⌥ solto antes do espaço) ainda fecha o hold", async () => {
    const h = makeHotkey()
    h.onKeyDown(ev())
    h.advance(HOLD_MS)
    h.onKeyUp(ev({ altKey: false }))
    await flush()
    expect(h.target!.stop).toHaveBeenCalledTimes(1)
  })

  it("soltar um MODIFICADOR (keyup AltLeft) também encerra o hold", async () => {
    const h = makeHotkey()
    h.onKeyDown(ev())
    h.advance(HOLD_MS)
    h.onKeyUp(ev({ code: "AltLeft", altKey: false }))
    await flush()
    expect(h.target!.stop).toHaveBeenCalledTimes(1)
    // o keyup posterior do Espaço é inócuo (sessão já fechada)
    const up = ev()
    h.onKeyUp(up)
    await flush()
    expect(h.target!.stop).toHaveBeenCalledTimes(1)
    expect(up.preventDefault).not.toHaveBeenCalled()
  })

  it("tap e hold valem pra QUALQUER combo configurado (⌃⌥D)", async () => {
    const h = makeHotkey({ combo: "ctrl+alt+KeyD" })
    const down = ev({ code: "KeyD", ctrlKey: true, altKey: true })
    h.onKeyDown(down)
    expect(down.preventDefault).toHaveBeenCalled()
    h.advance(HOLD_MS)
    h.onKeyUp(ev({ code: "KeyD", ctrlKey: true, altKey: true }))
    await flush()
    expect(h.target!.start).toHaveBeenCalledTimes(1)
    expect(h.target!.stop).toHaveBeenCalledTimes(1)
  })
})

describe("createDictationHotkey — guardas", () => {
  it("key repeat: preventDefault (sem NBSP no hold) mas NÃO redispara", () => {
    const h = makeHotkey()
    h.onKeyDown(ev())
    const rep = ev({ repeat: true })
    h.onKeyDown(rep)
    h.onKeyDown(ev({ repeat: true }))
    expect(rep.preventDefault).toHaveBeenCalled()
    expect(h.target!.start).toHaveBeenCalledTimes(1)
  })

  it("modificador extra, faltando ou code errado ⇒ ignora (nem preventDefault)", () => {
    const h = makeHotkey()
    const cases = [
      ev({ metaKey: true }),
      ev({ ctrlKey: true }),
      ev({ shiftKey: true }),
      ev({ altKey: false }),
      ev({ code: "KeyA" }),
    ]
    for (const e of cases) h.onKeyDown(e)
    for (const e of cases) expect(e.preventDefault).not.toHaveBeenCalled()
    expect(h.target!.start).not.toHaveBeenCalled()
  })

  it("desabilitado ou com modal aberto ⇒ não trata", () => {
    for (const opts of [{ enabled: false }, { blocked: true }]) {
      const h = makeHotkey(opts)
      const e = ev()
      h.onKeyDown(e)
      expect(e.preventDefault).not.toHaveBeenCalled()
      expect(h.target!.start).not.toHaveBeenCalled()
    }
  })

  it("combo null (atalho desativado) ⇒ handler inerte", () => {
    const h = makeHotkey({ combo: null })
    const down = ev()
    h.onKeyDown(down)
    h.onKeyUp(ev())
    expect(down.preventDefault).not.toHaveBeenCalled()
    expect(h.target!.start).not.toHaveBeenCalled()
    expect(h.onNoTarget).not.toHaveBeenCalled()
  })

  it("o combo é lido POR EVENTO: trocar o setting vale no próximo keydown", () => {
    const h = makeHotkey()
    h.setCombo("ctrl+alt+KeyD")
    const old = ev() // alt+Space não vale mais
    h.onKeyDown(old)
    expect(old.preventDefault).not.toHaveBeenCalled()
    h.onKeyDown(ev({ code: "KeyD", ctrlKey: true, altKey: true }))
    expect(h.target!.start).toHaveBeenCalledTimes(1)
  })

  it("sem alvo ⇒ callback de aviso (e o keyup posterior é inócuo)", () => {
    const h = makeHotkey({ target: null })
    const down = ev()
    h.onKeyDown(down)
    expect(h.onNoTarget).toHaveBeenCalledTimes(1)
    expect(down.preventDefault).toHaveBeenCalled()
    const up = ev()
    h.onKeyUp(up) // sem sessão aberta
    expect(up.preventDefault).not.toHaveBeenCalled()
  })
})

describe("registro de alvos", () => {
  it("o último registrado vence; desregistrar devolve o anterior", () => {
    const a = makeTarget()
    const b = makeTarget()
    registerDictationTarget(a)
    const offB = registerDictationTarget(b)
    expect(activeDictationTarget()).toBe(b)
    offB()
    expect(activeDictationTarget()).toBe(a)
  })

  it("alvo indisponível (isAvailable=false) é pulado", () => {
    const a = makeTarget()
    const b = makeTarget({ isAvailable: () => false })
    registerDictationTarget(a)
    registerDictationTarget(b)
    expect(activeDictationTarget()).toBe(a)
  })

  it("sem alvos ⇒ null", () => {
    expect(activeDictationTarget()).toBeNull()
  })
})
