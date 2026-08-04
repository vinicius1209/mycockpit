// Gate RICO (caminho do dinheiro): answerGate aceita GateAnswer[] (texto +
// anexos) além do string[] legado. Os texts viram diretriz no prompt da fase
// seguinte (buildGateDecisionsBlock, como antes); os anexos agregados vão pro
// runPhase da PRÓXIMA fase, filtrados pelo agentCaps do agent dela (não
// suportado ⇒ descarta com notice no fio, nunca erro). O gate ABRIR dispara
// notifyGate UMA vez (notificação nativa + feed).
//
// Modelado no mission.history.test.ts: runPhase (agent real), readHandoff (FS)
// e lib/notify (Tauri) mocados; helpers puros de @/lib/mission seguem reais.

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PhaseResult } from "@/lib/mission"
import type { HandoffDoc } from "@/lib/missionHandoff"
import type { Attachment, AttachmentKind } from "@/lib/attachments"
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"

// Estado compartilhado com as fábricas de mock (hoisted p/ o vi.mock enxergar).
const h = vi.hoisted(() => ({
  results: [] as PhaseResult[],
  handoffs: [] as (HandoffDoc | null)[],
  calls: [] as {
    agent: string
    prompt: string
    attachments: Attachment[] | undefined
  }[],
}))

vi.mock("@/lib/mission", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/mission")>()
  return {
    ...mod,
    runPhase: vi.fn(async (args: import("@/lib/mission").RunPhaseArgs) => {
      h.calls.push({
        agent: args.agent,
        prompt: args.prompt,
        attachments: args.attachments,
      })
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

// readHandoff mocado: fora do Tauri o real devolve null e o gate nunca abre.
vi.mock("@/lib/missionHandoff", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/missionHandoff")>()
  return {
    ...mod,
    readHandoff: vi.fn(async () => h.handoffs.shift() ?? null),
  }
})

// abort() cancela o run da fase corrente (invoke Tauri) — mocado p/ não vazar.
vi.mock("@/lib/agent", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/agent")>()
  return { ...mod, cancelAgent: vi.fn(async () => {}) }
})

// notificações (plugin Tauri + feed) — só contamos as chamadas.
vi.mock("@/lib/notify", () => ({
  notifyGate: vi.fn(),
  notifyTurnEnd: vi.fn(),
  nativeNotify: vi.fn(),
  // MH2.3: o store passou a notificar desfecho/recovery — stubs pro mock
  // parcial continuar completo (nenhuma asserção deste arquivo muda).
  notifyMissionEnd: vi.fn(),
  notifyMissionRecovery: vi.fn(),
}))

import { useMission } from "./mission"
import { useChat, type ChatItem, type ConvState } from "./chat"
import { notifyGate } from "@/lib/notify"

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

function ok(costUsd = 0): PhaseResult {
  return { ok: true, items: [], costUsd, costSource: undefined }
}

function att(name: string, kind: AttachmentKind): Attachment {
  return {
    path: `attachments/c1/${name}`,
    name,
    kind,
    mime: kind === "pdf" ? "application/pdf" : "image/png",
    bytes: 10,
  }
}

/** Handoff com open_questions → o gate abre depois da fase. */
function gateHandoff(questions: string[]): HandoffDoc {
  return {
    intent: "fazer x",
    decisions: [],
    open_questions: questions,
    files_touched: [],
    for_next_agent: "",
  }
}

const CONV = "c1"
const PROJ = "proj1"

/** Conversa da missão JÁ carregada em byId (o launcher garante isso). */
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

async function waitFor(cond: () => boolean, tries = 100): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return
    await new Promise((r) => setTimeout(r, 0))
  }
  throw new Error("condição não satisfeita a tempo")
}

beforeEach(() => {
  h.results = []
  h.handoffs = []
  h.calls = []
  vi.mocked(notifyGate).mockClear()
  useMission.setState({ byConv: {} })
  seedConv()
})

