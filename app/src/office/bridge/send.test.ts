// Testes de PARIDADE do send.ts com o handleSend do ChatPanel — a lista
// fechada do §9 do docs/agent-office.md. Stores e libs com efeito são mocados;
// o que se verifica é a COREOGRAFIA (guardas, argumentos do runAgent, finally).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { toast } from "sonner"
import { cancelAgent, runAgent } from "@/lib/agent"
import { wantsAutoResume } from "@/lib/autoResume"
import { listConversations, type ConversationMeta } from "@/lib/db"
import { buildLearningBlocks, markLessonsUsed } from "@/lib/learning"
import { notifyTurnEnd } from "@/lib/notify"
import { exportConvContext } from "@/lib/transcript"
import type { ChatItem, ConvState, QueuedMsg } from "@/store/chat"
import { cancelDeskTurn, ensureDeskConversation, sendFromDesk } from "./send"

// Estado compartilhado com as factories dos mocks (vi.hoisted roda antes).
const h = vi.hoisted(() => ({
  chat: {} as Record<string, unknown>,
  mission: { byConv: {} as Record<string, { status: string }> },
  app: {
    projects: [{ id: "p1", path: "/proj", permissionMode: "padrao" }],
    settings: { autoResume: false, autoResumeMaxTries: 5 },
  },
  fusion: {
    byConv: {} as Record<string, { phase: string }>,
    abort: vi.fn(),
  },
}))

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))
vi.mock("@/lib/agent", () => ({
  runAgent: vi.fn(async () => {}),
  cancelAgent: vi.fn(async () => {}),
  agentLabel: (id: string) =>
    ({ "claude-code": "Claude Code", codex: "Codex", agy: "Antigravity" })[
      id as "claude-code"
    ] ?? id,
}))
vi.mock("@/lib/autoResume", () => ({
  wantsAutoResume: vi.fn(() => ({ resume: false, delayMs: 0, reason: "" })),
}))
vi.mock("@/lib/db", () => ({
  isTauri: () => true,
  listConversations: vi.fn(async () => null),
}))
vi.mock("@/lib/handoff", () => ({ buildHandoff: vi.fn(() => "[handoff]") }))
vi.mock("@/lib/learning", () => ({
  buildLearningBlocks: vi.fn(async () => ({
    recall: null,
    lessons: null,
    lessonIds: [] as string[],
  })),
  markLessonsUsed: vi.fn(async () => {}),
}))
vi.mock("@/lib/notify", () => ({ notifyTurnEnd: vi.fn() }))
vi.mock("@/lib/transcript", () => ({
  renderTranscript: vi.fn(() => "# transcript"),
  exportConvContext: vi.fn(async () => ".mycockpit/context/conv.md"),
  buildMemoryPrompt: vi.fn(
    (_items: unknown, pointer: string | null, prompt: string) =>
      `[memória-agy|${pointer ?? "sem-ponteiro"}] ${prompt}`,
  ),
  // mesma regra da função real (pura): claude/codex com histórico + sessão
  shouldAttachResumeFallback: vi.fn(
    (agent: string, items: unknown[], sessionId: string | null) =>
      agent !== "agy" && items.length > 0 && sessionId != null,
  ),
  buildResumeFallback: vi.fn(() => "[fallback-resume]"),
}))
vi.mock("@/store/chat", () => ({ useChat: { getState: () => h.chat } }))
vi.mock("@/store/mission", () => ({ useMission: { getState: () => h.mission } }))
vi.mock("@/store/app", () => ({ useApp: { getState: () => h.app } }))
vi.mock("@/store/fusion", () => ({ useFusion: { getState: () => h.fusion } }))

// ---------------------------------------------------------------- factories

function user(text: string): ChatItem {
  return { kind: "user", id: "u", text }
}

function makeConv(partial: Partial<ConvState> = {}): ConvState {
  return {
    projectId: "p1",
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
    ...partial,
  }
}

function makeChat(conv: ConvState) {
  return {
    byId: { c1: conv } as Record<string, ConvState>,
    conversationsByProject: {} as Record<string, ConversationMeta[]>,
    ensureConversationLoaded: vi.fn(async () => {}),
    registerConversation: vi.fn(async () => {}),
    loadProjectConversations: vi.fn(async () => {}),
    enqueue: vi.fn(),
    dequeueQueued: vi.fn((): QueuedMsg[] => []),
    cancelAutoResume: vi.fn(),
    setAutoResume: vi.fn(),
    invalidateSuggestions: vi.fn(),
    start: vi.fn(),
    handleEvent: vi.fn(),
    finish: vi.fn(),
    persist: vi.fn(async () => {}),
    scheduleSuggestions: vi.fn(),
    setPendingPlan: vi.fn(),
  }
}

