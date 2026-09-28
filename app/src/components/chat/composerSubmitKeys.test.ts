import { describe, expect, it } from "vitest"
import { enterTarget } from "./composerSubmitKeys"

describe("gesto de envio do composer", () => {
  it("Enter envia normalmente em repouso e corrige o turno em voo", () => {
    expect(enterTarget("enter", { command: false, shift: false }, false)).toBe(
      "submit",
    )
    expect(enterTarget("enter", { command: false, shift: false }, true)).toBe(
      "force",
    )
  })

  it("Shift+Enter continua criando nova linha", () => {
    expect(enterTarget("enter", { command: false, shift: true }, true)).toBeNull()
  })

  it("respeita a preferência Cmd+Enter sem mudar o significado do envio", () => {
    expect(enterTarget("cmd-enter", { command: false, shift: false }, true)).toBeNull()
    expect(enterTarget("cmd-enter", { command: true, shift: false }, true)).toBe(
      "force",
    )
  })
})

describe("⌥↵ guarda como nota", () => {
  it("vale nos dois atalhos de envio, e nunca envia", () => {
    expect(enterTarget("enter", { command: false, shift: false, alt: true }, false)).toBe("guardar")
    expect(enterTarget("enter", { command: false, shift: false, alt: true }, true)).toBe("guardar")
    expect(enterTarget("cmd-enter", { command: false, shift: false, alt: true }, false)).toBe("guardar")
  })

  it("com ⌘ ou Shift junto, não é o gesto de guardar", () => {
    expect(enterTarget("enter", { command: false, shift: true, alt: true }, false)).toBeNull()
    expect(enterTarget("cmd-enter", { command: true, shift: false, alt: true }, false)).toBe("submit")
  })
})
