// Centralização da interpretação e formatação de `resetHint`.
//
// Os CLIs emitem dicas de reset em múltiplos formatos: relógio civil com fuso
// IANA (ex: `2pm (America/Sao_Paulo)` da Claude), durações relativas (`60s`,
// `reseta em 2h`), porcentagens (`100%`) ou mensagens descritivas.
//
// Antes deste módulo, a formatação estava espalhada entre `incidentPresentation.ts`,
// `ContinuityBanner.tsx` e `fleet/derive.ts`, gerando divergências visuais (ex:
// "2pm (America/Sao_Paulo)" em inglês no transcript vs "14:00" no banner) quando o
// regex não casava horários sem minutos (como `2pm`).

export interface ParsedClock {
  /** Hora formatada em 24h ("14:00", "01:50"). */
  time: string
  /** Nome amigável do fuso ("horário de São Paulo"), se informado. */
  zoneLabel?: string
}

/** Extrai componentes civis de relógio em formatos comuns emitidos por CLIs. */
export function parseClockHint(hint: string): ParsedClock | null {
  const raw = hint.trim()
  const candidate = raw.replace(/^reset(?:s|ting)?\s+(?:at\s+)?/i, "")

  // 12h: "2pm", "2:30pm", "11:45 am"
  const twelveHour = candidate.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b/i,
  )
  // 24h: "14:00", "09:30"
  const twentyFourHour = candidate.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/)

  if (!twelveHour && !twentyFourHour) return null

  let timeStr = ""
  if (twelveHour) {
    const rawH = Number(twelveHour[1])
    const minute = twelveHour[2] ?? "00"
    const isPm = twelveHour[3].toLowerCase() === "p"
    const hour = (rawH % 12) + (isPm ? 12 : 0)
    timeStr = `${String(hour).padStart(2, "0")}:${minute}`
  } else if (twentyFourHour) {
    const hour = Number(twentyFourHour[1])
    const minute = twentyFourHour[2]
    timeStr = `${String(hour).padStart(2, "0")}:${minute}`
  }

  const zoneMatch = candidate.match(
    /\(\s*([A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)+)\s*\)/,
  )
  let zoneLabel: string | undefined
  if (zoneMatch) {
    const iana = zoneMatch[1]
    if (/America\/Sao_Paulo/i.test(iana)) {
      zoneLabel = "horário de São Paulo"
    } else {
      const city = iana.split("/").pop()?.replace(/_/g, " ") ?? iana
      zoneLabel = `horário de ${city}`
    }
  }

  return { time: timeStr, zoneLabel }
}

/** Formata o hint de reset para a apresentação de incidentes no transcript.
 *  Ex: "14:00 · horário de São Paulo", ou preserva texto não-relógio íntegro. */
export function formatIncidentReset(hint: string): string {
  const parsed = parseClockHint(hint)
  if (parsed) {
    return parsed.zoneLabel
      ? `${parsed.time} · ${parsed.zoneLabel}`
      : parsed.time
  }
  return hint.trim()
}

/** Frase explicativa completa para o estado de cota (usada no ContinuityBanner). */
export function formatResetSentence(hint: string | null | undefined): string {
  const trimmed = hint?.trim()
  if (!trimmed) return "O horário de retorno ainda não foi informado."
  if (trimmed === "100%") return "A leitura mais recente chegou a 100%."

  const parsed = parseClockHint(trimmed)
  if (parsed) {
    return parsed.zoneLabel
      ? `Volta às ${parsed.time} (${parsed.zoneLabel}).`
      : `Volta às ${parsed.time}.`
  }

  if (/^(reseta|volta)\b/i.test(trimmed)) {
    return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}.`
  }

  return `Volta ${trimmed}.`
}

/** Formato curto para tooltips, listas e badges.
 *  Ex: "volta às 14:00", "volta em 2h". */
export function formatResetBrief(hint: string | null | undefined): string | null {
  const trimmed = hint?.trim()
  if (!trimmed) return null
  if (trimmed === "100%") return "100% da cota"

  const parsed = parseClockHint(trimmed)
  if (parsed) {
    return `volta às ${parsed.time}`
  }

  if (/^(reseta|volta)\b/i.test(trimmed)) {
    return trimmed.toLowerCase()
  }

  return `volta ${trimmed}`
}
