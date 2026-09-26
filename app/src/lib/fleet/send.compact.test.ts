// /compactar interceptado no send — a peça que trava as DUAS pontas do
// builtin: em motor com nativeCompact o que viaja é o texto LITERAL "/compact"
// via resume (turno técnico, sem doutrina/expansão de .md — o inventário de
// disco nem é lido); em motor sem, transplante para si mesmo com memória
// emoldurado (H3) em sessão fresca. Superfície testada: sendFromDesk (a
// paridade com o handleSend do ChatPanel é a mesma disciplina do send.test.ts;
// scaffolding espelha o send.slash.test.ts, só o subset usado).

import { beforeEach, describe, expect, it, vi } from "vitest"
import { avisar } from "@/lib/avisos"
import { runAgent } from "@/lib/agent"
import { RENEWAL_INSTRUCTION } from "@/lib/compact"
import type { ConversationMeta } from "@/lib/db/conversations"
import { readDoctrine } from "@/lib/doctrine"
import { readProjectCommands, type SlashCommand } from "@/lib/sources"
import { exportConvContext } from "@/lib/transcript"
import { HISTORY_OPEN } from "@/lib/trust"
import type { ChatItem, ConvState, QueuedMsg } from "@/store/chat"
import { acceptedRunEvent } from "@/test/chatRunFixtures"
import { sendFromDesk } from "./send"

const h = vi.hoisted(() => ({
  chat: {} as Record<string, unknown>,
  mission: { byConv: {} as Record<string, { status: string }> },
  app: {
    projects: [{ id: "p1", path: "/proj", permissionMode: "padrao" }],
    settings: {
      autoResume: false,
      autoResumeMaxTries: 5,
      detected: {} as Record<string, unknown>,
    },
  },
  fusion: { byConv: {} as Record<string, { phase: string }>, abort: vi.fn() },
}))

vi.mock("@/lib/avisos", async () => (await import("@/test/avisosFalsos")).moduloDeAvisosFalsos())
vi.mock("@/lib/agent", () => ({
  runAgent: vi.fn(async (...args: unknown[]) => {
    const onEvent = args[10] as (event: typeof acceptedRunEvent) => void
    onEvent(acceptedRunEvent)
  }),
  cancelAgent: vi.fn(async () => true),
  agentLabel: (id: string) => id,
}))
vi.mock("@/lib/autoResume", () => ({
  wantsAutoResume: vi.fn(() => ({ resume: false, delayMs: 0, reason: "" })),
}))
vi.mock("@/lib/db", () => ({ isTauri: () => true }))
vi.mock("@/lib/db/conversations", () => ({
  listConversations: vi.fn(async () => null),
}))
vi.mock("@/lib/handoff", () => ({
  buildHandoff: vi.fn(() => "[handoff]"),
  prepareHybridHandoff: vi.fn(async () => ({
    prompt: "[handoff]",
    envelope: {},
    paths: null,
  })),
}))
// Doutrina: funções puras reais; só a LEITURA de disco é trocada por teste.
vi.mock("@/lib/doctrine", async (orig) => ({
  ...(await orig<typeof import("@/lib/doctrine")>()),
  readDoctrine: vi.fn(async () => ({ exists: false, content: "", bytes: 0 })),
}))
vi.mock("@/lib/learning", () => ({
  buildLearningBlocks: vi.fn(async () => ({
    recall: null,
    lessons: null,
    lessonIds: [] as string[],
  })),
  markLessonsUsed: vi.fn(async () => {}),
  recordInjectedLessons: vi.fn(),
}))
vi.mock("@/lib/notify", () => ({ notifyTurnEnd: vi.fn() }))
vi.mock("@/lib/presets", () => ({
  resolveFirstTurnPersona: vi.fn(async () => ({ status: "none" as const })),
  warnPresetDrift: vi.fn(async () => null),
  personaHandoffBlock: vi.fn(async () => null),
  hasAssistantReply: vi.fn((items: { kind: string }[]) =>
    items.some(
      (it) => it.kind === "text" || it.kind === "tool" || it.kind === "result",
    ),
  ),
}))
vi.mock("@/lib/transcript", () => ({
  renderTranscript: vi.fn(() => "# transcript"),
  exportConvContext: vi.fn(async () => ".mycockpit/context/conv.md"),
  memoryPointerLine: (path: string) =>
    `Memória completa desta conversa (leia se precisar de mais contexto): ${path}`,
  buildMemoryPrompt: vi.fn(
    (_items: unknown, _pointer: string | null, prompt: string) => prompt,
  ),
  shouldAttachResumeFallback: vi.fn(() => false),
  buildResumeFallback: vi.fn(() => "[fallback-resume]"),
}))
vi.mock("@/lib/sources", () => ({
  readProjectCommands: vi.fn(async (): Promise<SlashCommand[]> => []),
}))
vi.mock("@/store/chat", () => ({
  useChat: { getState: () => h.chat },
  hasExecutorTurn: (items: { kind: string }[]) =>
    items.some((it) => it.kind !== "advice"),
  executorItems: (items: { kind: string }[]) =>
    items.filter((it) => it.kind !== "advice"),
  needsPersonaReinject: () => false,
}))
vi.mock("@/store/mission", () => ({ useMission: { getState: () => h.mission } }))
vi.mock("@/store/app", () => ({ useApp: { getState: () => h.app } }))
vi.mock("@/store/fusion", () => ({ useFusion: { getState: () => h.fusion } }))

