// Testes da ORIGEM e do ÍNDICE de espera (store/interactions):
// - originForInteraction: de qual projeto·conversa veio o pedido (é o que o card
//   de permissão mostra — antes um pedido de outro projeto interrompia sem dizer
//   de onde). Segue no recorte approval-only: p/ qualquer kind existe o
//   currentOriginAnyKind (testado em interactions.notify.test.ts);
// - awaitingKey: onde acender o sinal na sidebar, com chave estável. Cobre
//   PERGUNTA também: ask_user para o turno igual a uma permissão e o backend
//   manda run_id nela (approval.rs), então há onde acender.

import { describe, expect, it } from "vitest"
import type { InteractionRequest } from "@/lib/interaction"
import { awaitingKey, originForInteraction, runIdOf } from "./interactions"

function aprovacao(id: string, runId: string): InteractionRequest {
  return {
    id,
    run_id: runId,
    kind: "approval",
    data: { tool_name: "Bash", command: "ls", input: {} },
  }
}

/** `runId: null` = pergunta órfã (o `undefined` explícito ATIVA o default). */
function pergunta(id: string, runId: string | null = null): InteractionRequest {
  return {
    id,
    run_id: runId ?? undefined,
    kind: "question",
    data: { questions: [] },
  }
}

const SEM_MISSAO = { byConv: {} }

describe("runIdOf", () => {
  it("lê o topo (backend atual) e o data (canal legado)", () => {
    expect(runIdOf(aprovacao("i1", "r-1"))).toBe("r-1")
    expect(
      runIdOf({
        id: "i2",
        kind: "approval",
        data: { run_id: "r-2", tool_name: "Bash", command: "", input: {} },
      }),
    ).toBe("r-2")
  })

  it("sem run_id em lugar nenhum ⇒ null (string vazia não conta)", () => {
    expect(runIdOf(pergunta("q1"))).toBeNull()
    expect(
      runIdOf({ id: "i3", run_id: "", kind: "approval", data: {} }),
    ).toBeNull()
  })
})

describe("originForInteraction", () => {
  const app = {
    projects: [
      { id: "p1", name: "mycockpit" },
      { id: "p2", name: "prime-sales-hub" },
    ],
  }

  it("resolve projeto e conversa donos do pedido", () => {
    const chat = {
      byId: { c1: { runId: "r-1", projectId: "p1" } },
      conversations: [{ id: "c1", title: "Corrigir paginação" }],
      conversationsByProject: { p1: [{ id: "c1", title: "Corrigir paginação" }] },
    }
    expect(originForInteraction(aprovacao("i1", "r-1"), chat, app, SEM_MISSAO)).toEqual(
      {
        convId: "c1",
        projectId: "p1",
        projectName: "mycockpit",
        convTitle: "Corrigir paginação",
      },
    )
  })

  it("usa a lista do projeto DONO — turno em background não fica sem nome", () => {
    // `conversations` é o espelho do projeto ATIVO (p1); a conversa dona é do p2.
    const chat = {
      byId: { c9: { runId: "r-9", projectId: "p2" } },
      conversations: [{ id: "c1", title: "Outra do p1" }],
      conversationsByProject: {
        p1: [{ id: "c1", title: "Outra do p1" }],
        p2: [{ id: "c9", title: "Deploy do hub" }],
      },
    }
    const o = originForInteraction(aprovacao("i1", "r-9"), chat, app, SEM_MISSAO)
    expect(o).toMatchObject({ projectName: "prime-sales-hub", convTitle: "Deploy do hub" })
  })

  it("título/projeto ausentes caem em rótulo genérico, nunca em vazio", () => {
    const chat = {
      byId: { c1: { runId: "r-1", projectId: "p-desconhecido" } },
      conversations: [],
      conversationsByProject: {},
    }
    const o = originForInteraction(aprovacao("i1", "r-1"), chat, app, SEM_MISSAO)
    expect(o).toMatchObject({ projectName: "Projeto", convTitle: "Conversa" })
  })

  it("título só de espaços não passa por 'preenchido'", () => {
    const chat = {
      byId: { c1: { runId: "r-1", projectId: "p1" } },
      conversations: [],
      conversationsByProject: { p1: [{ id: "c1", title: "   " }] },
    }
    expect(
      originForInteraction(aprovacao("i1", "r-1"), chat, app, SEM_MISSAO)?.convTitle,
    ).toBe("Conversa")
  })

  it("run órfão ⇒ null; question ⇒ null aqui (recorte approval-only)", () => {
    const chat = {
      byId: { c1: { runId: "r-1", projectId: "p1" } },
      conversations: [],
      conversationsByProject: {},
    }
    expect(
      originForInteraction(aprovacao("i1", "r-999"), chat, app, SEM_MISSAO),
    ).toBeNull()
    // pergunta COM run_id da c1: este resolvedor devolve null de propósito (ele
    // alimenta o cabeçalho do card de permissão). Quem precisa da origem de uma
    // pergunta (notificação, tray) usa currentOriginAnyKind.
    expect(
      originForInteraction(pergunta("q1", "r-1"), chat, app, SEM_MISSAO),
    ).toBeNull()
  })
})

