// A janela de render corta NÓS; as derivações que a alimentam consomem ITENS.
// O que estes casos guardam é a ponte entre as duas contagens: a fatia tem que
// COBRIR tudo que a janela mostra. Errar pra menos aqui não é lentidão, é dado
// faltando na tela (hora do grupo sumida, selo de anexo perdido) — por isso a
// maior parte dos casos compara o resultado escopado com o resultado do fio
// inteiro, item por item.
import { describe, expect, it } from "vitest"
import type { Attachment } from "@/lib/attachments"
import type { ChatItem } from "@/store/chat"
import { attachmentReadsByItem } from "@/lib/attachmentRead"
import { buildNodes } from "./messageNodes"
import { groupByAuthor, groupTs } from "./messageGroups"
import {
  feedbackTextByResult,
  tsForGroups,
  turnStartIndex,
  windowStartIndex,
} from "./threadWindow"

const att = (n: string): Attachment => ({
  path: `/attachments/c1/${n}.png`,
  name: `${n}.png`,
  kind: "image",
  mime: "image/png",
  bytes: 100,
})

/** Fio sintético com os nós que o buildNodes costura de verdade num turno:
 *  prosa continuada (o corte no meio da frase vira UMA bolha), a tool que ela
 *  disparou e o resultado. `turnos` turnos iguais, com `ts` crescente. */
function fio(turnos: number): ChatItem[] {
  const items: ChatItem[] = []
  let t = 1000
  for (let n = 0; n < turnos; n++) {
    items.push({ kind: "user", id: `u${n}`, text: `pedido ${n}`, ts: t++ })
    items.push({ kind: "text", id: `t${n}a`, text: "vou verificar o", ts: t++ })
    items.push({
      kind: "tool",
      id: `k${n}`,
      name: "Read",
      input: { file_path: `/src/f${n}.ts` },
      ts: t++,
    })
    items.push({ kind: "text", id: `t${n}b`, text: " arquivo agora.", ts: t++ })
    items.push({ kind: "text", id: `t${n}c`, text: "Pronto.", ts: t++ })
    items.push({
      kind: "result",
      id: `r${n}`,
      ok: true,
      text: `resumo ${n}`,
      ts: t++,
    })
  }
  return items
}

/** O mesmo recorte que o MessageList faz: últimos `janela` nós. */
function recorte(items: ChatItem[], janela: number) {
  const nodes = buildNodes(items)
  const escondidos = Math.max(0, nodes.length - janela)
  const visible = escondidos > 0 ? nodes.slice(escondidos) : nodes
  return {
    nodes,
    visible,
    groups: groupByAuthor(visible),
    start: escondidos > 0 ? windowStartIndex(items, visible[0]?.key ?? null) : 0,
  }
}

describe("windowStartIndex — onde a fatia começa", () => {
  it("acha o índice do item que abre a janela", () => {
    const items = fio(4)
    expect(windowStartIndex(items, "u2")).toBe(items.findIndex((i) => i.id === "u2"))
  })

  it("chave desconhecida degrada pro fio inteiro, nunca pra fatia curta", () => {
    // Nó sem item correspondente (histórico curado): perder o item seria perder
    // informação na tela. Voltar ao índice 0 é só o custo de hoje.
    expect(windowStartIndex(fio(3), "fantasma")).toBe(0)
  })

  it("sem nada visível a fatia é vazia", () => {
    const items = fio(2)
    expect(windowStartIndex(items, null)).toBe(items.length)
  })

  it("pré-condição: id de item é único (com repetido, a fatia começaria tarde)", () => {
    // O reducer carimba `uid()` em todo item, então isto vale por construção.
    const items = fio(4)
    expect(new Set(items.map((i) => i.id)).size).toBe(items.length)
    // E é por isso que a pré-condição importa: a busca é de trás pra frente,
    // então um id repetido devolveria a ocorrência MAIS RECENTE e a fatia
    // começaria DEPOIS do nó que a pediu — a direção proibida (dado sumindo da
    // tela). Fixado aqui pra ninguém descobrir isso em produção.
    const repetido: ChatItem[] = [...items, { ...items[0] }]
    expect(windowStartIndex(repetido, items[0].id)).toBe(repetido.length - 1)
  })
})