/** Meta de conversa: title default null = thread do usuário/em branco (a mesa
 *  só reusa título "Mesa · …"). */
function meta(
  id: string,
  agent: string | null,
  updatedAt: number,
  title: string | null = null,
): ConversationMeta {
  return { id, title, updatedAt, color: null, worktreePath: null, agent }
}

let chat: ReturnType<typeof makeChat>

function arm(conv: ConvState) {
  chat = makeChat(conv)
  h.chat = chat
}

const args = {
  convId: "c1",
  projectId: "p1",
  projectPath: "/proj",
  agent: "claude-code" as const,
  text: "olá",
}

beforeEach(() => {
  vi.clearAllMocks()
  h.mission.byConv = {}
  h.app.settings = { autoResume: false, autoResumeMaxTries: 5 }
  h.fusion.byConv = {}
  arm(makeConv())
})

afterEach(() => {
  vi.useRealTimers()
})

// ---------------------------------------------------------------- sendFromDesk

describe("sendFromDesk — guardas", () => {
  it("conversa corrompida bloqueia o envio com aviso", async () => {
    arm(makeConv({ corrupt: true }))
    await sendFromDesk(args)
    expect(toast.error).toHaveBeenCalled()
    expect(runAgent).not.toHaveBeenCalled()
    expect(chat.start).not.toHaveBeenCalled()
  })

  it("missão rodando na conversa bloqueia o envio", async () => {
    const onAccepted = vi.fn()
    h.mission.byConv = { c1: { status: "running" } }
    await sendFromDesk({ ...args, onAccepted })
    expect(toast).toHaveBeenCalledWith(
      "Missão em andamento. Pare a missão para enviar manualmente.",
    )
    expect(runAgent).not.toHaveBeenCalled()
    expect(onAccepted).not.toHaveBeenCalled()
  })

  it("turno rodando ⇒ enfileira em vez de disparar novo run", async () => {
    const onAccepted = vi.fn()
    arm(makeConv({ running: true }))
    await sendFromDesk({ ...args, onAccepted })
    expect(chat.enqueue).toHaveBeenCalledWith("c1", "olá", [])
    expect(runAgent).not.toHaveBeenCalled()
    expect(chat.start).not.toHaveBeenCalled()
    expect(onAccepted).toHaveBeenCalledWith("queued")
  })

  it("finalizando também enfileira (flush da sessão ainda em curso)", async () => {
    arm(makeConv({ finalizing: true }))
    await sendFromDesk(args)
    expect(chat.enqueue).toHaveBeenCalledWith("c1", "olá", [])
    expect(runAgent).not.toHaveBeenCalled()
  })

  it("agent travado da conversa vence o agent da mesa", async () => {
    arm(makeConv({ agent: "codex", items: [user("antes")] }))
    await sendFromDesk(args) // mesa do claude-code
    expect(vi.mocked(runAgent).mock.calls[0][2]).toBe("codex")
  })
})

