import { describe, expect, it } from "vitest"
import {
  deriveHudPresentation,
  elapsedMetric,
  hudStatus,
  hudStopReducer,
  type HudSnapshotState,
  type HudStopIntent,
} from "@/lib/hudPresentation"
import type { TrayActivity, TraySnapshot } from "@/lib/tray"

const activity = (convId: string, title = `Tarefa ${convId}`): TrayActivity => ({
  convId,
  projectId: "project-1",
  title,
  projectName: "Frota",
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

const ready = (value: TraySnapshot): HudSnapshotState => ({ status: "ready", snapshot: value })

describe("deriveHudPresentation", () => {
  it("não inventa estado pronto antes de receber o snapshot", () => {
    expect(deriveHudPresentation({ status: "loading" }, null, null).kind).toBe("loading")
    expect(deriveHudPresentation({ status: "unavailable" }, null, null).kind).toBe("unavailable")
    expect(hudStatus({ status: "loading" }).label).toBe("Lendo a frota")
  })

  it("prioriza a confirmação local enquanto a atividade real existe", () => {
    const current = snapshot({
      running: 1,
      decisions: 1,
      blocking: 1,
      activities: [activity("a")],
    })
    const intent = hudStopReducer(null, { type: "request", activity: current.activities[0] })
    expect(deriveHudPresentation(ready(current), intent, "a").kind).toBe("stop")
  })

  it("invalida a confirmação quando o snapshot remove a atividade", () => {
    const intent = hudStopReducer(null, { type: "request", activity: activity("a") })
    expect(hudStopReducer(intent, { type: "snapshot", snapshot: snapshot() })).toBeNull()
  })

  it("deixa uma decisão real assumir quando a atividade confirmada desaparece", () => {
    const intent = hudStopReducer(null, { type: "request", activity: activity("a") })
    const current = snapshot({ decisions: 1, blocking: 1 })
    expect(deriveHudPresentation(ready(current), intent, "a").kind).toBe("decision")
  })

  it("mostra decisão real antes de qualquer atividade", () => {
    const current = snapshot({
      running: 1,
      decisions: 2,
      blocking: 1,
      activities: [activity("a")],
    })
    expect(deriveHudPresentation(ready(current), null, "a").kind).toBe("decision")
  })

  it("mantém a atividade focada e limita as secundárias a duas", () => {
    const current = snapshot({
      running: 4,
      activities: [activity("a"), activity("b"), activity("c"), activity("d")],
    })
    const presentation = deriveHudPresentation(ready(current), null, "b")
    expect(presentation.kind).toBe("flight")
    if (presentation.kind !== "flight") return
    expect(presentation.primary.convId).toBe("b")
    expect(presentation.secondary.map((item) => item.convId)).toEqual(["a", "c"])
  })

  it("distingue último turno observado de frota vazia", () => {
    const settled = snapshot({
      lastTurn: { title: "Auditoria", receipt: "Validou o build", ok: true, at: 1_778_000_000_000 },
    })
    expect(deriveHudPresentation(ready(settled), null, null).kind).toBe("settled")
    expect(deriveHudPresentation(ready(snapshot()), null, null).kind).toBe("ready")
  })
})

describe("hudStopReducer", () => {
  it("só confirma a solicitação depois que o envio termina", () => {
    const requested = hudStopReducer(null, { type: "request", activity: activity("a") })
    const sending = hudStopReducer(requested, { type: "sending" })
    const waiting = hudStopReducer(sending, { type: "sent", at: 123 }) as HudStopIntent
    expect(sending?.phase).toBe("sending")
    expect(waiting).toMatchObject({ phase: "waiting", requestedAt: 123 })
    expect(hudStopReducer(waiting, { type: "unconfirmed" })?.phase).toBe("unconfirmed")
  })

  it("mantém a falha visível e permite abandonar a decisão", () => {
    const requested = hudStopReducer(null, { type: "request", activity: activity("a") })
    expect(hudStopReducer(requested, { type: "failed", error: "canal fechado" })).toMatchObject({
      phase: "failed",
      error: "canal fechado",
    })
    expect(hudStopReducer(requested, { type: "cancel" })).toBeNull()
  })
})

describe("elapsedMetric", () => {
  it("trata atividade sem data de início", () => {
    expect(elapsedMetric(null, 1_000_000)).toEqual({
      value: "·",
      unit: "",
      label: "em voo",
    })
  })

  it("formata minutos em linha única com unidade min", () => {
    const start = 1_000_000
    expect(elapsedMetric(start, start + 16 * 60_000)).toEqual({
      value: "16",
      unit: "min",
      label: "em voo",
    })
  })

  it("decompõe horas e minutos para leitura inline sem quebra órfã de H", () => {
    const start = 1_000_000
    // 4h 19min = 259 minutos
    expect(elapsedMetric(start, start + (4 * 60 + 19) * 60_000)).toEqual({
      value: "4",
      unit: "h",
      secondaryValue: "19",
      secondaryUnit: "m",
      label: "em voo",
    })
  })

  it("preserva minutos restantes zero de forma explícita", () => {
    const start = 1_000_000
    // 2h = 120 minutos
    expect(elapsedMetric(start, start + 2 * 60 * 60_000)).toEqual({
      value: "2",
      unit: "h",
      secondaryValue: "0",
      secondaryUnit: "m",
      label: "em voo",
    })
  })
})
