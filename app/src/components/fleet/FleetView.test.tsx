// Rollup "Frota": a lógica de "quais linhas, em qual seção, em qual ordem"
// (buildFleetLines, parseFleetKey, parseUnseenKey, rowSubtitle) e o RENDER de
// uma linha (FleetRowItem) são testados isolados da store — ver o comentário
// no topo de FleetView.tsx pro motivo (useSyncExternalStore em SSR lê
// getInitialState do zustand v5, não o estado atual; testar o container
// conectado via renderToStaticMarkup daria falso positivo, sempre vazio).

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import type { ConversationMeta } from "@/lib/db/conversations"
import {
  buildFleetLines,
  FleetRowItem,
  parseFleetKey,
  parseUnseenKey,
  rowSubtitle,
  type LinhaDaFrota,
} from "./FleetView"

describe("parseFleetKey", () => {
  it("chave vazia não produz linha nenhuma", () => {
    expect(parseFleetKey("")).toEqual([])
  })

  it("uma linha: id, projeto, agent e início", () => {
    expect(parseFleetKey("c1:p1:claude-code:1000")).toEqual([
      { id: "c1", projectId: "p1", agent: "claude-code", startedAt: 1000 },
    ])
  })

  it("sem início (startedAt vazio) vira null, não NaN", () => {
    expect(parseFleetKey("c1:p1:codex:")).toEqual([
      { id: "c1", projectId: "p1", agent: "codex", startedAt: null },
    ])
  })

  it("várias linhas, uma por '|'", () => {
    const rows = parseFleetKey("c1:p1:claude-code:1000|c2:p2:codex:2000")
    expect(rows).toHaveLength(2)
    expect(rows[0].id).toBe("c1")
    expect(rows[1].id).toBe("c2")
  })
})

describe("parseUnseenKey", () => {
  it("chave vazia não produz linha nenhuma", () => {
    expect(parseUnseenKey("")).toEqual([])
  })

  it("resultado desconhecido degrada pra ok, nunca inventa falha", () => {
    expect(parseUnseenKey("c1:p1:error|c2:p2:ok|c3:p3:xyz")).toEqual([
      { id: "c1", projectId: "p1", resultado: "error" },
      { id: "c2", projectId: "p2", resultado: "ok" },
      { id: "c3", projectId: "p3", resultado: "ok" },
    ])
  })
})

// --- fixtures no shape real de ConversationMeta (lib/db/conversations) ------

const PROJETOS = [
  { id: "p1", name: "frota", color: "#78716c" },
  { id: "p2", name: "Landing Prime", color: "#0d9488" },
]

function meta(parcial: Partial<ConversationMeta> & { id: string }): ConversationMeta {
  return {
    title: null,
    updatedAt: 0,
    color: null,
    worktreePath: null,
    agent: null,
    ...parcial,
  }
}

const METAS: Record<string, ConversationMeta[]> = {
  p1: [
    meta({ id: "c-pede", title: "Deploy da landing", updatedAt: 500 }),
    meta({ id: "c-roda-nova", title: "Tweet da thread", updatedAt: 900 }),
    meta({ id: "c-roda-antiga", title: "Refactor do parser", updatedAt: 800 }),
    meta({ id: "c-ok", title: "Ajuste de tipografia", updatedAt: 700 }),
    meta({ id: "c-erro", title: "Build do release", updatedAt: 600 }),
  ],
  p2: [meta({ id: "c-orfa", title: "Pergunta do motor", updatedAt: 950 })],
}

const BASE = {
  aguardando: new Set<string>(),
  metas: METAS,
  projetos: PROJETOS,
  vivas: [],
  terminadas: [],
}

