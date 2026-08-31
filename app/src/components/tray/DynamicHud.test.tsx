import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { DynamicHud } from "./DynamicHud"

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() =>
    Promise.resolve({
      running: 1,
      decisions: 0,
      blocking: 0,
      activities: [],
      decisionConvId: null,
      decisionProjectId: null,
      nextSchedule: null,
      lastRun: null,
      lastTurn: null,
      enabledSchedules: 0,
      deferred: 0,
      external: [],
    }),
  ),
}))

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}))

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({
    setTheme: vi.fn(() => Promise.resolve()),
  })),
}))

describe("DynamicHud", () => {
  it("renderiza o compacto sem inventar estado antes do primeiro snapshot", () => {
    const html = renderToStaticMarkup(
      createElement(DynamicHud, {
        runtime: {
          enabled: true,
          requestedPosition: "notch",
          effectivePosition: "notch",
          hoverExpand: true,
          followActiveScreen: true,
          screenId: null,
          expanded: false,
          screen: {
            id: "1",
            name: "Built-in Retina Display",
            hasNotch: true,
            notchWidth: 185,
            notchHeight: 32,
            screenWidth: 1512,
            screenHeight: 982,
            originX: 0,
            originY: 0,
            visibleX: 0,
            visibleY: 33,
            visibleWidth: 1512,
            visibleHeight: 949,
            scaleFactor: 2,
            safeTop: 32,
            active: true,
          },
          availableScreens: [],
          fallbackReason: null,
          supportedPositions: ["notch", "island", "left", "right", "bottom", "menubar"],
        },
      }),
    )
    expect(html).toContain("dynamic-hud-shell")
    expect(html).toContain("bg-hud-shell")
    expect(html).not.toContain("padding-top")
    expect(html).toContain("grid-template-columns:1fr 185px 1fr")
    expect(html).toContain("Lendo a frota")
    expect(html).not.toContain("Frota pronta")
    expect(html).not.toContain("Journey Streak")
  })

  it("o expandido integra o notch e reserva o centro durante a leitura", () => {
    const html = renderToStaticMarkup(
      createElement(DynamicHud, {
        runtime: {
          enabled: true,
          requestedPosition: "notch",
          effectivePosition: "notch",
          hoverExpand: true,
          followActiveScreen: true,
          screenId: null,
          expanded: true,
          screen: {
            id: "1",
            name: "Built-in Retina Display",
            hasNotch: true,
            notchWidth: 185,
            notchHeight: 32,
            screenWidth: 1512,
            screenHeight: 982,
            originX: 0,
            originY: 0,
            visibleX: 0,
            visibleY: 33,
            visibleWidth: 1512,
            visibleHeight: 949,
            scaleFactor: 2,
            safeTop: 32,
            active: true,
          },
          availableScreens: [],
          fallbackReason: null,
          supportedPositions: ["notch", "island", "left", "right", "bottom", "menubar"],
        },
      }),
    )
    expect(html).toContain("Lendo o estado da frota")
    expect(html).toContain("grid-template-columns:1fr 185px 1fr")
    expect(html).not.toContain("Built-in Retina Display")
    expect(html).not.toContain("Recolher")
    expect(html).toContain("rounded-b-[13px] border-x border-b")
  })

  it("acopla a ilha à aresta superior sem criar um cartão de quatro cantos", () => {
    const html = renderToStaticMarkup(
      createElement(DynamicHud, {
        runtime: {
          enabled: true,
          requestedPosition: "island",
          effectivePosition: "island",
          hoverExpand: true,
          followActiveScreen: true,
          screenId: null,
          expanded: false,
          screen: null,
          availableScreens: [],
          fallbackReason: null,
          supportedPositions: ["notch", "island", "left", "right", "bottom", "menubar"],
        },
      }),
    )
    expect(html).toContain("rounded-b-[13px] border-x border-b")
    expect(html).toContain("dark h-full w-full overflow-hidden bg-hud-shell")
    expect(html).not.toContain("bg-popover")
    expect(html).not.toContain("rounded-[13px]")
    expect(html).not.toContain("p-1")
  })

  it("resume a borda direita em marca e estado, sem texto vertical cortado", () => {
    const html = renderToStaticMarkup(
      createElement(DynamicHud, {
        runtime: {
          enabled: true,
          requestedPosition: "right",
          effectivePosition: "right",
          hoverExpand: true,
          followActiveScreen: true,
          screenId: null,
          expanded: false,
          screen: null,
          availableScreens: [],
          fallbackReason: null,
          supportedPositions: ["notch", "island", "left", "right", "bottom", "menubar"],
        },
      }),
    )
    expect(html).toContain("rounded-l-[13px] border-y border-l")
    expect(html).toContain("dark h-full w-full overflow-hidden bg-hud-shell")
    expect(html).not.toContain("bg-popover")
    expect(html).toContain("viewBox=\"0 0 44 44\"")
    expect(html).toContain("lucide-loader-circle")
    expect(html).not.toContain("writing-mode")
  })
})
