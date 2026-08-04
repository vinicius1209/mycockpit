// MH1.1 — desfecho HONESTO do loop de revisão: esgotadas as rodadas de
// correção sem APROVADO, a missão termina "done" COM RESSALVA explícita
// (status/timeline via reviewCaveat, notice no fio, resumo final com o
// parecer) — nunca um "done" seco que esconde a reprovação. A entrega ainda
// acontece (insertDelivery/distillLesson rodam): o código está no worktree,
// só não foi aprovado.
//
// Modelado no mission.history.test.ts: runPhase (agent real), readHandoff (FS)
// mocados; helpers puros de @/lib/mission (reviewerApproved, phaseText…) REAIS
// — os pareceres das fixtures são frases no formato que o template do reviewer
// produz, incluindo as armadilhas do endurecimento.

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult } from "@/lib/mission"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"

const h = vi.hoisted(() => ({
  results: [] as PhaseResult[],
  deliveries: [] as { agent: string; task: string }[],
  distilled: [] as { reviewerFeedback: string }[],
}))

vi.mock("@/lib/mission", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/mission")>()
  return {
    ...mod,
    runPhase: vi.fn(async () => {
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

// entrega/índice: espiona SEM tocar no resto do db (fora do Tauri degradaria,
// mas o teste afirma que a chamada ACONTECE mesmo com ressalva).
vi.mock("@/lib/db", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/db")>()
  return {
    ...mod,
    insertDelivery: vi.fn(async (d: { agent: string; task: string }) => {
      h.deliveries.push({ agent: d.agent, task: d.task })
    }),
    upsertMission: vi.fn(async () => {}),
  }
})

// destilação (M2): espiona — a lição das correções ainda roda com ressalva.
vi.mock("@/lib/learning", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/learning")>()
  return {
    ...mod,
    buildLearningBlocks: vi.fn(async () => ({
      recall: null,
      lessons: null,
      lessonIds: [],
    })),
    markLessonsUsed: vi.fn(async () => {}),
    distillLesson: vi.fn(async (a: { reviewerFeedback: string }) => {
      h.distilled.push({ reviewerFeedback: a.reviewerFeedback })
    }),
  }
})

// abort() cancela o run da fase corrente (invoke Tauri) — mocado p/ não vazar.
vi.mock("@/lib/agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agent")>()
  return { ...mod, cancelAgent: vi.fn(async () => {}) }
})

import { useMission } from "./mission"
import { useChat, type ChatItem, type ConvState } from "./chat"

// ── Factories locais ──────────────────────────────────────────────────────

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

function preset(phases: MissionPhaseDef[]): MissionPreset {
  return { id: "t", name: "Teste", phases, maxCostUsd: null }
}

function textItem(text: string): ChatItem {
  return { kind: "text", id: crypto.randomUUID(), text }
}

function ok(costUsd = 0, items: ChatItem[] = []): PhaseResult {
  return { ok: true, items, costUsd, costSource: undefined }
}

/** Parecer REPROVADO no formato real do parecer do template. */
function reprova(texto: string): PhaseResult {
  return ok(0.1, [textItem(texto)])
}

const CONV = "c1"
const PROJ = "proj1"

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
    .launch(CONV, pre, "tarefa da missão", PROJ, "/tmp/proj", "padrao")
}

function run() {
  return useMission.getState().byConv[CONV]
}

function notices(): string[] {
  return (useChat.getState().byId[CONV]?.items ?? [])
    .filter((it) => it.kind === "notice")
    .map((it) => (it as Extract<ChatItem, { kind: "notice" }>).message)
}

function resultItem() {
  return (useChat.getState().byId[CONV]?.items ?? []).find(
    (it) => it.kind === "result",
  ) as Extract<ChatItem, { kind: "result" }> | undefined
}

function texts(): string[] {
  return (useChat.getState().byId[CONV]?.items ?? [])
    .filter((it) => it.kind === "text")
    .map((it) => (it as Extract<ChatItem, { kind: "text" }>).text)
}

beforeEach(() => {
  h.results = []
  h.deliveries = []
  h.distilled = []
  vi.clearAllMocks()
  useMission.setState({ byConv: {} })
  seedConv()
})

