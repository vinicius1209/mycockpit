// A aba Conversa como histórico de pedidos (mock aba-conversa.html rev. 2,
// aprovado em 23/09/2026). Payload REAL da conversa 1200a161 (22 e 23/09),
// recortado: três pedidos encerrados (commits, commit+push, imagem) e o pedido
// "aprovo sim" até a escrita do `historico.ts`, com o plano real dele. Os
// recibos são de ANTES da correção do ADR-226, por isso o custo é o acumulado
// da sessão; a aba mostra o que está gravado, como o fio.
import { describe, expect, it } from "vitest"
import fixture from "@/lib/__fixtures__/historico-de-pedidos-1200a161.json"
import type { ChatItem } from "@/store/chat"
import { historicoDePedidos } from "./historico"

const ITENS = fixture as unknown as ChatItem[]
const DEPOIS = (ITENS.at(-1)!.ts ?? 0) + 60_000

describe("histórico de pedidos da conversa", () => {
  it("um item por pedido, do mais novo para o mais velho, com os fatos do fio", () => {
    const h = historicoDePedidos(ITENS, { running: true, finalizing: false }, DEPOIS)
    expect(h.pedidos.map((p) => p.texto.slice(0, 24))).toEqual([
      "aprovo sim",
      "Cara, me ajude a ver se ",
      "pode commitar e push tud",
      "e pode commitar tudo sim",
    ])
    const [atual, imagem, push, commits] = h.pedidos
    // Cinco commits de verdade: quatro num comando só e mais um.
    expect(commits).toMatchObject({ estado: "concluido", commits: 5, acoes: 3, imagens: 0 })
    expect(push).toMatchObject({ estado: "concluido", commits: 1 })
    expect(imagem).toMatchObject({ estado: "concluido", imagens: 1, commits: 0 })
    expect(imagem.resposta).toMatch(/^Você lembrou certo/)
    expect(imagem.duracaoMs).toBeGreaterThan(0)
    // O pedido em andamento: rodando, com o arquivo escrito e o plano DELE.
    expect(atual.estado).toBe("rodando")
    expect(atual.arquivos).toBe(1)
    expect(atual.plano?.tasks.length).toBeGreaterThan(0)
    expect(atual.duracaoMs).toBe(DEPOIS - atual.ts!)
    expect(h.rodando).toBe(1)
    // O plano mora no turno que o criou: nenhum pedido antigo o herda.
    expect(h.pedidos.slice(1).every((p) => p.plano === null)).toBe(true)
  })

  it("sem processo vivo, o pedido sem terminal é 'sem desfecho', nunca 'rodando' de teatro", () => {
    const h = historicoDePedidos(ITENS, { running: false, finalizing: false }, DEPOIS)
    expect(h.pedidos[0].estado).toBe("sem-desfecho")
    expect(h.pedidos[0].duracaoMs).toBeNull()
    expect(h.rodando).toBe(0)
  })

  it("consulta a especialista não vira pedido do histórico", () => {
    const comParecer = [
      ...ITENS.slice(0, 3),
      { kind: "user", id: "p1", text: "@Íris olha isso", advisorTo: { id: "iris", name: "Íris" }, ts: 1 } as ChatItem,
      ...ITENS.slice(3),
    ]
    const h = historicoDePedidos(comParecer, { running: false, finalizing: false })
    expect(h.pedidos.some((p) => p.texto.startsWith("@Íris"))).toBe(false)
    expect(h.pedidos).toHaveLength(4)
  })

  it("total de custo só quando todo pedido encerrado tem custo; sem custo, o modelo responde", () => {
    const semCusto: ChatItem[] = [
      { kind: "user", id: "u1", text: "sobe o dev server", ts: 1_000 },
      { kind: "result", id: "r1", ok: true, model: "gemini-3-pro", ts: 19_000 },
    ]
    const h = historicoDePedidos(semCusto, { running: false, finalizing: false })
    expect(h.pedidos[0]).toMatchObject({ custoUsd: null, modelo: "gemini-3-pro", duracaoMs: 18_000 })
    expect(h.custoTotalUsd).toBeNull()
    const comCusto = historicoDePedidos(ITENS.slice(0, ITENS.findIndex((i) => i.kind === "user" && i.text.startsWith("aprovo"))), {
      running: false,
      finalizing: false,
    })
    expect(comCusto.custoTotalUsd).toBeCloseTo(18.7674288 + 28.307669 + 34.7235322, 4)
  })

  it("interrupção e erro são ditos pelo nome", () => {
    const h = historicoDePedidos(
      [
        { kind: "user", id: "a", text: "um", ts: 1 },
        { kind: "cancelled", id: "c", ts: 2 },
        { kind: "user", id: "b", text: "dois", ts: 3 },
        { kind: "result", id: "r", ok: false, text: "falhou", ts: 4 },
      ],
      { running: false, finalizing: false },
    )
    expect(h.pedidos.map((p) => p.estado)).toEqual(["erro", "interrompido"])
  })
})
