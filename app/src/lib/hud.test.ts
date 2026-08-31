import { beforeEach, describe, expect, it, vi } from "vitest"
import { setHudExpanded } from "@/lib/hud"

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve(null)),
}))

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }))
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }))
vi.mock("@/lib/db", () => ({ isTauri: () => true }))

describe("contrato de foco do instrumento", () => {
  beforeEach(() => mocks.invoke.mockClear())

  it("hover pode expandir sem roubar foco", async () => {
    await setHudExpanded(true)
    expect(mocks.invoke).toHaveBeenCalledWith("set_hud_expanded", {
      expanded: true,
      focus: false,
    })
  })

  it("gesto explícito pode pedir foco para teclado e Esc", async () => {
    await setHudExpanded(true, true)
    expect(mocks.invoke).toHaveBeenCalledWith("set_hud_expanded", {
      expanded: true,
      focus: true,
    })
  })
})
