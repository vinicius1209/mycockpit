/** Vida ambiente — lógica PURA (sem Pixi, sem DOM): PRNG semeado, agenda
 *  determinística de micro-ações do idle sentado e curvas de fase. 100%
 *  testável (ambient.test.ts).
 *
 *  Determinismo: mulberry32 semeado (hash do projectId/deskId) — NUNCA
 *  Math.random solto: a mesma seed reproduz a mesma vida entre sessões. */

// ---------------------------------------------------------------------------
// PRNG semeado (mulberry32) + hash de string → seed
// ---------------------------------------------------------------------------

/** PRNG determinístico e barato; devolve floats em [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Hash FNV-1a (32 bits) — projectId/deskId → seed estável entre sessões. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

// ---------------------------------------------------------------------------
// Agenda de micro-ações do idle sentado (alongar / olhar / gole demorado)
// ---------------------------------------------------------------------------

export type MicroActionKind = "stretch" | "lookAround" | "longSip"

export type MicroAction = {
  kind: MicroActionKind
  /** Início (s, relógio da sim). */
  start: number
  /** Duração (1–2s). */
  duration: number
}

/** Intervalo entre micro-ações (fim de uma → início da próxima), em s. */
export const MICRO_GAP_MIN = 12
export const MICRO_GAP_MAX = 25
/** Duração de cada micro-ação, em s. */
export const MICRO_DUR_MIN = 1
export const MICRO_DUR_MAX = 2

const MICRO_KINDS: readonly MicroActionKind[] = ["stretch", "lookAround", "longSip"]

/** Micro-ação ATIVA-ou-próxima em `timeSec`: a primeira da agenda cuja janela
 *  ainda não terminou (se `timeSec` cai dentro de uma, devolve essa mesma).
 *  Pura e determinística — reconstrói a agenda desde t=0 a partir da seed;
 *  mesma (seed, time) ⇒ mesma ação, sempre. Chamar só quando a ação corrente
 *  expira (1×/~12–25s), nunca por frame. */
export function nextMicroAction(seed: number, timeSec: number): MicroAction {
  const rng = mulberry32(seed)
  let start = MICRO_GAP_MIN + rng() * (MICRO_GAP_MAX - MICRO_GAP_MIN)
  for (;;) {
    const duration = MICRO_DUR_MIN + rng() * (MICRO_DUR_MAX - MICRO_DUR_MIN)
    const kind = MICRO_KINDS[Math.floor(rng() * MICRO_KINDS.length)]
    if (start + duration > timeSec) return { kind, start, duration }
    start = start + duration + MICRO_GAP_MIN + rng() * (MICRO_GAP_MAX - MICRO_GAP_MIN)
  }
}

/** Envelope 0→1→0 (meia-onda de seno) dentro da janela da ação; 0 fora. */
export function microActionEnvelope(action: MicroAction, timeSec: number): number {
  const u = (timeSec - action.start) / action.duration
  if (u <= 0 || u >= 1) return 0
  return Math.sin(u * Math.PI)
}

// ---------------------------------------------------------------------------
// Peso do boss em pé (alterna de perna)
// ---------------------------------------------------------------------------

/** Lado do peso do boss idle: alterna suavemente entre −1 e +1 a cada
 *  `periodSec` (tanh de seno ⇒ platôs de apoio com transição macia). */
export function weightShiftSide(timeSec: number, periodSec = 8): number {
  return Math.tanh(2.5 * Math.sin((Math.PI * timeSec) / periodSec))
}

// ---------------------------------------------------------------------------
// Poeira do facho da luminária (motes) — browniano barato por seno composto
// ---------------------------------------------------------------------------

export const MOTE_COUNT_MIN = 4
export const MOTE_COUNT_MAX = 6

export type MoteSpec = {
  /** Centro do vaivém (frações 0..1 da largura/altura do facho). */
  cx: number
  cy: number
  /** Amplitude do browniano (fração da largura do facho). */
  amp: number
  /** Frequências (rad/s) e fases dos senos compostos. */
  fa: number
  fb: number
  pa: number
  pb: number
  /** Alpha base (baixíssimo) e escala do pontinho. */
  alpha: number
  scale: number
}

/** 4–6 partículas de poeira — parâmetros determinísticos por seed. */
export function moteSpecs(seed: number): MoteSpec[] {
  const rng = mulberry32(seed)
  const count = MOTE_COUNT_MIN + Math.floor(rng() * (MOTE_COUNT_MAX - MOTE_COUNT_MIN + 1))
  const specs: MoteSpec[] = []
  for (let i = 0; i < count; i++) {
    specs.push({
      cx: 0.2 + rng() * 0.6,
      cy: 0.15 + rng() * 0.7,
      amp: 0.05 + rng() * 0.07,
      fa: 0.12 + rng() * 0.18,
      fb: 0.07 + rng() * 0.12,
      pa: rng() * Math.PI * 2,
      pb: rng() * Math.PI * 2,
      alpha: 0.04 + rng() * 0.06,
      scale: 0.28 + rng() * 0.2,
    })
  }
  return specs
}

/** Posição browniana barata (senos compostos) em frações 0..1 do facho —
 *  as amplitudes de moteSpecs garantem que nunca sai do retângulo. */
export function motePosition(m: MoteSpec, timeSec: number): { x: number; y: number } {
  const x =
    m.cx + m.amp * (Math.sin(m.fa * timeSec + m.pa) + 0.5 * Math.sin(m.fb * 1.7 * timeSec + m.pb))
  const y =
    m.cy +
    m.amp * 0.8 * (Math.cos(m.fb * timeSec + m.pa) + 0.5 * Math.sin(m.fa * 1.3 * timeSec + m.pb))
  return { x, y }
}
