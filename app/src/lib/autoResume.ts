// Auto-revive: o agent bateu num rate limit (da API dele e/ou da CLI) e disse
// "vou esperar e tentar de novo" — mas o TURNO terminou e a conversa morreu. Pra
// deixar rodando de madrugada, este detector PURO decide se o turno pede um
// resume automático (opt-in no ChatPanel), quando (delayMs) e por quê (reason).
//
// Sinais:
//  - FORTE: evento `limit_reached` durante o turno (limite da CLI). Traz um
//    reset_hint (quando o limite reseta) → usamos pra cronometrar o próximo
//    resume em vez de chutar backoff.
//  - HEURÍSTICO: o texto FINAL do turno casa padrões de rate-limit / espera /
//    retry ("rate limit", "vou aguardar", "will retry", "wakeup", "60s"…).

import type { ChatItem } from "@/store/chat"

/** Backoff exponencial (ms) quando NÃO há reset_hint: 60s, 120s, 240s… cap 15min. */
const BACKOFF_BASE_MS = 60_000
export const BACKOFF_CAP_MS = 15 * 60_000

/** Padrões (pt-BR + en) que indicam "o agent quer/precisa continuar depois". */
const RESUME_PATTERNS: RegExp[] = [
  /rate[\s-]?limit/i,
  /\blimite\s+(de\s+)?(uso|taxa|cota|requisi)/i,
  /vou\s+(aguardar|esperar|tentar)/i,
  /aguard\w*\s+(o\s+)?(reset|wakeup|limite|\d+\s*s)/i,
  /tentar\s+(de\s+)?novo|tentar\s+novamente|retom\w+\s+(depois|automat)/i,
  /will\s+(retry|try\s+again|wait)/i,
  /\bretry(ing)?\b/i,
  /\bwakeup\b/i,
  /\breset[s]?\s+(in|at|em)\b/i,
  /\b\d+\s*(s|seg|segundos|min|minutos)\b.*(aguard|esper|tentar|retry|wait|reset)/i,
  /(aguard|esper|tentar|retry|wait|reset).*\b\d+\s*(s|seg|segundos|min|minutos)\b/i,
  /back(ing)?[\s-]?off/i,
]

/** O texto casa algum padrão de rate-limit / espera / retry? Reuso do detector
 *  de auto-resume pela RECUPERAÇÃO de missão (lib/mission.isRecoverableFailure):
 *  o mesmo sinal que revive um turno decide se uma fase falha é recuperável. */
export function matchesResumePattern(text: string): boolean {
  return RESUME_PATTERNS.some((re) => re.test(text))
}

export interface AutoResumeVerdict {
  /** true = o turno pede um resume automático. */
  resume: boolean
  /** Espera (ms) antes do próximo resume (do reset_hint, senão backoff). */
  delayMs: number
  /** Por que decidimos resumir (rótulo curto, entra no aviso/log). */
  reason: string
}

/** Backoff exponencial pela tentativa (0-based): 0→60s, 1→120s… cap 15min. */
export function backoffMs(tries: number): number {
  const t = tries < 0 ? 0 : tries
  const raw = BACKOFF_BASE_MS * 2 ** t
  return Math.min(raw, BACKOFF_CAP_MS)
}

/** Extrai um delay (ms) de um reset_hint textual do CLI. Aceita formas comuns:
 *  "60s", "2m", "in 90 seconds", "reseta em 5 min", ou um epoch/ISO absoluto.
 *  Retorna null se não der pra extrair um número plausível. */
export function parseResetHint(hint: string | undefined, now = Date.now()): number | null {
  if (!hint) return null
  const h = hint.trim()

  // timestamp absoluto ISO (2026-07-08T03:00:00Z) → delta até lá.
  const iso = Date.parse(h)
  if (!Number.isNaN(iso) && /\d{4}-\d{2}-\d{2}/.test(h)) {
    const delta = iso - now
    return delta > 0 ? delta : 0
  }

  // epoch (segundos ou ms) solto.
  const epochMatch = h.match(/^\s*(\d{10,13})\s*$/)
  if (epochMatch) {
    const n = Number(epochMatch[1])
    const ms = n < 1e12 ? n * 1000 : n // 10 dígitos = segundos
    const delta = ms - now
    if (delta > 0 && delta < 24 * 60 * 60_000) return delta
  }

  // duração relativa: "90s", "2m", "in 5 minutes", "3 h".
  const dur = h.match(
    /(\d+(?:[.,]\d+)?)\s*(ms|s|sec|secs|second|seconds|seg|segundos?|m|min|mins|minute|minutes|minutos?|h|hr|hrs|hour|hours|hora?s?)\b/i,
  )
  if (dur) {
    const val = parseFloat(dur[1].replace(",", "."))
    const unit = dur[2].toLowerCase()
    if (unit === "ms") return val
    if (unit.startsWith("s")) return val * 1000
    if (unit.startsWith("m") && unit !== "ms") return val * 60_000
    if (unit.startsWith("h")) return val * 3_600_000
  }
  return null
}

/** Texto final do turno = último item de assistant (text) OU cartão de limite. */
function finalText(items: ChatItem[]): string {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind === "text") return it.text
    if (it.kind === "limit") return it.message
    // se o turno terminou num erro/cancelamento, não vasculha atrás dele.
    if (it.kind === "error" || it.kind === "cancelled") return ""
  }
  return ""
}

/** Decide se o turno recém-encerrado pede resume automático.
 *  @param items  transcript atual da conversa (pós-turno).
 *  @param limit  se um `limit_reached` bateu neste turno, o hint (ou null); undefined = não bateu.
 *  @param tries  quantos resumes já tentamos (p/ o backoff quando não há hint). */
export function wantsAutoResume(
  items: ChatItem[],
  limit: { hit: boolean; resetHint?: string | null } | undefined,
  tries = 0,
  now = Date.now(),
): AutoResumeVerdict {
  const backoff = backoffMs(tries)

  // Sinal FORTE: limite da CLI neste turno → resume garantido, cronometra pelo hint.
  if (limit?.hit) {
    const fromHint = parseResetHint(limit.resetHint ?? undefined, now)
    // hint costuma marcar o instante EXATO do reset; +2s de folga pra não cair cedo.
    const delayMs = fromHint != null ? Math.min(fromHint + 2000, BACKOFF_CAP_MS) : backoff
    return { resume: true, delayMs, reason: "limite da CLI atingido" }
  }

  // Sinal HEURÍSTICO: o texto final combina padrões de espera/retry.
  const text = finalText(items)
  if (text) {
    const matched = RESUME_PATTERNS.find((re) => re.test(text))
    if (matched) {
      // se o texto cita uma duração ("60s", "2 min"), usa; senão backoff.
      const fromText = parseResetHint(text, now)
      const delayMs = fromText != null ? Math.min(fromText + 2000, BACKOFF_CAP_MS) : backoff
      return { resume: true, delayMs, reason: "texto do turno pede retry" }
    }
  }

  return { resume: false, delayMs: 0, reason: "" }
}
