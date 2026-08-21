// O gate do "Planejar primeiro" agora é ITEM do fio, e não campo de runtime.
//
// O que motivou: o usuário pediu um plano ao agy, o cartão de aprovar/negar
// apareceu, e depois de reabrir o app não havia mais nem o pedido nem rastro de
// que ele existiu. Fomos no banco da conversa real (450ce8e3…) e ela tinha 31
// `tool`, 2 `user`, 2 `text`, 2 `result` — nada sobre o plano. `pendingPlan`
// era estado de runtime, e uma DECISÃO DO HUMANO não pode morar aí.
//
// Estes testes fixam as duas metades: o que conta como "na mesa" (puro) e a
// durabilidade (o item vive em `items`, que o dbSave já grava).

import { beforeEach, describe, expect, it, vi } from "vitest"
import { pendingPlanGate } from "./planMode"
import { renderTranscript } from "./transcript"
import { useChat, type ChatItem } from "@/store/chat"

vi.mock("@/lib/db", async (o) => ({
  ...(await o<typeof import("@/lib/db")>()),
  isTauri: () => false,
}))

const user = (id: string): ChatItem => ({ kind: "user", id, text: "faz" })
const texto = (id: string, t = "plano proposto"): ChatItem => ({
  kind: "text",
  id,
  text: t,
})
const gate = (id: string, decision?: "approved" | "discarded"): ChatItem => ({
  kind: "planGate",
  id,
  text: "1. fazer isso\n2. fazer aquilo",
  ...(decision ? { decision } : {}),
})

describe("pendingPlanGate", () => {
  it("gate sem decisão está na mesa", () => {
    expect(pendingPlanGate([texto("t1"), gate("g1")])?.id).toBe("g1")
  })

  it("gate decidido sai da mesa, mas continua no fio", () => {
    const fio = [texto("t1"), gate("g1", "approved")]
    expect(pendingPlanGate(fio)).toBeNull()
    expect(fio.some((i) => i.kind === "planGate")).toBe(true)
  })

  it("mandar outra coisa tira o gate da mesa SEM carimbar decisão", () => {
    // Seguir em frente não é aprovar nem descartar. O cartão sai da tela e o
    // item fica registrado como proposto-e-não-decidido, que é a verdade.
    const fio = [gate("g1"), user("u2")]
    expect(pendingPlanGate(fio)).toBeNull()
    const g = fio.find((i) => i.kind === "planGate")
    expect(g && "decision" in g ? g.decision : undefined).toBeUndefined()
  })

  it("fio sem gate nenhum", () => {
    expect(pendingPlanGate([user("u1"), texto("t1")])).toBeNull()
  })

  it("o gate MAIS RECENTE é o que vale", () => {
    const fio = [gate("g1", "discarded"), texto("t1"), gate("g2")]
    expect(pendingPlanGate(fio)?.id).toBe("g2")
  })
})

describe("o gate sobrevive ao que matava o antigo pendingPlan", () => {
  const P = "p1"
  const base = {
    projectId: P,
    agent: "agy",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: [] as ChatItem[],
    sessionId: null,
    model: null,
    contextTokens: 0,
    streamingTextId: null,
    running: false,
    finalizing: false,
    runId: null,
    startedAt: null,
    suggestions: [],
    suggesting: false,
  }

  beforeEach(() => {
    const metas = [
      { id: "c1", title: "a", updatedAt: 0, color: null, worktreePath: null, agent: "agy" },
    ]
    useChat.setState({
      projectId: P,
      activeId: "c1",
      conversations: metas,
      conversationsByProject: { [P]: metas },
      byId: { c1: { ...base, items: [texto("t1")] } as never },
    })
  })

  it("o plano entra em `items` — que é o que o banco grava", () => {
    useChat.getState().pushPlanGate("c1", "PLANO")
    const items = useChat.getState().byId.c1.items
    expect(items.at(-1)).toMatchObject({ kind: "planGate", text: "PLANO" })
    // A prova da durabilidade: `items` é a coluna persistida. O antigo
    // `pendingPlan` não tinha coluna nenhuma — some no restart e some calado.
    expect(pendingPlanGate(items)).not.toBeNull()
  })

  it("decidir carimba SEM apagar (o cartão vira histórico)", () => {
    useChat.getState().pushPlanGate("c1", "PLANO")
    const id = useChat.getState().byId.c1.items.at(-1)!.id
    useChat.getState().decidePlanGate("c1", id, "approved")
    const item = useChat.getState().byId.c1.items.at(-1)!
    expect(item).toMatchObject({ kind: "planGate", decision: "approved" })
  })

  it("decidir duas vezes não sobrescreve a primeira decisão", () => {
    useChat.getState().pushPlanGate("c1", "PLANO")
    const id = useChat.getState().byId.c1.items.at(-1)!.id
    useChat.getState().decidePlanGate("c1", id, "discarded")
    useChat.getState().decidePlanGate("c1", id, "approved")
    expect(useChat.getState().byId.c1.items.at(-1)).toMatchObject({
      decision: "discarded",
    })
  })

  it("carimbar preserva a REFERÊNCIA dos outros itens (o memo por item)", () => {
    const antes = useChat.getState().byId.c1.items[0]
    useChat.getState().pushPlanGate("c1", "PLANO")
    const id = useChat.getState().byId.c1.items.at(-1)!.id
    useChat.getState().decidePlanGate("c1", id, "approved")
    expect(useChat.getState().byId.c1.items[0]).toBe(antes)
  })
})

describe("o transcript conta a DECISÃO, não o plano", () => {
  it("aprovado", () => {
    const t = renderTranscript([texto("t1"), gate("g1", "approved")], { agent: "agy" })
    expect(t).toContain("APROVOU")
  })

  it("descartado", () => {
    expect(renderTranscript([gate("g1", "discarded")], { agent: "agy" })).toContain("DESCARTOU")
  })

  it("não decidido avisa pra NÃO executar", () => {
    const t = renderTranscript([gate("g1")], { agent: "agy" })
    expect(t).toContain("não execute")
  })

  it("não repete o texto do plano (ele já está acima, como fala do agente)", () => {
    const t = renderTranscript([texto("t1", "1. fazer isso"), gate("g1", "approved")], { agent: "agy" })
    expect(t.match(/fazer isso/g)?.length).toBe(1)
  })
})