describe("buildFleetLines", () => {
  it("vazio total não produz seção nenhuma", () => {
    expect(buildFleetLines(BASE)).toEqual({ agora: [], maisCedo: [] })
  })

  it("quem pede vem antes de quem roda, e rodar+pedir é UMA linha (pede)", () => {
    const { agora } = buildFleetLines({
      ...BASE,
      vivas: [
        { id: "c-roda-nova", projectId: "p1", agent: "codex", startedAt: 200 },
        { id: "c-pede", projectId: "p1", agent: "claude-code", startedAt: 100 },
      ],
      aguardando: new Set(["c-pede"]),
    })
    expect(agora.map((l) => l.id)).toEqual(["c-pede", "c-roda-nova"])
    expect(agora[0].estado).toBe("pede")
    expect(agora[0].rodando).toBe(true)
    expect(agora[1].estado).toBe("rodando")
  })

  it("pedido sem run vivo entra via meta do projeto, sem inventar projeto", () => {
    const { agora } = buildFleetLines({
      ...BASE,
      aguardando: new Set(["c-orfa"]),
    })
    expect(agora).toHaveLength(1)
    expect(agora[0].projectId).toBe("p2")
    expect(agora[0].titulo).toBe("Pergunta do motor")
    expect(agora[0].estado).toBe("pede")
    expect(agora[0].rodando).toBe(false)
  })

  it("pedido de conversa desconhecida (sem meta) não aparece — sem status inventado", () => {
    const { agora } = buildFleetLines({
      ...BASE,
      aguardando: new Set(["c-fantasma"]),
    })
    expect(agora).toEqual([])
  })

  it("dentro do rodando, o turno mais ANTIGO vem primeiro", () => {
    const { agora } = buildFleetLines({
      ...BASE,
      vivas: [
        { id: "c-roda-nova", projectId: "p1", agent: "codex", startedAt: 200 },
        { id: "c-roda-antiga", projectId: "p1", agent: "codex", startedAt: 100 },
      ],
    })
    expect(agora.map((l) => l.id)).toEqual(["c-roda-antiga", "c-roda-nova"])
  })

  it("mais cedo: falha antes de concluída, e nunca repete quem está em agora", () => {
    const { agora, maisCedo } = buildFleetLines({
      ...BASE,
      vivas: [{ id: "c-roda-nova", projectId: "p1", agent: "codex", startedAt: 200 }],
      terminadas: [
        { id: "c-ok", projectId: "p1", resultado: "ok" },
        { id: "c-erro", projectId: "p1", resultado: "error" },
        { id: "c-roda-nova", projectId: "p1", resultado: "ok" },
      ],
    })
    expect(agora.map((l) => l.id)).toEqual(["c-roda-nova"])
    expect(maisCedo.map((l) => l.id)).toEqual(["c-erro", "c-ok"])
    expect(maisCedo[0].estado).toBe("falhou")
    expect(maisCedo[1].estado).toBe("quando")
  })

  it("cor: a da conversa vence; sem ela, a do projeto; sem as duas, null", () => {
    const metas: Record<string, ConversationMeta[]> = {
      p1: [meta({ id: "c1", color: "#123456" }), meta({ id: "c2" })],
      p2: [meta({ id: "c3" })],
    }
    const { agora } = buildFleetLines({
      ...BASE,
      metas,
      projetos: [{ id: "p1", name: "a", color: "#aaaaaa" }, { id: "p2", name: "b", color: null }],
      vivas: [
        { id: "c1", projectId: "p1", agent: "codex", startedAt: 1 },
        { id: "c2", projectId: "p1", agent: "codex", startedAt: 2 },
        { id: "c3", projectId: "p2", agent: "codex", startedAt: 3 },
      ],
    })
    expect(agora.map((l) => l.cor)).toEqual(["#123456", "#aaaaaa", null])
  })

  it("sem título na meta, cai no rótulo canônico", () => {
    const { agora } = buildFleetLines({
      ...BASE,
      metas: { p1: [meta({ id: "c1" })] },
      vivas: [{ id: "c1", projectId: "p1", agent: "codex", startedAt: 1 }],
    })
    expect(agora[0].titulo).toBe("Nova conversa")
  })
})

