// Qual é "o último turno" para a tray e o Companion.
//
// A peneira do `convId` é o que impede a frase de mentir: o feed carrega
// desfecho de MISSÃO e notícia de ferramenta no mesmo balde, e mostrar missão
// concluída sob o rótulo "último turno" seria dizer outra coisa.

import { describe, expect, it } from "vitest"
import { turnosRecentes, ultimoTurno, type ItemDeFeed } from "./lastTurn"

const turno = (ts: number, over: Partial<ItemDeFeed> = {}): ItemDeFeed => ({
  kind: "run_done",
  title: `turno ${ts}`,
  convId: "c1",
  ts,
  ...over,
})

describe("ultimoTurno", () => {
  it("feed vazio não inventa turno", () => {
    expect(ultimoTurno([])).toBeNull()
  })

  it("pega o mais recente, não o último da lista", () => {
    // A ordem do feed não é contrato; o carimbo é.
    const f = [turno(300), turno(100), turno(200)]
    expect(ultimoTurno(f)?.title).toBe("turno 300")
  })

  it("o título vigente vence a cópia antiga do feed", () => {
    const f = [
      turno(300, {
        title: "revisao de branches",
        projectId: "p1",
      }),
    ]
    const atual = ultimoTurno(f, (convId, projectId) =>
      convId === "c1" && projectId === "p1" ? "revisão de branches" : null,
    )
    expect(atual?.title).toBe("revisão de branches")
  })

  it("mantém o título do feed quando a conversa não está carregada", () => {
    const f = [turno(300, { title: "Título preservado", projectId: "p1" })]
    expect(ultimoTurno(f, () => null)?.title).toBe("Título preservado")
  })

  it("o recibo vem quando existe", () => {
    const f = [turno(1, { body: "Extraiu o parser pra lib/" })]
    expect(ultimoTurno(f)?.receipt).toBe("Extraiu o parser pra lib/")
  })

  it("sem recibo é `null`, não string vazia", () => {
    // Turno de primeiro plano / helper desligado / prazo estourado. Quem mostra
    // cai no desfecho — e `""` passaria por um `if` como se houvesse texto.
    expect(ultimoTurno([turno(1)])?.receipt).toBeNull()
    expect(ultimoTurno([turno(1, { body: "   " })])?.receipt).toBeNull()
  })

  it("erro é turno também, marcado como tal", () => {
    const u = ultimoTurno([turno(1, { kind: "run_error", title: "falhou" })])
    expect(u?.ok).toBe(false)
  })

  it("item SEM convId não é turno de conversa", () => {
    // Desfecho de missão usa o mesmo `kind`; sem esta peneira a tray diria
    // "último turno" mostrando uma missão.
    expect(ultimoTurno([turno(9, { convId: undefined })])).toBeNull()
  })

  it("outros tipos do feed não entram", () => {
    const f: ItemDeFeed[] = [
      { kind: "gate", title: "g", convId: "c1", ts: 99 },
      { kind: "approval", title: "a", convId: "c1", ts: 98 },
      turno(1),
    ]
    expect(ultimoTurno(f)?.title).toBe("turno 1")
  })

  it("turno velho continua sendo o último (quem julga é quem lê)", () => {
    // Cortar por idade esconderia o único dado disponível. A tray mostra o
    // instante junto.
    const ontem = Date.now() - 30 * 60 * 60 * 1000
    expect(ultimoTurno([turno(ontem)])).not.toBeNull()
  })
})

describe("turnosRecentes", () => {
  it("do mais novo pro mais velho", () => {
    const f = [turno(100, { projectId: "p" }), turno(300, { projectId: "p" }), turno(200, { projectId: "p" })]
    expect(turnosRecentes(f).map((t) => t.at)).toEqual([300, 200, 100])
  })

  it("usa o mesmo título vigente no Companion", () => {
    const f = [turno(100, { title: "nome antigo", projectId: "p" })]
    const [recent] = turnosRecentes(f, 5, () => "nome atual")
    expect(recent.title).toBe("nome atual")
  })

  it("corta no teto — o celular é resumo, não histórico", () => {
    const f = Array.from({ length: 20 }, (_, i) => turno(i, { projectId: "p" }))
    expect(turnosRecentes(f, 3)).toHaveLength(3)
  })

  it("exige projectId: o celular não resolve projeto sozinho", () => {
    // Sem as stores do lado de lá, um turno sem endereço vira card mudo.
    expect(turnosRecentes([turno(1)])).toEqual([])
  })

  it("mesma peneira do singular: sem convId não é turno de conversa", () => {
    expect(turnosRecentes([turno(1, { projectId: "p", convId: undefined })])).toEqual([])
  })

  it("erro entra na lista, marcado", () => {
    const t = turnosRecentes([turno(1, { projectId: "p", kind: "run_error" })])
    expect(t[0].ok).toBe(false)
  })

  it("feed vazio devolve lista vazia (a seção mostra o próprio vazio)", () => {
    expect(turnosRecentes([])).toEqual([])
  })
})
