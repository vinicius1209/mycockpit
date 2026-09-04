// Automação de PLANO DE VOO: o loop agêntico disparado por horário.
//
// O que este arquivo protege são as TRÊS PORTAS DE PAUSA. Uma missão lançada
// pelo botão pode parar e esperar você (gate, recuperação, o modal do
// worktree) — é o comportamento certo com alguém na frente. A MESMA missão às
// 3h da manhã, parada esperando, é uma missão morta que o app segue exibindo
// como viva: o pior desfecho possível pra uma casa que proíbe teatro de
// estado. Fechar as três é o que faz "eu agendei" significar "vai rodar".

import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  /** O `ask` do ensureMissionCwd nunca pode ser CHAMADO num disparo agendado:
   *  ele abre um modal que ninguém veria. */
  createWorktree: vi.fn(async (_p: string, _c: string) => ({
    path: "/wt/alpha",
    branch: "mission/alpha",
  })),
  confirmChamado: vi.fn(),
}))

vi.mock("@/lib/git", () => ({ createWorktree: h.createWorktree }))
vi.mock("@/lib/confirm", () => ({ confirm: h.confirmChamado }))
vi.mock("@/lib/db", async (orig) => ({
  ...(await orig<typeof import("@/lib/db")>()),
  isTauri: () => true,
}))

import type { MissionPreset } from "@/lib/missionTypes"
import type { ScheduleRecord } from "@/lib/db"
import type { Project } from "@/lib/types"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useMission } from "@/store/mission"
import {
  dispatchMissionSchedule,
  findPlan,
  missionOutcome,
  unattendedPreset,
} from "./scheduleMission"

const PROJECT: Project = {
  id: "p1",
  name: "alpha",
  path: "/proj/alpha",
  createdAt: 1,
}

function plan(over: Partial<MissionPreset> = {}): MissionPreset {
  return {
    id: "preset-abc",
    revision: 1,
    name: "Rota padrão",
    gatePolicy: "agente",
    maxCostUsd: 5,
    phases: [
      {
        id: "plan",
        label: "Planejar",
        persona: "planner",
        agent: "claude-code",
        model: null,
        effort: null,
        maxRetries: 1,
      },
    ],
    ...over,
  }
}

function schedule(over: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    id: "s1",
    name: "faxina noturna",
    projectId: "p1",
    kind: "mission",
    agent: "claude-code",
    model: null,
    effort: null,
    planId: "preset-abc",
    prompt: "limpa o que der pra limpar",
    permission: "auto",
    recurrence: JSON.stringify({ kind: "daily", hour: 3, minute: 0 }),
    enabled: true,
    nextRun: null,
    lastRunAt: null,
    lastRunStatus: null,
    completedAt: null,
    createdAt: 0,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  useApp.setState({
    projects: [PROJECT],
    settings: { ...useApp.getState().settings, missionPresets: [plan()] },
  })
  useChat.setState({
    byId: { c1: { worktreePath: null } } as never,
    setWorktree: vi.fn(),
  })
  useMission.setState({ byConv: {}, interrupted: {} })
})

describe("porta 1 — o GATE não pode existir num disparo agendado", () => {
  it("o preset efetivo troca a política do plano por 'nunca'", () => {
    // gate aberto às 3h = missão parada pra sempre esperando resposta.
    expect(unattendedPreset(plan({ gatePolicy: "agente" })).gatePolicy).toBe(
      "nunca",
    )
    expect(
      unattendedPreset(plan({ gatePolicy: "sempre-apos-planejar" })).gatePolicy,
    ).toBe("nunca")
  })

  it("o resto do plano do usuário atravessa intacto (fases, teto, nome)", () => {
    const p = plan()
    const efetivo = unattendedPreset(p)
    expect(efetivo.phases).toEqual(p.phases)
    expect(efetivo.maxCostUsd).toBe(5)
    expect(efetivo.name).toBe(p.name)
  })
})

