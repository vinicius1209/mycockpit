import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"

export interface TrayActivity {
  convId: string
  projectId: string
  title: string
  projectName: string
  kind: "turno" | "missão" | "disputa"
  startedAt: number | null
  agent: string
  model: string | null
  detail: string
}

export interface TraySnapshot {
  running: number
  decisions: number
  activities: TrayActivity[]
  decisionConvId: string | null
  decisionProjectId: string | null
  nextSchedule: { name: string; at: number; relative: string } | null
  lastRun: { name: string; status: string; at: number } | null
  enabledSchedules: number
}

export interface TrayAction {
  action:
    | "new-task"
    | "review-decision"
    | "show-running"
    | "open-activity"
    | "stop-activity"
    | "open-schedules"
    | "pause-schedules"
    | "open-settings"
  convId?: string | null
  projectId?: string | null
}

// A string de status da frota (menu/tooltip) é montada SÓ no Rust
// (fleet_status em tray.rs, com teste próprio) — fonte única do texto.

let lastSent: string | null = null

export function updateTray(snapshot: TraySnapshot): void {
  if (!isTauri()) return
  const key = JSON.stringify(snapshot)
  if (key === lastSent) return
  lastSent = key
  invoke("set_tray_snapshot", { snapshot }).catch(() => {
    lastSent = null
  })
}

export function setTrayPreferences(
  keepInTray: boolean,
  closeHintShown: boolean,
): void {
  if (!isTauri()) return
  void invoke("set_tray_preferences", { keepInTray, closeHintShown })
}

export function runTrayAction(
  action: string,
  convId?: string | null,
  projectId?: string | null,
): Promise<void> {
  return invoke("tray_action", {
    action,
    convId: convId ?? null,
    projectId: projectId ?? null,
  })
}
