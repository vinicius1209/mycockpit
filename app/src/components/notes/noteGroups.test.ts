import { describe, expect, it } from "vitest"
import { LIMIAR_DA_LISTA, ROTULO_DE_ESCOPO, agruparNotas, carimboCurto, escopoDaNota, faixaDaNota, mesmoDia, mostraLista } from "./noteGroups"
import { selectNotesFor } from "@/store/stickyNotes"
import type { StickyNote } from "./types"

/** 27/08/2026, 21:12 local — a hora do mock. `now` é injetado em todo teste:
 *  o corte "Hoje" é função do relógio e não pode depender do dia da máquina. */
const AGORA = new Date(2026, 7, 27, 21, 12).getTime()
const UMA_HORA = 3_600_000
const UM_DIA = 24 * UMA_HORA

function nota(over: Partial<StickyNote> & { id: string }): StickyNote {
  return {
    content: `conteúdo ${over.id}`,
    color: "sand",
    createdAt: AGORA,
    updatedAt: AGORA,
    ...over,
  }
}

describe("mostraLista (o limiar do desenho B)", () => {
  it("o limiar é 3: com 2 notas a lista some e sobra a folha", () => {
    expect(LIMIAR_DA_LISTA).toBe(3)
    expect(mostraLista(0)).toBe(false)
    expect(mostraLista(1)).toBe(false)
    expect(mostraLista(2)).toBe(false)
    expect(mostraLista(3)).toBe(true)
    expect(mostraLista(20)).toBe(true)
  })
})

describe("escopoDaNota", () => {
  it("nota com projeto é DESTE projeto; sem projeto é de TODOS", () => {
    // O rótulo antigo mentia: nota sem `convId` era chamada de "Deste projeto" e
    // aparecia em qualquer projeto que você abrisse.
    expect(escopoDaNota({ convId: undefined, projectId: "p1" }, "c1")).toBe("projeto")
    expect(escopoDaNota({ convId: undefined }, "c1")).toBe("todos")
  })

  it("nota da conversa ativa é da conversa", () => {
    expect(escopoDaNota({ convId: "c1" }, "c1")).toBe("conversa")
  })

  it("nota de OUTRA conversa não é rotulada como 'desta conversa'", () => {
    // Inalcançável pelo `selectNotesFor` (ele filtra antes), mas o rótulo tem
    // que ser honesto por conta própria: nota de outra conversa NO projeto é
    // "deste projeto"; sem projeto, é "de todos".
    expect(escopoDaNota({ convId: "c2", projectId: "p1" }, "c1")).toBe("projeto")
    expect(escopoDaNota({ convId: "c2" }, "c1")).toBe("todos")
  })
})

describe("faixaDaNota", () => {
  it("editada hoje cai em Hoje", () => {
    expect(faixaDaNota({ updatedAt: AGORA - 3 * UMA_HORA }, AGORA)).toBe("hoje")
  })

  it("ontem às 23h não é 'hoje' às 8h, mesmo com menos de 24h de idade", () => {
    const ontemTarde = new Date(2026, 7, 26, 23, 0).getTime()
    const hojeCedo = new Date(2026, 7, 27, 8, 0).getTime()
    expect(hojeCedo - ontemTarde).toBeLessThan(UM_DIA)
    expect(faixaDaNota({ updatedAt: ontemTarde }, hojeCedo)).toBe("anteriores")
  })

  it("mesmoDia compara calendário, não janela de 24h", () => {
    expect(mesmoDia(AGORA, AGORA - UMA_HORA)).toBe(true)
    expect(mesmoDia(AGORA, AGORA - UM_DIA)).toBe(false)
  })
})

