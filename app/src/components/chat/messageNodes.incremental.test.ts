// PROVA da reconstrução incremental (`buildNodesMemo`).
//
// `buildNodes` é uma dobra com VIZINHANÇA: um item muda, mas o nó que sai dali
// depende dos vizinhos (prosa costurada, tools do mesmo passo, incidente que
// absorve os erros seguintes, galho de subagente). Errar a faixa reconstruída
// não dá erro: dá corrupção visual intermitente (fusão perdida, nó duplicado,
// ordem trocada) — o pior tipo de bug.
//
// Por isso a prova é de PROPRIEDADE, não de exemplo: fios pseudoaleatórios com
// SEMENTE determinística, mutações pseudoaleatórias em cima, e a exigência de
// que o incremental seja PROFUNDAMENTE idêntico à passada inteira em todo passo.
// Uma divergência falha imprimindo a semente e a sequência culpada.
import { describe, expect, it } from "vitest"
import type { ChatItem } from "@/store/chat"
import { buildNodes, reuseNodes, type Node } from "./messageNodes"
import { buildNodesMemo, type NodesMemo } from "./nodesMemo"

// ---------------------------------------------------------------- gerador

/** PRNG determinístico (mulberry32). Semente na mão = caso reproduzível. */
function rng(semente: number): () => number {
  let a = semente >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Gerador {
  r: () => number
  n: number
  /** toolIds já emitidos: candidatos a virar pai de um filho. */
  tools: string[]
}

const escolha = <T>(g: Gerador, xs: T[]): T => xs[Math.floor(g.r() * xs.length)]

/** Fragmentos escolhidos pra estressar `continuesProse` nos DOIS sentidos:
 *  minúscula/sem pontuação continua a bolha, maiúscula/ponto/marcador abre uma
 *  nova. Sem isso o teste só exercitaria um dos ramos da costura. */
const TRECHOS = [
  "escrevendo o ",
  "resto da frase",
  ". Fim.",
  "Nova sentença aqui",
  "- item de lista",
  "# título",
  "continua sem ponto",
  "",
  "   ",
  "?",
]

function proximoItem(g: Gerador): ChatItem {
  const id = `i${g.n++}`
  const ts = 1_700_000_000_000 + g.n * 1000
  const dado = g.r()
  if (dado < 0.28) return { kind: "text", id, text: escolha(g, TRECHOS), ts }
  if (dado < 0.62) {
    // `toolId` ÚNICO, como o `uid()` do reducer: derivado do id do item, que já
    // é único. Repetição é patologia à parte, coberta pelo caso dedicado.
    const toolId = `T-${id}`
    g.tools.push(toolId)
    // ~1 em 6 nasce dentro do galho de um subagente anterior.
    const pai = g.tools.length > 1 && g.r() < 0.17 ? escolha(g, g.tools.slice(0, -1)) : undefined
    return {
      kind: "tool",
      id,
      name: escolha(g, ["Read", "Bash", "TaskCreate", "TaskUpdate", "Grep"]),
      input: { q: id },
      toolId,
      ...(pai ? { parentToolId: pai } : {}),
      ts,
    }
  }
  if (dado < 0.72) return { kind: "user", id, text: `pedido ${id}`, ts } as ChatItem
  if (dado < 0.82)
    return { kind: "result", id, ok: g.r() < 0.6, text: escolha(g, ["ok", "falhou feio", ""]), ts }
  if (dado < 0.88)
    return {
      kind: "error",
      id,
      message: escolha(g, ["falhou feio", "o agente saiu com código -1", "rate limit reached"]),
      ts,
    }
  if (dado < 0.92) return { kind: "limit", id, message: "session limit reached at 5pm", ts }
  if (dado < 0.96) return { kind: "notice", id, message: `aviso ${id}`, ts }
  return { kind: "cancelled", id, ts }
}

function fio(g: Gerador, tamanho: number): ChatItem[] {
  const out: ChatItem[] = []
  for (let i = 0; i < tamanho; i++) out.push(proximoItem(g))
  return out
}

// ---------------------------------------------------------------- mutações

/** Uma mutação do fio, imutável como a do reducer: array novo, item novo,
 *  IDENTIDADE preservada em tudo que não mudou. */
function mutar(g: Gerador, items: ChatItem[]): { items: ChatItem[]; o_que: string } {
  const dado = g.r()
  const at = (p: (it: ChatItem) => boolean) => {
    const idx = items.map((it, i) => [it, i] as const).filter(([it]) => p(it))
    return idx.length ? escolha(g, idx)[1] : -1
  }
  // delta de texto na bolha viva (o caso QUENTE: último item de texto)
  if (dado < 0.34) {
    let alvo = -1
    for (let i = items.length - 1; i >= 0; i--)
      if (items[i].kind === "text") {
        alvo = i
        break
      }
    if (alvo >= 0) {
      const it = items[alvo] as Extract<ChatItem, { kind: "text" }>
      const out = items.slice()
      out[alvo] = { ...it, text: it.text + escolha(g, ["x", " ", ".", "A", "\n- "]) }
      return { items: out, o_que: `delta em ${it.id}` }
    }
  }
  // item novo no fim
  if (dado < 0.56) {
    const novo = proximoItem(g)
    return { items: [...items, novo], o_que: `append ${novo.kind} ${novo.id}` }
  }
  // tool que muda de status (result chega depois)
  if (dado < 0.7) {
    const alvo = at((it) => it.kind === "tool")
    if (alvo >= 0) {
      const it = items[alvo] as Extract<ChatItem, { kind: "tool" }>
      const out = items.slice()
      out[alvo] = { ...it, result: { ok: g.r() < 0.7, text: "saiu", lines: 1 } }
      return { items: out, o_que: `status de ${it.id}` }
    }
  }
  // notice enfiado NO MEIO (parte prosa costurada, abre grupo novo)
  if (dado < 0.8) {
    const onde = Math.floor(g.r() * (items.length + 1))
    const novo: ChatItem = { kind: "notice", id: `i${g.n++}`, message: "aviso do meio" }
    return {
      items: [...items.slice(0, onde), novo, ...items.slice(onde)],
      o_que: `notice em ${onde}`,
    }
  }
  // tool FILHO de um pai antigo entra no fim: envelhece o nó da RAIZ, lá atrás
  if (dado < 0.9) {
    const pais = items.filter(
      (it): it is Extract<ChatItem, { kind: "tool" }> => it.kind === "tool" && !!it.toolId,
    )
    if (pais.length) {
      const pai = escolha(g, pais)
      const id = `i${g.n++}`
      const toolId = `T-${id}`
      g.tools.push(toolId)
      const novo: ChatItem = {
        kind: "tool",
        id,
        name: "Read",
        input: {},
        toolId,
        parentToolId: pai.toolId,
      }
      return { items: [...items, novo], o_que: `filho de ${pai.toolId} no fim` }
    }
  }
  // item do meio TROCADO por outro de kind qualquer: quebra (ou cria) results
  // consecutivos, runs de erro e costuras de prosa sem avisar.
  if (dado < 0.95 && items.length > 1) {
    const onde = Math.floor(g.r() * items.length)
    const out = items.slice()
    out[onde] = proximoItem(g)
    return { items: out, o_que: `troca ${onde} por ${out[onde].kind}` }
  }
  // item removido do meio (histórico curado / result parcial descartado)
  if (items.length > 2) {
    const onde = Math.floor(g.r() * items.length)
    return {
      items: [...items.slice(0, onde), ...items.slice(onde + 1)],
      o_que: `remove ${items[onde].id} (${onde})`,
    }
  }
  return { items: [...items, proximoItem(g)], o_que: "append (fallback)" }
}

// ---------------------------------------------------------------- prova

/** `toEqual` compara profundamente, mas some com a ORDEM quando as duas listas
 *  divergem em tamanho de um jeito confuso — o resumo por chave dá o culpado. */
const resumo = (nodes: Node[]) =>
  nodes.map((n) => `${n.type}:${n.key}:${n.type === "prose" ? JSON.stringify(n.text) : ""}`)

function conferir(
  semente: number,
  passo: number,
  o_que: string,
  items: ChatItem[],
  memo: NodesMemo,
) {
  const inteiro = buildNodes(items)
  const contexto = `semente ${semente}, passo ${passo} (${o_que}), fio=${JSON.stringify(items)}`
  expect(resumo(memo.nodes), contexto).toEqual(resumo(inteiro))
  expect(memo.nodes, contexto).toEqual(inteiro)
}

describe("buildNodesMemo — o incremental diz EXATAMENTE o que a passada inteira diria", () => {
  it("800 fios x 15 mutações: cada passo é profundamente idêntico ao rebuild inteiro", () => {
    for (let semente = 1; semente <= 800; semente++) {
      const g: Gerador = { r: rng(semente), n: 0, tools: [] }
      let items = fio(g, 6 + Math.floor(g.r() * 40))
      let memo = buildNodesMemo(null, items)
      conferir(semente, 0, "inicial", items, memo)
      for (let passo = 1; passo <= 15; passo++) {
        const m = mutar(g, items)
        items = m.items
        memo = buildNodesMemo(memo, items)
        conferir(semente, passo, m.o_que, items, memo)
      }
    }
  }, 120_000)

  it("fio comprido com streaming longo: 400 deltas seguidos sem divergir", () => {
    const g: Gerador = { r: rng(9001), n: 0, tools: [] }
    let items = [...fio(g, 300), { kind: "text", id: "viva", text: "começo", ts: 1 } as ChatItem]
    let memo = buildNodesMemo(null, items)
    for (let k = 0; k < 400; k++) {
      const it = items[items.length - 1] as Extract<ChatItem, { kind: "text" }>
      const out = items.slice()
      out[out.length - 1] = { ...it, text: it.text + (k % 40 === 39 ? ". Agora " : "x") }
      items = out
      memo = buildNodesMemo(memo, items)
      expect(memo.nodes, `delta ${k}`).toEqual(buildNodes(items))
    }
  }, 60_000)

  it("a faixa reconstruída é CURTA no caso quente (streaming no fim do fio)", () => {
    const g: Gerador = { r: rng(7), n: 0, tools: [] }
    let items = [...fio(g, 400), { kind: "text", id: "viva", text: "oi", ts: 1 } as ChatItem]
    let memo = buildNodesMemo(null, items)
    const total = memo.nodes.length
    for (let k = 0; k < 30; k++) {
      const it = items[items.length - 1] as Extract<ChatItem, { kind: "text" }>
      const out = items.slice()
      out[out.length - 1] = { ...it, text: it.text + "x" }
      items = out
      memo = buildNodesMemo(memo, items)
      // reconstruiu o último punhado de nós, não os ~200 do fio.
      expect(total - memo.rebuiltFrom).toBeLessThanOrEqual(3)
    }
  })

  it("um filho de subagente no fim faz a reconstrução RECUAR até o nó da raiz", () => {
    const items: ChatItem[] = [
      { kind: "user", id: "u1", text: "vai", ts: 1 },
      { kind: "tool", id: "a1", name: "Task", input: {}, toolId: "T1", ts: 2 },
      { kind: "text", id: "x1", text: "Enquanto isso", ts: 3 },
      { kind: "notice", id: "n1", message: "aviso", ts: 4 },
      { kind: "text", id: "x2", text: "Outra coisa", ts: 5 },
    ]
    const antes = buildNodesMemo(null, items)
    const noDaRaiz = antes.nodes.findIndex((n) => n.key === "a1")
    expect(noDaRaiz).toBeGreaterThanOrEqual(0)
    const depois = buildNodesMemo(null, items) // memo fresco só pra ter o par
    const comFilho = [
      ...items,
      { kind: "tool", id: "c1", name: "Read", input: {}, toolId: "T2", parentToolId: "T1" } as ChatItem,
    ]
    const incremental = buildNodesMemo(antes, comFilho)
    expect(incremental.rebuiltFrom).toBeLessThanOrEqual(noDaRaiz)
    expect(incremental.nodes).toEqual(buildNodes(comFilho))
    expect(depois.nodes).toEqual(antes.nodes)
  })

  it("`toolId` repetido degrada pro fio inteiro em vez de escolher uma raiz", () => {
    // Patologia: dois tools com o MESMO toolId. `withDescendants` pendura o
    // filho nos dois galhos, então não existe "a" raiz pra recuar — a saída
    // continua sendo a da passada inteira, custe o que custar.
    const items: ChatItem[] = [
      { kind: "tool", id: "a", name: "Task", input: {}, toolId: "T", ts: 1 },
      { kind: "tool", id: "b", name: "Read", input: {}, toolId: "X", parentToolId: "T", ts: 2 },
      { kind: "notice", id: "n", message: "corta o segmento", ts: 3 },
      { kind: "tool", id: "c", name: "Task", input: {}, toolId: "T", ts: 4 },
    ]
    const antes = buildNodesMemo(null, items)
    const comFilho: ChatItem[] = [
      ...items,
      { kind: "tool", id: "d", name: "Read", input: {}, toolId: "Y", parentToolId: "X", ts: 5 },
    ]
    const depois = buildNodesMemo(antes, comFilho)
    expect(depois.rebuiltFrom).toBe(0)
    expect(depois.nodes).toEqual(buildNodes(comFilho))
  })

  it("filho cujo pai ainda não apareceu no fio também degrada pro inteiro", () => {
    const items: ChatItem[] = [
      { kind: "user", id: "u", text: "vai", ts: 1 },
      { kind: "text", id: "t", text: "pensando", ts: 2 },
    ]
    const antes = buildNodesMemo(null, items)
    const orfao: ChatItem[] = [
      ...items,
      { kind: "tool", id: "o", name: "Read", input: {}, toolId: "Z", parentToolId: "SUMIU", ts: 3 },
    ]
    const depois = buildNodesMemo(antes, orfao)
    expect(depois.rebuiltFrom).toBe(0)
    expect(depois.nodes).toEqual(buildNodes(orfao))
  })

  it("fio de conteúdo idêntico não reconstrói nó nenhum", () => {
    const g: Gerador = { r: rng(42), n: 0, tools: [] }
    const items = fio(g, 30)
    const antes = buildNodesMemo(null, items)
    const depois = buildNodesMemo(antes, [...items])
    expect(depois.rebuiltFrom).toBe(antes.nodes.length)
    expect(depois.nodes).toBe(antes.nodes)
  })
})

describe("reuseNodes escopado ao que foi reconstruído", () => {
  it("com `from`, o resultado é o mesmo do escopo inteiro", () => {
    for (let semente = 500; semente < 560; semente++) {
      const g: Gerador = { r: rng(semente), n: 0, tools: [] }
      let items = fio(g, 10 + Math.floor(g.r() * 30))
      let memo = buildNodesMemo(null, items)
      let refs = memo.nodes
      for (let passo = 1; passo <= 8; passo++) {
        const m = mutar(g, items)
        items = m.items
        const prev = memo
        memo = buildNodesMemo(prev, items)
        // escopado (o que o componente faz) vs. inteiro (o comportamento antigo)
        const escopado = reuseNodes(prev.nodes, memo.nodes.slice(), memo.rebuiltFrom)
        const inteiro = reuseNodes(refs, memo.nodes.slice(), 0)
        expect(escopado, `semente ${semente} passo ${passo} (${m.o_que})`).toEqual(inteiro)
        for (let i = 0; i < escopado.length; i++)
          expect(escopado[i] === inteiro[i], `identidade do nó ${i}`).toBe(true)
        refs = reuseNodes(prev.nodes, memo.nodes, memo.rebuiltFrom)
        memo = { ...memo, nodes: refs }
      }
    }
  }, 60_000)
})
