// MH1.2 — o CICLO COMPLETO que o plano promete (não só a marcação): uma fase
// de missão pede permissão, ninguém responde, o limiar vence ⇒
// checkUnattendedInteractions nega FAIL-CLOSED pela fila REAL de interações
// (useInteractions.answer → answerInteraction) e a missão destrava — segue e
// termina honesta (done ou error com marco), nunca pendurada pra sempre.
// Também prova a guarda ANTI-DUPLO-START: nunca existem duas missões da mesma
// conversa (fase rodando OU gate aberto), então "fase muda + gate aberto em
// missões diferentes da mesma conversa" é estado impossível por construção.
//
// Modelado no watchdog.unattended.test.ts (fila real, answerInteraction
// espiado, payloads reais de approval) + mission.unattended.test.ts (registro
// real de unattendedRuns; runPhase mocado simulando o BACKEND: enfileira o
// pedido com o run_id da fase e bloqueia até a resposta chegar — o mesmo
// contrato do approval.rs, que espera sem timeout).

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult, RunPhaseArgs } from "@/lib/mission"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"
import type { HandoffDoc } from "@/lib/missionHandoff"

const h = vi.hoisted(() => ({
  /** Comportamento por invocação do runPhase (shift); default = ok imediato. */
  impls: [] as ((args: RunPhaseArgs) => Promise<PhaseResult>)[],
  calls: [] as { runId: string; agent: string }[],
  /** Handoff da fase 0 (gate humano) — null = sem perguntas. */
  gateDoc: null as HandoffDoc | null,
}))

vi.mock("@/lib/avisos", async () => (await import("@/test/avisosFalsos")).moduloDeAvisosFalsos())
vi.mock("@/lib/notify", () => ({
  nativeNotify: vi.fn(async () => {}),
  notifyTurnEnd: vi.fn(),
  notifyGate: vi.fn(),
  _resetMissionEndNotified: vi.fn(),
  notifyMissionEnd: vi.fn(),
  notifyMissionRecovery: vi.fn(),
  notifyApproval: vi.fn(),
  notifyQuestion: vi.fn(),
  notifyUnattendedTimeout: vi.fn(),
  notifyTurnStalled: vi.fn(),
  notifyMissionStalled: vi.fn(),
  notifyCardStalled: vi.fn(),
}))
vi.mock("@/lib/agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agent")>()
  return { ...mod, cancelAgent: vi.fn(async () => {}) }
})
// answerInteraction é o invoke que destrava o turno no backend: espionado.
vi.mock("@/lib/interaction", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/interaction")>()
  return { ...mod, answerInteraction: vi.fn(async () => {}) }
})
vi.mock("@/lib/mission", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/mission")>()
  return {
    ...mod,
    runPhase: vi.fn(async (args: RunPhaseArgs) => {
      h.calls.push({ runId: args.runId, agent: args.agent })
      const impl = h.impls.shift()
      if (impl) return impl(args)
      return { ok: true, items: [], costUsd: 0, costSource: undefined }
    }),
  }
})
// handoff da fase 0 controlável (gate humano); o resto do módulo segue real.
vi.mock("@/lib/missionHandoff", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/missionHandoff")>()
  return {
    ...mod,
    readHandoff: vi.fn(async (_cwd: string, rel: string) =>
      rel.includes("/0-") ? h.gateDoc : null,
    ),
  }
})

import {
  answerInteraction,
  type ApprovalAnswer,
  type InteractionRequest,
} from "@/lib/interaction"
import { notifyUnattendedTimeout } from "@/lib/notify"
import { unattendedRunIds } from "@/lib/unattendedRuns"
import { checkUnattendedInteractions, _resetWatchdogState } from "@/lib/watchdog"
import { useApp } from "@/store/app"
import { useChat, type ChatItem, type ConvState } from "@/store/chat"
import { useInteractions } from "@/store/interactions"
import { useMission } from "./mission"

const T0 = 1_700_000_000_000
const MIN = 60_000
const CONV = "c1"
const PROJ = "proj1"

function phaseDef(over: Partial<MissionPhaseDef> = {}): MissionPhaseDef {
  return {
    id: "p",
    label: "Fase",
    persona: "executor",
    agent: "claude-code",
    model: null,
    effort: null,
    maxRetries: 1,
    ...over,
  }
}

