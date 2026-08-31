import type { TrayActivity, TraySnapshot } from "@/lib/tray"

export type HudSnapshotState =
  | { status: "loading" }
  | { status: "unavailable" }
  | { status: "ready"; snapshot: TraySnapshot }

export type HudStopPhase = "confirm" | "sending" | "waiting" | "unconfirmed" | "failed"

export interface HudStopIntent {
  phase: HudStopPhase
  convId: string
  projectId: string
  title: string
  requestedAt: number | null
  error: string | null
}

export type HudStopEvent =
  | { type: "request"; activity: TrayActivity }
  | { type: "cancel" }
  | { type: "sending" }
  | { type: "sent"; at: number }
  | { type: "unconfirmed" }
  | { type: "failed"; error: string }
  | { type: "snapshot"; snapshot: TraySnapshot }

export type HudPresentation =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "stop"; snapshot: TraySnapshot; intent: HudStopIntent; activity: TrayActivity }
  | { kind: "decision"; snapshot: TraySnapshot }
  | { kind: "flight"; snapshot: TraySnapshot; primary: TrayActivity; secondary: TrayActivity[] }
  | { kind: "settled"; snapshot: TraySnapshot }
  | { kind: "ready"; snapshot: TraySnapshot }

export function hudStopReducer(
  state: HudStopIntent | null,
  event: HudStopEvent,
): HudStopIntent | null {
  if (event.type === "request") {
    return {
      phase: "confirm",
      convId: event.activity.convId,
      projectId: event.activity.projectId,
      title: event.activity.title,
      requestedAt: null,
      error: null,
    }
  }
  if (event.type === "cancel") return null
  if (!state) return null
  if (event.type === "snapshot") {
    const stillPresent = event.snapshot.activities.some(
      (activity) => activity.convId === state.convId && activity.projectId === state.projectId,
    )
    return stillPresent ? state : null
  }
  if (event.type === "sending") {
    return { ...state, phase: "sending", requestedAt: null, error: null }
  }
  if (event.type === "sent") {
    return { ...state, phase: "waiting", requestedAt: event.at, error: null }
  }
  if (event.type === "unconfirmed") {
    return state.phase === "waiting" ? { ...state, phase: "unconfirmed" } : state
  }
  return { ...state, phase: "failed", error: event.error }
}

export function deriveHudPresentation(
  resource: HudSnapshotState,
  intent: HudStopIntent | null,
  focusedConvId: string | null,
): HudPresentation {
  if (resource.status === "loading") return { kind: "loading" }
  if (resource.status === "unavailable") return { kind: "unavailable" }

  const snapshot = resource.snapshot
  if (intent) {
    const activity = snapshot.activities.find(
      (candidate) => candidate.convId === intent.convId && candidate.projectId === intent.projectId,
    )
    if (activity) return { kind: "stop", snapshot, intent, activity }
  }
  if (snapshot.decisions > 0) return { kind: "decision", snapshot }
  if (snapshot.activities.length > 0) {
    const primary =
      snapshot.activities.find((activity) => activity.convId === focusedConvId) ?? snapshot.activities[0]
    return {
      kind: "flight",
      snapshot,
      primary,
      secondary: snapshot.activities.filter((activity) => activity !== primary).slice(0, 2),
    }
  }
  if (snapshot.lastTurn) return { kind: "settled", snapshot }
  return { kind: "ready", snapshot }
}

export function hudStatus(resource: HudSnapshotState): {
  kind: "loading" | "unavailable" | "decision" | "flight" | "idle"
  label: string
} {
  if (resource.status === "loading") return { kind: "loading", label: "Lendo a frota" }
  if (resource.status === "unavailable") return { kind: "unavailable", label: "Estado indisponível" }
  const { snapshot } = resource
  if (snapshot.decisions > 0) {
    return {
      kind: "decision",
      label: `${snapshot.decisions} ${snapshot.decisions === 1 ? "decisão" : "decisões"}`,
    }
  }
  if (snapshot.running > 0) return { kind: "flight", label: `${snapshot.running} em voo` }
  return { kind: "idle", label: "Frota pronta" }
}

export function elapsedLabel(startedAt: number | null, now: number): string {
  if (!startedAt) return "em execução"
  const minutes = Math.max(0, Math.floor((now - startedAt) / 60_000))
  if (minutes < 1) return "agora"
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}min`
}

export function elapsedMetric(startedAt: number | null, now: number): { value: string; unit: string } {
  if (!startedAt) return { value: "·", unit: "EM VOO" }
  const minutes = Math.max(0, Math.floor((now - startedAt) / 60_000))
  if (minutes < 60) return { value: String(minutes), unit: "MIN" }
  const hours = Math.floor(minutes / 60)
  return { value: `${hours}:${String(minutes % 60).padStart(2, "0")}`, unit: "H" }
}

export function relativeLabel(at: number, now: number): string {
  const minutes = Math.max(0, Math.floor((now - at) / 60_000))
  if (minutes < 1) return "agora mesmo"
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `há ${hours}h` : `há ${Math.floor(hours / 24)}d`
}

export function externalStatusLabel(status: string): string {
  if (status === "working") return "trabalhando"
  if (status === "waiting" || status === "blocked") return "esperando você"
  return "ociosa"
}
