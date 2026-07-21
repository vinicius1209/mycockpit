// Testes do dock ALARGADO da Sala de Decisão (§ gate rico): o card de gate
// montado no dock (DeskDock/MissionDock) faz push; o unmount faz pop — a
// largura só volta a DOCK_W quando o ÚLTIMO card sai. Sem DOM.
// Roda com: bunx vitest run src/office/ui/dockWide.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest"

// Mocks herméticos (mesma razão do ui.test.ts): o store importa efeitos do
// bridge e a assinatura da cena — nada disso participa da largura do dock.
vi.mock("../bridge/hooks", () => ({
  dockLeaveCtx: () => ({ hasDraft: false, turnActive: false }),
}))
vi.mock("../bridge/voice", () => ({ cancelDictation: vi.fn(async () => {}) }))

import {
  DOCK_W,
  DOCK_W_WIDE,
  activeDockWidth,
  useOfficeUi,
} from "./store"

beforeEach(() => {
  // zera só o que este teste mexe (o store é módulo-singleton)
  useOfficeUi.setState({ dockWideCount: 0, dockWide: false })
})

describe("dock alargado (pushDockWide/popDockWide)", () => {
  it("card de gate montado alarga; desmontado estreita", () => {
    const s = useOfficeUi.getState()
    expect(useOfficeUi.getState().dockWide).toBe(false)
    expect(activeDockWidth(useOfficeUi.getState().dockWide)).toBe(DOCK_W)

    s.pushDockWide()
    expect(useOfficeUi.getState().dockWide).toBe(true)
    expect(activeDockWidth(useOfficeUi.getState().dockWide)).toBe(DOCK_W_WIDE)

    s.popDockWide()
    expect(useOfficeUi.getState().dockWide).toBe(false)
    expect(activeDockWidth(useOfficeUi.getState().dockWide)).toBe(DOCK_W)
  })

  it("dois cards simultâneos: só o ÚLTIMO pop estreita", () => {
    const s = useOfficeUi.getState()
    s.pushDockWide()
    s.pushDockWide()
    expect(useOfficeUi.getState().dockWide).toBe(true)
    s.popDockWide()
    expect(useOfficeUi.getState().dockWide).toBe(true) // ainda há um card
    s.popDockWide()
    expect(useOfficeUi.getState().dockWide).toBe(false)
  })

  it("pop sem push não fica negativo (StrictMode monta 2×)", () => {
    const s = useOfficeUi.getState()
    s.popDockWide()
    expect(useOfficeUi.getState().dockWideCount).toBe(0)
    s.pushDockWide()
    expect(useOfficeUi.getState().dockWide).toBe(true)
  })

  it("larguras: 380 padrão, 560 com o card de decisão visível", () => {
    expect(DOCK_W).toBe(380)
    expect(DOCK_W_WIDE).toBe(560)
    expect(activeDockWidth(false)).toBe(DOCK_W)
    expect(activeDockWidth(true)).toBe(DOCK_W_WIDE)
  })
})
