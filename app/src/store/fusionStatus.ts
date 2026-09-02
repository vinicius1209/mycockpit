export type CandStatus =
  | "queued"
  | "running"
  | "finalizing"
  | "done"
  | "error"
  | "blocked"
  | "cancelled"
  | "killed"

/** Candidato ainda em voo, inclusive quando aguarda a vaga de concorrência. */
export function isRunning(status: CandStatus): boolean {
  return status === "running" || status === "queued"
}

/** Candidato que chegou a iniciar e terminou sem entrega aproveitável. */
export function isFailed(status: CandStatus): boolean {
  return status === "error" || status === "cancelled" || status === "killed"
}