describe("gate rico (GateAnswer[]: texto + anexos)", () => {
  it("texts entram no prompt da fase seguinte E os anexos chegam no runPhase dela", async () => {
    h.results = [ok(0.1), ok(0.2)]
    h.handoffs = [gateHandoff(["Qual porta?"])]
    // próxima fase = claude-code (image + pdf) → nada é descartado.
    const p = launch(preset([phaseDef(), phaseDef({ id: "p2" })]))

    await waitFor(() => !!run()?.gate)
    useMission.getState().answerGate(CONV, [
      {
        text: "usa a 5175",
        attachments: [att("shot.png", "image"), att("spec.pdf", "pdf")],
      },
    ])
    await waitFor(() => run()?.status === "done")
    await p

    expect(h.calls).toHaveLength(2)
    // texto da resposta como diretriz no prompt (mesmo caminho de sempre).
    expect(h.calls[1].prompt).toContain("Decisões do usuário (gate humano)")
    expect(h.calls[1].prompt).toContain("P: Qual porta?")
    expect(h.calls[1].prompt).toContain("R: usa a 5175")
    // anexos agregados chegam no runPhase da fase seguinte.
    expect(h.calls[1].attachments?.map((a) => a.name)).toEqual([
      "shot.png",
      "spec.pdf",
    ])
    // marco no fio menciona os anexos.
    const answered = notices().find((m) => m.includes("Gate respondido"))
    expect(answered).toContain("usa a 5175")
    expect(answered).toContain("(+ 2 anexos)")
  })

  it("string[] legado segue intacto (texts no prompt, sem anexos)", async () => {
    h.results = [ok(), ok()]
    h.handoffs = [gateHandoff(["Qual porta?"])]
    const p = launch(preset([phaseDef(), phaseDef({ id: "p2" })]))

    await waitFor(() => !!run()?.gate)
    useMission.getState().answerGate(CONV, ["5175"])
    await waitFor(() => run()?.status === "done")
    await p

    expect(h.calls[1].prompt).toContain("R: 5175")
    expect(h.calls[1].attachments).toBeUndefined()
    const answered = notices().find((m) => m.includes("Gate respondido"))
    expect(answered).toContain("5175")
    expect(answered).not.toContain("anexo")
  })

  // O exemplo de "agent sem suporte" era o agy — até se provar que ele LÊ imagem
  // e PDF (via `view_file`; ver ADR-020). O comportamento testado continua o
  // mesmo; o que mudou foi qual par agent×tipo ainda é incompatível. Hoje é
  // PDF no Codex: o `-i` dele só aceita PNG/JPEG/GIF/WebP e, com PDF, FALHA EM
  // SILÊNCIO (exit 0, e o arquivo vira o literal "image content" no rollout) —
  // ou seja, descartar aqui não é frescura, é o que impede o usuário de achar
  // que enviou.
  it("agent da próxima fase sem suporte (PDF no codex) → anexo descartado com notice, nunca erro", async () => {
    h.results = [ok(), ok()]
    h.handoffs = [gateHandoff(["Qual porta?"])]
    const p = launch(
      preset([phaseDef(), phaseDef({ id: "p2", agent: "codex" })]),
    )

    await waitFor(() => !!run()?.gate)
    useMission.getState().answerGate(CONV, [
      { text: "5175", attachments: [att("manual.pdf", "pdf")] },
    ])
    await waitFor(() => run()?.status === "done")
    await p

    // a missão CONCLUIU (descartar não é erro) e a fase codex rodou sem anexos.
    expect(run().status).toBe("done")
    expect(h.calls[1].agent).toBe("codex")
    expect(h.calls[1].attachments).toBeUndefined()
    const dropped = notices().find((m) => m.includes("descartado"))
    expect(dropped).toContain("codex não suporta")
    expect(dropped).toContain("manual.pdf")
  })

  it("agy agora RECEBE imagem no gate (era descartada antes do ADR-020)", async () => {
    h.results = [ok(), ok()]
    h.handoffs = [gateHandoff(["Qual porta?"])]
    const p = launch(preset([phaseDef(), phaseDef({ id: "p2", agent: "agy" })]))

    await waitFor(() => !!run()?.gate)
    useMission.getState().answerGate(CONV, [
      { text: "5175", attachments: [att("shot.png", "image")] },
    ])
    await waitFor(() => run()?.status === "done")
    await p

    expect(h.calls[1].agent).toBe("agy")
    expect(h.calls[1].attachments).toEqual([att("shot.png", "image")])
    expect(notices().find((m) => m.includes("descartado"))).toBeUndefined()
  })

  it("caps parciais (codex: image sim, pdf não) → só o PDF cai fora", async () => {
    h.results = [ok(), ok()]
    h.handoffs = [gateHandoff(["Qual porta?"])]
    const p = launch(
      preset([phaseDef(), phaseDef({ id: "p2", agent: "codex" })]),
    )

    await waitFor(() => !!run()?.gate)
    useMission.getState().answerGate(CONV, [
      {
        text: "5175",
        attachments: [att("shot.png", "image"), att("spec.pdf", "pdf")],
      },
    ])
    await waitFor(() => run()?.status === "done")
    await p

    expect(h.calls[1].attachments?.map((a) => a.name)).toEqual(["shot.png"])
    const dropped = notices().find((m) => m.includes("descartado"))
    expect(dropped).toContain("spec.pdf")
    expect(dropped).not.toContain("shot.png,") // só o PDF na lista
  })

  it("anexos do gate vão SÓ pra fase imediatamente seguinte (a 3ª roda sem)", async () => {
    h.results = [ok(), ok(), ok()]
    h.handoffs = [gateHandoff(["Q?"])]
    const p = launch(
      preset([phaseDef(), phaseDef({ id: "p2" }), phaseDef({ id: "p3" })]),
    )

    await waitFor(() => !!run()?.gate)
    useMission.getState().answerGate(CONV, [
      { text: "r", attachments: [att("shot.png", "image")] },
    ])
    await waitFor(() => run()?.status === "done")
    await p

    expect(h.calls).toHaveLength(3)
    expect(h.calls[1].attachments?.map((a) => a.name)).toEqual(["shot.png"])
    expect(h.calls[2].attachments).toBeUndefined()
  })

  it("notifyGate dispara UMA vez quando o gate abre (sem spam)", async () => {
    h.results = [ok(), ok()]
    h.handoffs = [gateHandoff(["Qual porta?"])]
    const p = launch(
      preset([phaseDef({ label: "Planejar" }), phaseDef({ id: "p2" })]),
    )

    await waitFor(() => !!run()?.gate)
    expect(notifyGate).toHaveBeenCalledTimes(1)
    expect(notifyGate).toHaveBeenCalledWith(CONV, expect.any(String), "Planejar")

    useMission.getState().answerGate(CONV, ["5175"])
    await waitFor(() => run()?.status === "done")
    await p

    // responder/concluir não re-notifica — 1 por gate.
    expect(notifyGate).toHaveBeenCalledTimes(1)
  })

  it("missão SEM gate não chama notifyGate", async () => {
    h.results = [ok(), ok()]
    const p = launch(preset([phaseDef(), phaseDef({ id: "p2" })]))
    await p
    expect(run().status).toBe("done")
    expect(notifyGate).not.toHaveBeenCalled()
  })
})
