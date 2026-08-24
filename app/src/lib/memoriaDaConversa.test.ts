// A rede do G1. Cada teste nomeia o DEFEITO do algoritmo antigo que ele fixa.

import { describe, expect, it } from "vitest"
import { memoriaDaConversa } from "./memoriaDaConversa"
import type { ChatItem } from "@/store/chat"

const user = (id: string, text: string): ChatItem => ({ kind: "user", id, text })
const tool = (id: string, name: string, ok = true): ChatItem => ({
  kind: "tool",
  id,
  name,
  input: {},
  result: { ok, text: "", lines: 0 },
})
const texto = (id: string, t: string): ChatItem => ({ kind: "text", id, text: t })

describe("a intenção humana é insubstituível", () => {
  it("TODO pedido entra, mesmo com o fio cheio de ferramenta", () => {
    // O defeito medido: 90% dos BYTES são `tool`, e o corte posicional gastava
    // o orçamento neles — 1 de 34 pedidos sobrevivia numa conversa real.
    const items = [
      user("u1", "primeiro pedido"),
      ...Array.from({ length: 500 }, (_, i) => tool(`t${i}`, "Read")),
      user("u2", "segundo pedido"),
      ...Array.from({ length: 500 }, (_, i) => tool(`s${i}`, "Bash")),
      user("u3", "terceiro pedido"),
    ]
    const m = memoriaDaConversa(items, 3_000)
    for (const p of ["primeiro pedido", "segundo pedido", "terceiro pedido"]) {
      expect(m.texto, p).toContain(p)
    }
  })

  it("pedido longo é ENCURTADO, não descartado", () => {
    // 34 intenções pela metade reconstroem a conversa; 5 inteiras, não.
    const items = Array.from({ length: 20 }, (_, i) =>
      user(`u${i}`, `pedido ${i} ` + "x".repeat(400)),
    )
    const m = memoriaDaConversa(items, 3_000)
    for (let i = 0; i < 20; i++) expect(m.texto, `pedido ${i}`).toContain(`pedido ${i} `)
  })
})

describe("ferramenta vira contagem, não lista", () => {
  it("500 leituras viram uma linha", () => {
    const items = [user("u", "vai"), ...Array.from({ length: 500 }, (_, i) => tool(`t${i}`, "Read"))]
    const m = memoriaDaConversa(items, 3_000)
    expect(m.texto).toContain("Read ×500")
    // "Onde paramos" nao repete ferramenta: com 500 Read no fim, a cauda
    // significativa e o PEDIDO, nao seis linhas de `· Read`.
    expect(m.texto.split("Read").length - 1).toBeLessThan(3)
  })
})

describe("decisões e falhas sobrevivem", () => {
  it("o carimbo do plano entra, e diz QUAL foi", () => {
    // "eu aprovei isso?" é pergunta que aparece semanas depois.
    const items: ChatItem[] = [
      { kind: "planGate", id: "p1", text: "migrar o schema", decision: "approved" },
      { kind: "planGate", id: "p2", text: "trocar o ORM", decision: "discarded" },
    ]
    const m = memoriaDaConversa(items, 3_000)
    expect(m.texto).toContain("APROVADO")
    expect(m.texto).toContain("RECUSADO")
  })

  it("falha COM conserto posterior não vira alarme falso", () => {
    // A ferramenta falhou e depois funcionou: não está quebrada.
    const items = [tool("t1", "Bash", false), tool("t2", "Bash", true)]
    const m = memoriaDaConversa(items, 3_000)
    expect(m.texto).not.toContain("FALHAS SEM CONSERTO")
  })

  it("falha SEM conserto posterior aparece", () => {
    const items = [tool("t1", "Bash", true), tool("t2", "Bash", false)]
    const m = memoriaDaConversa(items, 3_000)
    expect(m.texto).toContain("FALHAS SEM CONSERTO")
  })
})

describe("a projeção NÃO se faz passar por completa", () => {
  it("declara o que cortou, por categoria", () => {
    // O defeito estrutural do recap antigo: um `[… N itens omitidos …]` no meio,
    // cercado de texto coerente, lê como detalhe. Truncagem que parece íntegra é
    // pior que truncagem óbvia.
    const items = [user("u", "vai"), ...Array.from({ length: 100 }, (_, i) => tool(`t${i}`, "Read")), texto("x", "resposta")]
    const m = memoriaDaConversa(items, 3_000)
    expect(m.texto).toContain("NÃO ESTÁ AQUI")
    expect(m.cortes.ferramentas).toBeGreaterThan(0)
  })

  it("conversa pequena não ganha rodapé de corte", () => {
    // Aviso que aparece sempre é aviso que ninguém lê.
    const m = memoriaDaConversa([user("u", "oi")], 3_000)
    expect(m.texto).not.toContain("NÃO ESTÁ AQUI")
  })
})

describe("o orçamento é RESPEITADO", () => {
  it("nunca estoura, nem com o rodapé", () => {
    // Medido na primeira versão: 3111 chars num teto de 3000, porque o rodapé
    // era empurrado fora da conta. Projeção que fura o próprio limite pra dizer
    // que respeita limites é a pior forma de mentir.
    for (const n of [1, 10, 200, 2000]) {
      const items = [
        ...Array.from({ length: n }, (_, i) => user(`u${i}`, `pedido ${i} ${"y".repeat(300)}`)),
        ...Array.from({ length: n }, (_, i) => tool(`t${i}`, "Read")),
      ]
      for (const b of [500, 3_000, 60_000]) {
        // A MOLDURA (H3) fica fora do orçamento, mesma convenção do
        // `serializeContext`: ela é constante e obrigatória, então contá-la
        // faria o teto significar coisas diferentes por tamanho de delimitador.
        const t = memoriaDaConversa(items, b).texto
        const conteudo = t.slice(
          t.indexOf(">") + 1,
          t.lastIndexOf("</historico-de-contexto>"),
        )
        expect(conteudo.length, `n=${n} b=${b}`).toBeLessThanOrEqual(b)
      }
    }
  })
})