describe("sendFromDesk — coreografia do run", () => {
  it("confirma o aceite do run antes de executar o agent", async () => {
    const onAccepted = vi.fn()
    await sendFromDesk({ ...args, onAccepted })
    expect(onAccepted).toHaveBeenCalledWith("started")
  })

  it("propaga modelo e esforço escolhidos no primeiro envio", async () => {
    await sendFromDesk({ ...args, model: "opus", effort: "high" })
    const call = vi.mocked(runAgent).mock.calls[0]
    expect(call[3]).toBe("opus")
    expect(call[4]).toBe("high")
  })

  it("conversa estabelecida mantém o modelo e esforço travados", async () => {
    arm(
      makeConv({
        items: [user("antes")],
        reqModel: "sonnet",
        effort: "medium",
      }),
    )
    await sendFromDesk({ ...args, model: "opus", effort: "max" })
    const call = vi.mocked(runAgent).mock.calls[0]
    expect(call[3]).toBe("sonnet")
    expect(call[4]).toBe("medium")
  })

  it("sessionId da conversa é propagado como resume", async () => {
    arm(makeConv({ sessionId: "sess-1", items: [user("antes")] }))
    await sendFromDesk(args)
    const call = vi.mocked(runAgent).mock.calls[0]
    expect(call[7]).toBe("sess-1")
    // envio manual cancela auto-resume e invalida sugestões ANTES do run
    expect(chat.cancelAutoResume).toHaveBeenCalledWith("c1")
    expect(chat.invalidateSuggestions).toHaveBeenCalledWith("c1")
    // permissão do projeto e cwd compartilhado do projeto
    expect(call[8]).toBe("padrao")
    expect(call[6]).toBe("/proj")
  })

  it("memória do agy injetada no prompt (recap + ponteiro exportado)", async () => {
    arm(makeConv({ agent: "agy", items: [user("antes")] }))
    await sendFromDesk({ ...args, agent: "agy" })
    expect(exportConvContext).toHaveBeenCalledWith("/proj", "c1", "# transcript")
    const call = vi.mocked(runAgent).mock.calls[0]
    expect(call[5]).toBe("[memória-agy|.mycockpit/context/conv.md] olá")
    // agy não leva fallback de resume (não tem resume nativo)
    expect(call[12]).toBeNull()
  })

  it("claude/codex com sessão levam o memoryFallback do resume", async () => {
    arm(makeConv({ sessionId: "sess-1", items: [user("antes")] }))
    await sendFromDesk(args)
    const call = vi.mocked(runAgent).mock.calls[0]
    expect(call[12]).toBe("[fallback-resume]")
    // o prompt normal NÃO muda (o motor só usa o fallback se o resume falhar)
    expect(call[5]).toBe("olá")
  })

  it("sem sessão não monta fallback (conversa nova não tem o que retomar)", async () => {
    arm(makeConv({ items: [user("antes")] }))
    await sendFromDesk(args)
    expect(vi.mocked(runAgent).mock.calls[0][12]).toBeNull()
  })

  it("planFirst da conversa é respeitado no run", async () => {
    arm(makeConv({ planFirst: true }))
    await sendFromDesk(args)
    expect(vi.mocked(runAgent).mock.calls[0][11]).toBe(true)
  })

  it("worktree da conversa vence a pasta do projeto como cwd", async () => {
    arm(makeConv({ worktreePath: "/wt/c1" }))
    await sendFromDesk(args)
    expect(vi.mocked(runAgent).mock.calls[0][6]).toBe("/wt/c1")
  })
})

describe("sendFromDesk — lições (M2)", () => {
  it("lições ativas do projeto entram no prompt e marcam uso", async () => {
    vi.mocked(buildLearningBlocks).mockResolvedValueOnce({
      recall: null,
      lessons: "## Lições",
      lessonIds: ["l1", "l2"],
    })
    await sendFromDesk(args)
    // mesma chamada do ChatPanel no Linear (sem recall — só o planner usa)
    expect(buildLearningBlocks).toHaveBeenCalledWith("p1", "olá", false)
    expect(vi.mocked(runAgent).mock.calls[0][5]).toBe("## Lições\n\n---\n\nolá")
    expect(markLessonsUsed).toHaveBeenCalledWith(["l1", "l2"])
  })

  it("sem lições ativas o prompt não muda", async () => {
    await sendFromDesk(args)
    expect(vi.mocked(runAgent).mock.calls[0][5]).toBe("olá")
    expect(markLessonsUsed).not.toHaveBeenCalled()
  })

  it("falha no learning não bloqueia o envio (best-effort)", async () => {
    vi.mocked(buildLearningBlocks).mockRejectedValueOnce(new Error("db"))
    await sendFromDesk(args)
    expect(runAgent).toHaveBeenCalledTimes(1)
    expect(vi.mocked(runAgent).mock.calls[0][5]).toBe("olá")
  })

  it("memória do agy envolve o prompt JÁ com as lições (mesma ordem do app)", async () => {
    vi.mocked(buildLearningBlocks).mockResolvedValueOnce({
      recall: null,
      lessons: "## Lições",
      lessonIds: ["l1"],
    })
    arm(makeConv({ agent: "agy", items: [user("antes")] }))
    await sendFromDesk({ ...args, agent: "agy" })
    expect(vi.mocked(runAgent).mock.calls[0][5]).toBe(
      "[memória-agy|.mycockpit/context/conv.md] ## Lições\n\n---\n\nolá",
    )
  })
})

