export function composerPlaceholder({
  missionRunning,
  preparing,
  running,
  finalizing,
}: {
  missionRunning?: boolean
  preparing?: boolean
  running?: boolean
  finalizing?: boolean
  /** Sem efeito no texto desde a ADR-282; segue na assinatura dos chamadores. */
  hasCommands: boolean
}): string {
  // Instrução, não texto seu: curta, sem "…" e sem atalho em prosa (ADR-282).
  // As duas saídas do turno rodando aparecem no par Enfileirar | ⚡.
  if (missionRunning) return "Missão em andamento; pare a missão para enviar"
  if (preparing) return "Verificando capacidades"
  if (running) return "Corrigir agora ou deixar para depois"
  if (finalizing) return "Turno terminando; o que você escrever vai quando fechar"
  return "Peça algo ao seu time"
}
