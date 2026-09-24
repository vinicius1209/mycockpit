import { describe, expect, it } from "vitest"
import { acaoDoAtalho, rotuloDoAtalho, type TeclaDoAtalho } from "./atalhosDasAbas"

const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15"
const LINUX = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15"

function tecla(parcial: Partial<TeclaDoAtalho>): TeclaDoAtalho {
  return { key: "", code: "", metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...parcial }
}

describe("atalhos das abas", () => {
  it("⌘1 é a Conversa e ⌘2…⌘9 são as posições da tira", () => {
    expect(acaoDoAtalho(tecla({ code: "Digit1", key: "1", metaKey: true }), MAC)).toEqual({ tipo: "posicao", n: 1 })
    expect(acaoDoAtalho(tecla({ code: "Digit4", key: "4", metaKey: true }), MAC)).toEqual({ tipo: "posicao", n: 4 })
    expect(acaoDoAtalho(tecla({ code: "Digit4", key: "4", ctrlKey: true }), LINUX)).toEqual({ tipo: "posicao", n: 4 })
  })

  it("⌘0 não é das abas: é o tamanho da conversa (conversationScale)", () => {
    expect(acaoDoAtalho(tecla({ code: "Digit0", key: "0", metaKey: true }), MAC)).toBeNull()
  })

  it("⌃Tab e ⌃⇧Tab alternam nas duas plataformas", () => {
    expect(acaoDoAtalho(tecla({ key: "Tab", code: "Tab", ctrlKey: true }), MAC)).toEqual({ tipo: "alternar", passo: 1 })
    expect(acaoDoAtalho(tecla({ key: "Tab", code: "Tab", ctrlKey: true, shiftKey: true }), LINUX)).toEqual({
      tipo: "alternar",
      passo: -1,
    })
  })

  it("⌘W no macOS fica com o menu nativo; Ctrl+W no Linux chega como tecla", () => {
    expect(acaoDoAtalho(tecla({ code: "KeyW", key: "w", metaKey: true }), MAC)).toBeNull()
    expect(acaoDoAtalho(tecla({ code: "KeyW", key: "w", ctrlKey: true }), LINUX)).toEqual({ tipo: "fechar" })
  })

  it("⌘⇧T reabre a última fechada", () => {
    expect(acaoDoAtalho(tecla({ code: "KeyT", key: "T", metaKey: true, shiftKey: true }), MAC)).toEqual({ tipo: "reabrir" })
    expect(acaoDoAtalho(tecla({ code: "KeyT", key: "t", metaKey: true }), MAC)).toBeNull()
  })

  it("modificador da outra plataforma e Alt não disparam", () => {
    expect(acaoDoAtalho(tecla({ code: "Digit2", key: "2", ctrlKey: true }), MAC)).toBeNull()
    expect(acaoDoAtalho(tecla({ code: "Digit2", key: "2", metaKey: true }), LINUX)).toBeNull()
    expect(acaoDoAtalho(tecla({ code: "Digit2", key: "2", metaKey: true, altKey: true }), MAC)).toBeNull()
  })

  it("o rótulo segue a convenção da plataforma", () => {
    expect(rotuloDoAtalho("fechar", MAC)).toBe("⌘W")
    expect(rotuloDoAtalho("reabrir", MAC)).toBe("⌘⇧T")
    expect(rotuloDoAtalho(3, MAC)).toBe("⌘3")
    expect(rotuloDoAtalho("reabrir", LINUX)).toBe("Ctrl Shift T")
  })
})
