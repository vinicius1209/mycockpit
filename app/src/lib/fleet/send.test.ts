// Testes de PARIDADE do send.ts com o handleSend do ChatPanel — a lista
// fechada do §9 do docs/agent-office.md. Stores e libs com efeito são mocados;
// o que se verifica é a COREOGRAFIA (guardas, argumentos do runAgent, finally).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { toast } from "sonner"
import { cancelAgent, runAgent } from "@/lib/agent"
import { wantsAutoResume } from "@/lib/autoResume"
import { listConversations, type ConversationMeta } from "@/lib/db/conversations"
import { buildDoctrineBlock, doctrineFingerprint, readDoctrine } from "@/lib/doctrine"
import { buildLearningBlocks, markLessonsUsed } from "@/lib/learning"
import { notifyTurnEnd } from "@/lib/notify"
import {
  personaHandoffBlock,
  resolveFirstTurnPersona,
  warnPresetDrift,
} from "@/lib/presets"
import { exportConvContext } from "@/lib/transcript"
import type { ChatItem, ConvState, QueuedMsg } from "@/store/chat"
import {
  cancelDeskTurn,
  continueInAgent,
  ensureDeskConversation,
  sendFromDesk,
} from "./send"

// Estado compartilhado com as factories dos mocks (vi.hoisted roda antes).
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
// só a DECISÃO é dublada (o teste controla o verdict); o texto do reenvio segue
// o real — é ele que precisa contar o gatilho certo ao agente.
vi.mock("@/lib/autoResume", async (io) => ({
  ...(await io<typeof import("@/lib/autoResume")>()),
  wantsAutoResume: vi.fn(() => ({ resume: false, delayMs: 0, reason: "" })),
}))
vi.mock("@/lib/db", () => ({ isTauri: () => true }))
vi.mock("@/lib/db/conversations", () => ({
  listConversations: vi.fn(async () => null),
}))
vi.mock("@/lib/handoff", () => ({
  buildHandoff: vi.fn(() => "[handoff]"),
  prepareHybridHandoff: vi.fn(async (input: {
    personaBlock?: string | null
    doctrineBlock?: string | null
    lessonsBlock?: string | null
    items: ChatItem[]
    pendingUserIndex: number
  }) => {
    const pending = input.items[input.pendingUserIndex]
    const text = pending?.kind === "user" ? pending.text : ""
    const prefix = [
      input.personaBlock,
      input.doctrineBlock,
      input.lessonsBlock,
      "[handoff]",
    ]
      .filter(Boolean)
      .join("\n\n")
    return {
      prompt: `${prefix}\n\nPedido pendente:\n${text}`,
      envelope: {},
      paths: {
        transcriptPath: ".mycockpit/context/c1.md",
        manifestPath: ".mycockpit/context/c1.handoff.json",
      },
    }
  }),
}))
// Doutrina: mantém as funções PURAS reais (o bloco e a regra de quando injetar
// têm testes próprios em doctrine.test.ts) e troca só a LEITURA de disco. O
// default é "projeto sem doutrina" — os outros testes de prompt seguem valendo.
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
// Presets (S3): o núcleo tem testes próprios (presets.test.ts); aqui só a
// COREOGRAFIA — none (default), ready (injeta+carimba) e blocked (aborta).
vi.mock("@/lib/presets", () => ({
  resolveFirstTurnPersona: vi.fn(async () => ({ status: "none" as const })),
  warnPresetDrift: vi.fn(async () => null),
  personaHandoffBlock: vi.fn(async () => null),
  // mesma regra da função real (pura)
  hasAssistantReply: vi.fn((items: { kind: string }[]) =>
    items.some(
      (it) => it.kind === "text" || it.kind === "tool" || it.kind === "result",
    ),
  ),
}))
vi.mock("@/lib/transcript", async (importOriginal) => ({
  // Predicados puros: implementação REAL (mock deles = segunda verdade).
  ...(await importOriginal<typeof import("@/lib/transcript")>()),
  renderTranscript: vi.fn(() => "# transcript"),
  exportConvContext: vi.fn(async () => ".mycockpit/context/conv.md"),
  buildMemoryPrompt: vi.fn(
    (_items: unknown, pointer: string | null, prompt: string) =>
      `[memória-agy|${pointer ?? "sem-ponteiro"}] ${prompt}`,
  ),
  buildResumeFallback: vi.fn(() => "[fallback-resume]"),
}))
vi.mock("@/store/chat", () => ({
  useChat: { getState: () => h.chat },
  hasExecutorTurn: (items: { kind: string }[]) => items.some((it) => it.kind !== "advice"),
  executorItems: (items: { kind: string }[]) => items.filter((it) => it.kind !== "advice"),
  needsPersonaReinject: (c: {
    presetId?: string | null
    presetDigest?: string | null
    items: { kind: string }[]
  }) =>
    c.presetId != null &&
    (c.presetDigest == null || c.presetDigest === "") &&
    c.items.some((it) => it.kind !== "advice"),
}))
vi.mock("@/store/mission", () => ({ useMission: { getState: () => h.mission } }))
vi.mock("@/store/app", () => ({ useApp: { getState: () => h.app } }))
vi.mock("@/store/fusion", () => ({ useFusion: { getState: () => h.fusion } }))

