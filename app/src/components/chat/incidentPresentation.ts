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

/** Humaniza somente relógios civis inequívocos. O hint desconhecido volta
 * intacto, porque remover palavras ou inventar interpretação faria o replay
 * dizer algo diferente do que o agente informou. */
export function formatIncidentReset(hint: string): string {
  const raw = hint.trim()
  const candidate = raw.replace(/^reset(?:s|ting)?\s+(?:at\s+)?/i, "")
  const twelveHour = candidate.match(
    /\b(\d{1,2}):(\d{2})\s*([ap])\.?m\.?\b/i,
  )
  const twentyFourHour = candidate.match(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/)
  if (!twelveHour && !twentyFourHour) return raw

  let formatted = candidate
  if (twelveHour) {
    let hour = Number(twelveHour[1]) % 12
    if (twelveHour[3].toLowerCase() === "p") hour += 12
    formatted = formatted.replace(
      twelveHour[0],
      `${String(hour).padStart(2, "0")}:${twelveHour[2]}`,
    )
  }
  return formatted
    .replace(/\s*\(America\/Sao_Paulo\)/i, " · horário de São Paulo")
    .replace(/America\/Sao_Paulo/i, "horário de São Paulo")
}

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
