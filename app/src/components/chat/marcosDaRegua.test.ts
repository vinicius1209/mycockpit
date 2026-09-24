import { describe, expect, it } from "vitest"
import { historicoDePedidos } from "@/lib/conversationMap/historico"
import type { ChatItem } from "@/store/chat"
import { groupByAuthor } from "./messageGroups"
import { buildNodes } from "./messageNodes"
import { marcoPedeAtencao, marcosDaRegua, respostaDoMarco } from "./marcosDaRegua"
import { rotuloDoTraco } from "./TurnScrubber"
import { FIO } from "./marcosDaRegua.fixture"

function marcosDe(items: ChatItem[], nodes = buildNodes(items), vivo = false) {
  const pedidos = historicoDePedidos(items, { running: vivo, finalizing: false }).pedidos
  return marcosDaRegua(groupByAuthor(nodes), items, pedidos)
}

describe("marcosDaRegua: um traço por pedido", () => {
  const grupos = groupByAuthor(buildNodes(FIO))
  const marcos = marcosDe(FIO)

  it("três pedidos são três traços, por mais blocos que o fio pinte", () => {
    expect(grupos.length).toBeGreaterThan(3)
    expect(marcos.map((m) => m.key)).toEqual(["95cebfce", "3052124b", "a8dd1a1e"])
    expect(marcos.map((m) => m.ordem)).toEqual([1, 2, 3])
  })

  it("mostra a RESPOSTA final, não a narração do começo do turno", () => {
    expect(respostaDoMarco(marcos[0])).toMatch(/^Fiz os commits separados por assunto/)
    expect(respostaDoMarco(marcos[0])).not.toMatch(/^Antes de commitar/)
  })

  it("o aviso do sistema no meio do turno é do pedido, não um traço", () => {
    expect(marcos[0].avisos).toEqual([expect.stringMatching(/^A árvore de processos deste run atingiu 2301 MB/)])
    // Todos os grupos do pedido, inclusive o do aviso e o do agente depois
    // dele, apontam para o mesmo traço: o "na tela" não pula para outro.
    const doPrimeiro = grupos.filter((g) => marcos[0].grupos.includes(g.key))
    expect(doPrimeiro.map((g) => g.author.kind)).toEqual(["you", "executor", "system", "executor"])
  })

  it("o clique leva ao começo do pedido", () => {
    expect(marcos[1].groupId).toBe(`msg-group-${grupos.find((g) => g.nodes[0].key === "3052124b")!.key}`)
  })

  it("pedido que parou no limite pede atenção; o que concluiu não", () => {
    expect(marcos[1].pedido.estado).toBe("limite")
    expect(marcoPedeAtencao(marcos[1])).toBe(true)
    expect(marcoPedeAtencao(marcos[0])).toBe(false)
    expect(marcos[1].avisos).toEqual(["auto-resume: retomando (tentativa 1/3)"])
  })

  it("a retomada automática não se passa por pedido seu", () => {
    // Anterior à marca `retomada`: reconhecida pelo texto constante do app.
    expect(marcos[2].pedido.retomada).toBe(true)
    expect(marcos[0].pedido.retomada).toBe(false)
    expect(rotuloDoTraco(marcos[2])).toMatch(/^Pedido 3: Retomada automática\. Terminei/)
  })

  it("a marca `retomada` no item vale mesmo com outro texto", () => {
    const fio: ChatItem[] = [
      { kind: "user", id: "u1", text: "começa", ts: 1 },
      { kind: "user", id: "u2", text: "continue", retomada: true, ts: 2 },
    ]
    expect(marcosDe(fio).map((m) => m.pedido.retomada)).toEqual([false, true])
  })
})

describe("marcosDaRegua: a janela e as bordas", () => {
  it("a ordem conta a conversa inteira, mesmo com o começo fora da janela", () => {
    const nodes = buildNodes(FIO)
    const semOPrimeiro = nodes.slice(nodes.findIndex((n) => n.key === "3052124b"))
    const marcos = marcosDe(FIO, semOPrimeiro)
    expect(marcos.map((m) => m.ordem)).toEqual([2, 3])
  })

  it("a janela que começa no meio de um pedido mantém o traço dele", () => {
    const nodes = buildNodes(FIO)
    const meio = nodes.slice(nodes.findIndex((n) => n.key === "f5b6fcac"))
    const marcos = marcosDe(FIO, meio)
    expect(marcos[0].key).toBe("95cebfce")
    expect(respostaDoMarco(marcos[0])).toMatch(/^Fiz os commits/)
  })

  it("fala endereçada a especialista acontece dentro do pedido", () => {
    const fio: ChatItem[] = [
      { kind: "user", id: "u1", text: "revisa o plano", ts: 1 },
      { kind: "text", id: "t1", text: "Revisei.", ts: 2 },
      { kind: "user", id: "u2", text: "@aline o que acha?", advisorTo: { id: "aline", name: "Aline" }, ts: 3 },
    ]
    expect(marcosDe(fio).map((m) => m.key)).toEqual(["u1"])
  })

  it("o pedido que está rodando diz isso, sem inventar resposta", () => {
    const fio: ChatItem[] = [
      { kind: "user", id: "u1", text: "faz", ts: 1 },
      { kind: "result", id: "r1", ok: true, text: "Feito.", ts: 2 },
      { kind: "user", id: "u2", text: "e agora?", ts: 3 },
    ]
    const marcos = marcosDe(fio, buildNodes(fio), true)
    expect(marcos[1].pedido.estado).toBe("rodando")
    expect(respostaDoMarco(marcos[1])).toBe("trabalhando…")
    // Sem processo vivo, nunca "rodando" de teatro.
    expect(marcosDe(fio)[1].pedido.estado).toBe("sem-desfecho")
    expect(respostaDoMarco(marcosDe(fio)[1])).toBe("sem resposta registrada")
  })
})
