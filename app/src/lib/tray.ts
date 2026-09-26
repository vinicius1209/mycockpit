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

import type { UltimoTurno } from "@/lib/lastTurn"

export interface TraySnapshot {
  running: number
  /** Total do que espera VOCÊ: disputas para escolher + pedidos bloqueantes
   *  (permissão/pergunta). É a soma que o selo mostra. */
  decisions: number
  /** Quantas das `decisions` são PEDIDOS bloqueantes (permissão/pergunta), e
   *  não disputas.
   *
   *  Existe porque o subtítulo da tray era a string fixa "Revisar resultado da
   *  disputa" enquanto o número já somava as duas coisas: um pedido de `Bash`
   *  — o caso comum — chegava anunciado como resultado de uma disputa que não
   *  existia, e a tray é justamente a superfície que alcança você com a janela
   *  fechada. Rótulo tem que responder pelo que o número conta. */
  blocking: number
  activities: TrayActivity[]
  decisionConvId: string | null
  decisionProjectId: string | null
  nextSchedule: { name: string; at: number; relative: string } | null
  lastRun: { name: string; status: string; at: number } | null
  /** Último turno de CONVERSA — vizinho do `lastRun`, que é automação. */
  lastTurn: UltimoTurno | null
  enabledSchedules: number
  /** Trabalhos DIFERIDOS do provider vivos (Workflow/background task): o
   *  diálogo nativo de saída avisa que eles morrem junto (D1.4). */
  deferred: number
  /** Sessões externas observadas pelos hooks (H1). */
  external: TrayExternalSession[]
  /** O Mac está sendo mantido acordado agora. Preenchido pelo Rust na saída
   *  para a bandeja (`tray::com_o_sono`), a partir da trava real. */
  acordado?: boolean
  /** `on` | `agent` | `off`. */
  modoAcordado?: string
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

/**
 * O subtítulo do cartão de decisão da tray.
 *
 * Era a string FIXA "Revisar resultado da disputa" enquanto o número acima dela
 * já somava disputas + pedidos bloqueantes. No caso comum (uma permissão de
 * `Bash`) a tray mandava você revisar uma disputa que não existia — e a tray é
 * a superfície que alcança você com a janela fechada, então o custo do rótulo
 * errado é sair procurando.
 *
 * Puro de propósito: a regra é de CONTEÚDO (o rótulo responde pelo que o número
 * conta), não de componente, e por isso é testável sem renderizar nada.
 */
export function decisionSubtitle(decisions: number, blocking: number): string {
  const disputas = Math.max(0, decisions - blocking)
  if (blocking > 0 && disputas > 0) return "Pedidos e disputas esperando"
  if (blocking > 0) {
    return blocking === 1
      ? "Um pedido parou o turno"
      : "Pedidos pararam os turnos"
  }
  return disputas === 1
    ? "Revisar resultado da disputa"
    : "Revisar resultados das disputas"
}