// ---------------------------------------------------------------- factories

function user(text: string): ChatItem {
  return { kind: "user", id: "u", text }
}

/** Resposta do assistant — o sinal de "o 1º prompt CHEGOU no CLI"
 *  (hasAssistantReply), que é o que fecha a porta da doutrina/persona. */
function assistant(text: string): ChatItem {
  return { kind: "text", id: "t", text } as ChatItem
}

/** Arma o disco com uma doutrina para ESTE teste (o default é sem doutrina). */
function comDoutrina(content: string) {
  vi.mocked(readDoctrine).mockResolvedValue({
    exists: true,
    content,
    bytes: content.length,
  })
}

/** Volta ao default: projeto sem `.mycockpit/instructions.md`. */
function semDoutrina() {
  vi.mocked(readDoctrine).mockResolvedValue({
    exists: false,
    content: "",
    bytes: 0,
  })
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
    stampPreset: vi.fn(async () => {}),
    dropNativeSession: vi.fn(),
    beginTransplant: vi.fn(),
    recordInjectedFingerprint: vi.fn(),
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
  // clearAllMocks zera CHAMADAS, não implementações: sem isto o comDoutrina de
  // um teste vazaria pro seguinte e mudaria todo prompt esperado.
  semDoutrina()
  h.mission.byConv = {}
  h.app.settings = { autoResume: false, autoResumeMaxTries: 5, detected: {} }
  h.fusion.byConv = {}
  arm(makeConv())
})

