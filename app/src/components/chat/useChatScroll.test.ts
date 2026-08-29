import { describe, expect, it } from "vitest"
import {
  PERTO_DO_FIM_PX,
  SILENCIO_DE_REFLOW_MS,
  TETO_DE_ANCORAGEM_MS,
  ehGestoDeLeitura,
  pertoDoFim,
} from "./useChatScroll"

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

describe("a janela de ancoragem", () => {
  it("fecha por SILÊNCIO, e o teto é a rede de segurança", () => {
    // O prazo fixo de 800ms era o defeito: bastava pra fio curto e não bastava
    // pra um com imagem e diff, que aterrissava no meio. Agora o que encerra é
    // o layout parar de mexer; o teto só existe pra conteúdo que nunca para
    // (gif, iframe, imagem que tenta de novo).
    expect(SILENCIO_DE_REFLOW_MS).toBeLessThan(TETO_DE_ANCORAGEM_MS)
    // Silêncio curto o bastante pra não segurar a rolagem do usuário depois
    // que a tela assentou.
    expect(SILENCIO_DE_REFLOW_MS).toBeLessThanOrEqual(500)
  })
})