describe("a fatia cobre o que a janela mostra", () => {
  it("todo nó visível abre num item que está na fatia", () => {
    const items = fio(60)
    const indice = new Map(items.map((it, i) => [it.id, i] as const))
    for (const janela of [1, 5, 17, 150, 999]) {
      const { visible, start } = recorte(items, janela)
      for (const node of visible) {
        expect(indice.get(node.key), `nó ${node.key} sem item`).toBeDefined()
        expect(indice.get(node.key)!, `nó ${node.key} fora da fatia`).toBeGreaterThanOrEqual(start)
      }
    }
  })

  it("o carimbo de cada grupo é o mesmo que o do mapa do fio inteiro", () => {
    const items = fio(60)
    const inteiro = new Map(items.map((it) => [it.id, it.ts] as const))
    for (const janela of [1, 5, 17, 150, 999]) {
      const { groups } = recorte(items, janela)
      const escopado = tsForGroups(items, groups)
      for (const g of groups) {
        expect(groupTs(g, escopado)).toBe(groupTs(g, inteiro))
      }
      expect(groups.length).toBeGreaterThan(0)
    }
  })

  it("o mapa de carimbos nasce do tamanho dos grupos, não do fio", () => {
    const items = fio(60)
    const { groups } = recorte(items, 20)
    expect(tsForGroups(items, groups).size).toBeLessThanOrEqual(groups.length)
    expect(items.length).toBeGreaterThan(300)
  })

  it("item antigo sem carimbo continua sem hora (nada de 'undefined' fantasma)", () => {
    const items: ChatItem[] = [{ kind: "user", id: "u0", text: "oi" }]
    const groups = groupByAuthor(buildNodes(items))
    const ts = tsForGroups(items, groups)
    expect(ts.get("u0")).toBeUndefined()
    expect(groupTs(groups[0], ts)).toBeUndefined()
  })
})

describe("feedbackTextByResult escopado", () => {
  it("dá o mesmo texto que o fio inteiro para todo resultado da janela", () => {
    const items = fio(40)
    const inteiro = feedbackTextByResult(items)
    for (const janela of [1, 7, 33, 999]) {
      const { visible, start } = recorte(items, janela)
      const escopado = feedbackTextByResult(items, turnStartIndex(items, start))
      const visiveis = new Set(visible.map((n) => n.key))
      for (const [id, texto] of inteiro) {
        if (!visiveis.has(id)) continue
        expect(escopado.get(id), `result ${id}`).toBe(texto)
      }
      expect([...inteiro].some(([id]) => visiveis.has(id))).toBe(true)
    }
  })

  it("com a janela aberta inteira (showAll) é byte a byte o de hoje", () => {
    const items = fio(12)
    expect([...feedbackTextByResult(items, 0)]).toEqual([...feedbackTextByResult(items)])
  })

  it("só o resultado mais recente do pedido é alvo, mesmo escopado", () => {
    // Envelopes parciais do provider: o anterior sai do mapa.
    const items: ChatItem[] = [
      { kind: "user", id: "u0", text: "faça" },
      { kind: "text", id: "t0", text: "feito" },
      { kind: "result", id: "r0", ok: true, text: "parcial" },
      { kind: "result", id: "r1", ok: true, text: "final" },
    ]
    const escopado = feedbackTextByResult(items, turnStartIndex(items, 2))
    expect(escopado.has("r0")).toBe(false)
    expect(escopado.get("r1")).toBe("feito")
  })
})

