// MH1.2 — vigia de FASE DE MISSÃO muda: a missão NÃO seta `running` na
// conversa (o pipeline vive no useMission), então uma fase travada (CLI
// pendurada, socket morto) rodava "para sempre" sem nenhum aviso — invisível
// pro checkStalledTurns. checkStalledMissions é outra passada do MESMO ticker:
// fase corrente running sem NENHUM item novo além do limiar
// (settings.stalledAfterMin) avisa UMA vez por episódio; gate/recovery e
// pedido de permissão pendente são "esperando você", nunca mudo.

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))
vi.mock("@/lib/notify", () => ({
  notifyTurnStalled: vi.fn(),
  notifyCardStalled: vi.fn(),
  notifyMissionStalled: vi.fn(),
  notifyUnattendedTimeout: vi.fn(),
  notifyApproval: vi.fn(),
  notifyQuestion: vi.fn(),
  notifyGate: vi.fn(),
  nativeNotify: vi.fn(async () => {}),
}))
vi.mock("@/lib/agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agent")>()
  return { ...mod, cancelAgent: vi.fn(async () => {}) }
})

import { toast } from "sonner"
import { notifyMissionStalled } from "@/lib/notify"
import type {
  MissionPhaseDef,
  MissionPhaseRun,
  MissionRun,
} from "@/lib/missionTypes"
import type { InteractionRequest } from "@/lib/interaction"
import { useApp } from "@/store/app"
import { useChat, type ChatItem } from "@/store/chat"
import { useInteractions } from "@/store/interactions"
import { useMission } from "@/store/mission"
import { _resetWatchdogState, checkStalledMissions } from "./watchdog"

const T0 = 1_700_000_000_000
const MIN = 60_000

let n = 0
function textItem(text = "trabalhando…"): ChatItem {
  return { kind: "text", id: `t${n++}`, text }
}

function phaseDef(over: Partial<MissionPhaseDef> = {}): MissionPhaseDef {
  return {
    id: "p",
    label: "Executar",
    persona: "executor",
    agent: "codex",
    model: null,
    effort: null,
    maxRetries: 1,
    ...over,
  }
}

function phase(over: Partial<MissionPhaseRun> = {}): MissionPhaseRun {
  return {
    def: phaseDef(),
    status: "running",
    attempt: 1,
    costUsd: 0,
    startedAt: T0,
    items: [textItem()],
    ...over,
  }
}

function missionRun(over: Partial<MissionRun> = {}): MissionRun {
  return {
    id: "m1",
    convId: "c1",
    presetName: "Teste",
    task: "tarefa",
    dir: ".mycockpit/missions/x",
    phases: [phase()],
    current: 0,
    costTotal: 0,
    maxCostUsd: null,
    status: "running",
    startedAt: T0,
    gate: null,
    recovery: null,
    ...over,
  }
}

