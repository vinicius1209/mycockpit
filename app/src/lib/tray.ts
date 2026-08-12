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

/** Sessão EXTERNA de CLI (hooks-plan H1): aberta no terminal, fora do app.
 *  O tray só OBSERVA — sem ação de abrir/parar (não somos donos dela). */
export interface TrayExternalSession {
  agent: string
  /** Projeto conhecido pelo cwd, ou o basename da pasta. */
  place: string
  /** "working" | "waiting" | "blocked" | "idle" (vocabulário do Rust). */
  status: string
  lastSeen: number
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
  /** Trabalhos DIFERIDOS do provider vivos (Workflow/background task): o
   *  diálogo nativo de saída avisa que eles morrem junto (D1.4). */
  deferred: number
  /** Sessões externas observadas pelos hooks (H1). */
  external: TrayExternalSession[]
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
