// Testes do AVISO de interação pendente (store/interactions → lib/notify).
//
// O buraco que isto fecha: `announceArrival` filtrava `kind !== "approval"` e
// saía — uma PERGUNTA (`ask_user`) deixava o turno parado e não avisava nem no
// sino nem no SO. Pior: o `convIdForInteraction` devolve null p/ question, então
// mesmo cobrindo o kind o aviso morreria sem dono. Por isso a notificação usa
// `ownerByRunId` — que hoje é a régua de todo mundo que responde "quem está
// esperando você" (aviso, card inline, sinal da sidebar); o
// `convIdForInteraction` ficou só com as superfícies de permissão (o item de
// aprovação do companion, via lib/fleet/derive).

import { beforeEach, describe, expect, it, vi } from "vitest"
import type { InteractionRequest } from "@/lib/interaction"
import { notifyApproval, notifyQuestion } from "@/lib/notify"
import { useApp } from "@/store/app"
import { useChat, type ConvState } from "@/store/chat"
import { useMission } from "@/store/mission"
import {
  announceArrival,
  currentOriginAnyKind,
  questionHeadline,
  useInteractions,
} from "./interactions"

vi.mock("@/lib/interaction", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/interaction")>()
  return { ...mod, answerInteraction: vi.fn(async () => {}) }
})
vi.mock("@/lib/notify", () => ({
  notifyApproval: vi.fn(),
  notifyQuestion: vi.fn(),
  notifyTurnEnd: vi.fn(),
  notifyGate: vi.fn(),
}))

const RUN = "run-1"

function conversa(projectId: string, patch: Partial<ConvState> = {}): ConvState {
  return {
    projectId,
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
    ...patch,
  }
}

// `runId: null` = pedido órfão. Não usar `undefined` aqui: em JS o argumento
// undefined ATIVA o default do parâmetro e o "órfão" viria com run_id preenchido.
function pergunta(id: string, runId: string | null = RUN): InteractionRequest {
  return {
    id,
    run_id: runId ?? undefined,
    kind: "question",
    data: {
      questions: [
        {
          header: "Migração",
          question: "Como resolver as datas?",
          multiSelect: false,
          options: [{ label: "adapter", description: "" }],
        },
      ],
    },
  }
}

function aprovacao(id: string): InteractionRequest {
  return {
    id,
    run_id: RUN,
    kind: "approval",
    data: { tool_name: "Bash", command: "rm -rf build", input: {} },
  }
}

/** Estado com UMA conversa rodando o RUN, no projeto "px". */
function cenarioBase() {
  useChat.setState({
    projectId: "px",
    activeId: "cx",
    conversations: [
      { id: "cx", title: "Migrar eventos", updatedAt: 0, color: null, worktreePath: null, agent: null },
    ],
    conversationsByProject: {
      px: [
        { id: "cx", title: "Migrar eventos", updatedAt: 0, color: null, worktreePath: null, agent: null },
      ],
    },
    byId: { cx: conversa("px", { runId: RUN, running: true }) },
    queuedPrompt: null,
  })
  useApp.setState({
    projects: [{ id: "px", name: "mycockpit", path: "/px", createdAt: 0 }],
    activeProjectId: "px",
    viewMode: "linear",
    scheduledOpen: false,
  })
  useMission.setState({ byConv: {} })
}

beforeEach(() => {
  useInteractions.setState({ queue: [] })
  cenarioBase()
  vi.mocked(notifyApproval).mockClear()
  vi.mocked(notifyQuestion).mockClear()
})

describe("questionHeadline", () => {
  it("usa o header da 1ª pergunta (o rótulo curto que o modelo escolheu)", () => {
    expect(
      questionHeadline({
        questions: [
          { header: "Migração", question: "Como?", multiSelect: false, options: [] },
        ],
      }),
    ).toBe("Migração")
  })

  it("sem header, cai no enunciado cortado", () => {
    const q = "a".repeat(80)
    expect(
      questionHeadline({
        questions: [{ header: "", question: q, multiSelect: false, options: [] }],
      }),
    ).toBe(`${"a".repeat(60)}…`)
  })

  it("payload vazio/ausente não quebra", () => {
    expect(questionHeadline(undefined)).toBe("uma decisão")
    expect(questionHeadline({ questions: [] })).toBe("uma decisão")
  })
})

