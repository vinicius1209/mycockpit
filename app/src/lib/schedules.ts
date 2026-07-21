// F6 — Agendado: núcleo PURO das automações estilo CRON (docs/automation-
// evolution.md). Aqui mora só lógica testável sem Tauri/DB: o formato de
// recorrência (JSON discriminado), o parser de cron de 5 campos (subset v1:
// números, `*`, `*/n` e listas `a,b` — SEM ranges), o cálculo do próximo
// disparo e os textos humanos. O motor (lib/scheduleEngine) e a UI consomem
// daqui; nada neste arquivo importa store/DB.

/** Recorrência de uma automação (persistida como JSON string em
 *  `schedules.recurrence`). Discriminada por `kind`:
 *  - daily:  todo dia às hour:minute (hora local)
 *  - weekly: toda semana no weekday (0=dom … 6=sáb) às hour:minute
 *  - cron:   expressão de 5 campos (min hora dia-do-mês mês dia-da-semana) */
export type Recurrence =
  | { kind: "daily"; hour: number; minute: number }
  | { kind: "weekly"; weekday: number; hour: number; minute: number }
  | { kind: "cron"; expr: string }

/** Execução perdida há mais que isto NÃO roda sozinha no catch-up: vira
 *  notificação no sino ("abra Agendado para rodar") e o next_run recalcula. */
export const CATCHUP_GRACE_MS = 5 * 60_000

const inRange = (v: unknown, min: number, max: number): v is number =>
  typeof v === "number" && Number.isInteger(v) && v >= min && v <= max

/** Parse + validação da recorrência persistida. null = JSON inválido, kind
 *  desconhecido ou campos fora do range (a UI mostra "recorrência inválida"
 *  e o motor não dispara — fail-soft). */
export function parseRecurrence(raw: string): Recurrence | null {
  let v: unknown
  try {
    v = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof v !== "object" || v === null) return null
  const r = v as Record<string, unknown>
  if (r.kind === "daily") {
    if (!inRange(r.hour, 0, 23) || !inRange(r.minute, 0, 59)) return null
    return { kind: "daily", hour: r.hour, minute: r.minute }
  }
  if (r.kind === "weekly") {
    if (
      !inRange(r.weekday, 0, 6) ||
      !inRange(r.hour, 0, 23) ||
      !inRange(r.minute, 0, 59)
    )
      return null
    return {
      kind: "weekly",
      weekday: r.weekday,
      hour: r.hour,
      minute: r.minute,
    }
  }
  if (r.kind === "cron") {
    if (typeof r.expr !== "string" || !parseCronExpr(r.expr)) return null
    return { kind: "cron", expr: r.expr }
  }
  return null
}

// ── Cron de 5 campos (subset v1) ──

/** Campo de cron já resolvido: null = `*` (qualquer valor); array = valores
 *  permitidos, ordenados e sem duplicata. */
export interface CronSpec {
  minute: number[] | null
  hour: number[] | null
  dom: number[] | null
  month: number[] | null
  dow: number[] | null
}

// Um campo: `*` | passo `*`/n | lista `a,b,c` (número único = lista de 1).
// Ranges `a-b` NÃO são suportados na v1 → inválido.
function parseCronField(
  tok: string,
  min: number,
  max: number,
): number[] | null | "invalid" {
  if (tok === "*") return null
  const step = /^\*\/(\d+)$/.exec(tok)
  if (step) {
    const n = Number(step[1])
    if (n < 1 || n > max) return "invalid"
    const out: number[] = []
    for (let v = min; v <= max; v += n) out.push(v)
    return out
  }
  const out: number[] = []
  for (const p of tok.split(",")) {
    if (!/^\d+$/.test(p)) return "invalid"
    const v = Number(p)
    if (v < min || v > max) return "invalid"
    out.push(v)
  }
  if (out.length === 0) return "invalid"
  return [...new Set(out)].sort((a, b) => a - b)
}

/** Parser do cron de 5 campos (min hora dom mês dow). null = inválido — a UI
 *  usa isto como validação ao vivo do modo "Avançado (cron)". */
export function parseCronExpr(expr: string): CronSpec | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const minute = parseCronField(parts[0], 0, 59)
  const hour = parseCronField(parts[1], 0, 23)
  const dom = parseCronField(parts[2], 1, 31)
  const month = parseCronField(parts[3], 1, 12)
  const dow = parseCronField(parts[4], 0, 6)
  if (
    minute === "invalid" ||
    hour === "invalid" ||
    dom === "invalid" ||
    month === "invalid" ||
    dow === "invalid"
  )
    return null
  return { minute, hour, dom, month, dow }
}

/** O DIA casa com o spec? Regra clássica do cron: quando dom E dow são ambos
 *  restritos, vale o OU (qualquer um casando dispara); um só restrito = ele
 *  manda; ambos `*` = todo dia. Mês é sempre E. */
function cronDayMatches(spec: CronSpec, d: Date): boolean {
  if (spec.month && !spec.month.includes(d.getMonth() + 1)) return false
  const domOk = spec.dom == null || spec.dom.includes(d.getDate())
  const dowOk = spec.dow == null || spec.dow.includes(d.getDay())
  if (spec.dom != null && spec.dow != null) return domOk || dowOk
  return domOk && dowOk
}

const range = (min: number, max: number): number[] => {
  const out: number[] = []
  for (let v = min; v <= max; v++) out.push(v)
  return out
}

/** Janela de busca do próximo disparo de cron: ~4 anos de DIAS cobre qualquer
 *  combinação válida (inclusive 29/02). Além disso = nunca dispara (ex.: 31/02). */
const CRON_SEARCH_DAYS = 1500

