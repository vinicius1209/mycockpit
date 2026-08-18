// Extraído do MessageList (catraca de tamanho, STYLEGUIDE §10) — compartilhado
// por GroupRow (cabeçalho do grupo) e WorkingIndicator, os dois únicos
// consumidores. Ficar num arquivo à parte também evita import circular entre
// os dois (WorkingIndicator não pode importar de MessageList, que importa
// WorkingIndicator de volta).
import type { AgentDef } from "@/lib/agentDefs"
import { AgentLogo, agentLogoLabel } from "@/components/common/AgentLogo"
import { AgentAvatar } from "@/components/chat/AgentAvatar"
import { agentLabel } from "@/lib/agent"

/** Identidade do EXECUTOR pro gutter (compartilhada entre o cabeçalho do grupo
 *  e o indicador de "trabalhando…", pra não duplicar a resolução): a
 *  persona-piloto quando a conversa tem preset resolvido na lista; senão o logo
 *  do code agent num círculo + o rótulo do produto. Puro dada a lista de presets.
 *
 *  `engine` é o selo do motor pro CABEÇALHO (work-hierarchy: "o provider mora no
 *  cabeçalho do agente"; background-status B2.3 tirou o selo repetido de cada
 *  nó). Só vem preenchido quando o nome exibido NÃO é o do motor — com persona
 *  pilotando, o motor ficaria invisível; sem persona, o nome já É o motor e
 *  repetir seria ruído. */
export function resolveExecutorIdentity(
  presets: AgentDef[],
  agent: string,
  presetId: string | null,
): { gutter: React.ReactNode; name: string; engine: string | null } {
  const pilot = presetId ? presets.find((p) => p.id === presetId) : undefined
  if (pilot) {
    return {
      gutter: <AgentAvatar def={pilot} size={28} rounded />,
      name: pilot.name,
      engine: agentLabel(agent),
    }
  }
  return {
    gutter: (
      <span className="grid size-7 place-items-center rounded-full border bg-card">
        <AgentLogo agent={agent} className="size-4 text-muted-foreground" />
      </span>
    ),
    name: agentLogoLabel(agent),
    engine: null,
  }
}