describe("rowSubtitle — o tempo verbal certo, sem inventar", () => {
  it("pede é decisão, não atividade", () => {
    expect(rowSubtitle({ estado: "pede", finalizando: false, fundo: null })).toBe(
      "aguardando sua resposta",
    )
  })

  it("falhou e concluída são pretérito", () => {
    expect(rowSubtitle({ estado: "falhou", finalizando: false, fundo: null })).toBe(
      "o último turno falhou",
    )
    expect(rowSubtitle({ estado: "quando", finalizando: false, fundo: null })).toBe("concluída")
  })

  it("rodando: o background real vence o genérico; finalizando vence o trabalhar", () => {
    expect(
      rowSubtitle({ estado: "rodando", finalizando: true, fundo: "trabalho em background · build" }),
    ).toBe("trabalho em background · build")
    expect(rowSubtitle({ estado: "rodando", finalizando: true, fundo: null })).toBe("finalizando…")
    expect(rowSubtitle({ estado: "rodando", finalizando: false, fundo: null })).toBe(
      "está trabalhando…",
    )
  })
})

// --- a linha, por props (sem tocar a store) ---------------------------------

function linha(parcial: Partial<LinhaDaFrota>): LinhaDaFrota {
  return {
    id: "c1",
    projectId: "p1",
    projectName: "frota",
    agent: "claude-code",
    titulo: "Landing page",
    cor: null,
    estado: "rodando",
    rodando: true,
    startedAt: 1000,
    updatedAt: 2000,
    ...parcial,
  }
}

function renderLinha(props: Partial<Parameters<typeof FleetRowItem>[0]>): string {
  return renderToStaticMarkup(
    createElement(FleetRowItem, {
      linha: linha({}),
      subtitulo: "está trabalhando…",
      custo: null,
      custoEstimado: false,
      avisoParar: null,
      agora: 1_700_000_120_000,
      agoraMinuto: 1_700_000_120_000,
      onOpen: vi.fn(),
      onParar: vi.fn(),
      ...props,
    }),
  )
}

describe("FleetRowItem — render por props (sem tocar a store)", () => {
  it("mostra título, projeto e cronômetro da rodando", () => {
    const inicio = 1_700_000_120_000 - 65_000
    const html = renderLinha({ linha: linha({ startedAt: inicio }) })
    expect(html).toContain("Landing page")
    expect(html).toContain("frota")
    expect(html).toContain("1min")
    expect(html).toContain("turno rodando")
  })

  it("sem startedAt, não escreve tempo nenhum (nunca 'NaN')", () => {
    const html = renderLinha({
      linha: linha({ startedAt: null, updatedAt: null }),
    })
    expect(html).not.toContain("NaN")
  })

  it("custo zerado fica vazio: sem turno terminado não há custo a mostrar", () => {
    const html = renderLinha({ custo: null })
    expect(html).not.toContain("US$")
  })

  it("custo estimado carrega o til do método honesto", () => {
    const html = renderLinha({ custo: 1.2, custoEstimado: true })
    expect(html).toContain("~")
    expect(html).toContain("US$")
  })

  it("pede mostra Responder em vez de Abrir, e mantém Parar se o processo vive", () => {
    const html = renderLinha({
      linha: linha({ estado: "pede", rodando: true }),
      subtitulo: "aguardando sua resposta",
    })
    expect(html).toContain("Responder")
    expect(html).not.toContain("Abrir")
    expect(html).toContain("Parar")
    expect(html).toContain("aguardando sua resposta")
  })

  it("concluída não oferece Parar (não há o que cortar)", () => {
    const html = renderLinha({
      linha: linha({ estado: "quando", rodando: false }),
      subtitulo: "concluída",
    })
    expect(html).toContain("Abrir")
    expect(html).not.toContain("Parar")
  })
})
