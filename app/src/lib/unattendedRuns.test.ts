// Registro de runs DESASSISTIDOS + regra PURA do prazo. O que se prova aqui:
// automação sem ninguém na frente ganha prazo; conversa que VOCÊ digitou não
// ganha (esperar você é o certo); run que terminou antes some do registro (é o
// "cancelamento do timer"); e o knob em 0 devolve o comportamento de hoje.

import { beforeEach, describe, expect, it } from "vitest"
import {
  _resetUnattendedRuns,
  clearUnattendedRun,
  expiredUnattended,
  isUnattendedRun,
  markUnattendedRun,
  unattendedConvOf,
  unattendedRunIds,
  type PendingMark,
} from "./unattendedRuns"

const T0 = 1_700_000_000_000
const MIN = 60_000

function marca(over: Partial<PendingMark> = {}): PendingMark {
  return {
    id: "req-1",
    kind: "approval",
    runId: "run-auto",
    since: T0,
    ...over,
  }
}

beforeEach(() => {
  _resetUnattendedRuns()
})

describe("registro de runs desassistidos", () => {
  it("marca, consulta a conversa e limpa", () => {
    markUnattendedRun("run-auto", "conv-1")
    expect(isUnattendedRun("run-auto")).toBe(true)
    expect(unattendedConvOf("run-auto")).toBe("conv-1")
    expect([...unattendedRunIds()]).toEqual(["run-auto"])

    clearUnattendedRun("run-auto")
    expect(isUnattendedRun("run-auto")).toBe(false)
    expect(unattendedConvOf("run-auto")).toBeNull()
  })

  it("runId vazio não entra (não existe run sem id)", () => {
    markUnattendedRun("", "conv-1")
    expect(unattendedRunIds().size).toBe(0)
    expect(unattendedConvOf(null)).toBeNull()
  })
})

describe("expiredUnattended", () => {
  const runs = new Set(["run-auto"])

  it("expira o pedido do run desassistido só DEPOIS do limiar", () => {
    const m = marca()
    expect(expiredUnattended([m], runs, 10, T0 + 9 * MIN)).toEqual([])
    expect(expiredUnattended([m], runs, 10, T0 + 10 * MIN)).toEqual([m])
  })

  it("pedido de run NORMAL (você digitando) nunca expira", () => {
    const m = marca({ runId: "run-humano" })
    // 10 horas depois continua esperando: o turno espera você o tempo que precisar.
    expect(expiredUnattended([m], runs, 10, T0 + 600 * MIN)).toEqual([])
  })

  it("limiar 0 desliga o prazo (volta a esperar para sempre)", () => {
    expect(expiredUnattended([marca()], runs, 0, T0 + 600 * MIN)).toEqual([])
  })

  it("pedido órfão (sem run) não expira: sem run não dá pra afirmar que ninguém olha", () => {
    expect(
      expiredUnattended([marca({ runId: null })], runs, 10, T0 + 600 * MIN),
    ).toEqual([])
  })

  it("prazo é POR PEDIDO: o que chegou depois ainda tem a janela dele", () => {
    const velho = marca({ id: "req-velho" })
    const novo = marca({ id: "req-novo", since: T0 + 5 * MIN })
    expect(expiredUnattended([velho, novo], runs, 10, T0 + 10 * MIN)).toEqual([
      velho,
    ])
  })

  it("pergunta expira igual à permissão (os dois param o turno)", () => {
    const m = marca({ kind: "question" })
    expect(expiredUnattended([m], runs, 10, T0 + 10 * MIN)).toEqual([m])
  })
})
