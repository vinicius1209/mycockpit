/** Testes da vida ambiente — lógica pura (sem WebGL/Pixi — só ./ambient):
 *  PRNG semeado, agenda de micro-ações e curvas de fase. */
import { describe, expect, it } from "vitest"
import {
  hashSeed,
  microActionEnvelope,
  MICRO_DUR_MAX,
  MICRO_DUR_MIN,
  MICRO_GAP_MAX,
  MICRO_GAP_MIN,
  MOTE_COUNT_MAX,
  MOTE_COUNT_MIN,
  motePosition,
  moteSpecs,
  mulberry32,
  nextMicroAction,
  weightShiftSide,
  type MicroAction,
  type MicroActionKind,
} from "./ambient"

const KINDS: MicroActionKind[] = ["stretch", "lookAround", "longSip"]

/** Percorre a agenda: n ações consecutivas a partir de t=0. */
function schedule(seed: number, n: number): MicroAction[] {
  const out: MicroAction[] = []
  let t = 0
  for (let i = 0; i < n; i++) {
    const a = nextMicroAction(seed, t)
    out.push(a)
    t = a.start + a.duration
  }
  return out
}

describe("mulberry32 (PRNG semeado)", () => {
  it("é determinístico: mesma seed ⇒ mesma sequência", () => {
    const a = mulberry32(1209)
    const b = mulberry32(1209)
    for (let i = 0; i < 10; i++) expect(a()).toBe(b())
  })

  it("devolve floats em [0,1)", () => {
    const rng = mulberry32(7)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it("seeds diferentes divergem", () => {
    expect(mulberry32(1)()).not.toBe(mulberry32(2)())
  })
})

describe("hashSeed (string → seed uint32)", () => {
  it("é estável entre chamadas e devolve uint32", () => {
    const h = hashSeed("projeto-a:claude-code")
    expect(hashSeed("projeto-a:claude-code")).toBe(h)
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThanOrEqual(0xffffffff)
    expect(Number.isInteger(h)).toBe(true)
  })

  it("strings diferentes ⇒ seeds diferentes (projetos não clonam vida)", () => {
    expect(hashSeed("projeto-a")).not.toBe(hashSeed("projeto-b"))
    expect(hashSeed("")).not.toBe(hashSeed("x"))
  })
})

describe("nextMicroAction (agenda determinística do idle)", () => {
  it("mesma (seed, time) ⇒ mesma ação, sempre", () => {
    expect(nextMicroAction(42, 137.5)).toEqual(nextMicroAction(42, 137.5))
    expect(nextMicroAction(42, 0)).toEqual(nextMicroAction(42, 0))
  })

  it("primeira ação começa dentro do gap [12,25] com duração [1,2] e kind válido", () => {
    for (const seed of [1, 99, 0xdeadbeef]) {
      const a = nextMicroAction(seed, 0)
      expect(a.start).toBeGreaterThanOrEqual(MICRO_GAP_MIN)
      expect(a.start).toBeLessThanOrEqual(MICRO_GAP_MAX)
      expect(a.duration).toBeGreaterThanOrEqual(MICRO_DUR_MIN)
      expect(a.duration).toBeLessThanOrEqual(MICRO_DUR_MAX)
      expect(KINDS).toContain(a.kind)
    }
  })

  it("enquanto a ação está ativa, devolve a MESMA ação (não pula)", () => {
    const a = nextMicroAction(7, 0)
    expect(nextMicroAction(7, a.start)).toEqual(a)
    expect(nextMicroAction(7, a.start + a.duration / 2)).toEqual(a)
  })

  it("agenda avança com gaps em [12,25] e durações em [1,2]", () => {
    const acts = schedule(31337, 20)
    for (let i = 1; i < acts.length; i++) {
      const gap = acts[i].start - (acts[i - 1].start + acts[i - 1].duration)
      expect(gap).toBeGreaterThanOrEqual(MICRO_GAP_MIN)
      expect(gap).toBeLessThanOrEqual(MICRO_GAP_MAX)
      expect(acts[i].duration).toBeGreaterThanOrEqual(MICRO_DUR_MIN)
      expect(acts[i].duration).toBeLessThanOrEqual(MICRO_DUR_MAX)
    }
  })

  it("a janela devolvida nunca terminou antes do time consultado", () => {
    for (const time of [0, 12, 60.4, 333.3, 1000]) {
      const a = nextMicroAction(5, time)
      expect(a.start + a.duration).toBeGreaterThan(time)
    }
  })

  it("seeds diferentes ⇒ agendas diferentes (nada de uníssono)", () => {
    const a = schedule(1, 5).map((x) => x.start)
    const b = schedule(2, 5).map((x) => x.start)
    expect(a).not.toEqual(b)
  })

  it("as três micro-ações aparecem ao longo da agenda", () => {
    const kinds = new Set(schedule(2026, 60).map((a) => a.kind))
    expect(kinds).toEqual(new Set(KINDS))
  })
})

describe("microActionEnvelope (sino 0→1→0)", () => {
  const act: MicroAction = { kind: "stretch", start: 20, duration: 2 }

  it("é 0 fora da janela (antes e depois)", () => {
    expect(microActionEnvelope(act, 0)).toBe(0)
    expect(microActionEnvelope(act, 19.99)).toBe(0)
    expect(microActionEnvelope(act, 22)).toBe(0)
    expect(microActionEnvelope(act, 100)).toBe(0)
  })

  it("chega a 1 no meio e fica em [0,1] sempre", () => {
    expect(microActionEnvelope(act, 21)).toBeCloseTo(1, 10)
    for (let t = 19; t <= 23; t += 0.05) {
      const e = microActionEnvelope(act, t)
      expect(e).toBeGreaterThanOrEqual(0)
      expect(e).toBeLessThanOrEqual(1)
    }
  })
})

describe("weightShiftSide (peso do boss alterna a cada ~8s)", () => {
  it("fica em [-1,1] e cruza ~0 nas trocas", () => {
    for (let t = 0; t < 40; t += 0.25) {
      expect(Math.abs(weightShiftSide(t))).toBeLessThanOrEqual(1)
    }
    expect(Math.abs(weightShiftSide(0))).toBeLessThan(0.01)
    expect(Math.abs(weightShiftSide(8))).toBeLessThan(0.01)
  })

  it("apoia firme num lado e alterna no período seguinte", () => {
    expect(weightShiftSide(4)).toBeGreaterThan(0.9) //   platô +
    expect(weightShiftSide(12)).toBeLessThan(-0.9) //    platô −
    expect(weightShiftSide(20)).toBeGreaterThan(0.9) //  volta
  })

  it("respeita período customizado", () => {
    expect(weightShiftSide(1, 2)).toBeGreaterThan(0.9)
    expect(weightShiftSide(3, 2)).toBeLessThan(-0.9)
  })
})

describe("motes (poeira do facho da luminária)", () => {
  it("specs são determinísticos por seed, 4–6 partículas", () => {
    expect(moteSpecs(77)).toEqual(moteSpecs(77))
    for (const seed of [1, 55, 0xabcdef]) {
      const n = moteSpecs(seed).length
      expect(n).toBeGreaterThanOrEqual(MOTE_COUNT_MIN)
      expect(n).toBeLessThanOrEqual(MOTE_COUNT_MAX)
    }
  })

  it("alpha baixíssimo e pontinho pequeno (poeira, não vagalume)", () => {
    for (const m of moteSpecs(9)) {
      expect(m.alpha).toBeLessThanOrEqual(0.1)
      expect(m.scale).toBeLessThanOrEqual(0.5)
    }
  })

  it("o vaivém nunca sai do retângulo do facho (frações 0..1)", () => {
    for (const m of moteSpecs(123)) {
      for (let t = 0; t < 240; t += 1.7) {
        const p = motePosition(m, t)
        expect(p.x).toBeGreaterThanOrEqual(0)
        expect(p.x).toBeLessThanOrEqual(1)
        expect(p.y).toBeGreaterThanOrEqual(0)
        expect(p.y).toBeLessThanOrEqual(1)
      }
    }
  })

  it("posição é determinística (mesma spec + tempo ⇒ mesmo ponto)", () => {
    const m = moteSpecs(4)[0]
    expect(motePosition(m, 33.3)).toEqual(motePosition(m, 33.3))
  })
})
