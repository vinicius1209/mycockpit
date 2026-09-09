export function composerPlaceholder({
  missionRunning,
  preparing,
  running,
  finalizing,
  hasCommands,
}: {
  missionRunning?: boolean
  preparing?: boolean
  running?: boolean
  finalizing?: boolean
  hasCommands: boolean
}): string {
  if (missionRunning) return "Missão em andamento; pare a missão para enviar manualmente…"
  if (preparing) return "Verificando capacidades…"
  if (running) return "Enter corrige agora · Tab envia no próximo turno…"
  if (finalizing) return "Turno terminando · Tab envia assim que fechar…"
  if (hasCommands) return "Peça algo…  ou / para comandos"
  return "Peça algo ao seu time de agents…"
}
