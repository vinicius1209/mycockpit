// Testes da fila ÚNICA de interações (store/interactions): request agrega
// (dedup por id; pergunta vazia é respondida fail-closed sem enfileirar),
// answer responde o backend E remove NA HORA (o backend não emite resolved
// pra respostas do usuário), resolved do Drop remove.

import { beforeEach, describe, expect, it, vi } from "vitest"
import { answerInteraction, type InteractionRequest } from "@/lib/interaction"
import { useInteractions } from "./interactions"

// Só o efeito (invoke Tauri) é mocado; failClosedAnswer & cia seguem reais.
vi.mock("@/lib/interaction", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/interaction")>()
  return { ...mod, answerInteraction: vi.fn(async () => {}) }
})

function aprovacao(id: string): InteractionRequest {
  return {
    id,
    kind: "approval",
    data: { run_id: "r-1", tool_name: "Bash", command: "ls", input: {} },
  }
}

beforeEach(() => {
  useInteractions.setState({ queue: [] })
  vi.mocked(answerInteraction).mockClear()
})

describe("useInteractions", () => {
  it("request agrega em ordem FIFO e dedupa por id (re-emit/compat)", () => {
    const { push } = useInteractions.getState()
    push(aprovacao("i1"))
    push(aprovacao("i2"))
    push(aprovacao("i1")) // duplo canal de compat não duplica o card
    expect(useInteractions.getState().queue.map((r) => r.id)).toEqual([
      "i1",
      "i2",
    ])
  })

  it("pergunta VAZIA nem enfileira: responde fail-closed direto (achado M4)", () => {
    useInteractions
      .getState()
      .push({ id: "q0", kind: "question", data: { questions: [] } })
    expect(useInteractions.getState().queue).toHaveLength(0)
    expect(answerInteraction).toHaveBeenCalledWith("q0", { answers: [] })
  })

  it("answer responde o backend e REMOVE da fila imediatamente", () => {
    const { push, answer } = useInteractions.getState()
    push(aprovacao("i1"))
    answer("i1", { allow: true })
    expect(useInteractions.getState().queue).toHaveLength(0)
    expect(answerInteraction).toHaveBeenCalledWith("i1", { allow: true })

    // id já removido ⇒ não re-envia (double-click não duplica resposta)
    answer("i1", { allow: false })
    expect(answerInteraction).toHaveBeenCalledTimes(1)
  })

  it("resolved do backend (Drop fail-closed no fim do run) remove da fila", () => {
    const { push, resolve } = useInteractions.getState()
    push(aprovacao("i1"))
    push(aprovacao("i2"))
    resolve("i1")
    expect(useInteractions.getState().queue.map((r) => r.id)).toEqual(["i2"])
  })

  it("dismiss responde fail-closed e remove", () => {
    const req = aprovacao("i1")
    useInteractions.getState().push(req)
    useInteractions.getState().dismiss(req)
    expect(useInteractions.getState().queue).toHaveLength(0)
    expect(answerInteraction).toHaveBeenCalledWith("i1", {
      allow: false,
      message: "dispensado pelo usuário",
    })
  })
})
