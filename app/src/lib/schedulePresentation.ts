import type { AgentStatus } from "@/lib/types"

export function fmtScheduleWhen(ts: number): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ts))
}

/** Estado da automação no StatusDot canônico. "blocked" é um preflight que
 * pede configuração, não uma falha do turno nem repouso saudável. */
export function scheduleStatus(
  lastRunStatus: string | null,
  running: boolean,
): AgentStatus {
  if (running) return "running"
  if (lastRunStatus === "ok") return "success"
  if (lastRunStatus === "failed") return "error"
  if (lastRunStatus === "blocked") return "queued"
  return "idle"
}

/** Desfecho desconhecido aparece como veio, sem ser rebatizado de falha. */
export function runStatusLabel(status: string): string {
  if (status === "ok") return "ok"
  if (status === "failed") return "falhou"
  if (status === "blocked") return "bloqueada"
  return status
}

/** Sem carimbo real, não inventa horário para uma execução que nunca houve. */
export function lastRunLabel(
  lastRunAt: number | null | undefined,
): string {
  if (lastRunAt == null) return "nunca rodou"
  return `última ${fmtScheduleWhen(lastRunAt)}`
}