describe("awaitingKey", () => {
  const chat = {
    byId: {
      c1: { runId: "r-1", projectId: "p1" },
      c2: { runId: "r-2", projectId: "p2" },
    },
  }

  it("fila vazia ⇒ chave vazia", () => {
    expect(awaitingKey([], chat, SEM_MISSAO)).toBe("")
  })

  it("agrupa por conversa: rajada de idênticos não infla a chave", () => {
    const fila = [
      aprovacao("i1", "r-1"),
      aprovacao("i2", "r-1"),
      aprovacao("i3", "r-1"),
    ]
    expect(awaitingKey(fila, chat, SEM_MISSAO)).toBe("c1|p1")
  })

  it("chave é ESTÁVEL na ordem de chegada (senão a sidebar re-renderiza à toa)", () => {
    const a = awaitingKey([aprovacao("i1", "r-1"), aprovacao("i2", "r-2")], chat, SEM_MISSAO)
    const b = awaitingKey([aprovacao("i2", "r-2"), aprovacao("i1", "r-1")], chat, SEM_MISSAO)
    expect(a).toBe(b)
  })

  it("PERGUNTA pendente acende a conversa e o projeto (era o buraco)", () => {
    // Antes o índice filtrava approval: uma pergunta do ask_user deixava o turno
    // parado e a sidebar não acendia nada, então não havia como descobrir QUAL
    // conversa estava esperando. O run_id vem no pedido de pergunta também.
    expect(awaitingKey([pergunta("q1", "r-2")], chat, SEM_MISSAO)).toBe("c2|p2")
  })

  it("PERGUNTA de fase de missão entra na chave (run missionId::phase-N)", () => {
    // na missão o run_id NÃO é o runId da conversa (vem prefixado pelo id da
    // missão, e o dono sai do byConv). Sem este caso o sinal estaria coberto só no
    // turno linear — e a missão é justo o modo que roda por muito mais tempo,
    // onde a pergunta tem mais chance de te pegar em outra tela.
    const missions = {
      byConv: { c1: { id: "m1", current: 0, phases: [{}, {}, {}] } },
    }
    expect(awaitingKey([pergunta("q1", "m1::phase-1")], chat, missions)).toBe(
      "c1|p1",
    )
  })

  it("pergunta e permissão da MESMA conversa não duplicam o par", () => {
    const fila = [pergunta("q1", "r-1"), aprovacao("i1", "r-1")]
    expect(awaitingKey(fila, chat, SEM_MISSAO)).toBe("c1|p1")
  })

  it("ignora pedido sem run_id e run órfão (não há onde acender)", () => {
    const fila = [pergunta("q1"), aprovacao("i9", "r-inexistente")]
    expect(awaitingKey(fila, chat, SEM_MISSAO)).toBe("")
  })

  it("cobre conversa E projeto de cada pedido", () => {
    const key = awaitingKey([aprovacao("i1", "r-1"), aprovacao("i2", "r-2")], chat, SEM_MISSAO)
    expect(key.split(",")).toEqual(["c1|p1", "c2|p2"])
  })
})