describe("agruparNotas", () => {
  const lista: StickyNote[] = [
    nota({ id: "fix-conv", convId: "c1", updatedAt: AGORA - 30 * UM_DIA }),
    nota({ id: "hoje-conv", convId: "c1", updatedAt: AGORA - 3 * UMA_HORA }),
    nota({ id: "velha-conv", convId: "c1", updatedAt: AGORA - 5 * UM_DIA }),
    nota({ id: "hoje-proj", projectId: "p1", updatedAt: AGORA - UMA_HORA }),
    nota({ id: "velha-proj", projectId: "p1", updatedAt: AGORA - 9 * UM_DIA }),
  ]

  it("separa 'Desta conversa' de 'Deste projeto', e dentro de cada um por tempo", () => {
    const grupos = agruparNotas(lista, { agora: AGORA, convId: "c1" })
    expect(grupos.map((g) => g.id)).toEqual([
      "conversa:hoje",
      "conversa:anteriores",
      "projeto:hoje",
      "projeto:anteriores",
    ])
    expect(grupos.map((g) => g.rotuloEscopo)).toEqual([
      "Desta conversa",
      "Desta conversa",
      "Deste projeto",
      "Deste projeto",
    ])
  })

  it("só o primeiro grupo de cada escopo escreve o cabeçalho de escopo", () => {
    const grupos = agruparNotas(lista, { agora: AGORA, convId: "c1" })
    expect(grupos.map((g) => g.abreEscopo)).toEqual([true, false, true, false])
  })

  it("nenhuma nota some: a soma das seções é o total que entrou", () => {
    const grupos = agruparNotas(lista, { agora: AGORA, convId: "c1" })
    const soma = grupos.reduce((a, g) => a + g.notas.length, 0)
    expect(soma).toBe(lista.length)
    expect(grupos.flatMap((g) => g.notas.map((n) => n.id)).sort()).toEqual(
      lista.map((n) => n.id).sort(),
    )
  })

  it("grupo vazio não vira cabeçalho de seção", () => {
    const grupos = agruparNotas([nota({ id: "so-uma", projectId: "p1" })], {
      agora: AGORA,
    })
    expect(grupos.map((g) => g.id)).toEqual(["projeto:hoje"])
  })

  it("preserva a ordem que veio de selectNotesFor dentro do grupo", () => {
    const nova = nota({ id: "nova", updatedAt: AGORA - UMA_HORA })
    const antiga = nota({ id: "antiga", updatedAt: AGORA - 2 * UMA_HORA })
    const grupos = agruparNotas(selectNotesFor([antiga, nova]), { agora: AGORA })
    expect(grupos[0].notas.map((n) => n.id)).toEqual(["nova", "antiga"])
  })

  it("lista vazia não produz seção nenhuma", () => {
    expect(agruparNotas([], { agora: AGORA, convId: "c1" })).toEqual([])
  })

  it("trocar de conversa muda 'Desta conversa' e não mexe em 'Deste projeto'", () => {
    const todas: StickyNote[] = [
      nota({ id: "a-de-c1", convId: "c1" }),
      nota({ id: "b-de-c2", convId: "c2" }),
      nota({ id: "do-projeto", projectId: "p1" }),
    ]
    const emC1 = agruparNotas(selectNotesFor(todas, { projectId: "p1", convId: "c1" }), {
      agora: AGORA,
      convId: "c1",
    })
    const emC2 = agruparNotas(selectNotesFor(todas, { projectId: "p1", convId: "c2" }), {
      agora: AGORA,
      convId: "c2",
    })

    const daConversa = (gs: ReturnType<typeof agruparNotas>) =>
      gs.filter((g) => g.escopo === "conversa").flatMap((g) => g.notas.map((n) => n.id))
    const doProjeto = (gs: ReturnType<typeof agruparNotas>) =>
      gs.filter((g) => g.escopo === "projeto").flatMap((g) => g.notas.map((n) => n.id))

    expect(daConversa(emC1)).toEqual(["a-de-c1"])
    expect(daConversa(emC2)).toEqual(["b-de-c2"])
    expect(doProjeto(emC1)).toEqual(["do-projeto"])
    expect(doProjeto(emC2)).toEqual(["do-projeto"])
  })
})

describe("carimboCurto", () => {
  it("menos de um minuto é 'agora'", () => {
    expect(carimboCurto(AGORA - 5_000, AGORA)).toBe("agora")
  })

  it("minutos e horas do mesmo dia vêm curtos", () => {
    expect(carimboCurto(AGORA - 12 * 60_000, AGORA)).toBe("12min")
    expect(carimboCurto(AGORA - 8 * UMA_HORA, AGORA)).toBe("8h")
  })

  it("o dia anterior é 'ontem'", () => {
    expect(carimboCurto(new Date(2026, 7, 26, 9, 0).getTime(), AGORA)).toBe("ontem")
  })

  it("mais velho que ontem vira data curta", () => {
    expect(carimboCurto(new Date(2026, 7, 21, 9, 0).getTime(), AGORA)).toBe("21/08")
  })
})

describe("o escopo de PROJETO é filtro de verdade", () => {
  it("nota de outro projeto não aparece aqui", () => {
    // O defeito que isto fecha: sem `projectId`, a nota do prime-sales-hub
    // aparecia no mycockpit dizendo "Do projeto" — a tela afirmando um dono
    // que ela não tinha.
    const todas: StickyNote[] = [
      nota({ id: "daqui", projectId: "p1" }),
      nota({ id: "de-la", projectId: "p2" }),
      nota({ id: "de-todos" }),
    ]
    expect(selectNotesFor(todas, { projectId: "p1" }).map((n) => n.id)).toEqual([
      "daqui",
      "de-todos",
    ])
    expect(selectNotesFor(todas, { projectId: "p2" }).map((n) => n.id)).toEqual([
      "de-la",
      "de-todos",
    ])
  })

  it("a nota sem projeto segue visível em todo lugar, mas com o nome certo", () => {
    // Ela não some (é o que as notas antigas são, e é um escopo legítimo): ela
    // passa a se chamar pelo que é.
    const semProjeto = nota({ id: "de-todos" })
    expect(escopoDaNota(semProjeto, undefined)).toBe("todos")
    expect(ROTULO_DE_ESCOPO.todos).toBe("De todos os projetos")
  })
})
