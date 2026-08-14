// R7 — o vocabulário de intervenção, do lado do motor.
//
// "Pausar" não existe (não há pausa de um turno de agent). O que existe é
// SEGURAR no fim da fase (reversível, nada é interrompido) e INTERROMPER esta
// fase (irreversível, mata o processo). A distinção que este arquivo protege é
// a mais cara de todas: interromper UMA fase não pode matar a MISSÃO — matar
// tudo já tem gesto próprio, e se chama Parar.
//
// Mesmo arranjo do mission.recovery.test.ts: só o runPhase é mocado.

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult } from "@/lib/mission"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"

const h = vi.hoisted(() => ({
  results: [] as PhaseResult[],
  /** Segura a fase "rodando" até o teste mandar (o mock volta rápido demais
   *  pra dar tempo de observar o estado intermediário sem isto). */
  segura: null as null | Promise<void>,
  solta: null as null | (() => void),
  /** fases que o mock chegou a rodar. */
  ran: [] as string[],
  cancels: [] as string[],
}))

vi.mock("@/lib/mission", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/mission")>()
  return {
    ...mod,
    runPhase: vi.fn(async (args: import("@/lib/mission").RunPhaseArgs) => {
      h.ran.push(args.runId)
      if (h.segura) {
        const espera = h.segura
        h.segura = null
        await espera
      }
      return (
        h.results.shift() ?? {
          ok: true,
          items: [],
          costUsd: 0,
          costSource: undefined,
        }
      )
    }),
  }
})

vi.mock("@/lib/agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agent")>()
  return {
    ...mod,
    cancelAgent: vi.fn(async (id: string) => {
      h.cancels.push(id)
    }),
  }
})

import { useMission } from "./mission"

function phaseDef(over: Partial<MissionPhaseDef> = {}): MissionPhaseDef {
  return {
    id: over.id ?? "p",
    label: "Fase",
    persona: "executor",
    agent: "claude-code",
    model: null,
    effort: null,
    maxRetries: 1,
    ...over,
  }
}

const preset: MissionPreset = {
  id: "t",
  name: "Teste",
  phases: [phaseDef({ id: "a" }), phaseDef({ id: "b" }), phaseDef({ id: "c" })],
  maxCostUsd: null,
}

const CONV = "c-hold"

function run() {
  return useMission.getState().byConv[CONV]
}

/** Arma o freio da PRÓXIMA fase: ela fica "running" até `h.solta()`. */
function segurarProximaFase(): void {
  h.segura = new Promise<void>((r) => {
    h.solta = r
  })
}

async function waitFor(cond: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 0))
  }
  throw new Error("condição não satisfeita a tempo")
}

beforeEach(() => {
  h.results = []
  h.ran = []
  h.cancels = []
  h.segura = null
  h.solta = null
  useMission.setState({ byConv: {} })
})

describe("R7 · segurar no fim desta fase (reversível)", () => {
  it("a missão para ANTES da próxima fase, e nenhuma é interrompida", async () => {
    const p = useMission
      .getState()
      .launch(CONV, preset, "tarefa", "proj", "/tmp/p", "padrao")
    await waitFor(() => run() != null)
    useMission.getState().holdAfterPhase(CONV, true)
    await waitFor(() => run()?.hold?.reason === "pedido" && h.ran.length >= 1)
    // a fase 1 rodou inteira; a 2 não começou.
    await waitFor(() => run()?.phases[0].status === "done")
    expect(run()?.status).toBe("running")
    expect(h.ran).toHaveLength(1)
    expect(h.cancels).toHaveLength(0)

    useMission.getState().releaseHold(CONV)
    await p
    expect(run()?.status).toBe("done")
    expect(h.ran).toHaveLength(3)
  })

  it("desligar o pedido antes da fase acabar é livre (é um interruptor)", async () => {
    const p = useMission
      .getState()
      .launch(CONV, preset, "tarefa", "proj", "/tmp/p", "padrao")
    await waitFor(() => run() != null)
    useMission.getState().holdAfterPhase(CONV, true)
    useMission.getState().holdAfterPhase(CONV, false)
    await p
    expect(run()?.status).toBe("done")
    expect(h.ran).toHaveLength(3)
  })
})

describe("R7 · interromper ESTA fase (irreversível, mas não mata a missão)", () => {
  it("a fase fica aborted e a missão SEGURA em vez de ir a error", async () => {
    // o cancelamento chega ao loop como falha comum; a marca de intenção é o
    // que separa "o motor quebrou" de "você mandou parar esta fase".
    h.results = [
      { ok: false, items: [], costUsd: 0.5, costSource: "reported", error: "fase cancelada" },
    ]
    segurarProximaFase()
    const p = useMission
      .getState()
      .launch(CONV, preset, "tarefa", "proj", "/tmp/p", "padrao")
    await waitFor(() => run()?.phases[0].status === "running")
    useMission.getState().interruptPhase(CONV)
    h.solta?.()
    await waitFor(() => run()?.hold?.reason === "interrompida")

    expect(run()?.status).toBe("running") // NÃO virou error
    expect(run()?.phases[0].status).toBe("aborted")
    expect(run()?.phases[0].error).toBe("interrompida por você")
    // o gasto da fase interrompida é real e fica contabilizado
    expect(run()?.costTotal).toBeCloseTo(0.5)
    // o fim congelou (a fase tem duração, mesmo incompleta)
    expect(run()?.phases[0].endedAt).toBeGreaterThan(0)
    // e o processo foi de fato morto
    expect(h.cancels).toHaveLength(1)

    useMission.getState().releaseHold(CONV)
    await p
    expect(run()?.status).toBe("done")
    // as duas fases seguintes rodaram sobre o que ficou no worktree
    expect(h.ran).toHaveLength(3)
  })

  it("falha de VERDADE (sem gesto humano) continua matando a missão", async () => {
    // a régua velha não pode afrouxar: bug do motor segue sendo error.
    h.results = [
      { ok: false, items: [], costUsd: 0, costSource: undefined, error: "erro de compilação" },
    ]
    await useMission
      .getState()
      .launch(CONV, preset, "tarefa", "proj", "/tmp/p", "padrao")
    expect(run()?.status).toBe("error")
    expect(run()?.hold ?? null).toBeNull()
  })

  it("Parar a missão durante o hold desiste de vez (não fica pendurado)", async () => {
    h.results = [
      { ok: false, items: [], costUsd: 0, costSource: undefined, error: "fase cancelada" },
    ]
    segurarProximaFase()
    const p = useMission
      .getState()
      .launch(CONV, preset, "tarefa", "proj", "/tmp/p", "padrao")
    await waitFor(() => run()?.phases[0].status === "running")
    useMission.getState().interruptPhase(CONV)
    h.solta?.()
    await waitFor(() => run()?.hold?.reason === "interrompida")
    useMission.getState().abort(CONV)
    await p
    expect(run()?.status).toBe("aborted")
    expect(h.ran).toHaveLength(1)
  })
})
