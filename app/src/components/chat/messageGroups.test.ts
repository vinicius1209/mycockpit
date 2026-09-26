import { describe, expect, it } from "vitest"
import { buildNodes } from "./messageNodes"
import { estreiasDeEspecialista, groupByAuthor, groupTs, nodeAuthor } from "./messageGroups"
import type { ChatItem } from "@/store/chat"

const user = (id: string, text: string): ChatItem => ({ kind: "user", id, text })
const text = (id: string, t: string): ChatItem => ({ kind: "text", id, text: t })
const advice = (id: string, personaId: string, name: string): ChatItem => ({
  kind: "advice",
  id,
  personaId,
  personaName: name,
  personaVersion: 1,
  digest: "d",
  question: "?",
  text: "parecer",
})

describe("nodeAuthor — quem assina cada tipo de item", () => {
  it("user vira 'você'", () => {
    const [n] = buildNodes([user("u1", "oi")])
    expect(nodeAuthor(n).kind).toBe("you")
  })

  it("texto do assistente vira 'executor'", () => {
    const [n] = buildNodes([text("t1", "resposta")])
    expect(nodeAuthor(n).kind).toBe("executor")
  })

  it("advice vira 'especialista' carimbado com a persona", () => {
    const [n] = buildNodes([advice("a1", "aline", "Aline")])
    const a = nodeAuthor(n)
    expect(a.kind).toBe("especialista")
    if (a.kind !== "especialista") throw new Error("esperava especialista")
    expect(a.personaId).toBe("aline")
    expect(a.personaName).toBe("Aline")
  })

  it("cancelled e notice viram 'system' (voz sem dono)", () => {
    const [c] = buildNodes([{ kind: "cancelled", id: "c1" }])
    const [nt] = buildNodes([{ kind: "notice", id: "n1", message: "aviso" }])
    expect(nodeAuthor(c).kind).toBe("system")
    expect(nodeAuthor(nt).kind).toBe("system")
  })
})

describe("groupByAuthor — colapsa contíguos, quebra na troca de autor", () => {
  it("nós seguidos do executor colapsam num grupo só", () => {
    const nodes = buildNodes([
      text("t1", "Primeiro passo."),
      text("t2", "Segundo passo."),
    ])
    const groups = groupByAuthor(nodes)
    expect(groups).toHaveLength(1)
    expect(groups[0].author.kind).toBe("executor")
    expect(groups[0].nodes).toHaveLength(2)
  })

  it("troca você → executor → você abre três grupos", () => {
    const nodes = buildNodes([
      user("u1", "faça X"),
      text("t1", "feito"),
      user("u2", "e Y?"),
    ])
    const groups = groupByAuthor(nodes)
    expect(groups.map((g) => g.author.kind)).toEqual(["you", "executor", "you"])
  })

  it("pareceres de personas DIFERENTES não colapsam", () => {
    const nodes = buildNodes([
      advice("a1", "aline", "Aline"),
      advice("a2", "bruno", "Bruno"),
    ])
    const groups = groupByAuthor(nodes)
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => g.author.kind)).toEqual([
      "especialista",
      "especialista",
    ])
  })

  it("pareceres seguidos da MESMA persona colapsam num grupo", () => {
    const nodes = buildNodes([
      advice("a1", "aline", "Aline"),
      advice("a2", "aline", "Aline"),
    ])
    const groups = groupByAuthor(nodes)
    expect(groups).toHaveLength(1)
    expect(groups[0].nodes).toHaveLength(2)
  })

  it("chave do grupo é estável (autor + key do 1º nó)", () => {
    const nodes = buildNodes([user("u1", "oi")])
    const [g] = groupByAuthor(nodes)
    expect(g.key).toContain("you#")
  })
})

describe("groupTs — hora do grupo via a key do 1º nó (estilo Slack)", () => {
  it("resolve o ts do PRIMEIRO item do grupo", () => {
    const items: ChatItem[] = [
      { ...user("u1", "oi"), ts: 1000 },
      { ...text("t1", "resposta"), ts: 2000 },
      { ...text("t2", "mais"), ts: 3000 },
    ]
    const tsById = new Map(items.map((it) => [it.id, it.ts] as const))
    const groups = groupByAuthor(buildNodes(items))
    // você (1º item) e executor (o texto seguinte) → dois grupos
    expect(groups).toHaveLength(2)
    expect(groupTs(groups[0], tsById)).toBe(1000) // 1º item do grupo "você"
    expect(groupTs(groups[1], tsById)).toBe(2000) // 1º texto do executor
  })

  it("grupo cujo 1º item não tem ts (histórico antigo) → undefined (sem fantasma)", () => {
    const items: ChatItem[] = [user("u1", "oi")] // sem ts
    const tsById = new Map(items.map((it) => [it.id, it.ts] as const))
    const groups = groupByAuthor(buildNodes(items))
    expect(groupTs(groups[0], tsById)).toBeUndefined()
  })
})

describe("especialista como gente do time (ADR-267)", () => {
  const pedido = (id: string): ChatItem => ({
    kind: "user",
    id,
    text: "@Aline oi",
    advisorTo: { id: "aline", name: "Aline" },
  })
  const nova = (id: string, personaId: string): ChatItem => ({
    ...(advice(id, personaId, personaId) as Extract<ChatItem, { kind: "advice" }>),
    estilo: "mensagem",
  })

  it("o pedido a um especialista não cola no grupo das suas mensagens ao executor", () => {
    const groups = groupByAuthor(buildNodes([user("u1", "oi"), pedido("u2")]))
    expect(groups).toHaveLength(2)
    expect(groups[1].author).toEqual({ kind: "you", aoEspecialista: true })
  })

  it("estreia é o primeiro grupo de cada persona, e só no estilo mensagem", () => {
    const groups = groupByAuthor(
      buildNodes([
        advice("a0", "velha", "Velha"),
        pedido("u1"),
        nova("a1", "aline"),
        pedido("u2"),
        nova("a2", "aline"),
        nova("a3", "bia"),
      ]),
    )
    const estreias = estreiasDeEspecialista(groups)
    const donos = groups.filter((g) => estreias.has(g.key)).map((g) => g.nodes[0].key)
    expect(donos).toEqual(["a1", "a3"])
  })
})
