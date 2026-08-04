// MH2.1/MH2.2/MH2.3 no STORE — o laço da missão:
// - grava turn_costs por TENTATIVA de fase (fonte única do Painel/cards),
//   INCLUSIVE quando a missão falha/estoura depois; retry descartado tem linha
//   própria e parciais da MESMA tentativa reusam o run_id (REPLACE colapsa);
// - passa o teto RESTANTE pro runPhase e leva budgetExceeded ao MESMO desfecho
//   de teto do check entre fases, com notice dizendo onde mordeu;
// - notifica desfecho (ok/ressalva/falha/teto) e recovery pendente pelos
//   canais do ADR-013 — UMA vez por desfecho; abort do usuário não notifica.
//
// Modelado no mission.recovery.test.ts: só runPhase/db/notify/agent mocados;
// helpers puros de @/lib/mission (reviewerApproved, checkBudget…) reais.

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult, RunPhaseArgs } from "@/lib/mission"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"
import type { ChatItem } from "@/store/chat"

type CostEvent = {
  attempt: number
  costUsd: number
  costSource: "reported" | "estimated" | "unknown"
  input: number
  output: number
  cache: number
}

type Step = { result: PhaseResult; costEvents?: CostEvent[] }

const h = vi.hoisted(() => ({
  steps: [] as Step[],
  calls: [] as { runId: string; stopAtCostUsd: number | null | undefined }[],
  ledger: [] as {
    runId: string
    projectId: string
    convId: string
    agent: string
    costUsd: number | null
    costSource: string | null
    input: number
  }[],
  /** Segura o runPhase corrente até o teste liberar (caso abort). */
  gate: null as null | Promise<void>,
}))

vi.mock("@/lib/mission", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/mission")>()
  return {
    ...mod,
    runPhase: vi.fn(async (args: RunPhaseArgs) => {
      h.calls.push({ runId: args.runId, stopAtCostUsd: args.stopAtCostUsd })
      if (h.gate) await h.gate
      const step = h.steps.shift() ?? {
        result: { ok: true, items: [], costUsd: 0, costSource: undefined },
      }
      for (const c of step.costEvents ?? []) {
        args.onCost?.(c.attempt, {
          costUsd: c.costUsd,
          costSource: c.costSource,
          input: c.input,
          output: c.output,
          cache: c.cache,
        })
      }
      return step.result
    }),
  }
})

vi.mock("@/lib/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/db")>()
  return {
    ...mod,
    recordTurnCost: vi.fn(async (r: (typeof h.ledger)[number]) => {
      h.ledger.push(r)
    }),
    insertDelivery: vi.fn(async () => {}),
    upsertMission: vi.fn(async () => {}),
  }
})

vi.mock("@/lib/notify", () => ({
  notifyGate: vi.fn(),
  notifyTurnEnd: vi.fn(),
  nativeNotify: vi.fn(),
  notifyMissionEnd: vi.fn(),
  notifyMissionRecovery: vi.fn(),
}))

vi.mock("@/lib/agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agent")>()
  return { ...mod, cancelAgent: vi.fn(async () => {}) }
})

import { useMission } from "./mission"
import { useChat } from "./chat"
import { notifyMissionEnd, notifyMissionRecovery } from "@/lib/notify"
import { recordTurnCost } from "@/lib/db"

// ── Factories locais ──────────────────────────────────────────────────────

function phaseDef(over: Partial<MissionPhaseDef> = {}): MissionPhaseDef {
  return {
    id: "p",
    label: "Fase",
    persona: "executor",
    agent: "codex",
    model: null,
    effort: null,
    maxRetries: 1,
    ...over,
  }
}

function preset(
  phases: MissionPhaseDef[],
  maxCostUsd: number | null = null,
): MissionPreset {
  return { id: "t", name: "Teste", phases, maxCostUsd }
}

function textItem(text: string): ChatItem {
  return { kind: "text", id: crypto.randomUUID(), text }
}

function ok(costUsd = 0, items: ChatItem[] = []): PhaseResult {
  return { ok: true, items, costUsd, costSource: "estimated" }
}

