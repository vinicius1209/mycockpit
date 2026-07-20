/** Testes da lógica pura da cena (sem WebGL/Pixi — só ./logic).
 *  A projeção diamond 2:1 é do engine/iso e testada lá (iso.test.ts). */
import { describe, expect, it } from "vitest"
import type { DeskVisualState } from "../engine/types"
import {
  agentColor,
  beaconColorForState,
  cameraTransform,
  deskAnchorWorld,
  deskContainsWorld,
  doorLightColor,
  doorLightPulses,
  LABEL_LOD_MIN_ZOOM,
  labelTextVisibleAtZoom,
  partsForState,
  quantizeZIndex,
  resolveThemeTokens,
  screenToWorldWith,
  worldToScreenWith,
  zIndexChanged,
  DARK_TOKEN_FALLBACK,
  type ThemeTokens,
} from "./logic"

// factory local — tokens sintéticos p/ mapeamentos de cor
function makeTokens(overrides: Partial<ThemeTokens> = {}): ThemeTokens {
  return {
    brass: "#111111",
    stIdle: "#222222",
    stRunning: "#333333",
    stQueued: "#444444",
    stSuccess: "#555555",
    stError: "#666666",
    ...overrides,
  }
}

describe("transform da câmera", () => {
  it("centra o alvo no meio do viewport (com deslocamento de framing)", () => {
    const cam = { x: 4, y: 4 }
    const t = cameraTransform(cam, 2, 800, 600, { x: -100, y: 0 })
    const s = worldToScreenWith(t, cam.x, cam.y)
    // alvo cai no centro deslocado pelo screenOffset (dock aberto)
    expect(s.x).toBeCloseTo(800 / 2 - 100)
    expect(s.y).toBeCloseTo(600 / 2)
  })

  it("worldToScreen e screenToWorld são inversas sob o mesmo transform", () => {
    const t = cameraTransform({ x: 3.2, y: 1.7 }, 1.5, 1024, 768, { x: 40, y: -12 })
    const s = worldToScreenWith(t, 6.5, 2.25)
    const w = screenToWorldWith(t, s.x, s.y)
    expect(w.x).toBeCloseTo(6.5, 10)
    expect(w.y).toBeCloseTo(2.25, 10)
  })
})

describe("quantização de zIndex (y-sort)", () => {
  it("quantiza screenY para px inteiro", () => {
    expect(quantizeZIndex(101.2)).toBe(101)
    expect(quantizeZIndex(101.5)).toBe(102)
    expect(quantizeZIndex(-3.6)).toBe(-4)
  })

  it("só acusa mudança quando o inteiro quantizado muda (evita re-sort por frame)", () => {
    expect(zIndexChanged(101, 101.4)).toBe(false)
    expect(zIndexChanged(101, 101.49)).toBe(false)
    expect(zIndexChanged(101, 101.6)).toBe(true)
    expect(zIndexChanged(101, 100.6)).toBe(false)
    expect(zIndexChanged(101, 100.4)).toBe(true)
  })
})

describe("LOD dos labels por zoom", () => {
  it("esconde o texto abaixo de 0.8 e mantém acima", () => {
    expect(labelTextVisibleAtZoom(LABEL_LOD_MIN_ZOOM)).toBe(true)
    expect(labelTextVisibleAtZoom(0.79)).toBe(false)
    expect(labelTextVisibleAtZoom(0.5)).toBe(false)
    expect(labelTextVisibleAtZoom(2.5)).toBe(true)
  })
})

describe("mapeamento DeskVisualState → partes do avatar", () => {
  it("off esconde o avatar inteiro (mesa apagada)", () => {
    expect(partsForState("off")).toEqual({
      visible: false,
      coffee: false,
      thoughtDots: false,
      typingArms: false,
      armRightPose: "down",
    })
  })

  it("idle mostra café; thinking mostra balões + mão no queixo", () => {
    expect(partsForState("idle")).toMatchObject({ visible: true, coffee: true, armRightPose: "down" })
    expect(partsForState("thinking")).toMatchObject({
      visible: true,
      thoughtDots: true,
      armRightPose: "chin",
    })
  })

  it("typing alterna os braços; hand ergue o braço direito", () => {
    expect(partsForState("typing")).toMatchObject({ typingArms: true, armRightPose: "down" })
    expect(partsForState("hand")).toMatchObject({ typingArms: false, armRightPose: "raised" })
  })

  it("props de estado são mutuamente exclusivos", () => {
    const states: DeskVisualState[] = ["off", "idle", "thinking", "typing", "hand"]
    for (const s of states) {
      const p = partsForState(s)
      const props = [p.coffee, p.thoughtDots, p.typingArms].filter(Boolean)
      expect(props.length).toBeLessThanOrEqual(1)
    }
  })
})

describe("tokens de tema", () => {
  it("usa o leitor injetado quando a variável existe", () => {
    const tokens = resolveThemeTokens((name) => (name === "--brass" ? " #ff0000 " : ""))
    expect(tokens.brass).toBe("#ff0000")
    // demais caem no fallback dark-first
    expect(tokens.stRunning).toBe(DARK_TOKEN_FALLBACK.stRunning)
  })

  it("sem DOM/variáveis, devolve o fallback completo", () => {
    expect(resolveThemeTokens(() => "")).toEqual(DARK_TOKEN_FALLBACK)
  })
})

describe("cor de identidade do agent (derivada dos tokens do tema)", () => {
  const tokens = makeTokens()

  it("claude=brass, codex=azul running, agy=verde success", () => {
    expect(agentColor("claude-code", tokens)).toBe(tokens.brass)
    expect(agentColor("codex", tokens)).toBe(tokens.stRunning)
    expect(agentColor("agy", tokens)).toBe(tokens.stSuccess)
  })
})

describe("cores de estado (beacon e luz da porta)", () => {
  const tokens = makeTokens()

  it("beacon segue a linguagem do spike (thinking=brass, typing=azul, idle=verde)", () => {
    expect(beaconColorForState("thinking", tokens)).toBe(tokens.brass)
    expect(beaconColorForState("typing", tokens)).toBe(tokens.stRunning)
    expect(beaconColorForState("idle", tokens)).toBe(tokens.stSuccess)
    expect(beaconColorForState("hand", tokens)).toBe(tokens.stQueued)
    expect(beaconColorForState("off", tokens)).toBe(tokens.stIdle)
  })

  it("luz da porta: hand=âmbar (pulsa), running=azul, idle=verde", () => {
    expect(doorLightColor("hand", tokens)).toBe(tokens.stQueued)
    expect(doorLightColor("running", tokens)).toBe(tokens.stRunning)
    expect(doorLightColor("idle", tokens)).toBe(tokens.stSuccess)
    expect(doorLightPulses("hand")).toBe(true)
    expect(doorLightPulses("running")).toBe(false)
    expect(doorLightPulses("idle")).toBe(false)
  })
})

describe("hit-test de mesa (footprint 2×2)", () => {
  it("contém pontos dentro do footprint e rejeita a borda exclusiva", () => {
    const tile = { x: 4, y: 6 }
    expect(deskContainsWorld(tile, 4, 6)).toBe(true)
    expect(deskContainsWorld(tile, 5.99, 7.99)).toBe(true)
    expect(deskContainsWorld(tile, 6, 7)).toBe(false)
    expect(deskContainsWorld(tile, 3.99, 6.5)).toBe(false)
  })

  it("âncora é o centro do footprint", () => {
    expect(deskAnchorWorld({ x: 4, y: 6 })).toEqual({ x: 5, y: 6.5 })
  })
})
