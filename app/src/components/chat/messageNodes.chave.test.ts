// A INVARIANTE da chave do nó, travada direto na causa.
//
// Tudo que a Etapa A fez (escopar as derivações à fatia que a janela mostra)
// se apoia numa única frase: **a `key` de um nó é o id do item de MENOR índice
// que aquele nó cobre**. Dela sai a monotonicidade das keys, e daí sai a
// garantia do `windowStartIndex`: nada que um nó visível referencia mora antes
// do item que abre o primeiro nó visível.
//
// Até 14/08/2026 essa frase vivia só em comentário. `threadWindow.test.ts`
// testa a CONSEQUÊNCIA (a fatia cobre o que a janela mostra); quem derivasse a
// key de outro item do trecho quebraria a CAUSA e podia continuar passando ali
// por sorte de arranjo. Este arquivo testa a causa.
//
// Como a cobertura de um nó é recuperada sem reimplementar o `buildNodes`:
// cada item de texto carrega uma MARCA com o próprio id no meio do texto (a
// dobra concatena os textos crus, então a marca reaparece na bolha), tools
// viajam com o id no próprio objeto, e o `result` do incidente vem anexado.
// A marca entra DEPOIS do primeiro caractere e antes do último, justamente os
// dois que `continuesProse` lê — o agrupamento sai igual ao de um fio sem
// marca. O que se recupera é um SUBCONJUNTO da cobertura (mensagens de erro
// absorvidas por duplicata ficam de fora, porque marcá-las impediria a
// absorção que se quer exercitar); como a asserção é "nada coberto ANTES da
// key", subconjunto basta e não afrouxa nada.
//
// Pré-condição do gerador, a mesma do stream real: um tool FILHO nasce depois
// do pai. Filho antes do pai faria o nó da raiz cobrir um item anterior à sua
// própria key, e aí a invariante seria falsa (o `withDescendants` é o único
// lugar do fold que olha pra trás).
import { describe, expect, it } from "vitest"
import type { ChatItem } from "@/store/chat"
import { buildNodes, type Node } from "./messageNodes"

/** PRNG determinístico (mulberry32) — semente na mão = caso reproduzível. */
function rng(semente: number): () => number {
  let a = semente >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const MARCA = /\[\[([^\]]+)\]\]/g

/** Marca o texto sem mexer no primeiro nem no último caractere: são os únicos
 *  que `continuesProse` lê, então a costura de prosa decide igualzinho. */
function marcar(texto: string, id: string): string {
  if (texto.length >= 2) return `${texto[0]}[[${id}]]${texto.slice(1)}`
  return `${texto}[[${id}]]${texto}`
}

/** Fragmentos que estressam `continuesProse` nos DOIS sentidos: minúscula e sem
 *  pontuação continua a bolha; maiúscula, ponto final ou marcador markdown abre
 *  uma nova. Sem os dois ramos o teste só veria prosa costurada. */
const TRECHOS = [
  "escrevendo o ",
  "resto da frase",
  ". Fim.",
  "Nova sentença aqui",
  "- item de lista",
  "# título",
  "continua sem ponto",
  "?",
]

interface Gerador {
  r: () => number
  n: number
  tools: string[]
}

const escolha = <T,>(g: Gerador, xs: T[]): T => xs[Math.floor(g.r() * xs.length)]