function bugFail(costUsd = 0): PhaseResult {
  return {
    ok: false,
    items: [],
    costUsd,
    costSource: "estimated",
    error: "erro de compilação no arquivo x",
  }
}

/** Falha RECUPERÁVEL (item kind:"limit" real do transcript). */
function limitFail(costUsd = 0): PhaseResult {
  return {
    ok: false,
    items: [{ kind: "limit", id: "l1", message: "limite da CLI" }],
    costUsd,
    costSource: "reported",
    error: "limit_reached",
  }
}

/** Corte intra-fase do MH2.2 (o runPhase real devolve isto ao cruzar o teto). */
function tetoFail(costUsd: number): PhaseResult {
  return {
    ok: false,
    items: [],
    costUsd,
    costSource: "estimated",
    error: "teto de custo da missão atingido durante a fase",
    budgetExceeded: true,
  }
}

/** Evento de custo no formato real do codex (estimado a partir dos tokens). */
function codexCost(attempt: number, costUsd: number): CostEvent {
  return {
    attempt,
    costUsd,
    costSource: "estimated",
    input: 51_022,
    output: 7_310,
    cache: 0,
  }
}

const CONV = "c1"
const PROJ = "proj1"

function launch(pre: MissionPreset): Promise<void> {
  return useMission
    .getState()
    .launch(CONV, pre, "tarefa", PROJ, "/tmp/proj", "padrao")
}

function run() {
  return useMission.getState().byConv[CONV]
}

async function waitFor(cond: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 0))
  }
  throw new Error("condição não satisfeita a tempo")
}

beforeEach(() => {
  h.steps = []
  h.calls = []
  h.ledger = []
  h.gate = null
  vi.clearAllMocks()
  // o teste de best-effort troca a implementação (rejeita) — restaura aqui.
  vi.mocked(recordTurnCost).mockImplementation(async (r) => {
    h.ledger.push(r as (typeof h.ledger)[number])
  })
  useMission.setState({ byConv: {} })
  useChat.setState({ byId: {} })
})

describe("MH2.1 · ledger de custo por fase (turn_costs)", () => {
  it("missão FALHADA ainda grava o custo de TODAS as fases que rodaram (o gasto foi real)", async () => {
    h.steps = [
      { result: ok(0.5), costEvents: [codexCost(1, 0.5)] },
      { result: bugFail(0.3), costEvents: [codexCost(1, 0.3)] },
    ]
    await launch(
      preset([phaseDef({ id: "a" }), phaseDef({ id: "b", agent: "claude-code" })]),
    )
    expect(run().status).toBe("error")
    expect(h.ledger).toHaveLength(2)
    expect(h.ledger[0]).toMatchObject({
      projectId: PROJ,
      convId: CONV,
      agent: "codex",
      costUsd: 0.5,
      costSource: "estimated",
      input: 51_022,
    })
    // a fase que FALHOU também está no ledger (missão morta não some custo).
    expect(h.ledger[1]).toMatchObject({ agent: "claude-code", costUsd: 0.3 })
    // fases distintas nunca dividem run_id.
    expect(h.ledger[0].runId).not.toBe(h.ledger[1].runId)
  })

  it("dedup de retry: tentativas distintas = linhas distintas; parciais da MESMA tentativa reusam o run_id (REPLACE colapsa o cumulativo)", async () => {
    h.steps = [
      {
        result: ok(0.8),
        costEvents: [
          // tentativa 1: parcial 0.2 e cumulativo 0.5 (padrão do CLI) — MESMO
          // run_id, o REPLACE do banco fica só com o total da tentativa.
          codexCost(1, 0.2),
          codexCost(1, 0.5),
          // tentativa 2 (retry): gasto PRÓPRIO → linha própria.
          codexCost(2, 0.3),
        ],
      },
    ]
    await launch(preset([phaseDef({ maxRetries: 2 })]))
    expect(h.ledger).toHaveLength(3)
    expect(h.ledger[0].runId).toBe(h.ledger[1].runId)
    expect(h.ledger[2].runId).not.toBe(h.ledger[0].runId)
  })

  it("re-run de recovery gera linha própria (nunca sobrescreve o gasto da invocação anterior)", async () => {
    h.steps = [
      { result: limitFail(0.4), costEvents: [codexCost(1, 0.4)] },
      { result: ok(0.6), costEvents: [codexCost(1, 0.6)] },
    ]
    const p = launch(preset([phaseDef()]))
    await waitFor(() => !!run()?.recovery)
    useMission
      .getState()
      .resolveRecovery(CONV, { agent: "claude-code", model: null, effort: null })
    await p
    expect(run().status).toBe("done")
    expect(h.ledger).toHaveLength(2)
    // mesma fase, invocações diferentes → run_ids diferentes (attempt 1 nas
    // duas; sem o sufixo de invocação o REPLACE apagaria o gasto da primeira).
    expect(h.ledger[0].runId).not.toBe(h.ledger[1].runId)
  })

  it("gravar o ledger é best-effort: falha do banco não derruba a fase", async () => {
    vi.mocked(recordTurnCost).mockRejectedValue(new Error("db fechado"))
    h.steps = [{ result: ok(0.5), costEvents: [codexCost(1, 0.5)] }]
    await launch(preset([phaseDef()]))
    expect(run().status).toBe("done")
  })
})