/** Próximo disparo ESTRITAMENTE depois de `from` (hora local), em epoch ms.
 *  daily/weekly sempre têm próximo; cron pode retornar null (expressão
 *  inválida ou que nunca casa, ex.: dia 31 de fevereiro). */
export function computeNextRun(r: Recurrence, from: Date): number | null {
  if (r.kind === "daily") {
    const cand = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate(),
      r.hour,
      r.minute,
      0,
      0,
    )
    if (cand.getTime() <= from.getTime()) cand.setDate(cand.getDate() + 1)
    return cand.getTime()
  }
  if (r.kind === "weekly") {
    const delta = (r.weekday - from.getDay() + 7) % 7
    const cand = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate() + delta,
      r.hour,
      r.minute,
      0,
      0,
    )
    if (cand.getTime() <= from.getTime()) cand.setDate(cand.getDate() + 7)
    return cand.getTime()
  }
  const spec = parseCronExpr(r.expr)
  if (!spec) return null
  const minutes = spec.minute ?? range(0, 59)
  const hours = spec.hour ?? range(0, 23)
  for (let d = 0; d < CRON_SEARCH_DAYS; d++) {
    const day = new Date(
      from.getFullYear(),
      from.getMonth(),
      from.getDate() + d,
      0,
      0,
      0,
      0,
    )
    if (!cronDayMatches(spec, day)) continue
    for (const h of hours) {
      for (const m of minutes) {
        const t = new Date(
          day.getFullYear(),
          day.getMonth(),
          day.getDate(),
          h,
          m,
          0,
          0,
        ).getTime()
        if (t > from.getTime()) return t
      }
    }
  }
  return null
}

/** Os próximos `count` disparos ESTRITAMENTE depois de `from` — alimenta o
 *  preview "Próximas: ter 08:00 · qua 08:00 · …" do dialog. Cron que nunca
 *  casa devolve lista vazia (a UI mostra o aviso no lugar). */
export function nextRuns(r: Recurrence, from: Date, count: number): number[] {
  const out: number[] = []
  let cursor = from
  for (let i = 0; i < count; i++) {
    const t = computeNextRun(r, cursor)
    if (t == null) break
    out.push(t)
    cursor = new Date(t)
  }
  return out
}

// ── Textos humanos ──

const WEEKDAYS_PT = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"]

const pad2 = (n: number) => String(n).padStart(2, "0")

/** Epoch ms → "ter 08:00" (weekday curto + hora local) — um item do preview
 *  de próximas execuções. */
export function fmtRunShort(ts: number): string {
  const d = new Date(ts)
  return `${WEEKDAYS_PT[d.getDay()]} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** Recorrência → texto humano da lista: "diário às 08:00", "semanal (seg) às
 *  09:00", "cron 0 8 * * 1". */
export function recurrenceToText(r: Recurrence | null): string {
  if (!r) return "recorrência inválida"
  if (r.kind === "daily") return `diário às ${pad2(r.hour)}:${pad2(r.minute)}`
  if (r.kind === "weekly")
    return `semanal (${WEEKDAYS_PT[r.weekday]}) às ${pad2(r.hour)}:${pad2(r.minute)}`
  return `cron ${r.expr}`
}

/** Delta até um horário futuro → rótulo CURTO do badge/lista: "agora", "12min",
 *  "2h", "3d". Negativo/quase-zero colapsa em "agora". */
export function fmtUntilShort(ms: number): string {
  if (ms <= 45_000) return "agora"
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min}min`
  const h = Math.round(min / 60)
  if (h < 24) return `${h}h`
  return `${Math.round(h / 24)}d`
}

// ── Tick/catch-up (parte pura: a partição) ──

/** O subset de ScheduleRecord que o particionador precisa (evita importar o
 *  tipo do DB aqui — o lib fica puro). */
export interface SchedulableLike {
  enabled: boolean
  nextRun: number | null
}

/** Particiona os agendamentos no tick:
 *  - `due`: enabled, vencidos há ≤ grace → DISPARAM agora.
 *  - `missed`: enabled, vencidos há > grace (app fechado/máquina dormindo) →
 *    NÃO rodam sozinhos; viram notificação agrupada + next_run recalculado.
 *  Desabilitados e sem next_run ficam fora dos dois. */
export function splitDueAndMissed<T extends SchedulableLike>(
  schedules: T[],
  now: number,
  graceMs: number = CATCHUP_GRACE_MS,
): { due: T[]; missed: T[] } {
  const due: T[] = []
  const missed: T[] = []
  for (const s of schedules) {
    if (!s.enabled || s.nextRun == null || s.nextRun > now) continue
    if (now - s.nextRun > graceMs) missed.push(s)
    else due.push(s)
  }
  return { due, missed }
}

/** A PRÓXIMA automação a disparar (menor next_run entre as habilitadas).
 *  Alimenta o badge da sidebar, o bloco do Launchpad e o tray. */
export function nextScheduled<T extends SchedulableLike>(
  schedules: T[],
): T | null {
  let best: T | null = null
  for (const s of schedules) {
    if (!s.enabled || s.nextRun == null) continue
    if (!best || s.nextRun < (best.nextRun as number)) best = s
  }
  return best
}

/** As PRÓXIMAS automações a disparar, em ordem crescente de next_run (no máx.
 *  `max`) — mesma régua do nextScheduled (habilitadas com next_run), que é o
 *  caso max=1. Alimenta o quadro de avisos do office. */
export function upcomingScheduled<T extends SchedulableLike>(
  schedules: T[],
  max: number,
): T[] {
  return schedules
    .filter((s) => s.enabled && s.nextRun != null)
    .sort((a, b) => (a.nextRun as number) - (b.nextRun as number))
    .slice(0, Math.max(0, max))
}