describe("sendFromDesk — finally", () => {
  it("finish + persist rodam mesmo quando o run falha", async () => {
    vi.mocked(runAgent).mockRejectedValueOnce("boom")
    await sendFromDesk(args)
    expect(chat.finish).toHaveBeenCalledWith("c1")
    expect(chat.persist).toHaveBeenCalledWith("c1")
    expect(toast.error).toHaveBeenCalledWith("boom")
    expect(notifyTurnEnd).toHaveBeenCalledWith("c1", "claude-code")
    expect(chat.scheduleSuggestions).toHaveBeenCalledWith("c1")
  })

  it("fila enfileirada durante o turno drena coalescida num único reenvio", async () => {
    const pending: QueuedMsg[] = [
      { text: "um", attachments: [] },
      { text: "dois", attachments: [] },
    ]
    chat.dequeueQueued.mockReturnValueOnce(pending)
    await sendFromDesk(args)
    // o reenvio da fila é assíncrono (void sendFromDesk no finally)
    await vi.waitFor(() => expect(runAgent).toHaveBeenCalledTimes(2))
    expect(vi.mocked(runAgent).mock.calls[1][5]).toBe("um\n\ndois")
    // com fila, o próximo turno já começa: não notifica o turno intermediário
    expect(notifyTurnEnd).toHaveBeenCalledTimes(1)
  })

  it("sem fila: notifica o fim do turno e agenda sugestões", async () => {
    await sendFromDesk(args)
    expect(runAgent).toHaveBeenCalledTimes(1)
    expect(notifyTurnEnd).toHaveBeenCalledWith("c1", "claude-code")
    expect(chat.scheduleSuggestions).toHaveBeenCalledWith("c1")
  })
})

describe("sendFromDesk — auto-resume em rate limit", () => {
  it("rate limit com auto-resume ligado agenda o reenvio (segura as sugestões)", async () => {
    vi.useFakeTimers()
    h.app.settings = { autoResume: true, autoResumeMaxTries: 5 }
    vi.mocked(wantsAutoResume).mockReturnValueOnce({
      resume: true,
      delayMs: 1000,
      reason: "limite da CLI atingido",
    })
    // o timer lê byId[convId].autoResume → o mock grava de verdade no estado
    chat.setAutoResume.mockImplementation(
      (id: string, s: ConvState["autoResume"]) => {
        chat.byId[id].autoResume = s
      },
    )
    await sendFromDesk(args)
    expect(chat.setAutoResume).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ tries: 1, maxTries: 5, reason: "limite da CLI atingido" }),
    )
    // agendou: notifica (o usuário sabe que pausou), mas NÃO sugere ainda
    expect(notifyTurnEnd).toHaveBeenCalledWith("c1", "claude-code")
    expect(chat.scheduleSuggestions).not.toHaveBeenCalled()
    // dispara o timer → reenvio automático com handoff + pedido de continuar
    await vi.advanceTimersByTimeAsync(1000)
    expect(runAgent).toHaveBeenCalledTimes(2)
    const prompt = vi.mocked(runAgent).mock.calls[1][5] as string
    expect(prompt).toContain("[handoff]")
    expect(prompt).toContain("continue a tarefa pendente")
    expect(chat.handleEvent).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ type: "notice" }),
    )
    // o reenvio É o resume: não cancela o loop de novo (só o envio manual inicial)
    expect(chat.cancelAutoResume).toHaveBeenCalledTimes(2) // manual + fim do loop
  })

  it("reenvio do auto-resume não cancela o loop nem planeja (fromAutoResume)", async () => {
    arm(makeConv({ planFirst: true }))
    await sendFromDesk({ ...args, fromAutoResume: true })
    expect(chat.cancelAutoResume).not.toHaveBeenCalled()
    expect(vi.mocked(runAgent).mock.calls[0][11]).toBe(false)
  })

  it("cap de tentativas esgotado: encerra o loop e segue o fluxo normal", async () => {
    h.app.settings = { autoResume: true, autoResumeMaxTries: 2 }
    arm(makeConv())
    chat.byId.c1.autoResume = {
      tries: 2,
      maxTries: 2,
      nextAt: 0,
      reason: "limite",
      timer: 0 as unknown as ReturnType<typeof setTimeout>,
    }
    await sendFromDesk({ ...args, fromAutoResume: true })
    expect(wantsAutoResume).not.toHaveBeenCalled()
    expect(chat.setAutoResume).not.toHaveBeenCalled()
    expect(chat.cancelAutoResume).toHaveBeenCalledWith("c1")
    expect(notifyTurnEnd).toHaveBeenCalledWith("c1", "claude-code")
    expect(chat.scheduleSuggestions).toHaveBeenCalledWith("c1")
  })

  it("auto-resume desligado nas settings: fluxo normal, sem agendar", async () => {
    h.app.settings = { autoResume: false, autoResumeMaxTries: 5 }
    await sendFromDesk(args)
    expect(wantsAutoResume).not.toHaveBeenCalled()
    expect(chat.setAutoResume).not.toHaveBeenCalled()
    expect(chat.scheduleSuggestions).toHaveBeenCalledWith("c1")
  })
})

// ------------------------------------------------------- ensureDeskConversation

