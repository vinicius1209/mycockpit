import type { IncidentNode } from "@/components/chat/messageNodes"

export interface IncidentStage {
  id: "terminal" | "preserved" | "next"
  meta?: string
  title: string
  description: string
  tone: "incident" | "settled" | "information"
}

export interface IncidentPresentation {
  severity: "limit" | "error"
  title: string
  stages: IncidentStage[]
}

import { formatIncidentReset } from "@/lib/resetHint"
export { formatIncidentReset }


export function incidentPresentation(
  incident: IncidentNode,
): IncidentPresentation {
  if (incident.severity === "error") {
    return {
      severity: "error",
      title: "Execução interrompida",
      stages: [
        {
          id: "terminal",
          title: "Turno encerrado",
          description: "A execução terminou sem resposta final.",
          tone: "incident",
        },
        {
          id: "preserved",
          title: "Conversa preservada",
          description: "A conversa e os arquivos continuam no Frota.",
          tone: "settled",
        },
        {
          id: "next",
          title: "Motivo registrado",
          description: "Abra os detalhes técnicos para consultar a causa.",
          tone: "information",
        },
      ],
    }
  }

  const reset = incident.resetHint?.trim()
  return {
    severity: "limit",
    title: "Sessão em intervalo",
    stages: [
      {
        id: "terminal",
        title: "Turno encerrado",
        description: "O limite desta sessão foi atingido.",
        tone: "incident",
      },
      {
        id: "preserved",
        title: "Conversa preservada",
        description: "Contexto e arquivos continuam no Frota.",
        tone: "settled",
      },
      reset
        ? {
            id: "next",
            meta: formatIncidentReset(reset),
            title: "Retorno informado",
            description: "Horário informado pelo agente.",
            tone: "information",
          }
        : {
            id: "next",
            title: "Retorno não informado",
            description:
              "O agente não informou quando a sessão poderá continuar.",
            tone: "information",
          },
    ],
  }
}
