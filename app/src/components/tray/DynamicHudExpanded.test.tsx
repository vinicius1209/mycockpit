import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { DynamicHudExpanded } from "@/components/tray/DynamicHudExpanded"
import type { HudRuntimeView } from "@/lib/hud"
import type { HudPresentation } from "@/lib/hudPresentation"
import type { TrayActivity, TraySnapshot } from "@/lib/tray"

vi.mock("@/lib/tray", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/tray")>()
  return { ...original, runTrayAction: vi.fn(() => Promise.resolve()) }
})

const runtime: HudRuntimeView = {
  enabled: true,
  requestedPosition: "notch",
  effectivePosition: "notch",
  hoverExpand: true,
  followActiveScreen: true,
  screenId: "screen-1",
  expanded: true,
  screen: {
    id: "screen-1",
    name: "Tela interna",
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
}

const activity = (convId: string, title: string): TrayActivity => ({
  convId,
  projectId: "project-1",
  title,
  projectName: "Maclan",
  kind: "turno",
  startedAt: 1_778_000_000_000,
  agent: "Codex",
  model: "gpt-5",
  detail: "Redigindo resposta",
})

const snapshot = (patch: Partial<TraySnapshot> = {}): TraySnapshot => ({
  running: 0,
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
  ...patch,
})

function render(presentation: HudPresentation, statusKind: "loading" | "unavailable" | "decision" | "flight" | "idle", statusText: string) {
  return renderToStaticMarkup(
    createElement(DynamicHudExpanded, {
      runtime,
      presentation,
      statusKind,
      statusText,
      now: 1_778_000_960_000,
      closing: false,
      onRequestStop: vi.fn(),
      onCancelStop: vi.fn(),
      onConfirmStop: vi.fn(),
      onRetryStop: vi.fn(),
    }),
  )
}

describe("DynamicHudExpanded", () => {
  it("transforma tempo e atividade real no foco sem inventar progresso", () => {
    const activities = [activity("a", "Revisão de branches"), activity("b", "Testes finais"), activity("c", "Documentação")]
    const current = snapshot({ running: 3, activities })
    const html = render(
      { kind: "flight", snapshot: current, primary: activities[0], secondary: activities.slice(1) },
      "flight",
      "3 em voo",
    )
    expect(html).toContain("text-[30px]")
    expect(html).toContain("hud-live-rail")
    expect(html).toContain("Revisão de branches")
    expect(html).toContain("Testes finais")
    expect(html).toContain("Documentação")
    expect(html).not.toMatch(/\b34%\b/)
  })

  it("renderiza duração de horas e minutos inline sem quebra órfã", () => {
    const running = activity("a", "frota v2 (Core + clientes)")
    const longRunning: TrayActivity = {
      ...running,
      startedAt: 1_778_000_960_000 - (4 * 60 + 19) * 60_000,
    }
    const current = snapshot({ running: 1, activities: [longRunning] })
    const html = render(
      { kind: "flight", snapshot: current, primary: longRunning, secondary: [] },
      "flight",
      "1 em voo",
    )
    expect(html).toContain("4")
    expect(html).toContain("h")
    expect(html).toContain("19")
    expect(html).toContain("m")
    expect(html).toContain("em voo")
    expect(html).not.toMatch(/>H</)
  })

  it("faz uma decisão real vencer o tempo e aponta para a conversa", () => {
    const current = snapshot({ decisions: 1, blocking: 1, decisionConvId: "a", decisionProjectId: "project-1" })
    const html = render({ kind: "decision", snapshot: current }, "decision", "1 decisão")
    expect(html).toContain("Sua decisão vem primeiro")
    expect(html).toContain("Um pedido parou o turno")
    expect(html).toContain("Revisar no Frota")
    expect(html).not.toContain("Parar agora")
  })

  it("expõe a confirmação destrutiva sem declarar a tarefa interrompida", () => {
    const running = activity("a", "Revisão de branches")
    const current = snapshot({ running: 1, activities: [running] })
    const html = render(
      {
        kind: "stop",
        snapshot: current,
        activity: running,
        intent: {
          phase: "confirm",
          convId: "a",
          projectId: "project-1",
          title: running.title,
          requestedAt: null,
          error: null,
        },
      },
      "flight",
      "1 em voo",
    )
    expect(html).toContain("Parar Revisão de branches?")
    expect(html).toContain("Manter em voo")
    expect(html).toContain("Parar agora")
    expect(html).not.toContain("interrompida")
    expect(html).not.toContain("snapshot")
  })

  it("mantém o centro físico do notch livre no cabeçalho", () => {
    const html = render({ kind: "unavailable" }, "unavailable", "Estado indisponível")
    expect(html).toContain("grid-template-columns:1fr 185px 1fr")
    expect(html).toContain("Estado da frota indisponível")
    expect(html).not.toContain("Tela interna")
    expect(html).not.toContain("snapshot")
  })

  it("não transforma um último turno com falha em sucesso visual", () => {
    const current = snapshot({
      lastTurn: {
        title: "Auditoria final",
        receipt: null,
        ok: false,
        at: 1_778_000_000_000,
      },
    })
    const html = render({ kind: "settled", snapshot: current }, "idle", "Frota pronta")
    expect(html).toContain("turno falhou")
    expect(html).toContain("lucide-circle-alert")
    expect(html).not.toContain("lucide-circle-check")
  })
})