/** Troca os itens da fase corrente (simula progresso do onProgress). */
function pushPhaseItem(convId: string, item: ChatItem): void {
  const run = useMission.getState().byConv[convId]
  useMission.setState({
    byConv: {
      ...useMission.getState().byConv,
      [convId]: {
        ...run,
        phases: run.phases.map((p, i) =>
          i === run.current ? { ...p, items: [...(p.items ?? []), item] } : p,
        ),
      },
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetWatchdogState()
  useChat.setState({ byId: {} })
  useMission.setState({ byConv: {} })
  useInteractions.setState({ queue: [] })
  useApp.getState().setSettings({ stalledAfterMin: 10 })
})

describe("checkStalledMissions (MH1.2)", () => {
  it("fase com ferramenta estática é avisada após uma janela sem progresso", () => {
    const active: ChatItem = {
      kind: "tool",
      id: "330585d6-21f1-4fd5-a5f6-63647be48bce",
      name: "run_command",
      input: {},
      toolId: "agy-step-94",
    }
    useMission.setState({
      byConv: { c1: missionRun({ phases: [phase({ items: [active] })] }) },
    })
    checkStalledMissions(T0)
    checkStalledMissions(T0 + 10 * MIN)
    expect(notifyMissionStalled).toHaveBeenCalledWith(
      "c1",
      "codex",
      "Executar",
      10,
    )
  })

  it("fase muda além do limiar dispara UMA vez (nativa + toast com Parar missão)", () => {
    useMission.setState({ byConv: { c1: missionRun() } })
    checkStalledMissions(T0) // baseline
    checkStalledMissions(T0 + 9 * MIN)
    expect(notifyMissionStalled).not.toHaveBeenCalled()

    checkStalledMissions(T0 + 10 * MIN)
    expect(notifyMissionStalled).toHaveBeenCalledTimes(1)
    expect(notifyMissionStalled).toHaveBeenCalledWith(
      "c1",
      "codex",
      "Executar",
      10,
    )
    expect(toast).toHaveBeenCalledTimes(1)
    // o toast oferece o Stop REAL da missão, não um dismiss
    const opts = (toast as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0][1] as { cancel: { label: string } }
    expect(opts.cancel.label).toBe("Parar missão")

    // silêncio continuado NÃO re-avisa (1 por episódio)
    checkStalledMissions(T0 + 20 * MIN)
    checkStalledMissions(T0 + 60 * MIN)
    expect(notifyMissionStalled).toHaveBeenCalledTimes(1)
  })

  it("progresso da fase (item novo do onProgress) fecha o episódio; mudo por OUTRO período re-avisa", () => {
    useMission.setState({ byConv: { c1: missionRun() } })
    checkStalledMissions(T0)
    checkStalledMissions(T0 + 10 * MIN)
    expect(notifyMissionStalled).toHaveBeenCalledTimes(1)

    pushPhaseItem("c1", textItem("voltei a trabalhar"))
    checkStalledMissions(T0 + 12 * MIN)
    // silêncio parcial não dispara…
    checkStalledMissions(T0 + 21 * MIN)
    expect(notifyMissionStalled).toHaveBeenCalledTimes(1)
    // …outro período COMPLETO dispara de novo
    checkStalledMissions(T0 + 22 * MIN)
    expect(notifyMissionStalled).toHaveBeenCalledTimes(2)
  })

  it("troca de fase re-arma o cronômetro (fase nova = atividade)", () => {
    useMission.setState({
      byConv: {
        c1: missionRun({
          phases: [phase({ status: "done" }), phase()],
          current: 0,
        }),
      },
    })
    // fase 0 done: nada vigiado
    checkStalledMissions(T0)
    // avançou pra fase 1 (mesmos items da factory)
    const run = useMission.getState().byConv.c1
    useMission.setState({ byConv: { c1: { ...run, current: 1 } } })
    checkStalledMissions(T0 + 5 * MIN) // baseline da fase nova
    checkStalledMissions(T0 + 14 * MIN) // 9min da fase nova: nada
    expect(notifyMissionStalled).not.toHaveBeenCalled()
    checkStalledMissions(T0 + 15 * MIN) // 10min: agora sim
    expect(notifyMissionStalled).toHaveBeenCalledTimes(1)
  })

  it("gate pendente NÃO é mudo (esperando você, causa conhecida e notificada)", () => {
    useMission.setState({
      byConv: {
        c1: missionRun({ gate: { phase: 0, questions: ["Qual porta?"] } }),
      },
    })
    checkStalledMissions(T0)
    checkStalledMissions(T0 + 60 * MIN)
    expect(notifyMissionStalled).not.toHaveBeenCalled()
  })

  it("recovery pendente NÃO é mudo (o card de troca de agent já cobra você)", () => {
    useMission.setState({
      byConv: {
        c1: missionRun({
          recovery: { phase: 0, error: "limit_reached", message: "limite" },
          phases: [phase({ status: "error" })],
        }),
      },
    })
    checkStalledMissions(T0)
    checkStalledMissions(T0 + 60 * MIN)
    expect(notifyMissionStalled).not.toHaveBeenCalled()
  })

  it("pedido de permissão pendente da missão segura o aviso (bloqueada ≠ muda)", () => {
    useMission.setState({ byConv: { c1: missionRun() } })
    // pedido do backend com o run_id da FASE (ownerByRunId resolve a conversa)
    const req: InteractionRequest = {
      id: "req1",
      run_id: "m1::phase-0",
      kind: "approval",
      data: { tool_name: "Bash", command: "rm -rf dist", input: {} },
    }
    useInteractions.setState({ queue: [req] })
    checkStalledMissions(T0)
    checkStalledMissions(T0 + 60 * MIN)
    expect(notifyMissionStalled).not.toHaveBeenCalled()

    // pedido respondido (fila esvaziou): o agent ganha a janela COMPLETA de
    // novo (a espera re-ancorou o cronômetro; sua demora não vira "mudo")…
    useInteractions.setState({ queue: [] })
    checkStalledMissions(T0 + 65 * MIN) // 5min desde a última re-âncora: nada
    expect(notifyMissionStalled).not.toHaveBeenCalled()
    // …mas fase que segue muda após o pedido avisa depois do limiar cheio
    checkStalledMissions(T0 + 70 * MIN) // 10min desde T0+60
    expect(notifyMissionStalled).toHaveBeenCalledTimes(1)
  })

  it("missão done/abortada não é vigiada e não deixa marca órfã", () => {
    useMission.setState({ byConv: { c1: missionRun() } })
    checkStalledMissions(T0)
    // terminou: sai da vigilância sem avisar
    const run = useMission.getState().byConv.c1
    useMission.setState({
      byConv: {
        c1: {
          ...run,
          status: "done",
          phases: [phase({ status: "done" })],
          current: 1,
        },
      },
    })
    checkStalledMissions(T0 + 60 * MIN)
    expect(notifyMissionStalled).not.toHaveBeenCalled()

    // missão limpa (clear): marca some do mapa (sem vazamento)
    useMission.setState({ byConv: {} })
    checkStalledMissions(T0 + 61 * MIN)
    expect(notifyMissionStalled).not.toHaveBeenCalled()
  })

  it("setting 0 desliga o vigia de missões (mesmo contrato dos turnos)", () => {
    useApp.getState().setSettings({ stalledAfterMin: 0 })
    useMission.setState({ byConv: { c1: missionRun() } })
    checkStalledMissions(T0)
    checkStalledMissions(T0 + 120 * MIN)
    expect(notifyMissionStalled).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })
})