const ITEMS: ChatItem[] = [
  { kind: "user", id: "u1", text: "implementa o login" },
  { kind: "text", id: "t1", text: "Implementado; testes verdes." },
]

function makeConv(partial: Partial<ConvState> = {}): ConvState {
  return {
    projectId: "p1",
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: ITEMS,
    sessionId: "sessao-claude-real",
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

function arm(conv: ConvState) {
  h.chat = {
    byId: { c1: conv } as Record<string, ConvState>,
    conversationsByProject: {} as Record<string, ConversationMeta[]>,
    ensureConversationLoaded: vi.fn(async () => {}),
    enqueue: vi.fn(),
    dequeueQueued: vi.fn((): QueuedMsg[] => []),
    cancelAutoResume: vi.fn(),
    setAutoResume: vi.fn(),
    invalidateSuggestions: vi.fn(),
    beginPreparation: vi.fn(),
    blockPreparation: vi.fn(),
    clearPreparation: vi.fn(),
    start: vi.fn(),
    beginTransplant: vi.fn(),
    stampPreset: vi.fn(async () => {}),
    dropNativeSession: vi.fn(),
    recordInjectedFingerprint: vi.fn(),
    handleEvent: vi.fn(),
    finish: vi.fn(),
    persist: vi.fn(async () => {}),
    scheduleSuggestions: vi.fn(),
    setPendingPlan: vi.fn(),
  }
}

/** Um .md de disco chamado "compactar": a interceptação tem que vencer. */
const COMPACTAR_MD: SlashCommand = {
  name: "compactar",
  description: null,
  kind: "command",
  origin: "project",
  source: "mycockpit",
  body: "ESTE CORPO NUNCA PODE VIAJAR",
}

const args = {
  convId: "c1",
  projectId: "p1",
  projectPath: "/proj",
  agent: "claude-code" as const,
  text: "/compactar",
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readDoctrine).mockResolvedValue({
    exists: false,
    content: "",
    bytes: 0,
  })
  vi.mocked(readProjectCommands).mockResolvedValue([COMPACTAR_MD])
  h.mission.byConv = {}
  h.fusion.byConv = {}
  arm(makeConv())
})

describe("sendFromDesk — /compactar em motor com nativeCompact (claude)", () => {
  it("vira o texto LITERAL /compact via resume: turno técnico, sem doutrina e sem tocar o inventário de .md", async () => {
    vi.mocked(readDoctrine).mockResolvedValue({
      exists: true,
      content: "- Testes em pt-BR.",
      bytes: 20,
    })
    await sendFromDesk(args)
    expect(vi.mocked(runAgent)).toHaveBeenCalledTimes(1)
    const call = vi.mocked(runAgent).mock.calls[0]
    expect(call[5]).toBe("/compact") // o prompt É a invocação nativa
    expect(call[7]).toBe("sessao-claude-real") // via resume da sessão
    expect(call[13]).toBeNull() // turno técnico: nada no canal system
    // a interceptação vence a expansão: o .md "compactar" nem é lido.
    expect(vi.mocked(readProjectCommands)).not.toHaveBeenCalled()
    // a bolha mostra o que você digitou; o aceite da mesa dispara.
    const start = h.chat.start as ReturnType<typeof vi.fn>
    expect(start).toHaveBeenCalledWith(
      "c1",
      "/compactar",
      expect.any(String),
      "claude-code",
      null,
      null,
      [],
    )
  })

  it("anuncia o turno técnico no fio (notice honesto, não bolha de assistente)", async () => {
    await sendFromDesk(args)
    const handleEvent = h.chat.handleEvent as ReturnType<typeof vi.fn>
    const notices = handleEvent.mock.calls
      .filter(([, e]) => (e as { type: string }).type === "notice")
      .map(([, e]) => (e as { message: string }).message)
    expect(notices.some((m) => m.includes("/compact") && m.includes("turno técnico"))).toBe(
      true,
    )
  })
})

