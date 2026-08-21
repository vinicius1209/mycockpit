// O gate de plano como PEDIDO PENDENTE — e o que separa ele dos outros dois.
//
// O buraco que isto fecha: `planGate` não aparecia em `store/interactions`,
// `notify.ts`, `InboxBell` nem `companion.ts`. A infraestrutura inteira de
// "precisa de você" existia e a aprovação mais cara do app estava fora dela,
// podendo te esperar em silêncio numa conversa que você não abriu.

import { beforeEach, describe, expect, it } from "vitest"
import {
  keepPlanningPrompt,
  planRequestId,
  stalePlanGateIds,
} from "./planGate"
import { useInteractions } from "@/store/interactions"
import type { PlanData } from "@/lib/interaction"

const pedido = (convId: string, gateId: string) => ({
  id: planRequestId(gateId),
  kind: "plan" as const,
  data: { convId, gateId, text: "plano" } satisfies PlanData,
})

beforeEach(() => useInteractions.setState({ queue: [] }))

describe("planRequestId", () => {
  it("é derivado do gate: um plano, um pedido", () => {
    // determinístico pra que re-enfileirar não crie um segundo pedido do mesmo
    // plano (o `push` da fila dedupa por id).
    expect(planRequestId("g1")).toBe(planRequestId("g1"))
    expect(planRequestId("g1")).not.toBe(planRequestId("g2"))
  })
})

describe("o pedido entra na fila que acende os canais", () => {
  it("push dedupa pelo id do gate", () => {
    useInteractions.getState().push(pedido("c1", "g1"))
    useInteractions.getState().push(pedido("c1", "g1"))
    expect(useInteractions.getState().queue).toHaveLength(1)
  })

  it("responder um gate NÃO fala com o backend (é local)", () => {
    // Sem run pausado do outro lado: em headless o turno já terminou. Se o
    // `answer` tentasse entregar, cairia no catch e devolveria o pedido pra
    // fila — o cartão voltaria pra tela depois de você decidir.
    useInteractions.getState().push(pedido("c1", "g1"))
    useInteractions.getState().answer(planRequestId("g1"), { decision: "approved" })
    expect(useInteractions.getState().queue).toHaveLength(0)
  })

  it("dispensar um gate é 'continuar planejando', não fail-closed", () => {
    const req = pedido("c1", "g1")
    useInteractions.getState().push(req)
    useInteractions.getState().dismiss(req)
    expect(useInteractions.getState().queue).toHaveLength(0)
  })
})

describe("stalePlanGateIds", () => {
  it("o gate corrente não é velho", () => {
    useInteractions.getState().push(pedido("c1", "g1"))
    expect(stalePlanGateIds("c1", "g1")).toEqual([])
  })

  it("plano anterior da MESMA conversa foi superado pelo novo", () => {
    useInteractions.getState().push(pedido("c1", "g1"))
    useInteractions.getState().push(pedido("c1", "g2"))
    expect(stalePlanGateIds("c1", "g2")).toEqual(["g1"])
  })

  it("não encosta em gate de OUTRA conversa", () => {
    useInteractions.getState().push(pedido("c1", "g1"))
    useInteractions.getState().push(pedido("c2", "g9"))
    expect(stalePlanGateIds("c1", "g2")).toEqual(["g1"])
  })
})

describe("keepPlanningPrompt", () => {
  it("diz que NÃO foi aprovado e manda continuar planejando", () => {
    const p = keepPlanningPrompt()
    expect(p).toContain("NÃO foi aprovado")
    expect(p).toContain("planejamento")
    // Sem isto o agente lê a recusa como ajuste e executa o plano recusado.
    expect(p).toContain("Não execute")
  })

  it("o motivo do usuário viaja junto, atribuído", () => {
    expect(keepPlanningPrompt("faltou o rollback")).toContain(
      "Motivo do usuário: faltou o rollback",
    )
  })

  it("motivo vazio não vira linha órfã", () => {
    expect(keepPlanningPrompt("   ")).not.toContain("Motivo do usuário")
  })
})
