// Review gate G2 (correção 1) — o furo que reprovou a fase: comando NATIVO
// cru enterrado atrás de bloco prependido. Conversa claude + comando de fonte
// claude sobrevivia CRU na expansão normal; a doutrina/lições prependavam e o
// prompt final virava `[bloco]\n\n/review` — barra morta (o CLI só interpreta
// "/" quando o prompt INTEIRO é a invocação). A lição do ADR-016: este é o
// teste que faltou. Scaffolding espelha o send.test.ts (só o subset usado).
import { beforeEach, describe, expect, it, vi } from "vitest"
import { runAgent } from "@/lib/agent"
import type { ConversationMeta } from "@/lib/db/conversations"
import { readDoctrine } from "@/lib/doctrine"
import { buildLearningBlocks } from "@/lib/learning"
import { readProjectCommands, type SlashCommand } from "@/lib/sources"
import type { ChatItem, ConvState, QueuedMsg } from "@/store/chat"
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

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}))
vi.mock("@/lib/agent", () => ({
  runAgent: vi.fn(async () => {}),
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
vi.mock("@/lib/transcript", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/transcript")>()),
  renderTranscript: vi.fn(() => "# transcript"),
  exportConvContext: vi.fn(async () => ".mycockpit/context/conv.md"),
  buildMemoryPrompt: vi.fn(
    (_items: unknown, _pointer: string | null, prompt: string) => prompt,
  ),
  shouldAttachResumeFallback: vi.fn(() => false),
  buildResumeFallback: vi.fn(() => "[fallback-resume]"),
}))
// O inventário de comandos "/" POR AGENT — a peça nova deste cenário.
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

function makeConv(partial: Partial<ConvState> = {}): ConvState {
  return {
    projectId: "p1",
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: [] as ChatItem[],
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
    start: vi.fn(),
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

/** Comando NATIVO do claude no inventário do projeto (fonte "claude"). */
const REVIEW_NATIVO: SlashCommand = {
  name: "review",
  description: null,
  kind: "command",
  origin: "project",
  source: "claude",
  body: "Revise o diff com atenção.",
}

const args = {
  convId: "c1",
  projectId: "p1",
  projectPath: "/proj",
  agent: "claude-code" as const,
  text: "/review",
}

function comDoutrina(content: string) {
  vi.mocked(readDoctrine).mockResolvedValue({
    exists: true,
    content,
    bytes: content.length,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readDoctrine).mockResolvedValue({
    exists: false,
    content: "",
    bytes: 0,
  })
  vi.mocked(buildLearningBlocks).mockResolvedValue({
    recall: null,
    lessons: null,
    lessonIds: [],
  })
  vi.mocked(readProjectCommands).mockResolvedValue([REVIEW_NATIVO])
  h.mission.byConv = {}
  h.fusion.byConv = {}
  arm(makeConv())
})

describe("sendFromDesk — comando nativo × blocos prependidos (review gate G2)", () => {
  // H1 mudou o cenário original do furo: em conversa claude a doutrina NÃO
  // prependa mais o corpo (viaja no canal SYSTEM, re-enviada a cada spawn), e
  // por isso o /review nativo pode seguir CRU — o prompt inteiro é a
  // invocação, que é exatamente o contrato que o G2 protege. O que não pode
  // acontecer NUNCA: a barra crua atrás de um bloco no corpo (teste seguinte,
  // com lições, continua cobrando isso).
  it("H1: doutrina em conversa claude vai pro canal system e o /review nativo segue CRU no corpo", async () => {
    comDoutrina("- Testes em pt-BR.")
    await sendFromDesk(args)
    const call = vi.mocked(runAgent).mock.calls[0]
    const prompt = call[5] as string
    expect(prompt).toBe("/review")
    const systemPrompt = call[13] as string | null
    expect(systemPrompt).toContain("<doutrina")
    expect(systemPrompt).toContain("- Testes em pt-BR.")
  })

  it("CENÁRIO DO FURO (corpo): doutrina em motor SEM canal system prependa e o /comando expande (a barra não morre atrás do bloco)", async () => {
    comDoutrina("- Testes em pt-BR.")
    // comando de fonte codex (a convenção ~/.codex/prompts entra no inventário)
    vi.mocked(readProjectCommands).mockResolvedValue([
      { ...REVIEW_NATIVO, source: "codex" },
    ])
    await sendFromDesk({ ...args, agent: "codex" })
    const call = vi.mocked(runAgent).mock.calls[0]
    const prompt = call[5] as string
    expect(prompt).toContain("<doutrina")
    expect(prompt.endsWith("Revise o diff com atenção.")).toBe(true)
    // a barra crua NÃO pode sobrar no prompt: atrás da doutrina é texto morto.
    expect(prompt).not.toContain("/review")
    // e nada vai pro canal system (codex não tem canal são — §7.1)
    expect(call[13]).toBeNull()
  })

  it("lições prependidas também disparam a re-expansão (qualquer bloco conta)", async () => {
    vi.mocked(buildLearningBlocks).mockResolvedValue({
      recall: null,
      lessons: "## Lições",
      lessonIds: ["l1"],
    })
    await sendFromDesk(args)
    const prompt = vi.mocked(runAgent).mock.calls[0][5] as string
    expect(prompt).toBe("## Lições\n\n---\n\nRevise o diff com atenção.")
  })

  it("SEM bloco nenhum, o comando nativo segue CRU (o prompt inteiro é a invocação)", async () => {
    await sendFromDesk(args)
    expect(vi.mocked(runAgent).mock.calls[0][5]).toBe("/review")
  })

  it("comando NÃO-nativo já expandido não re-expande nem quebra com doutrina", async () => {
    comDoutrina("- Testes em pt-BR.")
    vi.mocked(readProjectCommands).mockResolvedValue([
      { ...REVIEW_NATIVO, source: "mycockpit" },
    ])
    await sendFromDesk(args)
    const call = vi.mocked(runAgent).mock.calls[0]
    const prompt = call[5] as string
    // conversa claude: a doutrina está no canal system, não no corpo (H1) —
    // o corpo é só a expansão do comando.
    expect(prompt).toBe("Revise o diff com atenção.")
    expect(call[13]).toContain("<doutrina")
    // a expansão normal já resolveu; a re-expansão é no-op (uma leitura só a mais, nenhuma)
    expect(vi.mocked(readProjectCommands)).toHaveBeenCalledTimes(1)
  })
})