describe("MH1.1 · done com ressalva quando o revisor não aprova", () => {
  it("rodadas esgotadas sem APROVADO → done COM reviewCaveat + notice + parecer no resumo (nunca done seco)", async () => {
    // executor ok → review reprova (rodada 1) → fix ok → re-review reprova
    // (rodada 2) → fix ok → re-review reprova DE NOVO (rodadas esgotadas).
    h.results = [
      ok(0.5),
      reprova("NÃO APROVADO: o handler em src/sync.ts engole a exceção."),
      ok(0.3),
      reprova("Ainda não está aprovado: falta o teste do caso vazio."),
      ok(0.3),
      reprova(
        "APROVADO COM RESSALVAS: funciona, mas sem teste de regressão para o retry.",
      ),
    ]
    await launch(
      preset([
        phaseDef({ id: "build", label: "Executar" }),
        phaseDef({ id: "review", label: "Revisar", persona: "reviewer" }),
      ]),
    )

    const r = run()
    expect(r.status).toBe("done")
    // 1) status/timeline: a ressalva vive no run (a UI lê daqui)
    expect(r.reviewCaveat).toEqual({
      rounds: 2,
      feedback: expect.stringContaining("APROVADO COM RESSALVAS"),
    })
    // 2) notice explícito no fio
    const aviso = notices().find((m) => m.includes("SEM aprovação do revisor"))
    expect(aviso).toBeTruthy()
    expect(aviso).toContain("2 rodadas")
    // 3) resumo final carrega a ressalva e o parecer
    expect(resultItem()?.ok).toBe(true)
    expect(resultItem()?.text).toContain("com ressalva")
    expect(
      texts().some((t) => t.includes("Parecer do revisor")),
    ).toBe(true)
    // 4) a entrega ACONTECEU (só não foi aprovada): delivery + lição rodam
    expect(h.deliveries).toHaveLength(1)
    expect(h.distilled).toHaveLength(1)
    // 5) audit trail: o índice `missions` do banco carrega a ressalva no
    // marco done (o histórico não conta "concluída" seca)
    const { upsertMission } = await import("@/lib/db")
    const rows = (
      upsertMission as unknown as ReturnType<typeof vi.fn>
    ).mock.calls.map(
      (c) =>
        c[0] as {
          status: string
          reviewCaveat?: { rounds: number; feedback: string } | null
        },
    )
    expect(
      rows.some((row) => row.status === "done" && row.reviewCaveat?.rounds === 2),
    ).toBe(true)
  })

  it("aprovação na re-review → done SEM ressalva (o loop corrigiu de verdade)", async () => {
    h.results = [
      ok(0.5),
      reprova("NÃO APROVADO: o handler em src/sync.ts engole a exceção."),
      ok(0.3),
      ok(0.1, [textItem("APROVADO. As correções cobrem os dois pontos.")]),
    ]
    await launch(
      preset([
        phaseDef({ id: "build", label: "Executar" }),
        phaseDef({ id: "review", label: "Revisar", persona: "reviewer" }),
      ]),
    )

    const r = run()
    expect(r.status).toBe("done")
    expect(r.reviewCaveat ?? null).toBeNull()
    expect(notices().some((m) => m.includes("SEM aprovação"))).toBe(false)
    expect(resultItem()?.text).toBe("Missão concluída · preset Teste")
  })

  it("reviewer reprovou mas NÃO havia executor pra corrigir → ressalva com 0 rodadas", async () => {
    h.results = [
      reprova("NÃO APROVADO: o diff está vazio, nada foi implementado."),
    ]
    await launch(
      preset([phaseDef({ id: "review", label: "Revisar", persona: "reviewer" })]),
    )

    const r = run()
    expect(r.status).toBe("done")
    expect(r.reviewCaveat?.rounds).toBe(0)
    expect(
      notices().some((m) => m.includes("não havia executor")),
    ).toBe(true)
  })

  it("frase armadilha 'aprovado com ressalvas' na PRIMEIRA revisão dispara o loop de correção (não passa como aprovado)", async () => {
    h.results = [
      ok(0.5),
      reprova("APROVADO COM RESSALVAS: falta tratar o erro de rede."),
      ok(0.3),
      ok(0.1, [textItem("APROVADO. A ressalva foi resolvida.")]),
    ]
    await launch(
      preset([
        phaseDef({ id: "build", label: "Executar" }),
        phaseDef({ id: "review", label: "Revisar", persona: "reviewer" }),
      ]),
    )

    const r = run()
    // o loop rodou (fases corretivas apendadas) e terminou aprovado, sem ressalva
    expect(r.phases.length).toBe(4)
    expect(r.phases[2].def.label).toBe("Corrigir (rodada 1)")
    expect(r.reviewCaveat ?? null).toBeNull()
  })
})
