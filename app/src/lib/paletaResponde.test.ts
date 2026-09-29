import { describe, expect, it } from "vitest"
import type { ConversationMeta } from "@/lib/db/conversations"
import { buildFleetLines } from "@/lib/fleet/linhas"
import type { UsageSnapshot } from "@/lib/usageWindow"
import {
  intencaoDaPergunta,
  linhaDeEstado,
  respostaDaCota,
  respostaDaFrota,
  respostaDoGasto,
  type EstadoDaFrota,
  type Pedaco,
} from "./paletaResponde"

// 29/09/2026 15:50 local.
const NOW = new Date(2026, 8, 29, 15, 50).getTime()
const MIN = 60_000
const texto = (p: Pedaco[]) => p.map((x) => x.texto).join("")

const meta = (id: string, title: string, updatedAt: number): ConversationMeta => ({
  id, title, updatedAt, color: null, worktreePath: null, agent: null,
})
const PROJETOS = [
  { id: "p1", name: "Frota", color: null },
  { id: "p2", name: "Landing Prime", color: null },
]
const METAS = {
  p1: [meta("c-estudo", "Estudo do Maestri", NOW - 30 * MIN), meta("c-mig", "Migração 63", NOW - 20 * MIN), meta("c-fatura", "Parcelas duplicadas", NOW - 4 * MIN), meta("c-ok", "Status no sidebar", NOW - 25 * MIN)],
  p2: [meta("c-landing", "Formulário de contato", NOW - 60 * MIN)],
}

// O estado pela MESMA derivação da Frota, não montado à mão.
function estado(): EstadoDaFrota {
  const { agora, maisCedo } = buildFleetLines({
    vivas: [
      { id: "c-estudo", projectId: "p1", agent: "claude-code", startedAt: NOW - 12 * MIN },
      { id: "c-mig", projectId: "p1", agent: "codex", startedAt: NOW - 3 * MIN },
      { id: "c-fatura", projectId: "p1", agent: "codex", startedAt: NOW - 5 * MIN },
    ],
    terminadas: [
      { id: "c-ok", projectId: "p1", resultado: "ok" },
      { id: "c-landing", projectId: "p2", resultado: "error" },
    ],
    aguardando: new Set(["c-fatura"]),
    metas: METAS,
    projetos: PROJETOS,
  } as Parameters<typeof buildFleetLines>[0])
  return { agora, maisCedo, pedidos: new Map([["c-fatura", "aprovar bun test"]]) }
}

describe("a pergunta (P1, por palavra, sem modelo)", () => {
  it("reconhece as cinco perguntas do mock", () => {
    expect(intencaoDaPergunta("quem está rodando")?.tipo).toBe("rodando")
    expect(intencaoDaPergunta("o que pede você")?.tipo).toBe("pede")
    expect(intencaoDaPergunta("quanto gastei hoje")?.tipo).toBe("gasto")
    expect(intencaoDaPergunta("quando a cota volta")?.tipo).toBe("cota")
    expect(intencaoDaPergunta("o que terminou sem eu ver")?.tipo).toBe("terminou")
  })

  it("lê motor, período e 'neste projeto' (P4)", () => {
    expect(intencaoDaPergunta("cota do codex")).toMatchObject({ tipo: "cota", motor: "codex" })
    expect(intencaoDaPergunta("gasto da semana no claude")).toMatchObject({ tipo: "gasto", motor: "claude-code", periodo: "semana" })
    expect(intencaoDaPergunta("rodando neste projeto")).toMatchObject({ tipo: "rodando", soProjeto: true })
  })

  it("o que não é pergunta de estado não ganha resposta", () => {
    expect(intencaoDaPergunta("por que o build quebrou")).toBeNull()
    expect(intencaoDaPergunta("parser")).toBeNull()
    expect(intencaoDaPergunta("cot")).toBeNull()
  })
})

