import { describe, expect, it } from "vitest"

const FRONT = import.meta.glob(
  [
    "./tray.tsx",
    "./components/tray/TraySurface.tsx",
    "./components/settings/HudSettings.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>
const NATIVE = import.meta.glob(
  ["../src-tauri/src/tray.rs", "../src-tauri/src/hud.rs"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>

describe("instrumento efetivo da bandeja", () => {
  it("roteia entre popover clássico e HUD pelo estado do backend", () => {
    const entrypoint = FRONT["./tray.tsx"]
    const surface = FRONT["./components/tray/TraySurface.tsx"]
    expect(entrypoint).toContain("TraySurface")
    expect(surface).toContain("TrayPopover")
    expect(surface).toContain("DynamicHud")
    expect(surface).toContain('runtime.effectivePosition !== "menubar"')
  })

  it("só oferece preferências que chegam ao presenter nativo", () => {
    const settings = FRONT["./components/settings/HudSettings.tsx"]
    expect(settings).toContain('label="Posição recolhida"')
    expect(settings).toContain('label="Tela do instrumento"')
    expect(settings).toContain("hudScreenId")
    expect(settings).toContain("setHudExpanded")
  })

  it("preserva o popover clássico e move o HUD com geometria nativa", () => {
    const native = NATIVE["../src-tauri/src/tray.rs"]
    const hud = NATIVE["../src-tauri/src/hud.rs"]
    expect(native).toContain(".inner_size(360.0, 430.0)")
    expect(native).toContain(".shadow(true)")
    expect(hud).toContain("set_size")
    expect(hud).toContain("set_position")
    expect(hud).toContain("set_focusable(runtime.expanded)")
    expect(hud).toContain('"hud://hover-leave"')
  })
})