describe("turnStartIndex", () => {
  it("volta ao item do usuário que abriu o turno", () => {
    const items = fio(3)
    const u1 = items.findIndex((i) => i.id === "u1")
    expect(turnStartIndex(items, u1 + 3)).toBe(u1)
    expect(turnStartIndex(items, u1)).toBe(u1)
  })

  it("fio que começa sem pedido do usuário volta ao começo", () => {
    const items: ChatItem[] = [
      { kind: "text", id: "t0", text: "oi" },
      { kind: "result", id: "r0", ok: true, text: "" },
    ]
    expect(turnStartIndex(items, 1)).toBe(0)
  })

  // ACOPLAMENTO NÃO DECLARADO até 14/08/2026: `turnStartIndex` e
  // `feedbackTextByResult` compartilham o predicado de reset (`kind === "user"`)
  // e só podem mudar juntas. Enfraquecer o reset de lá (zerar em menos casos)
  // faz este ponto de partida cair no meio de um estado que ele não reconstrói,
  // e o sintoma é texto de feedback ERRADO, não erro. Este caso é exaustivo em
  // `from`, de propósito: é a amarra, não um exemplo.
  it("o ponto de partida zera o acumulador para TODO índice do fio", () => {
    const items = [
      ...fio(5),
      // um turno com prosa em vários pedaços e dois results, pra que o
      // acumulador tenha o que perder se o reset mudar.
      { kind: "user", id: "ux", text: "de novo" } as ChatItem,
      { kind: "text", id: "tx1", text: "primeiro" } as ChatItem,
      { kind: "text", id: "tx2", text: "segundo" } as ChatItem,
      { kind: "result", id: "rx", ok: true, text: "" } as ChatItem,
    ]
    const inteiro = feedbackTextByResult(items)
    const indice = new Map(items.map((it, i) => [it.id, i] as const))
    for (let from = 0; from < items.length; from++) {
      const inicio = turnStartIndex(items, from)
      expect(inicio).toBeLessThanOrEqual(from)
      // o índice devolvido É um ponto de reset (ou o começo do fio).
      expect(inicio === 0 || items[inicio].kind === "user").toBe(true)
      const escopado = feedbackTextByResult(items, inicio)
      for (const [id, texto] of inteiro) {
        if (indice.get(id)! < from) continue
        expect(escopado.get(id), `result ${id} a partir de ${from}`).toBe(texto)
      }
    }
  })
})

describe("attachmentReadsByItem escopado", () => {
  const comAnexos = (): ChatItem[] => [
    { kind: "user", id: "u0", text: "a", attachments: [att("um")] },
    { kind: "tool", id: "k0", name: "Read", input: { file_path: att("um").path } },
    { kind: "user", id: "u1", text: "b", attachments: [att("dois")] },
    { kind: "text", id: "t1", text: "respondi sem abrir" },
    { kind: "user", id: "u2", text: "c", attachments: [att("tres")] },
    { kind: "tool", id: "k2", name: "Read", input: { file_path: att("tres").path } },
  ]

  it("dá o mesmo selo dos itens visíveis", () => {
    const items = comAnexos()
    const inteiro = attachmentReadsByItem(items, "claude-code", false)
    const escopado = attachmentReadsByItem(items, "claude-code", false, undefined, 2)
    for (const id of ["u1", "u2"]) {
      expect(escopado.get(id)).toEqual(inteiro.get(id))
    }
    expect(escopado.has("u0")).toBe(false) // fora da janela: não é desenhado
  })

  it("path repetido depois da fatia continua decidido pelo último item", () => {
    // O selo de um anexo é o do ÚLTIMO item com aquele path — que nunca é
    // anterior ao item que o mostra, então a fatia (um sufixo) sempre o contém.
    const p = att("um").path
    const items: ChatItem[] = [
      { kind: "user", id: "u0", text: "a", attachments: [att("um")] },
      { kind: "tool", id: "k0", name: "Read", input: { file_path: p } },
      { kind: "user", id: "u1", text: "de novo", attachments: [att("um")] },
      { kind: "text", id: "t1", text: "não abri desta vez" },
    ]
    const inteiro = attachmentReadsByItem(items, "claude-code", false)
    const escopado = attachmentReadsByItem(items, "claude-code", false, undefined, 2)
    expect(escopado.get("u1")).toEqual(inteiro.get("u1"))
    expect(escopado.get("u1")![p]).toEqual({ text: "não foi aberto", warn: true })
  })

  it("showAll (from=0) é byte a byte o de hoje", () => {
    const items = comAnexos()
    expect([...attachmentReadsByItem(items, "claude-code", false, undefined, 0)]).toEqual(
      [...attachmentReadsByItem(items, "claude-code", false)],
    )
  })

  it("token novo no fio não troca a referência dos selos de um item da fatia", () => {
    // Identidade (padrão P1): o `memo` do MessageItem depende disso.
    const antes = attachmentReadsByItem(comAnexos(), "claude-code", true, undefined, 2)
    const depois = attachmentReadsByItem(comAnexos(), "claude-code", true, antes, 2)
    expect(depois.get("u1")).toBe(antes.get("u1"))
    expect(depois.get("u2")).toBe(antes.get("u2"))
  })
})