describe("as respostas saem do estado da Frota", () => {
  const e = estado()

  it("rodando: as conversas vivas na ordem da Frota (pede primeiro, depois a mais antiga)", () => {
    const r = respostaDaFrota(intencaoDaPergunta("quem está rodando")!, e, NOW, "p1")
    expect(texto(r.manchete)).toBe("3 conversas rodando agora")
    expect(r.linhas.map((l) => [l.titulo, texto(l.meta)])).toEqual([
      ["Parcelas duplicadas", "há 5 min"],
      ["Estudo do Maestri", "há 12 min"],
      ["Migração 63", "há 3 min"],
    ])
    expect(r.linhas[1].conversa).toEqual({ id: "c-estudo", projectId: "p1" })
  })

  it("pede: em âmbar, com o resumo do pedido", () => {
    const r = respostaDaFrota(intencaoDaPergunta("o que pede você")!, e, NOW, "p1")
    expect(r.manchete[0]).toEqual({ texto: "1 conversa", tom: "am" })
    expect(r.linhas[0].meta[0]).toEqual({ texto: "aprovar bun test", tom: "am" })
  })

  it("terminou: falha em vermelho, e o projeto só aparece quando mistura", () => {
    const r = respostaDaFrota(intencaoDaPergunta("o que terminou")!, e, NOW, "p1")
    expect(texto(r.manchete)).toBe("2 conversas terminaram sem você abrir")
    const falha = r.linhas.find((l) => l.chave === "c-landing")!
    expect(falha.meta[0]).toEqual({ texto: "falhou", tom: "erro" })
    expect(falha.sub).toBe("Landing Prime")
    const soAqui = respostaDaFrota(intencaoDaPergunta("o que terminou neste projeto")!, e, NOW, "p1")
    expect(soAqui.linhas.map((l) => l.chave)).toEqual(["c-ok"])
    expect(soAqui.linhas[0].sub).toBeUndefined()
  })

  it("nada rodando diz nada, sem lista inventada", () => {
    const vazio: EstadoDaFrota = { agora: [], maisCedo: [], pedidos: new Map() }
    expect(texto(respostaDaFrota(intencaoDaPergunta("quem está rodando")!, vazio, NOW, null).manchete)).toBe("Nada rodando agora")
  })
})

describe("gasto e cota", () => {
  const hoje = NOW - 60 * MIN
  const rows = [
    { agent: "claude-code", projectId: "p1", costUsd: 150.4, tokens: 1, createdAt: hoje },
    { agent: "claude-code", projectId: "p1", costUsd: 40, tokens: 1, createdAt: hoje },
    { agent: "codex", projectId: "p2", costUsd: 26.62, tokens: 1, createdAt: hoje },
    { agent: "agy", projectId: "p1", costUsd: null, tokens: 1, createdAt: hoje },
    { agent: "claude-code", projectId: "p1", costUsd: 99, tokens: 1, createdAt: NOW - 3 * 24 * 60 * MIN },
  ]

  it("gasto de hoje por motor; motor sem preço diz 'sem preço', nunca zero", () => {
    const r = respostaDoGasto(intencaoDaPergunta("quanto gastei hoje")!, rows, NOW, "p1")
    expect(texto(r.manchete)).toBe("US$ 217,02 hoje, em 4 turnos")
    expect(r.linhas.map((l) => [l.agent, texto(l.meta)])).toEqual([
      ["claude-code", "US$ 190,402 turnos"],
      ["codex", "US$ 26,621 turno"],
      ["agy", "sem preço1 turno"],
    ])
    expect(texto(respostaDoGasto(intencaoDaPergunta("gasto da semana")!, rows, NOW, null).manchete)).toContain("US$ 316,02")
  })

  const snap = (agent: string, id: string, pct: number, min: number, reset: Date): UsageSnapshot => ({
    agent, source: "oauth", planType: null, fetchedAt: NOW - 2 * MIN,
    windows: [{ id, label: id, usedPercent: pct, resetsAt: reset.getTime() / 1000, windowMinutes: min }],
  })

  it("cota: a mais apertada primeiro, com a volta e a régua de cor", () => {
    const r = respostaDaCota(
      intencaoDaPergunta("quando a cota volta")!,
      {
        "claude-code": snap("claude-code", "5h", 72, 300, new Date(2026, 8, 29, 18, 0)),
        codex: snap("codex", "7d", 35, 10_080, new Date(2026, 9, 2, 9, 0)),
      },
      {},
      NOW,
    )
    expect(texto(r.manchete)).toBe("A mais apertada é a do Claude Code, que volta às 18:00")
    expect(r.fonte).toBe("leitura dos planos de 2min atrás")
    expect(r.linhas[0]).toMatchObject({ sub: "sessão de 5h", barra: { pct: 72, tom: "warn" } })
    expect(r.linhas[0].meta).toEqual([{ texto: "72%", tom: "am" }, { texto: "volta 18:00" }])
    expect(r.linhas[1].meta[1]).toEqual({ texto: "volta dia 2, 09:00" })
  })

  it("sem leitura de cota, diz que ainda não leu", () => {
    const r = respostaDaCota(intencaoDaPergunta("cota do codex")!, {}, {}, NOW)
    expect(texto(r.manchete)).toBe("Ainda não li a cota do Codex")
    expect(r.linhas).toEqual([])
  })
})

describe("linha do campo vazio (P2)", () => {
  it("só com algo rodando ou pedindo", () => {
    expect(linhaDeEstado({ agora: [], maisCedo: [], pedidos: new Map() }, 217.02)).toBeNull()
    expect(linhaDeEstado(estado(), 217.02)?.map((p) => p.texto)).toEqual(["3 rodando", "1 pede você", "US$ 217,02 hoje"])
  })
})
