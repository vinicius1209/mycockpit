import { describe, expect, it } from "vitest"
import type { InteractionRequest } from "@/lib/interaction"
import { conversasQuePedem, ehAtalhoDaProxima, proximaQuePede } from "./proximaQuePede"

// Shape real do backend: `run_id` irmão de `data` (approval.rs), e o gate de
// plano com a conversa no payload.
const aprovacao = (id: string, runId: string): InteractionRequest => ({
  id,
  run_id: runId,
  kind: "approval",
  data: { tool_name: "Bash", command: "ls", input: {} },
})
const plano = (id: string, convId: string): InteractionRequest => ({
  id,
  kind: "plan",
  data: { convId, plan: "1. ler" },
})

const chat = {
  byId: {
    a: { runId: "r-a", projectId: "p1" },
    b: { runId: "r-b", projectId: "p2" },
    c: { runId: null, projectId: "p1" },
    semProjeto: { runId: "r-x", projectId: null },
  },
}
const semMissoes = { byConv: {} }

describe("conversasQuePedem", () => {
  it("segue a ordem de chegada e conta cada conversa uma vez", () => {
    const fila = [aprovacao("1", "r-b"), aprovacao("2", "r-a"), aprovacao("3", "r-b"), plano("4", "c")]
    expect(conversasQuePedem(fila, chat, semMissoes)).toEqual([
      { convId: "b", projectId: "p2" },
      { convId: "a", projectId: "p1" },
      { convId: "c", projectId: "p1" },
    ])
  })

  it("deixa de fora pedido órfão e conversa sem projeto", () => {
    const fila = [aprovacao("1", "r-morto"), aprovacao("2", "r-x")]
    expect(conversasQuePedem(fila, chat, semMissoes)).toEqual([])
  })
})

describe("proximaQuePede", () => {
  const tres = [
    { convId: "b", projectId: "p2" },
    { convId: "a", projectId: "p1" },
    { convId: "c", projectId: "p1" },
  ]

  it("fora de uma que pede, vai à que espera há mais tempo", () => {
    expect(proximaQuePede(tres, "outra")?.convId).toBe("b")
    expect(proximaQuePede(tres, null)?.convId).toBe("b")
  })

  it("repetido, passa à seguinte e volta ao começo no fim", () => {
    expect(proximaQuePede(tres, "b")?.convId).toBe("a")
    expect(proximaQuePede(tres, "a")?.convId).toBe("c")
    expect(proximaQuePede(tres, "c")?.convId).toBe("b")
  })

  it("sem ninguém pedindo, não vai a lugar nenhum", () => {
    expect(proximaQuePede([], "a")).toBeNull()
  })
})

describe("ehAtalhoDaProxima", () => {
  const tecla = (p: Partial<Parameters<typeof ehAtalhoDaProxima>[0]>) => ({
    key: "a",
    code: "KeyA",
    metaKey: false,
    ctrlKey: false,
    shiftKey: true,
    altKey: false,
    ...p,
  })

  it("é ⌘⇧A no Mac e Ctrl+Shift+A no Linux", () => {
    expect(ehAtalhoDaProxima(tecla({ metaKey: true }), "MacIntel")).toBe(true)
    expect(ehAtalhoDaProxima(tecla({ ctrlKey: true }), "Linux x86_64")).toBe(true)
    expect(ehAtalhoDaProxima(tecla({ ctrlKey: true }), "MacIntel")).toBe(false)
    expect(ehAtalhoDaProxima(tecla({ metaKey: true, shiftKey: false }), "MacIntel")).toBe(false)
    expect(ehAtalhoDaProxima(tecla({ metaKey: true, altKey: true }), "MacIntel")).toBe(false)
  })
})