function preset(
  phases: MissionPhaseDef[],
  name = "Teste",
): MissionPreset {
  return { id: name, name, phases, maxCostUsd: null }
}

function ok(costUsd = 0): PhaseResult {
  return { ok: true, items: [], costUsd, costSource: undefined }
}

/** Pedido REAL de aprovação do backend, com o run_id da FASE da missão. */
function aprovacao(runId: string): InteractionRequest {
  return {
    id: "req-m",
    run_id: runId,
    kind: "approval",
    data: { tool_name: "Bash", command: "rm -rf dist", input: {} },
  }
}

/** Simula o backend: enfileira o pedido e BLOQUEIA até a resposta tirá-lo da
 *  fila (approval.rs espera sem timeout), depois devolve `result`. */
function faseQuePedePermissao(result: PhaseResult) {
  return async (args: RunPhaseArgs): Promise<PhaseResult> => {
    useInteractions.setState({
      queue: [...useInteractions.getState().queue, aprovacao(args.runId)],
    })
    await waitFor(
      () => !useInteractions.getState().queue.some((r) => r.id === "req-m"),
      2000,
    )
    return result
  }
}

function seedConv() {
  const conv: ConvState = {
    projectId: PROJ,
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: [],
    sessionId: null,
    model: null,
    streamingTextId: null,
    running: false,
    finalizing: false,
    runId: null,
    startedAt: null,
    suggestions: [],
    suggesting: false,
  }
  useChat.setState({
    projectId: PROJ,
    activeId: CONV,
    conversations: [],
    conversationsByProject: {
      [PROJ]: [
        {
          id: CONV,
          title: "Missão · Teste",
          updatedAt: 0,
          color: null,
          worktreePath: null,
          agent: "claude-code",
        },
      ],
    },
    byId: { [CONV]: conv },
  })
}

function launch(pre: MissionPreset): Promise<void> {
  return useMission
    .getState()
    .launch(CONV, pre, "tarefa", PROJ, "/tmp/proj", "padrao")
}

function run() {
  return useMission.getState().byConv[CONV]
}

function items(): ChatItem[] {
  return useChat.getState().byId[CONV]?.items ?? []
}

function notices(): string[] {
  return items()
    .filter((it) => it.kind === "notice")
    .map((it) => (it as Extract<ChatItem, { kind: "notice" }>).message)
}

async function waitFor(cond: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 0))
  }
  throw new Error("condição não satisfeita a tempo")
}

beforeEach(() => {
  h.impls = []
  h.calls = []
  h.gateDoc = null
  vi.clearAllMocks()
  _resetWatchdogState()
  useMission.setState({ byConv: {}, interrupted: {} })
  useInteractions.setState({ queue: [] })
  useApp.setState({
    projects: [{ id: PROJ, name: "alpha", path: "/tmp/proj", createdAt: 1 }],
  })
  useApp.getState().setSettings({ unattendedAnswerAfterMin: 10 })
  seedConv()
})

