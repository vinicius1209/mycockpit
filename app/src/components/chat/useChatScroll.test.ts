import { describe, expect, it } from "vitest"
import { PERTO_DO_FIM_PX, ehGestoDeLeitura, pertoDoFim } from "./useChatScroll"

const source = Object.values(
  import.meta.glob("./useChatScroll.ts", {
    query: "?raw",
    import: "default",
    eager: true,
  }),
)[0] as string

describe("pertoDoFim", () => {
  it("no fim exato conta como fim", () => {
    expect(pertoDoFim({ scrollHeight: 1000, scrollTop: 800, clientHeight: 200 })).toBe(
      true,
    )
  })

  it("a folga existe pra não perder o fim por um pixel de sub-pixel", () => {
    // Zoom, borda fracionária e devicePixelRatio fazem a conta fechar em
    // 999,6 em vez de 1000. Sem folga, o autoscroll desligaria sozinho.
    expect(
      pertoDoFim({ scrollHeight: 1000, scrollTop: 799, clientHeight: 200 }),
    ).toBe(true)
  })

  it("longe do fim não é fim", () => {
    expect(
      pertoDoFim({ scrollHeight: 5000, scrollTop: 100, clientHeight: 800 }),
    ).toBe(false)
  })

  it("na fronteira, o limite é exclusivo", () => {
    const scrollTop = 1000 - 200 - PERTO_DO_FIM_PX
    expect(pertoDoFim({ scrollHeight: 1000, scrollTop, clientHeight: 200 })).toBe(
      false,
    )
    expect(
      pertoDoFim({ scrollHeight: 1000, scrollTop: scrollTop + 1, clientHeight: 200 }),
    ).toBe(true)
  })
})

describe("ehGestoDeLeitura", () => {
  it("roda, teclas de navegação e fim/início soltam a âncora", () => {
    for (const k of ["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]) {
      expect(ehGestoDeLeitura(k)).toBe(true)
    }
  })

  it("digitar não é gesto de leitura", () => {
    // Digitação acontece no composer. Se letra soltasse a âncora, escrever
    // enquanto o turno roda desligaria o autoscroll sem ninguém pedir.
    for (const k of ["a", "Enter", "Shift", "Meta", " "]) {
      expect(ehGestoDeLeitura(k)).toBe(false)
    }
  })
})

describe("a política de seguir", () => {
  it("chegar ao fim é o gesto que RELIGA o seguir", () => {
    // O par do gesto de leitura. Sem ele, quem subisse pra ler uma vez teria
    // que reabrir a conversa pra voltar a ser levado junto.
    expect(pertoDoFim({ scrollHeight: 1000, scrollTop: 800, clientHeight: 200 })).toBe(
      true,
    )
  })

  it("subir pra ler tira do fim, e é só isso que a POSIÇÃO decide", () => {
    // Desligar o seguir por posição era o defeito: o fio parava sozinho no
    // meio do turno porque a linha de ferramenta cresce depois de chegar, e o
    // crescimento empurrava o fim pra fora sem ninguém ter pedido nada.
    expect(
      pertoDoFim({ scrollHeight: 5000, scrollTop: 100, clientHeight: 800 }),
    ).toBe(false)
  })
})

describe("o alvo do observador de crescimento", () => {
  it("é o transcript explícito, não o primeiro filho acidental do scroller", () => {
    expect(source).toContain("ro.observe(contentEl)")
    expect(source).toContain("contentRef: setContentEl")
    expect(source).not.toContain("ro.observe(el.firstElementChild)")
  })
})