describe("porta 3 — o modal do worktree não pode aparecer", () => {
  it("o worktree é criado ANTES do launch e ligado na conversa", async () => {
    const launch = vi.fn(async () => {})
    useMission.setState({ launch } as never)

    await dispatchMissionSchedule(schedule(), {
      convId: "c1",
      project: PROJECT,
      permission: "auto",
    })

    expect(h.createWorktree).toHaveBeenCalledWith("/proj/alpha", "c1")
    expect(useChat.getState().setWorktree).toHaveBeenCalledWith("c1", "/wt/alpha")
    expect(h.confirmChamado).not.toHaveBeenCalled()
  })

  it("worktree que falha NÃO cai na pasta do projeto: a automação falha com a causa", async () => {
    h.createWorktree.mockRejectedValueOnce("branch já existe")
    const launch = vi.fn(async () => {})
    useMission.setState({ launch } as never)

    const out = await dispatchMissionSchedule(schedule(), {
      convId: "c1",
      project: PROJECT,
      permission: "auto",
    })

    // escrever no repositório real por um modal que ninguém viu é justamente o
    // que o fail-closed no efeito proíbe.
    expect(launch).not.toHaveBeenCalled()
    expect(h.confirmChamado).not.toHaveBeenCalled()
    expect(out.status).toBe("failed")
    expect(out.error).toMatch(/worktree/i)
  })
})

describe("o plano precisa existir", () => {
  it("plano apagado depois do agendamento falha com a causa escrita", async () => {
    useApp.setState({
      settings: { ...useApp.getState().settings, missionPresets: [] },
    })
    const launch = vi.fn(async () => {})
    useMission.setState({ launch } as never)

    const out = await dispatchMissionSchedule(schedule(), {
      convId: "c1",
      project: PROJECT,
      permission: "auto",
    })

    // NUNCA degrada pra "roda o prompt solto": seria despachar um agent que
    // ninguém configurou.
    expect(launch).not.toHaveBeenCalled()
    expect(out.status).toBe("failed")
    expect(out.error).toMatch(/Plano de voo/)
    expect(findPlan("preset-abc")).toBeNull()
  })
})

describe("desfecho da missão → desfecho da automação", () => {
  it("done vira ok com o custo total da missão", () => {
    const out = missionOutcome(
      { status: "done", costTotal: 1.25, phases: [] },
      "c1",
    )
    expect(out).toEqual({ status: "ok", cost: 1.25, convId: "c1", error: null })
  })

  it("error carrega a fase que falhou e o motivo dela", () => {
    const out = missionOutcome(
      {
        status: "error",
        costTotal: 0.4,
        phases: [
          { status: "done", def: { label: "Planejar" } },
          {
            status: "error",
            error: "teto de custo estourado",
            def: { label: "Executar" },
          },
        ],
      },
      "c1",
    )
    expect(out.status).toBe("failed")
    expect(out.cost).toBe(0.4)
    expect(out.error).toBe("Fase “Executar”: teto de custo estourado")
  })

  it("missão que nem chegou ao store não vira 'ok' por omissão", () => {
    const out = missionOutcome(undefined, "c1")
    expect(out.status).toBe("failed")
    expect(out.error).toMatch(/não chegou a largar/)
  })
})

describe("porta 2 — recuperação pendente é desistida, não esperada", () => {
  it("recovery aberto durante a missão agendada dispara abortRecovery", async () => {
    const abortRecovery = vi.fn()
    // launch que ABRE um recovery no meio (o card "escolha outro motor") e só
    // depois resolve: sem o observador, o store ficaria esperando pra sempre.
    const launch = vi.fn(async () => {
      useMission.setState((s) => ({
        byConv: {
          ...s.byConv,
          c1: {
            status: "running",
            costTotal: 0,
            phases: [],
            recovery: { phase: 0, error: "limite", message: "troque o motor" },
          } as never,
        },
      }))
      await Promise.resolve()
    })
    useMission.setState({ launch, abortRecovery } as never)

    await dispatchMissionSchedule(schedule(), {
      convId: "c1",
      project: PROJECT,
      permission: "auto",
    })

    expect(abortRecovery).toHaveBeenCalledWith("c1")
  })

  it("o observador MORRE com a missão: recovery de uma missão manual depois não é abortado", async () => {
    const abortRecovery = vi.fn()
    const launch = vi.fn(async () => {})
    useMission.setState({ launch, abortRecovery } as never)

    await dispatchMissionSchedule(schedule(), {
      convId: "c1",
      project: PROJECT,
      permission: "auto",
    })
    abortRecovery.mockClear()

    // a MESMA conversa abre recovery mais tarde, agora com você na frente.
    useMission.setState((s) => ({
      byConv: {
        ...s.byConv,
        c1: {
          status: "running",
          costTotal: 0,
          phases: [],
          recovery: { phase: 0, error: "limite", message: "troque o motor" },
        } as never,
      },
    }))

    expect(abortRecovery).not.toHaveBeenCalled()
  })
})
