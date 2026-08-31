// MH2.1/MH2.2 — custo e teto DENTRO do runPhase: o ledger vê cada tentativa
// (onCost) e o teto morde no meio da fase (stopAtCostUsd → cancelAgent + sem
// retry). Fixtures no formato REAL dos AgentEvent que os adapters emitem
// (docs/stream-json-notes.md): claude reporta custo no result do FIM do run e
// pode emitir DOIS results no mesmo run com custo CUMULATIVO (trabalho
// diferido); codex emite um result com custo ESTIMADO no fim.

import { describe, expect, it, vi } from "vitest"
import type { AgentEvent } from "@/lib/agent"
import { runPhase, type PhaseCostEvent } from "./mission"

/** Result no formato real do claude (custo REPORTADO pelo CLI no fim do run —
 *  `total_cost_usd` do evento `result` do stream-json). */
function claudeResult(ok: boolean, cost: number): AgentEvent {
  return {
    type: "result",
    ok,
    text: ok ? "feito" : null,
    cost_usd: cost,
    cost_source: "reported",
    input_tokens: 2_413,
    output_tokens: 891,
    cache_read: 118_224,
    cache_creation: 4_096,
  }
}

/** Result no formato real do codex (sem custo no protocolo → ESTIMADO pelo
 *  adapter a partir dos tokens). */
function codexResult(ok: boolean, cost: number): AgentEvent {
  return {
    type: "result",
    ok,
    text: ok ? "done" : null,
    cost_usd: cost,
    cost_source: "estimated",
    input_tokens: 51_022,
    output_tokens: 7_310,
    cache_read: 0,
    cache_creation: 0,
  }
}

type RunScript = AgentEvent[][] // eventos por tentativa (1ª, 2ª, …)

/** runAgent falso: cada chamada consome a próxima lista de eventos. */
function fakeRun(script: RunScript) {
  let call = 0
  const fn = vi.fn(
    async (
      _r: string,
      _c: string,
      _a: string,
      _m: string | null,
      _e: string | null,
      _p: string,
      _cwd: string,
      _res: string | null,
      _perm: string,
      _att: unknown,
      onEvent: (e: AgentEvent) => void,
    ) => {
      for (const ev of script[call] ?? []) onEvent(ev)
      call++
    },
  )
  return fn
}

function args(over: Partial<Parameters<typeof runPhase>[0]> = {}) {
  return {
    runId: "m1::phase-0",
    convId: "c1",
    agent: "codex",
    model: null,
    effort: null,
    prompt: "p",
    cwd: "/x",
    permission: "padrao",
    maxRetries: 1,
    ...over,
  }
}