describe("MH2.2 · teto dentro da fase (lado do store)", () => {
  it("passa o teto RESTANTE pro runPhase (maxCostUsd menos o já gasto)", async () => {
    h.steps = [{ result: ok(0.4) }, { result: ok(0.2) }]
    await launch(preset([phaseDef({ id: "a" }), phaseDef({ id: "b" })], 1.0))
    expect(h.calls[0].stopAtCostUsd).toBeCloseTo(1.0)
    expect(h.calls[1].stopAtCostUsd).toBeCloseTo(0.6)
  })

  it("sem teto no preset, runPhase roda sem stopAtCostUsd (nada de corte)", async () => {
    h.steps = [{ result: ok(0.4) }]
    await launch(preset([phaseDef()], null))
    expect(h.calls[0].stopAtCostUsd).toBeNull()
  })

  it("budgetExceeded → MESMO desfecho de teto do check entre fases, com notice dizendo onde mordeu", async () => {
    h.steps = [
      { result: tetoFail(1.4), costEvents: [codexCost(1, 1.4)] },
      { result: ok(0.1) },
    ]
    await launch(preset([phaseDef({ id: "a" }), phaseDef({ id: "b" })], 1.0))
    const r = run()
    expect(r.status).toBe("error")
    expect(r.phases[0].status).toBe("error")
    expect(r.phases[0].error).toBe("teto de US$ 1.00 atingido durante a fase 1")
    // o custo REAL gasto até o corte fica registrado (fase e missão).
    expect(r.costTotal).toBeCloseTo(1.4)
    // a fase 2 nunca rodou (o dinheiro parou de sair).
    expect(h.calls).toHaveLength(1)
    // e o gasto do corte está no ledger (MH2.1 cobre até o estouro).
    expect(h.ledger).toHaveLength(1)
    expect(notifyMissionEnd).toHaveBeenCalledTimes(1)
    expect(notifyMissionEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "teto",
        detail: "teto de US$ 1.00 atingido durante a fase 1",
      }),
    )
  })

  it("teto estourado NUNCA vira card de recuperação (mesmo com rastro de limite no transcript)", async () => {
    h.steps = [
      {
        result: {
          ...tetoFail(1.2),
          items: [{ kind: "limit", id: "l1", message: "limite da CLI" }],
        },
      },
    ]
    await launch(preset([phaseDef()], 1.0))
    expect(run().status).toBe("error")
    expect(run().recovery ?? null).toBeNull()
  })
})

