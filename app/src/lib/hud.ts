import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { isTauri } from "@/lib/db"

export type HudPosition =
  | "notch"
  | "island"
  | "left"
  | "right"
  | "bottom"
  | "menubar"

export interface ScreenGeometry {
  id: string
  name: string
  hasNotch: boolean
  notchWidth: number
  notchHeight: number
  screenWidth: number
  screenHeight: number
  originX: number
  originY: number
  visibleX: number
  visibleY: number
  visibleWidth: number
  visibleHeight: number
  scaleFactor: number
  safeTop: number
  active: boolean
}

export interface HudRuntimeView {
  enabled: boolean
  requestedPosition: HudPosition
  effectivePosition: HudPosition
  hoverExpand: boolean
  followActiveScreen: boolean
  screenId: string | null
  expanded: boolean
  screen: ScreenGeometry | null
  availableScreens: ScreenGeometry[]
  fallbackReason: string | null
  supportedPositions: HudPosition[]
}

export interface HudPreferences {
  enabled: boolean
  position: HudPosition
  hoverExpand: boolean
  followActiveScreen: boolean
  screenId: string | null
}

export async function hudStatus(): Promise<HudRuntimeView | null> {
  if (!isTauri()) return null
  return invoke<HudRuntimeView>("hud_status")
}

export async function setHudPreferences(
  preferences: HudPreferences,
): Promise<HudRuntimeView | null> {
  if (!isTauri()) return null
  return invoke<HudRuntimeView>("set_hud_preferences", { preferences })
}

export async function setHudExpanded(
  expanded: boolean,
  focus = false,
  autoCollapse = false,
): Promise<HudRuntimeView | null> {
  if (!isTauri()) return null
  return invoke<HudRuntimeView>("set_hud_expanded", {
    expanded,
    focus,
    autoCollapse,
  })
}

export function listenHudState(
  onState: (state: HudRuntimeView) => void,
): Promise<UnlistenFn> {
  return listen<HudRuntimeView>("hud://state", (event) => onState(event.payload))
}

export const HUD_POSITION_LABEL: Record<HudPosition, string> = {
  notch: "Notch",
  island: "Ilha no topo",
  left: "Borda esquerda",
  right: "Borda direita",
  bottom: "Base da tela",
  menubar: "Barra de menus",
}

export function hudRuntimeLabel(runtime: HudRuntimeView | null): string {
  if (!runtime?.enabled || runtime.effectivePosition === "menubar") {
    return "Popover na barra de menus"
  }
  const display = runtime.screen?.name
  const position = HUD_POSITION_LABEL[runtime.effectivePosition]
  return display ? position + " · " + display : position
}
