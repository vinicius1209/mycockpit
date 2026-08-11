// Telemetria de frame do Agent Office — singleton LIGÁVEL por flag
// (localStorage mc.office.perf = "1" OU ?perf=1). DESLIGADA (default), todo
// hook é no-op de custo ~zero: um if de boolean, zero mark/measure, zero
// alocação (perfSpan/perfAgg devolvem o MESMO noop compartilhado).
//
// Ligada:
//  · perfSpan/perfMark emitem performance.mark/measure (prefixo "mc.") pro
//    timeline do DevTools E alimentam a atribuição por frame;
//  · perfFrame(dtMs) — chamado pelo loop (engine/loop.ts) a cada rAF — fecha
//    a JANELA DO FRAME: spans encerrados desde o perfFrame anterior pertencem
//    ao frame corrente. Frame > PERF_HITCH_MS ⇒ entrada no ring buffer
//    (últimos PERF_RING_MAX) com top 5 spans da janela + heapUsed (se houver)
//    + console.warn compacto ("[perf] hitch 142ms · persist:98ms · …");
//  · estatística por segundo (p50/p95/max do dt) + totais acumulados por span;
//  · getPerfReport() devolve tudo (o overlay do HUD copia como JSON).
//
// Medição pelo PRÓPRIO loop de propósito: PerformanceObserver("longtask") não
// é confiável no WKWebView — o dt do rAF acima do limiar é o sinal de hitch.

export const PERF_FLAG_KEY = "mc.office.perf"
/** Frame acima disso é hitch (3+ frames de 60Hz perdidos). */
export const PERF_HITCH_MS = 50
/** Ring buffer de hitches (últimos N). */
export const PERF_RING_MAX = 100
/** Top spans anexados a cada hitch. */
const HITCH_TOP_SPANS = 5
/** Estatística por segundo retida (últimos N segundos ≈ 5 min). */
const SECONDS_MAX = 300

export type PerfSpanSample = { name: string; ms: number }
export type PerfHitch = {
  /** performance.now() do fechamento do frame. */
  at: number
  dtMs: number
  /** Spans encerrados DENTRO da janela do frame (top 5 por ms). */
  spans: PerfSpanSample[]
  /** usedJSHeapSize, quando o host expõe performance.memory (Chrome). */
  heapUsed?: number
}
export type PerfSecond = {
  at: number
  frames: number
  p50: number
  p95: number
  max: number
}
export type PerfTotal = { name: string; ms: number; count: number }
export type PerfReport = {
  enabled: boolean
  at: number
  hitches: PerfHitch[]
  seconds: PerfSecond[]
  /** Acumulado por span (ordenado por ms desc) — inclui os agregados. */
  totals: PerfTotal[]
}

function readFlag(): boolean {
  try {
    if (localStorage.getItem(PERF_FLAG_KEY) === "1") return true
  } catch {
    /* sem localStorage (node/testes) */
  }
  try {
    if (new URLSearchParams(window.location.search).get("perf") === "1")
      return true
  } catch {
    /* sem window */
  }
  return false
}

let enabled = readFlag()
const NOOP: () => void = () => {}

// ── estado interno (só é tocado com a flag ligada) ──────────────────────────
/** Spans encerrados desde o último perfFrame (a janela do frame corrente). */
const frameSpans: PerfSpanSample[] = []
const hitches: PerfHitch[] = []
const totals = new Map<string, { ms: number; count: number }>()
/** Agregados de call sites quentes (perfAgg) — flush 1×/s nos totais. */
const aggs = new Map<string, { ms: number; count: number }>()
const seconds: PerfSecond[] = []
let secondDts: number[] = []
let secondAt = 0
/** Nomes já emitidos no timeline — higiene 1×/s (clearMarks/clearMeasures). */
const measureNames = new Set<string>()
const markNames = new Set<string>()

const round1 = (x: number): number => Math.round(x * 10) / 10

function addTotal(name: string, ms: number, count = 1): void {
  const t = totals.get(name)
  if (t) {
    t.ms += ms
    t.count += count
  } else totals.set(name, { ms, count })
}

function emitMeasure(name: string, start: number, end: number): void {
  const full = `mc.${name}`
  measureNames.add(full)
  try {
    performance.measure(full, { start, end })
  } catch {
    /* measure com options indisponível — o registro interno já aconteceu */
  }
}

/** Flag corrente (o HUD decide se monta o overlay; estável na sessão). */
export function perfEnabled(): boolean {
  return enabled
}

/** Marco pontual no timeline do DevTools (prefixo "mc."). No-op sem a flag. */
export function perfMark(name: string): void {
  if (!enabled) return
  const full = `mc.${name}`
  markNames.add(full)
  try {
    performance.mark(full)
  } catch {
    /* performance.mark indisponível */
  }
}

