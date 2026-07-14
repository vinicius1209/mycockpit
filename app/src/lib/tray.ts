// Tray (outra frente adiciona o lado Rust AGORA): o front chama
// `set_tray_status(status, nextSchedule)` best-effort quando o estado da frota
// ou a próxima agendada mudam. O comando pode NÃO existir (dev no browser, ou
// o build sem a frente do tray) → falha = silêncio absoluto.

import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"

/** Linha de status da frota no tray:
 *  "● 2 rodando · 1 decisão" · "● 3 rodando" · "○ Frota parada". */
export function buildTrayStatus(running: number, decisions: number): string {
  const head = running > 0 ? `● ${running} rodando` : "○ Frota parada"
  if (decisions <= 0) return head
  return `${head} · ${decisions} ${decisions === 1 ? "decisão" : "decisões"}`
}

// Dedupe: o efeito do App re-envia num intervalo (pro tempo relativo da
// próxima agendada não mofar) — só invoca quando algo de fato mudou.
let lastSent: string | null = null

export function updateTray(status: string, nextSchedule: string | null): void {
  if (!isTauri()) return
  const key = `${status}|${nextSchedule ?? ""}`
  if (key === lastSent) return
  lastSent = key
  invoke("set_tray_status", { status, nextSchedule }).catch(() => {
    // comando ausente/erro → silêncio; permite retentar na próxima mudança.
    lastSent = null
  })
}