describe("MH2.2 · teto morde DENTRO da fase (stopAtCostUsd)", () => {
  it("result parcial de retry cruza o teto → cancela o run, NÃO re-tenta e volta budgetExceeded", async () => {
    // tentativa 1 falha já custando US$ 1,20 (estimado, codex) com teto
    // restante de US$ 1,00 — o retry re-rodaria a fase inteira e dobraria o
    // estouro; o corte segura ali.
    const run = fakeRun([[codexResult(false, 1.2)], [codexResult(true, 1.0)]])
    const cancel = vi.fn(async () => true)
    const r = await runPhase(
      args({ maxRetries: 3, stopAtCostUsd: 1.0, run: run as never, cancel }),
    )
    expect(r.ok).toBe(false)
    expect(r.budgetExceeded).toBe(true)
    expect(r.error).toContain("teto")
    expect(r.costUsd).toBeCloseTo(1.2)
    expect(run).toHaveBeenCalledTimes(1) // nunca chegou na tentativa 2
    expect(cancel).toHaveBeenCalledWith("m1::phase-0")
  })

  it("parcial CUMULATIVO no meio do run cruza o teto → cancel dispara e o cancelled encerra a tentativa (custo não soma em dobro)", async () => {
    // padrão real do claude com trabalho diferido: primeiro result ok com
    // custo, o run segue vivo, segundo result com custo CUMULATIVO cruza o
    // teto; o cancel do corte derruba o resto do run (evento cancelled).
    const run = fakeRun([
      [
        claudeResult(true, 0.8),
        claudeResult(true, 1.4),
        { type: "cancelled" },
      ],
    ])
    const cancel = vi.fn(async () => true)
    const r = await runPhase(
      args({
        agent: "claude-code",
        stopAtCostUsd: 1.0,
        run: run as never,
        cancel,
      }),
    )
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(r.ok).toBe(false)
    expect(r.budgetExceeded).toBe(true)
    // o último result VENCE (custo cumulativo do CLI): 1.4, nunca 0.8 + 1.4.
    expect(r.costUsd).toBeCloseTo(1.4)
  })

  it("degradação honesta: custo só chega no result FINAL ok → o corte não derruba a fase (ok volta; o check entre fases morde)", async () => {
    // claude reporta custo no FIM: quando o result que cruza o teto é o último
    // suspiro do run (que termina ok antes do cancel morder), a fase volta ok
    // com o trabalho REAL entregue — o desfecho de teto fica com o checkBudget
    // entre fases, nunca um "cancelado" teatral de trabalho já concluído.
    const run = fakeRun([[claudeResult(true, 2.0)]])
    const cancel = vi.fn(async () => true)
    const r = await runPhase(
      args({
        agent: "claude-code",
        stopAtCostUsd: 1.0,
        run: run as never,
        cancel,
      }),
    )
    expect(r.ok).toBe(true)
    expect(r.budgetExceeded).toBeUndefined()
    expect(r.costUsd).toBeCloseTo(2.0)
  })

  it("sem teto (stopAtCostUsd ausente) nada é cancelado", async () => {
    const run = fakeRun([[codexResult(true, 3.5)]])
    const cancel = vi.fn(async () => true)
    const r = await runPhase(args({ run: run as never, cancel }))
    expect(r.ok).toBe(true)
    expect(cancel).not.toHaveBeenCalled()
  })
})

describe("MH2.1 · onCost e a contabilidade por tentativa", () => {
  it("onCost recebe CADA result com custo, inclusive o da tentativa descartada pelo retry", async () => {
    const run = fakeRun([[codexResult(false, 0.2)], [codexResult(true, 0.3)]])
    const costs: { attempt: number; e: PhaseCostEvent }[] = []
    const r = await runPhase(
      args({
        maxRetries: 2,
        run: run as never,
        onCost: (attempt, e) => costs.push({ attempt, e }),
      }),
    )
    expect(r.ok).toBe(true)
    expect(costs).toHaveLength(2)
    expect(costs[0]).toMatchObject({
      attempt: 1,
      e: { costUsd: 0.2, costSource: "estimated" },
    })
    expect(costs[1]).toMatchObject({ attempt: 2, e: { costUsd: 0.3 } })
    // tokens do result viajam pro ledger (input/output/cache).
    expect(costs[1].e.input).toBe(51_022)
    expect(costs[1].e.output).toBe(7_310)
    // entre tentativas o custo SOMA (cada uma é um run novo, gasto real).
    expect(r.costUsd).toBeCloseTo(0.5)
  })

  it("dentro da MESMA tentativa o último result vence (cumulativo); entre tentativas soma", async () => {
    // tentativa 1: dois results cumulativos (0.3 → 0.5) e falha no fim;
    // tentativa 2: um result ok de 0.2. Total honesto: 0.5 + 0.2 = 0.7
    // (somar os parciais da tentativa 1 daria 1.0 — dupla contagem).
    const run = fakeRun([
      [claudeResult(true, 0.3), claudeResult(false, 0.5)],
      [claudeResult(true, 0.2)],
    ])
    const r = await runPhase(
      args({ agent: "claude-code", maxRetries: 2, run: run as never }),
    )
    expect(r.ok).toBe(true)
    expect(r.costUsd).toBeCloseTo(0.7)
  })
})