/** Abre um span; o retorno FECHA e registra (janela do frame + totais +
 *  performance.measure). Sem a flag devolve um noop compartilhado. */
export function perfSpan(name: string): () => void {
  if (!enabled) return NOOP
  const t0 = performance.now()
  return () => {
    const t1 = performance.now()
    const ms = t1 - t0
    frameSpans.push({ name, ms })
    addTotal(name, ms)
    emitMeasure(name, t0, t1)
  }
}

/** Span AGREGADO por segundo — para call sites quentes (ex.: hitTestDesk no
 *  pointermove a 500–1000Hz): acumula ms/chamadas e vira UMA linha nos totais
 *  por flush, nunca um measure por chamada. */
export function perfAgg(name: string): () => void {
  if (!enabled) return NOOP
  const t0 = performance.now()
  return () => {
    const ms = performance.now() - t0
    const a = aggs.get(name)
    if (a) {
      a.ms += ms
      a.count += 1
    } else aggs.set(name, { ms, count: 1 })
  }
}

/** Duração medida por TERCEIROS (ex.: onRender do <Profiler> do React):
 *  entra na janela do frame corrente + totais, sem relógio próprio. */
export function perfDuration(name: string, ms: number): void {
  if (!enabled) return
  frameSpans.push({ name, ms })
  addTotal(name, ms)
}

/** Nearest-rank sobre array ORDENADO asc. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  )
  return sorted[idx] ?? 0
}

function flushSecond(now: number): void {
  const sorted = secondDts.slice().sort((a, b) => a - b)
  seconds.push({
    at: Math.round(now),
    frames: secondDts.length,
    p50: round1(percentile(sorted, 50)),
    p95: round1(percentile(sorted, 95)),
    max: round1(sorted[sorted.length - 1] ?? 0),
  })
  if (seconds.length > SECONDS_MAX)
    seconds.splice(0, seconds.length - SECONDS_MAX)
  secondDts = []
  secondAt = now
  // agregados do segundo viram totais (uma linha por nome)
  for (const [name, a] of aggs) addTotal(name, a.ms, a.count)
  aggs.clear()
  // higiene do timeline: SÓ os nossos marks/measures (nunca clear geral — o
  // React/DevTools também usam o timeline)
  try {
    for (const n of measureNames) performance.clearMeasures(n)
    for (const n of markNames) performance.clearMarks(n)
  } catch {
    /* clearMeasures/clearMarks indisponíveis */
  }
}

/** Chamado pelo loop (engine/loop.ts) com o dt BRUTO do rAF, a cada frame.
 *  Fecha a janela do frame (atribuição de spans), detecta hitch e alimenta a
 *  estatística por segundo. No-op sem a flag. */
export function perfFrame(dtMs: number): void {
  if (!enabled) return
  const now = performance.now()
  if (secondAt === 0) secondAt = now
  secondDts.push(dtMs)
  if (now - secondAt >= 1000) flushSecond(now)
  if (dtMs > PERF_HITCH_MS) {
    const top = frameSpans
      .slice()
      .sort((a, b) => b.ms - a.ms)
      .slice(0, HITCH_TOP_SPANS)
      .map((s) => ({ name: s.name, ms: round1(s.ms) }))
    const hitch: PerfHitch = { at: Math.round(now), dtMs: round1(dtMs), spans: top }
    const heap = (
      performance as unknown as { memory?: { usedJSHeapSize?: number } }
    ).memory?.usedJSHeapSize
    if (typeof heap === "number") hitch.heapUsed = heap
    hitches.push(hitch)
    if (hitches.length > PERF_RING_MAX)
      hitches.splice(0, hitches.length - PERF_RING_MAX)
    console.warn(
      `[perf] hitch ${Math.round(dtMs)}ms${top
        .map((s) => ` · ${s.name}:${Math.round(s.ms)}ms`)
        .join("")}`,
    )
  }
  frameSpans.length = 0 // fecha a janela: spans daqui em diante são do próximo frame
}

/** Foto completa (ring de hitches + p50/p95/max por segundo + totais). */
export function getPerfReport(): PerfReport {
  const totalsArr: PerfTotal[] = [...totals.entries()]
    .map(([name, t]) => ({ name, ms: round1(t.ms), count: t.count }))
    .sort((a, b) => b.ms - a.ms)
  return {
    enabled,
    at: Date.now(),
    hitches: hitches.map((h) => ({ ...h, spans: h.spans.slice() })),
    seconds: seconds.slice(),
    totals: totalsArr,
  }
}

/** SÓ TESTES: força a flag e zera todo o estado interno. */
export function _perfResetForTests(on = false): void {
  enabled = on
  frameSpans.length = 0
  hitches.length = 0
  totals.clear()
  aggs.clear()
  seconds.length = 0
  secondDts = []
  secondAt = 0
  measureNames.clear()
  markNames.clear()
}