describe("dono do pedido (ownerByRunId via currentOriginAnyKind)", () => {
  it("resolve a conversa dona de uma PERGUNTA pelo run_id", () => {
    // é o que o convIdForInteraction NÃO faz (recorte approval-only) e o que sem
    // isso deixava o aviso de pergunta sem para onde apontar.
    const o = currentOriginAnyKind(pergunta("q1"))
    expect(o?.convId).toBe("cx")
    expect(o?.projectId).toBe("px")
    expect(o?.projectName).toBe("mycockpit")
    expect(o?.convTitle).toBe("Migrar eventos")
  })

  it("pergunta sem run_id continua órfã (não inventa dono)", () => {
    expect(currentOriginAnyKind(pergunta("q1", null))).toBeNull()
  })
})

describe("announceArrival — o aviso que faltava", () => {
  it("PERGUNTA avisa, com headline, contagem e a conversa dona", () => {
    announceArrival(pergunta("q1"), [])
    expect(notifyQuestion).toHaveBeenCalledTimes(1)
    expect(notifyQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        convId: "cx",
        projectId: "px",
        projectName: "mycockpit",
        convTitle: "Migrar eventos",
        headline: "Migração",
        count: 1,
      }),
    )
    expect(notifyApproval).not.toHaveBeenCalled()
  })

  it("várias perguntas no mesmo pedido entram na contagem", () => {
    const req = pergunta("q1")
    ;(req.data as { questions: unknown[] }).questions.push({
      header: "Segunda",
      question: "E isso?",
      multiSelect: false,
      options: [],
    })
    announceArrival(req, [])
    expect(notifyQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ count: 2 }),
    )
  })

  it("APROVAÇÃO continua avisando (não quebrou o que existia)", () => {
    announceArrival(aprovacao("a1"), [])
    expect(notifyApproval).toHaveBeenCalledTimes(1)
    expect(notifyApproval).toHaveBeenCalledWith(
      expect.objectContaining({ convId: "cx", toolName: "Bash" }),
    )
    expect(notifyQuestion).not.toHaveBeenCalled()
  })

  it("rajada: 2ª pergunta da MESMA conversa não repete o aviso", () => {
    announceArrival(pergunta("q2"), [pergunta("q1")])
    expect(notifyQuestion).not.toHaveBeenCalled()
  })

  it("rajada é por CONVERSA: pedido de outra conversa ainda avisa", () => {
    // fila já tem um pedido de OUTRO run/conversa → não é rajada desta.
    useChat.setState({
      byId: {
        cx: conversa("px", { runId: RUN, running: true }),
        cy: conversa("px", { runId: "run-2", running: true }),
      },
    })
    const outra: InteractionRequest = { ...pergunta("q0"), run_id: "run-2" }
    announceArrival(pergunta("q1"), [outra])
    expect(notifyQuestion).toHaveBeenCalledTimes(1)
  })

  it("run órfão não avisa (sem conversa dona não há onde te mandar)", () => {
    announceArrival(pergunta("q1", null), [])
    expect(notifyQuestion).not.toHaveBeenCalled()
  })

  it("fora de foco ⇒ seen=false (a nativa é o único sinal que te alcança)", () => {
    // sem `document` no ambiente de teste, focused=false → seen=false.
    announceArrival(pergunta("q1"), [])
    expect(notifyQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ seen: false }),
    )
  })
})

describe("fila", () => {
  it("aprovação e pergunta convivem sem se anular", () => {
    useInteractions.getState().push(aprovacao("a1"))
    useInteractions.getState().push(pergunta("q1"))
    expect(useInteractions.getState().queue.map((r) => r.kind)).toEqual([
      "approval",
      "question",
    ])
  })
})
