import { describe, expect, it, vi } from "vitest"
import {
  CONVERSATION_COLUMN_WIDTH,
  CONVERSATION_SCALES,
  conversationScaleAction,
  conversationColumnStyle,
  conversationScalePercent,
  normalizeConversationScale,
  scaleFromShortcut,
  stepConversationScale,
} from "@/lib/conversationScale"

function key(
  code: string,
  overrides: Partial<KeyboardEvent> = {},
): KeyboardEvent {
  return {
    code,
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  } as unknown as KeyboardEvent
}

describe("escala de leitura da conversa", () => {
  it("reconhece os atalhos de navegador no teclado principal e numérico", () => {
    expect(conversationScaleAction(key("Equal"))).toBe("increase")
    expect(conversationScaleAction(key("NumpadAdd"))).toBe("increase")
    expect(conversationScaleAction(key("Minus"))).toBe("decrease")
    expect(conversationScaleAction(key("NumpadSubtract"))).toBe("decrease")
    expect(conversationScaleAction(key("Digit0"))).toBe("reset")
    expect(conversationScaleAction(key("Numpad0"))).toBe("reset")
  })

  it("aceita Ctrl e não captura tecla sem modificador ou com Alt", () => {
    expect(
      conversationScaleAction(
        key("Equal", { metaKey: false, ctrlKey: true }),
      ),
    ).toBe("increase")
    expect(
      conversationScaleAction(
        key("Equal", { metaKey: false, ctrlKey: false }),
      ),
    ).toBeNull()
    expect(conversationScaleAction(key("Equal", { altKey: true }))).toBeNull()
    expect(conversationScaleAction(key("KeyK"))).toBeNull()
  })

  it("avança por degraus, respeita os limites e restaura 100%", () => {
    expect(stepConversationScale(1, 1)).toBe(1.1)
    expect(stepConversationScale(1, -1)).toBe(0.9)
    expect(stepConversationScale(1.6, 1)).toBe(1.6)
    expect(stepConversationScale(0.8, -1)).toBe(0.8)

    const increase = key("Equal")
    expect(scaleFromShortcut(increase, 1)).toBe(1.1)
    expect(increase.preventDefault).toHaveBeenCalledOnce()
    expect(increase.stopPropagation).toHaveBeenCalledOnce()

    expect(scaleFromShortcut(key("Digit0"), 1.4)).toBe(1)
  })

  it("normaliza storage inválido e apresenta porcentagem humana", () => {
    expect(normalizeConversationScale(Number.NaN)).toBe(1)
    expect(normalizeConversationScale(1.27)).toBe(1.3)
    expect(conversationScalePercent(1.3)).toBe("130%")
  })

  it("a largura da coluna NÃO se compensa pela escala (era compensação dupla)", () => {
    // A regra é contraintuitiva e por isso precisa de teste: em Chrome
    // moderno a porcentagem já resolve contra o contentor ajustado pelo zoom,
    // então `100 / scale` pinta 950px a 80% (transbordando o pai de 760) e
    // 585px a 130% (coluna encolhendo). Medido com elementFromPoint.
    for (const requested of CONVERSATION_SCALES) {
      const estilo = conversationColumnStyle(requested)
      expect(estilo.width).toBe("100%")
      expect(estilo.zoom).toBe(normalizeConversationScale(requested))
    }
  })

  it("a coluna física é declarada UMA vez, sem escala dentro", () => {
    expect(CONVERSATION_COLUMN_WIDTH).toBe(760)
  })
})