describe("MH1.2 · ciclo completo: permissão sem resposta numa fase ⇒ fail-closed e desfecho honesto", () => {
  it("vigia nega pela fila real, a fase destrava e a missão TERMINA (done + rastro no fio)", async () => {
    // fase 0 pede permissão e fica bloqueada; após o deny ela conclui (o CLI
    // seguiu sem o comando negado); fase 1 roda normal.
    h.impls = [faseQuePedePermissao(ok(0.2))]
    const p = launch(
      preset([
        phaseDef({ id: "a", label: "Executar" }),
        phaseDef({ id: "b", label: "Validar" }),
      ]),
    )

    await waitFor(() => useInteractions.getState().queue.length === 1)
    // o pedido carrega o run_id REAL da fase (é ele que liga fila → missão)
    const missionId = run().id
    expect(useInteractions.getState().queue[0].run_id).toBe(
      `${missionId}::phase-0`,
    )

    checkUnattendedInteractions(T0) // 1ª vista: carimba o prazo
    checkUnattendedInteractions(T0 + 9 * MIN)
    expect(answerInteraction).not.toHaveBeenCalled()

    checkUnattendedInteractions(T0 + 10 * MIN)
    expect(answerInteraction).toHaveBeenCalledTimes(1)
    const [id, resposta] = vi.mocked(answerInteraction).mock.calls[0]
    expect(id).toBe("req-m")
    const aprov = resposta as ApprovalAnswer
    expect(aprov.allow).toBe(false)
    expect(aprov.message).toContain("desassistida")

    // a missão DESTRAVOU e terminou honesta — nada pendurado, nada teatro.
    await p
    expect(run().status).toBe("done")
    expect(useInteractions.getState().queue).toHaveLength(0)
    expect(unattendedRunIds().size).toBe(0)
    // rastro do desfecho: notice do deny NO FIO da conversa da missão + sino.
    expect(
      notices().some((m) => m.includes("negada automaticamente")),
    ).toBe(true)
    expect(notifyUnattendedTimeout).toHaveBeenCalledTimes(1)
    expect(vi.mocked(notifyUnattendedTimeout).mock.calls[0][0]).toMatchObject({
      convId: CONV,
      kind: "approval",
    })
    expect(
      items().some((it) => it.kind === "result" && it.ok === true),
    ).toBe(true)
  })

  it("deny que derruba a fase termina a missão em ERROR com marco (fail-closed nunca vira missão pendurada)", async () => {
    h.impls = [
      faseQuePedePermissao({
        ok: false,
        items: [],
        costUsd: 0.1,
        costSource: undefined,
        error: "fase encerrada após permissão negada",
      }),
    ]
    const p = launch(
      preset([
        phaseDef({ id: "a", label: "Executar" }),
        phaseDef({ id: "b", label: "Validar" }),
      ]),
    )
    await waitFor(() => useInteractions.getState().queue.length === 1)
    checkUnattendedInteractions(T0)
    checkUnattendedInteractions(T0 + 10 * MIN)
    await p

    // desfecho HONESTO: error com marco terminal — e a fase 2 nunca rodou às
    // cegas em cima de uma fase que morreu.
    expect(run().status).toBe("error")
    expect(h.calls).toHaveLength(1)
    expect(unattendedRunIds().size).toBe(0)
    const marco = items().find((it) => it.kind === "result") as
      | Extract<ChatItem, { kind: "result" }>
      | undefined
    expect(marco?.ok).toBe(false)
    expect(marco?.text).toContain("Missão interrompida")
  })
})

describe("MH1.2 · guarda anti-duplo-start (uma missão por conversa, sempre)", () => {
  it("com FASE rodando, um segundo launch na mesma conversa é ignorado", async () => {
    let release!: (r: PhaseResult) => void
    h.impls = [() => new Promise<PhaseResult>((res) => (release = res))]
    const p = launch(preset([phaseDef({ id: "a" })], "A"))
    await waitFor(() => h.calls.length === 1)
    const firstId = run().id

    // tentativa de segunda missão com a fase da primeira ainda em voo
    await launch(preset([phaseDef({ id: "x" })], "B"))

    expect(run().id).toBe(firstId)
    expect(run().presetName).toBe("A")
    expect(h.calls).toHaveLength(1) // nenhuma fase da "B" rodou
    expect(Object.keys(useMission.getState().byConv)).toEqual([CONV])

    release(ok(0.1))
    await p
    expect(run().status).toBe("done")
  })

  it("com GATE aberto (missão pausada segue running), um segundo launch é ignorado — nunca 'fase muda + gate' de missões diferentes", async () => {
    // fase 0 deixa pergunta em aberto no handoff ⇒ gate humano abre.
    h.gateDoc = {
      intent: "definir a porta do serviço",
      decisions: [],
      files_touched: [],
      open_questions: ["Qual porta usar?"],
      for_next_agent: "",
    }
    const p = launch(
      preset([phaseDef({ id: "a" }), phaseDef({ id: "b" })], "A"),
    )
    await waitFor(() => !!run()?.gate)
    const firstId = run().id

    await launch(preset([phaseDef({ id: "x" })], "B"))

    // a missão A segue única, pausada no gate — a B não nasceu.
    expect(run().id).toBe(firstId)
    expect(run().presetName).toBe("A")
    expect(run().gate).toBeTruthy()
    expect(h.calls).toHaveLength(1)

    useMission.getState().answerGate(CONV, ["8080"])
    await p
    expect(run().status).toBe("done")
  })
})