/** Probe de detecção pro cenário da guarda F-A (shape do AgentProbe real). */
function armDetected(agent: string, auth: "ok" | "missing" | "unknown" | "na") {
  h.app.settings.detected = {
    [agent]: {
      installed: true,
      version: "1.0.0",
      auth,
      detail: null,
      latest: null,
      checkedAt: 0,
    },
  }
}

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
    expect(chat.enqueue).toHaveBeenCalledWith("c1", "olá", [], { autor: "humano" })
    expect(runAgent).not.toHaveBeenCalled()
    expect(chat.start).not.toHaveBeenCalled()
    expect(onAccepted).toHaveBeenCalledWith("queued")
  })

  it("finalizando também enfileira (flush da sessão ainda em curso)", async () => {
    arm(makeConv({ finalizing: true }))
    await sendFromDesk(args)
    expect(chat.enqueue).toHaveBeenCalledWith("c1", "olá", [], { autor: "humano" })
    expect(runAgent).not.toHaveBeenCalled()
  })

  it("agent travado da conversa vence o agent da mesa", async () => {
    arm(makeConv({ agent: "codex", items: [user("antes")] }))
    await sendFromDesk(args) // mesa do claude-code
    expect(vi.mocked(runAgent).mock.calls[0][2]).toBe("codex")
  })

  it("F-A: CLI deslogada aborta ANTES do start, com aviso honesto e sem aceite", async () => {
    const onAccepted = vi.fn()
    armDetected("claude-code", "missing")
    await sendFromDesk({ ...args, onAccepted })
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("sem login"),
    )
    expect(chat.start).not.toHaveBeenCalled()
    expect(runAgent).not.toHaveBeenCalled()
    expect(onAccepted).not.toHaveBeenCalled()
  })

  it("F-A: a guarda vale pro agent EFETIVO (o travado da conversa, não o da mesa)", async () => {
    arm(makeConv({ agent: "codex", items: [user("antes")] }))
    armDetected("codex", "missing")
    await sendFromDesk(args) // mesa do claude-code, conversa travada no codex
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("Codex"),
    )
    expect(runAgent).not.toHaveBeenCalled()
  })

  it("F-A: auth incerta NÃO bloqueia (degradação honesta, o turno segue)", async () => {
    armDetected("claude-code", "unknown")
    await sendFromDesk(args)
    expect(runAgent).toHaveBeenCalled()
  })

  it("F-A: revezamento pra CLI deslogada aborta antes do transplant", async () => {
    arm(makeConv({ items: [user("pedido pendente")] }))
    armDetected("codex", "missing")
    await continueInAgent(args, "codex")
    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining("sem login"),
    )
    expect(chat.beginTransplant).not.toHaveBeenCalled()
    expect(runAgent).not.toHaveBeenCalled()
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

  // Memória SINTÉTICA (H5) é pra motor SEM resume: ramo sem motor despachável
  // desde que o agy 1.1.13 ganhou resume (transcript.test cobre a composição).
  it("agy passou a usar o resume nativo: prompt limpo, sem memória sintética", async () => {
    arm(makeConv({ agent: "agy", sessionId: "conv-agy-1", items: [user("antes")] }))
    await sendFromDesk({ ...args, agent: "agy" })
    const call = vi.mocked(runAgent).mock.calls[0]
    expect(call[5]).toBe("olá")
    expect(call[7]).toBe("conv-agy-1")
    expect(exportConvContext).toHaveBeenCalledWith("/proj", "c1", "# transcript")
    // e o fallback vale: o agy abre conversa NOVA quando o id não existe.
    expect(call[12]).toBeTruthy()
  })

  // ── Doutrina do projeto (.mycockpit/instructions.md) ──
  // A mesa manda pelo MESMO cano do chat: sem isto, enviar do Escritório
  // rodaria sem as regras do projeto — o mesmo bug que as lições já tiveram.
  // H1: o CANAL agora é por capability — claude (systemChannel) recebe pelo
  // canal system em TODO turno; codex/agy seguem com bloco no corpo.
  it("doutrina no corpo do 1º turno em motor sem canal system (codex)", async () => {
    comDoutrina("- Testes em pt-BR.")
    await sendFromDesk({ ...args, agent: "codex" })
    const call = vi.mocked(runAgent).mock.calls[0]
    const prompt = call[5]
    expect(prompt).toContain("<doutrina")
    expect(prompt).toContain("- Testes em pt-BR.")
    // o pedido do usuário continua no fim (a doutrina é prefixo, não substituto)
    expect(prompt.endsWith("olá")).toBe(true)
    expect(call[13]).toBeNull()
    // H4: o fingerprint da doutrina injetada é carimbado no ledger da conversa
    expect(chat.recordInjectedFingerprint).toHaveBeenCalledWith(
      "c1",
      "doctrine",
      expect.any(String),
    )
  })

  it("H1: claude recebe a doutrina pelo canal SYSTEM em todo turno, corpo limpo", async () => {
    comDoutrina("- Testes em pt-BR.")
    // sessionId: o cenário É mid-sessão ("todo turno"); sem ele seria um fork.
    arm(makeConv({ items: [user("antes"), assistant("respondi")], sessionId: "s" }))
    await sendFromDesk(args)
    const call = vi.mocked(runAgent).mock.calls[0]
    expect(call[5]).toBe("olá")
    expect(call[13]).toContain("<doutrina")
    expect(call[13]).toContain("- Testes em pt-BR.")
  })

  it("turno seguinte de codex NÃO repete a doutrina (resume carrega, ledger em dia)", async () => {
    comDoutrina("- Testes em pt-BR.")
    // ledger carimbado com o fingerprint ATUAL (estado normal mid-sessão: o
    // 1º turno injetou e carimbou) — sem o carimbo seria o cenário de restart,
    // que RE-INJETA de propósito (teste abaixo).
    const atual = doctrineFingerprint(buildDoctrineBlock("- Testes em pt-BR.")!)
    arm(
      makeConv({
        agent: "codex",
        items: [user("antes"), assistant("respondi")],
        injected: { doctrine: atual },
        sessionId: "sess-viva", // "resume carrega" exige sessão viva
      }),
    )
    await sendFromDesk({ ...args, agent: "codex" })
    const call = vi.mocked(runAgent).mock.calls[0]
    expect(call[5]).toBe("olá")
    expect(call[13]).toBeNull()
  })

  it("restart do app (ledger zerado) em conversa codex já rodada: re-injeta com o prefixo (edição offline não se perde)", async () => {
    comDoutrina("- Testes em pt-BR.")
    arm(makeConv({ agent: "codex", items: [user("antes"), assistant("respondi")] }))
    await sendFromDesk({ ...args, agent: "codex" })
    const prompt = vi.mocked(runAgent).mock.calls[0][5]
    expect(prompt).toContain("(doutrina atualizada)")
    expect(prompt).toContain("<doutrina")
    expect(prompt.endsWith("olá")).toBe(true)
  })

  it("H4: doutrina mudou mid-conversa → codex re-injeta com o prefixo honesto", async () => {
    comDoutrina("- Testes em pt-BR.")
    arm(
      makeConv({
        agent: "codex",
        items: [user("antes"), assistant("respondi")],
        // ledger com o fingerprint de uma doutrina ANTIGA (≠ da atual)
        injected: { doctrine: "fingerprint-antigo" },
      }),
    )
    await sendFromDesk({ ...args, agent: "codex" })
    const prompt = vi.mocked(runAgent).mock.calls[0][5]
    expect(prompt).toContain("(doutrina atualizada)")
    expect(prompt).toContain("<doutrina")
    expect(prompt.endsWith("olá")).toBe(true)
  })

  it("agy recebe a doutrina em TODO turno (não tem resume)", async () => {
    comDoutrina("- Testes em pt-BR.")
    arm(makeConv({ agent: "agy", items: [user("antes"), assistant("respondi")] }))
    await sendFromDesk({ ...args, agent: "agy" })
    expect(vi.mocked(runAgent).mock.calls[0][5]).toContain("<doutrina")
  })

  it("H2: o fingerprint do plano de MCPs da conversa viaja no run (ledger → mcpFingerprint)", async () => {
    arm(makeConv({ injected: { mcp: "fp-do-plano-anunciado" } }))
    await sendFromDesk(args)
    expect(vi.mocked(runAgent).mock.calls[0][14]).toBe("fp-do-plano-anunciado")
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

  it("no agy as lições entram no prompt sem envelope de memória sintética", async () => {
    vi.mocked(buildLearningBlocks).mockResolvedValueOnce({
      recall: null,
      lessons: "## Lições",
      lessonIds: ["l1"],
    })
    arm(makeConv({ agent: "agy", items: [user("antes")] }))
    await sendFromDesk({ ...args, agent: "agy" })
    expect(vi.mocked(runAgent).mock.calls[0][5]).toBe("## Lições\n\n---\n\nolá")
  })
})

describe("sendFromDesk — persona do preset (S3)", () => {
  it("preflight bloqueado ABORTA antes do start (fail-closed, run não inicia)", async () => {
    const onAccepted = vi.fn()
    vi.mocked(resolveFirstTurnPersona).mockResolvedValueOnce({
      status: "blocked",
      error: 'O preset "UI" referencia uma skill que não existe: /testes.',
    })
    await sendFromDesk({ ...args, onAccepted })
    expect(toast.error).toHaveBeenCalledWith(
      'O preset "UI" referencia uma skill que não existe: /testes.',
    )
    expect(chat.start).not.toHaveBeenCalled()
    expect(runAgent).not.toHaveBeenCalled()
    expect(onAccepted).not.toHaveBeenCalled()
  })

  it("1º turno com preset: bloco prependido, trio do preset assume e o digest é carimbado", async () => {
    arm(makeConv({ presetId: "pr1" }))
    vi.mocked(resolveFirstTurnPersona).mockResolvedValueOnce({
      status: "ready",
      block: '<persona name="UI Engineer">…</persona>',
      presetId: "pr1",
      digest: "digest-v1",
      name: "UI Engineer",
      agent: "codex",
      model: "gpt-x",
      effort: "high",
    })
    await sendFromDesk(args)
    const call = vi.mocked(runAgent).mock.calls[0]
    expect(call[2]).toBe("codex") // o preset define o trio, não a mesa
    expect(call[3]).toBe("gpt-x")
    expect(call[4]).toBe("high")
    expect(call[5]).toBe('<persona name="UI Engineer">…</persona>\n\nolá')
    expect(chat.stampPreset).toHaveBeenCalledWith(
      "c1",
      "pr1",
      "digest-v1",
      "UI Engineer",
    )
  })

  it("resume de conversa com preset carimbado dispara a verificação de drift", async () => {
    arm(
      makeConv({
        items: [
          user("primeiro turno"),
          { kind: "text", id: "t1", text: "resposta do agent" },
        ],
        presetId: "pr1",
        presetDigest: "digest-antigo",
        sessionId: "s1",
      }),
    )
    await sendFromDesk(args)
    expect(warnPresetDrift).toHaveBeenCalledWith(
      "c1",
      "pr1",
      "digest-antigo",
      "/proj", // personas moram em arquivo: sem o projeto, a de escopo local pareceria apagada
    )
    // e a persona NÃO re-injeta (locked + resposta chegam no resolvedor)
    expect(resolveFirstTurnPersona).toHaveBeenCalledWith(
      expect.objectContaining({ locked: true, presetId: "pr1", hasReply: true }),
    )
  })

  it("D1: travada SEM resposta chega no resolvedor com hasReply false (re-injeção)", async () => {
    arm(
      makeConv({
        items: [user("primeiro turno que morreu no spawn")],
        presetId: "pr1",
        presetDigest: "digest-do-run-morto",
      }),
    )
    vi.mocked(resolveFirstTurnPersona).mockResolvedValueOnce({
      status: "ready",
      block: "<persona>doutrina</persona>",
      presetId: "pr1",
      digest: "digest-novo",
      name: "UI Engineer",
      agent: "codex",
      model: null,
      effort: null,
    })
    await sendFromDesk(args)
    expect(resolveFirstTurnPersona).toHaveBeenCalledWith(
      expect.objectContaining({ locked: true, hasReply: false }),
    )
    // re-injeta + re-carimba; e o drift NÃO avisa (a doutrina re-chegou fresca)
    expect(vi.mocked(runAgent).mock.calls[0][5]).toBe(
      "<persona>doutrina</persona>\n\nolá",
    )
    expect(chat.stampPreset).toHaveBeenCalledWith(
      "c1",
      "pr1",
      "digest-novo",
      "UI Engineer",
    )
    expect(warnPresetDrift).not.toHaveBeenCalled()
  })

  it("S3.2 wheel-switch (backend novo, sessão fresca): a doutrina SEMPRE viaja no envelope (item 4 do review)", async () => {
    comDoutrina("- Testes em pt-BR.")
    // conversa claude com sessão nativa + reinject armado (presetDigest vazio
    // no mock do needsPersonaReinject) + persona nova rodando em CODEX →
    // wheelSwitch. Ledger com o fingerprint ATUAL: sem o freshSession, a
    // decisão diria "não repete" e a sessão FRESCA do codex assumiria sem
    // regra nenhuma (o gap pré-existente que o review mandou fechar).
    const atual = doctrineFingerprint(buildDoctrineBlock("- Testes em pt-BR.")!)
    arm(
      makeConv({
        items: [user("antes"), assistant("respondi")],
        sessionId: "s1",
        presetId: "pr1",
        presetDigest: "",
        injected: { doctrine: atual },
      }),
    )
    vi.mocked(resolveFirstTurnPersona).mockResolvedValueOnce({
      status: "ready",
      block: "<persona>nova</persona>",
      presetId: "pr1",
      digest: "digest-novo",
      name: "Nova",
      agent: "codex",
      model: null,
      effort: null,
    })
    await sendFromDesk(args)
    expect(chat.beginTransplant).toHaveBeenCalled()
    const prompt = vi.mocked(runAgent).mock.calls[0][5] as string
    // o mock do prepareHybridHandoff prependa os blocos recebidos: a doutrina
    // chegou ao envelope, SEM o prefixo de atualização (sessão nova, bloco novo)
    expect(prompt).toContain("<doutrina")
    expect(prompt).not.toContain("(doutrina atualizada)")
    expect(prompt).toContain("<persona>nova</persona>")
    expect(prompt).toContain("[handoff]")
  })

  it("D2: run que começou DURANTE o preflight enfileira em vez de dobrar o run", async () => {
    const onAccepted = vi.fn()
    arm(makeConv({ presetId: "pr1" }))
    vi.mocked(resolveFirstTurnPersona).mockImplementationOnce(async () => {
      // outro envio venceu a corrida enquanto o preflight rodava
      ;(h.chat.byId as Record<string, ConvState>).c1.running = true
      return { status: "none" as const }
    })
    await sendFromDesk({ ...args, onAccepted })
    expect(chat.enqueue).toHaveBeenCalledWith("c1", "olá", [], { autor: "humano" })
    expect(onAccepted).toHaveBeenCalledWith("queued")
    expect(chat.start).not.toHaveBeenCalled()
    expect(runAgent).not.toHaveBeenCalled()
  })

  it("conversa sem preset segue o caminho de hoje (sem drift, sem bloco)", async () => {
    await sendFromDesk(args)
    expect(warnPresetDrift).not.toHaveBeenCalled()
    expect(chat.stampPreset).not.toHaveBeenCalled()
    expect(vi.mocked(runAgent).mock.calls[0][5]).toBe("olá")
  })

  it("D3: transplant de conversa carimbada leva a doutrina no preâmbulo", async () => {
    arm(
      makeConv({
        items: [user("pedido pendente")],
        presetId: "pr1",
        presetDigest: "digest-carimbado",
      }),
    )
    vi.mocked(personaHandoffBlock).mockResolvedValueOnce(
      '<persona name="UI Engineer">doutrina</persona>',
    )
    await continueInAgent(args, "codex")
    expect(personaHandoffBlock).toHaveBeenCalledWith(
      "pr1",
      "digest-carimbado",
      "/proj",
    )
    const prompt = vi.mocked(runAgent).mock.calls[0][5] as string
    expect(prompt.startsWith('<persona name="UI Engineer">doutrina</persona>\n\n')).toBe(
      true,
    )
    expect(prompt).toContain("[handoff]")
    expect(prompt).toContain("pedido pendente")
  })

  it("D3: preset apagado → transplant segue SEM bloco (o warn de apagado cobre)", async () => {
    arm(
      makeConv({
        items: [user("pedido pendente")],
        presetId: "pr1",
        presetDigest: "digest-carimbado",
      }),
    )
    // default do mock: personaHandoffBlock → null (preset sumiu / sem carimbo)
    await continueInAgent(args, "codex")
    const prompt = vi.mocked(runAgent).mock.calls[0][5] as string
    expect(prompt.startsWith("[handoff]")).toBe(true)
  })
})

describe("sendFromDesk — finally", () => {
  it("finish + persist rodam mesmo quando o run falha", async () => {
    vi.mocked(runAgent).mockRejectedValueOnce("boom")
    await sendFromDesk(args)
    expect(chat.finish).toHaveBeenCalledWith("c1")
    expect(chat.persist).toHaveBeenCalledWith("c1")
    expect(toast.error).toHaveBeenCalledWith("boom")
    expect(chat.handleEvent).toHaveBeenCalledWith("c1", {
      type: "error",
      message: "boom",
    })
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
    h.app.settings = { autoResume: true, autoResumeMaxTries: 5, detected: {} }
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
    // dispara o timer → reenvio automático mínimo (resume/fallback carregam memória)
    await vi.advanceTimersByTimeAsync(1000)
    expect(runAgent).toHaveBeenCalledTimes(2)
    const prompt = vi.mocked(runAgent).mock.calls[1][5] as string
    expect(prompt).not.toContain("[handoff]")
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
    h.app.settings = { autoResume: true, autoResumeMaxTries: 2, detected: {} }
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
    h.app.settings = { autoResume: false, autoResumeMaxTries: 5, detected: {} }
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