function proximoItem(g: Gerador): ChatItem {
  const id = `i${g.n++}`
  const ts = 1_700_000_000_000 + g.n * 1000
  const dado = g.r()
  if (dado < 0.3) return { kind: "text", id, text: marcar(escolha(g, TRECHOS), id), ts }
  if (dado < 0.62) {
    const toolId = `T-${id}`
    // Só um tool JÁ EMITIDO pode ser pai: no stream o filho nasce depois.
    const pai = g.tools.length > 0 && g.r() < 0.2 ? escolha(g, g.tools) : undefined
    g.tools.push(toolId)
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
  if (dado < 0.72) return { kind: "user", id, text: `pedido ${id}`, ts }
  if (dado < 0.84)
    return { kind: "result", id, ok: g.r() < 0.5, text: escolha(g, ["ok", "falhou feio", ""]), ts }
  if (dado < 0.9)
    return {
      kind: "error",
      id,
      // "falhou feio" e o exit genérico ficam SEM marca de propósito: são os
      // que o incidente absorve (por duplicata exata e por consequência), e
      // marcá-los mataria a absorção. Só andam pra FRENTE, então não escondem
      // nada do que este teste afirma.
      message: escolha(g, [`erro [[${id}]]`, "falhou feio", "o agente saiu com código -1"]),
      ts,
    }
  if (dado < 0.94)
    return { kind: "limit", id, message: `session limit reached [[${id}]] at 5pm`, ts }
  if (dado < 0.97) return { kind: "notice", id, message: `aviso [[${id}]]`, ts }
  return { kind: "cancelled", id, ts }
}

function fioAdversarial(semente: number, tamanho: number): ChatItem[] {
  const g: Gerador = { r: rng(semente), n: 0, tools: [] }
  return Array.from({ length: tamanho }, () => proximoItem(g))
}

/** Índices de item que o nó COBRE, lidos do que ele carrega (nunca do fold).
 *  A key entra sempre: a asserção que interessa é "nada coberto antes dela". */
function cobertura(node: Node, indice: Map<string, number>): number[] {
  const ids: string[] = [node.key]
  const marcas = (texto: string) => {
    for (const m of texto.matchAll(MARCA)) ids.push(m[1])
  }
  switch (node.type) {
    case "item":
      ids.push(node.item.id)
      if (node.item.kind === "notice") marcas(node.item.message)
      break
    case "plan":
      ids.push(node.anchorId)
      break
    case "tools":
      for (const t of node.tools) ids.push(t.id)
      break
    case "prose":
      marcas(node.text)
      for (const t of node.tools) ids.push(t.id)
      break
    case "incident":
      if (node.result) ids.push(node.result.id)
      for (const d of node.details) marcas(d)
      marcas(node.message)
      break
  }
  const out: number[] = []
  for (const id of ids) {
    const i = indice.get(id)
    // marca sem item correspondente seria bug DO TESTE, não do fold.
    expect(i, `marca ${id} sem item`).toBeDefined()
    out.push(i!)
  }
  return out
}

describe("a chave de um nó é o menor índice de item que ele cobre", () => {
  it("vale em 400 fios adversariais, nó a nó", () => {
    let comProsa = 0
    let comIncidente = 0
    let comGalho = 0
    for (let semente = 1; semente <= 400; semente++) {
      const items = fioAdversarial(semente, 40 + (semente % 25))
      const indice = new Map(items.map((it, i) => [it.id, i] as const))
      const nodes = buildNodes(items)
      for (const node of nodes) {
        const cobertos = cobertura(node, indice)
        const menor = Math.min(...cobertos)
        expect(
          indice.get(node.key),
          `semente ${semente}: key ${node.key} sem item`,
        ).toBeDefined()
        expect(
          menor,
          `semente ${semente}: nó ${node.type}/${node.key} cobre o item ${menor}, anterior à própria chave`,
        ).toBe(indice.get(node.key))
        if (node.type === "prose") comProsa++
        if (node.type === "incident") comIncidente++
        if (node.type === "tools" && node.tools.length > 1) comGalho++
      }
    }
    // O gerador exercitou mesmo os três casos difíceis (prosa costurada,
    // incidente que absorve o que vem depois, tool com galho de subagente).
    expect(comProsa).toBeGreaterThan(100)
    expect(comIncidente).toBeGreaterThan(100)
    expect(comGalho).toBeGreaterThan(100)
  })

  it("as chaves são estritamente crescentes no índice do item", () => {
    // Corolário direto: é o que deixa `windowStartIndex` cortar o fio pelo
    // primeiro nó visível sem perder nada do que os nós seguintes citam.
    for (let semente = 1; semente <= 200; semente++) {
      const items = fioAdversarial(semente, 50)
      const indice = new Map(items.map((it, i) => [it.id, i] as const))
      const nodes = buildNodes(items)
      let anterior = -1
      for (const node of nodes) {
        const atual = indice.get(node.key)!
        expect(atual, `semente ${semente}: chave ${node.key} fora de ordem`).toBeGreaterThan(
          anterior,
        )
        anterior = atual
      }
    }
  })

  it("nenhum item é coberto por dois nós ao mesmo tempo", () => {
    // Um item desenhado em dois lugares seria conteúdo duplicado na tela; e um
    // item coberto por um nó ANTERIOR ao seu é exatamente o que a invariante
    // proíbe. As duas coisas caem aqui.
    for (let semente = 1; semente <= 200; semente++) {
      const items = fioAdversarial(semente, 50)
      const indice = new Map(items.map((it, i) => [it.id, i] as const))
      const dono = new Map<number, string>()
      for (const node of buildNodes(items)) {
        for (const i of cobertura(node, indice)) {
          const antigo = dono.get(i)
          expect(
            antigo === undefined || antigo === node.key,
            `semente ${semente}: item ${i} em ${antigo} e ${node.key}`,
          ).toBe(true)
          dono.set(i, node.key)
        }
      }
    }
  })
})
