import { describe, expect, it } from "vitest"
import { esperandoVoce, type PedidoVivo } from "@/lib/sino/esperando"
import type { Decision } from "@/lib/inbox"

const NOW = 1_790_000_000_000

function pedido(p: Partial<PedidoVivo> & { id: string }): PedidoVivo {
  return {
    tipo: "permissao",
    convId: "c1",
    projectId: "p1",
    convTitle: "Revisão do PRD de edição",
    projectName: "frota",
    resumo: "rodar bun run check",
    ...p,
  }
}

const vazio = { pedidos: [], missoes: [], decisoes: [], ferramentas: [], now: NOW }

describe("esperandoVoce", () => {
  it("sem nada vivo, não há linha nem número", () => {
    expect(esperandoVoce(vazio)).toEqual({ itens: [], total: 0 })
  })

  it("vinte pedidos da mesma conversa são UMA linha e UMA espera", () => {
    const pedidos = Array.from({ length: 20 }, (_, i) => pedido({ id: `r${i}` }))
    const r = esperandoVoce({ ...vazio, pedidos })
    expect(r.itens).toHaveLength(1)
    expect(r.total).toBe(1)
    expect(r.itens[0].meta).toBe("Permissão · rodar bun run check (+19) · frota")
  })

  it("a linha mostra o primeiro da fila, que é o que a conversa mostra", () => {
    const r = esperandoVoce({
      ...vazio,
      pedidos: [
        pedido({ id: "r1", tipo: "pergunta", resumo: "Comentários" }),
        pedido({ id: "r2", tipo: "permissao", resumo: "rodar bun test" }),
      ],
    })
    expect(r.itens[0].meta).toBe("Pergunta · Comentários (+1) · frota")
  })

  it("pedido de sessão no terminal não tem conversa, e cada um conta sozinho", () => {
    const r = esperandoVoce({
      ...vazio,
      pedidos: [
        pedido({ id: "h1", convId: null, convTitle: "Claude no terminal" }),
        pedido({ id: "h2", convId: null, convTitle: "Codex no terminal" }),
      ],
    })
    expect(r.itens.map((i) => i.titulo)).toEqual(["Claude no terminal", "Codex no terminal"])
    expect(r.total).toBe(2)
  })

  it("pedido e gate na mesma conversa são duas linhas e uma espera", () => {
    const r = esperandoVoce({
      ...vazio,
      pedidos: [pedido({ id: "r1" })],
      missoes: [
        {
          convId: "c1",
          projectId: "p1",
          convTitle: "Revisão do PRD de edição",
          projectName: "frota",
          motivo: "gate",
          fase: "Planejar",
        },
      ],
    })
    expect(r.itens).toHaveLength(2)
    expect(r.total).toBe(1)
    expect(r.itens[1].meta).toBe("Missão pausada · a fase Planejar deixou perguntas · frota")
  })

  it("a recuperação diz que a fase precisa de outro agente", () => {
    const r = esperandoVoce({
      ...vazio,
      missoes: [
        { convId: "c9", projectId: "p1", convTitle: "Missão", projectName: "frota", motivo: "recuperacao", fase: "Revisar" },
      ],
    })
    expect(r.itens[0].meta).toBe("Missão parada · a fase Revisar precisa de outro agente · frota")
  })

  it("disputa conta pela conversa; card, proposta e CLI contam cada um", () => {
    const decisoes: Decision[] = [
      { kind: "fusion", convId: "c1", projectId: "p1", projectName: "frota", title: "Qual abordagem?", createdAt: NOW - 60_000 },
      { kind: "card", cardId: "k1", projectId: "p1", projectName: "frota", title: "Migrar o sino", state: "review" },
      { kind: "proposal", proposalId: "pr1", excerpt: "Dividir o épico", body: "Dividir o épico", createdAt: NOW - 1 },
    ]
    const r = esperandoVoce({
      ...vazio,
      pedidos: [pedido({ id: "r1" })],
      decisoes,
      ferramentas: [{ agent: "codex", label: "Codex" }],
    })
    // c1 (pedido + disputa) + card + proposta + CLI
    expect(r.total).toBe(4)
    expect(r.itens.map((i) => i.titulo)).toEqual([
      "Revisão do PRD de edição",
      "Escolher o vencedor da disputa",
      "Card em revisão: Migrar o sino",
      "Ver proposta do lead",
      "Codex sem login",
    ])
  })

  it("idade só com carimbo real", () => {
    const r = esperandoVoce({
      ...vazio,
      pedidos: [pedido({ id: "r1" }), pedido({ id: "r2", convId: "c2" })],
      desdeDe: (convId) => (convId === "c1" ? NOW - 12 * 60_000 : null),
    })
    expect(r.itens.map((i) => i.desde)).toEqual([NOW - 12 * 60_000, null])
  })

  it("card parado diz há quanto tempo, a partir do relógio injetado", () => {
    const r = esperandoVoce({
      ...vazio,
      decisoes: [
        { kind: "card", cardId: "k1", projectId: "p1", projectName: "frota", title: "X", state: "blocked", stalledSince: NOW - 30 * 60_000 },
      ],
    })
    expect(r.itens[0].meta).toBe("frota · parado há 30 min")
  })
})