describe("MH2.3 · notificação de desfecho (uma por missão; ADR-013)", () => {
  it("fim ok notifica UMA vez com outcome 'concluida'", async () => {
    h.steps = [{ result: ok(0.5) }]
    await launch(preset([phaseDef()]))
    expect(notifyMissionEnd).toHaveBeenCalledTimes(1)
    expect(notifyMissionEnd).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "concluida", costUsd: 0.5 }),
    )
  })

  it("fim com ressalva do revisor (MH1.1) notifica 'ressalva'", async () => {
    h.steps = [
      {
        result: ok(0.2, [
          textItem("NÃO APROVADO: o diff está vazio, nada foi implementado."),
        ]),
      },
    ]
    await launch(
      preset([phaseDef({ id: "review", label: "Revisar", persona: "reviewer" })]),
    )
    expect(run().reviewCaveat).toBeTruthy()
    expect(notifyMissionEnd).toHaveBeenCalledTimes(1)
    expect(notifyMissionEnd).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "ressalva" }),
    )
  })

  it("falha de fase notifica 'falha' UMA vez, com o motivo", async () => {
    h.steps = [{ result: bugFail(0.3) }]
    await launch(preset([phaseDef()]))
    expect(notifyMissionEnd).toHaveBeenCalledTimes(1)
    expect(notifyMissionEnd).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: "falha",
        detail: "erro de compilação no arquivo x",
      }),
    )
  })

  it("teto entre fases (checkBudget) também notifica 'teto'", async () => {
    h.steps = [{ result: ok(2.0) }, { result: ok(0.1) }]
    await launch(preset([phaseDef({ id: "a" }), phaseDef({ id: "b" })], 1.5))
    expect(run().status).toBe("error")
    expect(notifyMissionEnd).toHaveBeenCalledTimes(1)
    expect(notifyMissionEnd).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "teto" }),
    )
  })

  it("abort do usuário NÃO notifica desfecho (gesto seu não precisa de aviso)", async () => {
    let release: () => void = () => {}
    h.gate = new Promise((r) => {
      release = r
    })
    h.steps = [{ result: ok(0.5) }]
    const p = launch(preset([phaseDef()]))
    await waitFor(() => run()?.status === "running")
    useMission.getState().abort(CONV)
    release()
    await p
    expect(run().status).toBe("aborted")
    expect(notifyMissionEnd).not.toHaveBeenCalled()
  })

  it("recovery pendente avisa quando ABRE (1 por episódio; re-falha é episódio novo)", async () => {
    h.steps = [
      { result: limitFail(0.2) },
      { result: limitFail(0.2) },
      { result: ok(0.3) },
    ]
    const p = launch(preset([phaseDef({ label: "Executar" })]))
    await waitFor(() => !!run()?.recovery)
    expect(notifyMissionRecovery).toHaveBeenCalledTimes(1)
    expect(notifyMissionRecovery).toHaveBeenCalledWith(CONV, "", "Executar")
    // re-run re-falha por limite → episódio NOVO, segundo aviso.
    useMission
      .getState()
      .resolveRecovery(CONV, { agent: "claude-code", model: null, effort: null })
    // espera o episódio ANTIGO fechar e o novo abrir (o resolve é assíncrono:
    // logo após o resolveRecovery o recovery velho ainda está no estado).
    await waitFor(
      () => vi.mocked(notifyMissionRecovery).mock.calls.length === 2,
    )
    await waitFor(() => !!run()?.recovery)
    expect(notifyMissionRecovery).toHaveBeenCalledTimes(2)
    useMission
      .getState()
      .resolveRecovery(CONV, { agent: "codex", model: null, effort: null })
    await p
    expect(run().status).toBe("done")
    // desfecho ok da mesma missão ainda avisa (recovery não "gasta" o fim).
    expect(notifyMissionEnd).toHaveBeenCalledTimes(1)
  })

  it("recuperação abandonada (desistir) notifica 'falha'", async () => {
    h.steps = [{ result: limitFail(0.2) }]
    const p = launch(preset([phaseDef()]))
    await waitFor(() => !!run()?.recovery)
    useMission.getState().abortRecovery(CONV)
    await p
    expect(run().status).toBe("error")
    expect(notifyMissionEnd).toHaveBeenCalledTimes(1)
    expect(notifyMissionEnd).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "falha" }),
    )
  })
})
