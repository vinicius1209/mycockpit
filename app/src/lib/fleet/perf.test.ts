// Telemetria de frame (engine/perf) — flag OFF é no-op absoluto (zero marks),
// hitches vão pro ring buffer (últimos 100) e os spans são atribuídos à
// JANELA do frame em que encerraram (limpa a cada perfFrame).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  _perfResetForTests,
  getPerfReport,
  PERF_OPERATION_RING_MAX,
  PERF_RING_MAX,
  perfAgg,
  perfDuration,
  perfEnabled,
  perfFrame,
  perfMark,
  perfOperation,
  perfSpan,
} from "./perf"

let warnSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  _perfResetForTests(false)
  vi.restoreAllMocks()
})

describe("flag desligada (default)", () => {
  it("todos os hooks são no-op: zero performance.mark/measure e relatório vazio", () => {
    _perfResetForTests(false)
    const mark = vi.spyOn(performance, "mark")
    const measure = vi.spyOn(performance, "measure")

    perfMark("boot")
    const end = perfSpan("persist")
    end()
    const endAgg = perfAgg("hitTest")
    endAgg()
    perfDuration("react:commit", 12)
    perfOperation("nav.project.intent", { bytes: 2 })({ outcome: "ok" })
    perfFrame(500) // frame gigante — ainda assim nada registra

    expect(mark).not.toHaveBeenCalled()
    expect(measure).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(perfEnabled()).toBe(false)

    const report = getPerfReport()
    expect(report.enabled).toBe(false)
    expect(report.hitches).toEqual([])
    expect(report.seconds).toEqual([])
    expect(report.totals).toEqual([])
    expect(report.operations).toEqual([])
  })

  it("perfSpan desligado devolve o MESMO noop (zero alocação por chamada)", () => {
    _perfResetForTests(false)
    expect(perfSpan("a")).toBe(perfSpan("b"))
    expect(perfAgg("a")).toBe(perfSpan("b"))
  })
})

describe("faixa operacional", () => {
  it("guarda duração, tamanho, cache e desfecho sem payload", () => {
    _perfResetForTests(true)
    let clock = 20
    vi.spyOn(performance, "now").mockImplementation(() => clock)
    vi.spyOn(Date, "now").mockReturnValue(1_789_000_000_000)

    const finish = perfOperation("files.root.request", {
      bytes: 512,
      cache: "miss",
    })
    clock = 27.25
    finish({ outcome: "ok" })

    expect(getPerfReport().operations).toEqual([
      {
        name: "files.root.request",
        startedAt: 1_789_000_000_000,
        durationMs: 7.3,
        bytes: 512,
        cache: "miss",
        outcome: "ok",
      },
    ])
  })

  it("retém somente as operações mais recentes", () => {
    _perfResetForTests(true)
    for (let index = 0; index < PERF_OPERATION_RING_MAX + 3; index++) {
      perfOperation(`op-${index}`)()
    }
    const { operations } = getPerfReport()
    expect(operations).toHaveLength(PERF_OPERATION_RING_MAX)
    expect(operations[0]?.name).toBe("op-3")
  })
})

describe("hitch logger + atribuição à janela do frame", () => {
  it("frame > 50ms vira hitch com os spans encerrados DENTRO da janela", () => {
    _perfResetForTests(true)
    const end = perfSpan("persist")
    end()
    perfDuration("react:commit", 33)
    perfFrame(120)

    const { hitches } = getPerfReport()
    expect(hitches).toHaveLength(1)
    expect(hitches[0]!.dtMs).toBe(120)
    const names = hitches[0]!.spans.map((s) => s.name)
    expect(names).toContain("persist")
    expect(names).toContain("react:commit")
    expect(warnSpy).toHaveBeenCalledTimes(1)
    expect(String(warnSpy.mock.calls[0]![0])).toMatch(/\[perf\] hitch 120ms/)
  })

  it("frame ≤ 50ms não vira hitch (mas fecha a janela)", () => {
    _perfResetForTests(true)
    perfDuration("derive", 10)
    perfFrame(16)
    expect(getPerfReport().hitches).toHaveLength(0)
  })

  it("a janela LIMPA a cada frame: span de um frame não vaza pro seguinte", () => {
    _perfResetForTests(true)
    perfDuration("persist", 40)
    perfFrame(16) // frame normal consome a janela
    perfFrame(90) // hitch SEM spans próprios
    const { hitches } = getPerfReport()
    expect(hitches).toHaveLength(1)
    expect(hitches[0]!.spans).toEqual([])
  })

  it("spans do hitch são top 5 por ms, ordenados desc", () => {
    _perfResetForTests(true)
    for (const [name, ms] of [
      ["a", 1],
      ["b", 7],
      ["c", 3],
      ["d", 9],
      ["e", 5],
      ["f", 2],
      ["g", 8],
    ] as const)
      perfDuration(name, ms)
    perfFrame(80)
    const spans = getPerfReport().hitches[0]!.spans
    expect(spans.map((s) => s.name)).toEqual(["d", "g", "b", "e", "c"])
    expect(spans.map((s) => s.ms)).toEqual([9, 8, 7, 5, 3])
  })

  it("ring buffer retém só os últimos 100 hitches", () => {
    _perfResetForTests(true)
    for (let i = 0; i < PERF_RING_MAX + 10; i++) perfFrame(100 + i)
    const { hitches } = getPerfReport()
    expect(hitches).toHaveLength(PERF_RING_MAX)
    expect(hitches[0]!.dtMs).toBe(110) // os 10 primeiros caíram
    expect(hitches[hitches.length - 1]!.dtMs).toBe(100 + PERF_RING_MAX + 9)
  })
})

describe("estatística por segundo + agregados", () => {
  it("p50/p95/max do dt por segundo; perfAgg entra nos totais no flush", () => {
    _perfResetForTests(true)
    let clock = 0
    vi.spyOn(performance, "now").mockImplementation(() => clock)

    // 3 chamadas agregadas de 2ms cada (start em t, end em t+2)
    for (let i = 0; i < 3; i++) {
      const end = perfAgg("hitTest")
      clock += 2
      end()
    }

    // 4 frames dentro do 1º segundo (baseline = 1º perfFrame, clock=6);
    // o último cruza a fronteira (6+1000) e flusha
    for (const dt of [16, 16, 16]) {
      perfFrame(dt)
      clock += 100
    }
    clock = 1006
    perfFrame(100)

    const report = getPerfReport()
    expect(report.seconds).toHaveLength(1)
    expect(report.seconds[0]).toMatchObject({
      frames: 4,
      p50: 16,
      p95: 100,
      max: 100,
    })
    const agg = report.totals.find((t) => t.name === "hitTest")
    expect(agg).toMatchObject({ ms: 6, count: 3 })
  })

  it("totais acumulam por span (ms somado + contagem)", () => {
    _perfResetForTests(true)
    perfDuration("derive", 4)
    perfDuration("derive", 6)
    const t = getPerfReport().totals.find((x) => x.name === "derive")
    expect(t).toMatchObject({ ms: 10, count: 2 })
  })

  it("perfSpan ligado registra measure com prefixo mc.", () => {
    _perfResetForTests(true)
    const measure = vi
      .spyOn(performance, "measure")
      .mockImplementation(() => ({}) as PerformanceMeasure)
    const end = perfSpan("persist")
    end()
    expect(measure).toHaveBeenCalledWith(
      "mc.persist",
      expect.objectContaining({ start: expect.any(Number), end: expect.any(Number) }),
    )
  })
})