describe("ensureDeskConversation", () => {
  it("reusa a conversa mais recente DA MESA do (projeto, agent)", async () => {
    vi.mocked(listConversations).mockResolvedValueOnce([
      meta("a", "claude-code", 1, "Mesa · Claude Code"),
      meta("b", "claude-code", 5, "Mesa · Claude Code"),
      meta("x", "codex", 9, "Mesa · Codex"),
    ])
    const id = await ensureDeskConversation("p1", "claude-code")
    expect(id).toBe("b")
    // metas do projeto carregadas ANTES do 1º persist: sem elas o persist não
    // acha meta.title e re-deriva do 1º prompt — o título fixo sumiria.
    expect(chat.loadProjectConversations).toHaveBeenCalledWith("p1")
    expect(chat.ensureConversationLoaded).toHaveBeenCalledWith("p1", "b")
    expect(chat.registerConversation).not.toHaveBeenCalled()
  })

  it("NÃO adota thread do usuário (mesmo agent, título não é da mesa)", async () => {
    vi.mocked(listConversations).mockResolvedValueOnce([
      meta("t", "claude-code", 9, "refatorar o parser"),
    ])
    const id = await ensureDeskConversation("p1", "claude-code")
    expect(id).not.toBe("t")
    expect(chat.registerConversation).toHaveBeenCalledWith(
      "p1",
      id,
      "Mesa · Claude Code",
      "claude-code",
    )
  })

  it("conversa em branco NÃO é livre (coluna agent tem DEFAULT claude-code)", async () => {
    // migração v10: agent é NOT NULL DEFAULT 'claude-code' — adotar a conversa
    // em branco sequestraria o "Nova conversa" recém-criado pelo usuário.
    vi.mocked(listConversations).mockResolvedValueOnce([
      meta("blank", "claude-code", 3),
    ])
    const id = await ensureDeskConversation("p1", "claude-code")
    expect(id).not.toBe("blank")
    expect(chat.registerConversation).toHaveBeenCalledWith(
      "p1",
      id,
      "Mesa · Claude Code",
      "claude-code", // agent carimbado JÁ na criação
    )
    expect(chat.ensureConversationLoaded).toHaveBeenCalledWith("p1", id)
  })

  it("chamadas concorrentes compartilham a MESMA resolução (sem duplicar)", async () => {
    vi.mocked(listConversations).mockResolvedValueOnce([])
    const [a, b] = await Promise.all([
      ensureDeskConversation("p1", "claude-code"),
      ensureDeskConversation("p1", "claude-code"),
    ])
    expect(a).toBe(b)
    expect(listConversations).toHaveBeenCalledTimes(1)
    expect(chat.registerConversation).toHaveBeenCalledTimes(1)
  })

  it("após o settle, uma nova chamada resolve de novo (mapa limpo)", async () => {
    vi.mocked(listConversations).mockResolvedValueOnce([])
    const first = await ensureDeskConversation("p1", "claude-code")
    vi.mocked(listConversations).mockResolvedValueOnce([
      meta(first, "claude-code", 9, "Mesa · Claude Code"),
    ])
    const second = await ensureDeskConversation("p1", "claude-code")
    expect(second).toBe(first)
    expect(listConversations).toHaveBeenCalledTimes(2)
  })
})

// --------------------------------------------------------------- cancelDeskTurn

describe("cancelDeskTurn", () => {
  it("cancela o runId corrente da conversa (e o auto-resume agendado)", async () => {
    arm(makeConv({ runId: "r9", running: true }))
    await cancelDeskTurn("c1")
    expect(cancelAgent).toHaveBeenCalledWith("r9")
    expect(chat.cancelAutoResume).toHaveBeenCalledWith("c1")
  })

  it("disputa Fusion em voo: aborta a disputa (runId nulo não vira no-op)", async () => {
    // beginFusion marca running SEM runId — o Stop precisa abortar a disputa
    arm(makeConv({ running: true, runId: null }))
    h.fusion.byConv = { c1: { phase: "running" } }
    await cancelDeskTurn("c1")
    expect(h.fusion.abort).toHaveBeenCalledWith("c1")
    expect(cancelAgent).not.toHaveBeenCalled()
  })

  it("disputa em julgamento também é abortável (mesmo gesto do app)", async () => {
    arm(makeConv({ running: true, runId: null }))
    h.fusion.byConv = { c1: { phase: "judging" } }
    await cancelDeskTurn("c1")
    expect(h.fusion.abort).toHaveBeenCalledWith("c1")
  })

  it("sem run em andamento é no-op (não chama o backend)", async () => {
    await cancelDeskTurn("c1")
    expect(cancelAgent).not.toHaveBeenCalled()
  })
})