describe("sendFromDesk — /compactar em motor SEM nativeCompact (codex)", () => {
  beforeEach(() => {
    arm(
      makeConv({
        agent: "codex",
        reqModel: "gpt-5.6-sol",
        sessionId: "thread-antiga",
      }),
    )
  })

  it("transplanta PARA SI MESMO: sessão fresca, memória emoldurada + ponteiro, nunca o /compactar cru", async () => {
    await sendFromDesk({ ...args, agent: "codex" })
    const begin = h.chat.beginTransplant as ReturnType<typeof vi.fn>
    expect(begin).toHaveBeenCalledWith("c1", expect.any(String), "codex", {
      model: "gpt-5.6-sol",
      effort: null,
      user: { text: "/compactar", attachments: [] },
    })
    const call = vi.mocked(runAgent).mock.calls[0]
    expect(call[2]).toBe("codex") // MESMO motor
    expect(call[7]).toBeNull() // sessão FRESCA (renovar É abrir mão da antiga)
    const prompt = call[5] as string
    expect(prompt).toContain(HISTORY_OPEN) // memória dentro da moldura H3
    expect(prompt).toContain("implementa o login")
    expect(prompt).toContain(".mycockpit/context/conv.md")
    expect(prompt).toContain(RENEWAL_INSTRUCTION)
    expect(prompt).not.toContain("/compactar") // o builtin nunca vira texto
    expect(vi.mocked(exportConvContext)).toHaveBeenCalledWith(
      "/proj",
      "c1",
      "# transcript",
    )
  })

  it("doutrina viaja FRESCA no corpo (freshSession; codex não tem canal system) e o fingerprint é carimbado", async () => {
    vi.mocked(readDoctrine).mockResolvedValue({
      exists: true,
      content: "- Testes em pt-BR.",
      bytes: 20,
    })
    await sendFromDesk({ ...args, agent: "codex" })
    const call = vi.mocked(runAgent).mock.calls[0]
    const prompt = call[5] as string
    expect(prompt).toContain("<doutrina")
    expect(prompt.indexOf("<doutrina")).toBeLessThan(prompt.indexOf(HISTORY_OPEN))
    expect(call[13]).toBeNull()
    expect(h.chat.recordInjectedFingerprint).toHaveBeenCalledWith(
      "c1",
      "doctrine",
      expect.any(String),
    )
  })

  it("anuncia a renovação no fio com copy honesta (sem prometer número)", async () => {
    await sendFromDesk({ ...args, agent: "codex" })
    const handleEvent = h.chat.handleEvent as ReturnType<typeof vi.fn>
    const notices = handleEvent.mock.calls
      .filter(([, e]) => (e as { type: string }).type === "notice")
      .map(([, e]) => (e as { message: string }).message)
    expect(notices.some((m) => m.includes("renovando a sessão"))).toBe(true)
    expect(notices.some((m) => /\d+\s*%/.test(m))).toBe(false)
  })

  it("sem conseguir salvar a memória plena, preserva a sessão e não abre uma nova", async () => {
    vi.mocked(exportConvContext).mockRejectedValueOnce(new Error("disco cheio"))
    await sendFromDesk({ ...args, agent: "codex" })
    expect(vi.mocked(runAgent)).not.toHaveBeenCalled()
    expect(vi.mocked(avisar.erro)).toHaveBeenCalledWith("A renovação não foi iniciada.", {
      detalhe: "Não foi possível salvar a memória completa; a sessão original foi preservada.",
    })
  })
})

describe("sendFromDesk — /compactar sem o que compactar (fail-closed no efeito)", () => {
  it("agy (sem sessionResume): nada dispara, motivo honesto no toast, rascunho preservado", async () => {
    arm(makeConv({ agent: "agy", sessionId: null }))
    const onAccepted = vi.fn()
    await sendFromDesk({ ...args, agent: "agy", onAccepted })
    expect(vi.mocked(runAgent)).not.toHaveBeenCalled()
    expect(h.chat.start).not.toHaveBeenCalled()
    expect(h.chat.beginTransplant).not.toHaveBeenCalled()
    expect(onAccepted).not.toHaveBeenCalled()
    expect(vi.mocked(avisar.nota)).toHaveBeenCalledWith(
      expect.stringContaining("Nada para compactar"),
    )
  })

  it("conversa sem turnos: idem (não há contexto acumulado)", async () => {
    arm(makeConv({ items: [] }))
    await sendFromDesk(args)
    expect(vi.mocked(runAgent)).not.toHaveBeenCalled()
    expect(vi.mocked(avisar.nota)).toHaveBeenCalledWith(
      expect.stringContaining("Nada para compactar"),
    )
  })
})

describe("sendFromDesk — /compactar com turno em andamento", () => {
  it("entra na fila como qualquer envio (a interceptação acontece na hora do despacho)", async () => {
    arm(makeConv({ running: true }))
    const onAccepted = vi.fn()
    await sendFromDesk({ ...args, onAccepted })
    expect(h.chat.enqueue).toHaveBeenCalledWith("c1", "/compactar", [], {
      autor: "humano",
    })
    expect(onAccepted).toHaveBeenCalledWith("queued")
    expect(vi.mocked(runAgent)).not.toHaveBeenCalled()
  })
})
