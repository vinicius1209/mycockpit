// R9/R8 — o teste do PLANO GRANDE, que é o que separa "cabe" de "escala".
// Com 3 fases o recolhimento é economia de tela; com 12 é a diferença entre
// ver e não ver a fase viva. E não há limiar de N: com missão curta a janela
// cobre o plano inteiro e nenhum stub aparece.

import { describe, expect, it } from "vitest"
import { missionWindow, neverCollapses } from "./missionWindow"
import type { MissionPhaseRun } from "./missionTypes"

function fase(
  id: string,
  over: Partial<MissionPhaseRun> = {},
  agent = "claude-code",
): MissionPhaseRun {
  const def = {
    id,
    label: id,
    persona: "executor" as const,
    agent,
    model: null,
    effort: null,
    maxRetries: 1,
  }
  return {
    status: "queued",
    attempt: 1,
    costUsd: 0,
    startedAt: null,
    ...over,
    def: { ...def, ...(over.def ?? {}) },
  } as MissionPhaseRun
}

function plano(n: number): MissionPhaseRun[] {
  return Array.from({ length: n }, (_, i) => fase(`f${i + 1}`))
}

const tipos = (rows: ReturnType<typeof missionWindow>) =>
  rows.map((r) => (r.kind === "fase" ? `f${r.index}` : `stub:${r.side}`))

describe("janela viva · missão curta não vira boba", () => {
  it("com 3 fases a janela cobre o plano e nenhum stub aparece", () => {
    expect(tipos(missionWindow(plano(3), 1))).toEqual(["f0", "f1", "f2"])
  })

  it("com 4 fases na segunda, ainda cabe tudo menos a última", () => {
    expect(tipos(missionWindow(plano(4), 1))).toEqual([
      "f0",
      "f1",
      "f2",
      "stub:futuro",
    ])
  })
})

describe("janela viva · o plano grande (12 fases, a viva é a 7)", () => {
  const rows = missionWindow(plano(12), 6)

  it("a fase VIVA nunca sai da tela, e é a única aberta", () => {
    const abertas = rows.filter((r) => r.kind === "fase" && r.open)
    expect(abertas).toHaveLength(1)
    expect(abertas[0]).toMatchObject({ index: 6 })
  })

  it("a anterior e a próxima ficam, em uma linha cada", () => {
    expect(tipos(rows)).toEqual([
      "stub:passado",
      "f5",
      "f6",
      "f7",
      "stub:futuro",
    ])
  })

  it("são DOIS stubs, um de cada lado, e nada mais", () => {
    expect(rows.filter((r) => r.kind === "stub")).toHaveLength(2)
  })
})

describe("os stubs são RECIBO, não contagem", () => {
  it("o passado declara duração, custo e ações", () => {
    const ps = plano(12)
    for (const i of [0, 1, 2, 3, 4]) {
      ps[i] = fase(`f${i + 1}`, {
        status: "done",
        costUsd: 2.28,
        costSource: "reported",
        startedAt: 0,
        endedAt: 616_000,
        items: [{ kind: "tool", id: `t${i}`, name: "Read", input: {} }],
      })
    }
    const stub = missionWindow(ps, 6).find(
      (r) => r.kind === "stub" && r.side === "passado",
    ) as Extract<ReturnType<typeof missionWindow>[number], { kind: "stub" }>
    expect(stub?.label).toBe("5 fases concluídas")
    expect(stub?.declares).toContain("US$ 11,40")
    expect(stub?.declares).toContain("5 ações")
    expect(stub?.declares).toContain("51min")
  })

  it("o passado confessa quando engoliu fase sem custo medido", () => {
    const ps = plano(12)
    ps[0] = fase("f1", { status: "done", startedAt: 0, endedAt: 1000 }, "model")
    ps[1] = fase("f2", {
      status: "done",
      costUsd: 1,
      costSource: "reported",
      startedAt: 0,
      endedAt: 1000,
    })
    ps[2] = fase("f3", { status: "done", costUsd: 1, costSource: "reported", startedAt: 0, endedAt: 1000 })
    ps[3] = fase("f4", { status: "done", costUsd: 1, costSource: "reported", startedAt: 0, endedAt: 1000 })
    ps[4] = fase("f5", { status: "done", costUsd: 1, costSource: "reported", startedAt: 0, endedAt: 1000 })
    const stub = missionWindow(ps, 6).find(
      (r) => r.kind === "stub" && r.side === "passado",
    ) as Extract<ReturnType<typeof missionWindow>[number], { kind: "stub" }>
    expect(stub?.declares).toContain("sem custo medido")
  })

  it("o futuro declara o que a agregação não pode esconder", () => {
    const ps = plano(12)
    ps[10] = fase("f11", {}, "model")
    const stub = missionWindow(ps, 6).find(
      (r) => r.kind === "stub" && r.side === "futuro",
    ) as Extract<ReturnType<typeof missionWindow>[number], { kind: "stub" }>
    expect(stub?.label).toBe("+4 fases na fila")
    expect(stub?.declares).toContain("não mede custo")
  })

  it("fase apendada no voo é EXCEÇÃO: ela fura o stub em vez de sumir nele", () => {
    const ps = plano(12)
    ps[9] = fase("fix-1-abc")
    const rows = missionWindow(ps, 6)
    expect(rows.some((r) => r.kind === "fase" && r.index === 9)).toBe(true)
    // e o stub do futuro se parte em dois, porque a ordem do plano manda:
    // fingir contiguidade seria esconder ONDE a fase nova entrou.
    expect(rows.filter((r) => r.kind === "stub" && r.side === "futuro")).toHaveLength(2)
  })
})

describe("as quatro exceções que nunca agregam", () => {
  const base = { holdPhase: null, manuallyOpen: new Set<number>() }

  it("fase que falhou ou foi interrompida", () => {
    expect(neverCollapses(fase("x", { status: "error" }), 0, base)).toBe(true)
    expect(neverCollapses(fase("x", { status: "aborted" }), 0, base)).toBe(true)
  })

  it("fase segurada por você", () => {
    expect(neverCollapses(fase("x"), 3, { holdPhase: 3 })).toBe(true)
  })

  it("fase com marca de procedência (entrou depois da decolagem)", () => {
    const apendada = fase("fix-1-abc")
    expect(neverCollapses(apendada, 0, base)).toBe(true)
  })

  it("fase que você abriu à mão", () => {
    expect(
      neverCollapses(fase("x"), 2, { manuallyOpen: new Set([2]) }),
    ).toBe(true)
  })

  it("na prática: a fase 5 reprovada continua na tela num plano de 12", () => {
    const ps = plano(12)
    ps[4] = fase("f5", { status: "error" })
    expect(tipos(missionWindow(ps, 6))).toContain("f4")
  })
})
