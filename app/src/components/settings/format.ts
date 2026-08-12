// Formatadores de texto das Configurações (puros, sem React).

/** "agora" · "há 12 min" · "há 3 h" · "há 2 d" · "nunca". */
export function fmtCheckedAt(ts: number, now: number = Date.now()): string {
  if (!ts) return "nunca"
  const m = Math.floor((now - ts) / 60_000)
  if (m < 1) return "agora"
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h} h`
  return `há ${Math.floor(h / 24)} d`
}
