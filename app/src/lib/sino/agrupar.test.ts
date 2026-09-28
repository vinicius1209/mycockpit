// Os itens têm a forma exata que `lib/notify` empilha (notifyTurnEnd,
// notifyQuestion, notifyDeferredEnd), com os textos do sino de 27/09/2026.

import { describe, expect, it } from "vitest"
import {
  agruparAtividade,
  metaDoAvulso,
  rotuloDosPedidos,
  soNaoLidas,
  type GrupoDaConversa,
} from "@/lib/sino/agrupar"
import type { Notification } from "@/store/notifications"

// 27/09/2026, 21:10, no fuso de quem roda o teste.
const NOW = new Date(2026, 8, 27, 21, 10).getTime()
const HORA = 3_600_000

let seq = 0
function item(n: Partial<Notification>): Notification {
  seq += 1
  return {
    id: `n${seq}`,
    kind: "run_done",
    title: "Revisão do PRD de edição",
    subtitle: "Claude Code · frota",
    projectId: "p1",
    convId: "c1",
    origem: "turno",
    ts: NOW - HORA,
    read: false,
    ...n,
  }
}

function turno(horasAtras: number, extra: Partial<Notification> = {}) {
  return item({ ts: NOW - horasAtras * HORA, ...extra })
}

describe("agruparAtividade", () => {
  it("seis turnos da mesma conversa no mesmo dia viram uma linha", () => {
    const dias = agruparAtividade(
      [5, 6, 6.1, 6.2, 6.3, 6.4].map((h) => turno(h)),
      NOW,
    )
    expect(dias).toHaveLength(1)
    expect(dias[0].rotulo).toBe("Hoje")
    const g = dias[0].entradas[0] as GrupoDaConversa
    expect(g.tipo).toBe("conversa")
    expect(g.turnos).toBe(6)
    expect(g.naoLidas).toBe(6)
    expect(g.ts).toBe(NOW - 5 * HORA)
  })

  it("o recibo do grupo é o do desfecho mais recente, nunca um mais velho", () => {
    const dias = agruparAtividade(
      [
        turno(6, { body: "Aplicou as correções no bloco de requisitos." }),
        turno(5), // primeiro plano: sem recibo
      ],
      NOW,
    )
    const g = dias[0].entradas[0] as GrupoDaConversa
    expect(g.desfecho?.body).toBeUndefined()
  })

  it("a pergunta respondida vira rastro no grupo, não linha âmbar solta", () => {
    const dias = agruparAtividade(
      [
        turno(5),
        item({
          kind: "question",
          origem: undefined,
          subtitle: "Pergunta pendente · Comentários · frota",
          ts: NOW - 6 * HORA,
        }),
        item({
          kind: "question",
          origem: undefined,
          subtitle: "Pergunta pendente · ADR · frota",
          ts: NOW - 6.5 * HORA,
        }),
      ],
      NOW,
    )
    expect(dias[0].entradas).toHaveLength(1)
    const g = dias[0].entradas[0] as GrupoDaConversa
    expect(g.turnos).toBe(1)
    expect(rotuloDosPedidos(g.pedidos)).toBe("2 perguntas")
  })

  it("falha fica sozinha, fora do grupo, onde se vê", () => {
    const dias = agruparAtividade(
      [
        turno(5),
        item({
          kind: "run_error",
          origem: "trabalho",
          title: "Trabalho em background parou",
          subtitle: "frota",
          ts: NOW - 6 * HORA,
        }),
        turno(6.2),
      ],
      NOW,
    )
    expect(dias[0].entradas.map((e) => e.tipo)).toEqual(["conversa", "avulso"])
  })

  it("trabalho em background concluído não se passa por turno", () => {
    const dias = agruparAtividade(
      [
        item({
          origem: "trabalho",
          title: "Trabalho em background concluído",
          subtitle: "frota",
        }),
      ],
      NOW,
    )
    expect(dias[0].entradas[0].tipo).toBe("avulso")
  })

  it("desfecho de missão entra no grupo mas não conta como turno", () => {
    const dias = agruparAtividade(
      [
        item({ origem: "missao", subtitle: "Missão concluída · US$ 1.20 · frota", ts: NOW - HORA }),
        turno(2),
      ],
      NOW,
    )
    const g = dias[0].entradas[0] as GrupoDaConversa
    expect(g.turnos).toBe(1)
    expect(g.desfecho?.subtitle).toBe("Missão concluída · US$ 1.20 · frota")
  })

  it("item sem origem (anterior ao ADR-271) com conversa conta como turno", () => {
    const dias = agruparAtividade([turno(1, { origem: undefined })], NOW)
    expect((dias[0].entradas[0] as GrupoDaConversa).turnos).toBe(1)
  })

  it("aviso sem conversa (atualização, automação) fica sozinho", () => {
    const dias = agruparAtividade(
      [item({ convId: undefined, origem: undefined, title: "Atualização disponível: Codex 0.50" })],
      NOW,
    )
    expect(dias[0].entradas[0].tipo).toBe("avulso")
  })

  it("a mesma conversa em dias diferentes são linhas diferentes, e o dia de ontem se chama Ontem", () => {
    const dias = agruparAtividade([turno(1), turno(24)], NOW)
    expect(dias.map((d) => d.rotulo)).toEqual(["Hoje", "Ontem"])
    const antigo = agruparAtividade([turno(24 * 5)], NOW)
    expect(antigo[0].rotulo).toBe("22/09")
  })
})

describe("soNaoLidas", () => {
  it("fica só o que tem algo não visto, e o dia vazio sai", () => {
    const dias = agruparAtividade(
      [turno(1, { convId: "c1" }), turno(2, { convId: "c2", read: true }), turno(25, { read: true })],
      NOW,
    )
    const r = soNaoLidas(dias)
    expect(r).toHaveLength(1)
    expect(r[0].entradas).toHaveLength(1)
    expect((r[0].entradas[0] as GrupoDaConversa).convId).toBe("c1")
  })
})

describe("metaDoAvulso", () => {
  it("o pedido no histórico não diz mais pendente", () => {
    const n = item({
      kind: "approval",
      convId: undefined,
      origem: undefined,
      title: "Claude no terminal",
      subtitle: "Permissão pendente · rodar git push · frota",
    })
    expect(metaDoAvulso(n, null)).toBe("Permissão · rodar git push · frota")
  })

  it("trabalho em background que parou diz de qual conversa, não 'turno falhou'", () => {
    const n = item({
      kind: "run_error",
      origem: "trabalho",
      title: "Trabalho em background parou",
      subtitle: "frota",
    })
    expect(metaDoAvulso(n, "Revisão do PRD de edição")).toBe("Revisão do PRD de edição · frota")
  })

  it("turno que falhou diz que falhou", () => {
    const n = item({ kind: "run_error" })
    expect(metaDoAvulso(n, null)).toBe("Claude Code · frota · turno falhou")
  })

  it("falha sem origem conhecida não ganha rótulo inventado", () => {
    const n = item({ kind: "run_error", origem: undefined, title: "Automação desligada: Diária", subtitle: "projeto sumiu" })
    expect(metaDoAvulso(n, null)).toBe("projeto sumiu")
  })
})

describe("rotuloDosPedidos", () => {
  it("nomeia cada tipo, no singular e no plural", () => {
    expect(rotuloDosPedidos({ perguntas: 2, permissoes: 1, pausas: 1 })).toBe(
      "2 perguntas · 1 permissão · 1 pausa da missão",
    )
    expect(rotuloDosPedidos({ perguntas: 0, permissoes: 0, pausas: 0 })).toBeNull()
  })
})
