import { DESTINATIONS } from "@/lib/agents"
import type { Destination } from "@/lib/types"

/** Destinos reais do registry, sem reinscrever agente ou disponibilidade no
 * componente visual. A escolha continua humana e exclui o agente atual. */
export function incidentTargets(
  currentAgent: string,
  destinations: Destination[] = DESTINATIONS,
) {
  return destinations.filter(
    (destination) =>
      destination.available &&
      destination.kind === "agent" &&
      destination.id !== currentAgent,
  )
}
