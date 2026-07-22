// S4.2 — lead propositor: proposePlan lê os cards abertos do board, chama o
// helper barato (suggest injetado, padrão distillLesson) e PERSISTE a
// proposta. O lead NUNCA despacha: este módulo não tem caminho de dispatch, e
// os testes verificam que ele só escreve texto (insertProposal).

import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/path", () => ({
  homeDir: vi.fn(async () => "/home/piloto"),
}))
vi.mock("@/lib/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db")>()),
  isTauri: () => false, // sem hidratação de boot do useCards no import
  insertProposal: vi.fn(async () => "prop-1"),
}))

import { insertProposal } from "@/lib/db"
import { buildLeadPrompt, proposePlan } from "@/lib/lead"
import { useApp } from "@/store/app"
import { useCards, type CardRow } from "@/store/cards"
import type { Project } from "@/lib/types"

function card(over: Partial<CardRow> = {}): CardRow {
  return {
    id: "c1",
    projectId: "p1",
    title: "intenção",
    body: null,
    state: "backlog",
    assigneeAgent: null,
    conversationId: null,
    owner: null,
    pinned: false,
    pinRank: null,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  }
}

function project(id: string, name: string): Project {
  return {
    id,
    name,
    path: `/proj/${id}`,
    createdAt: 1,
    hasClaudeMd: false,
    hasAgentsMd: false,
    status: "idle",
  }
}

function seedCards(cards: CardRow[]): void {
  const byProject: Record<string, CardRow[]> = {}
  for (const c of cards) (byProject[c.projectId] ??= []).push(c)
  useCards.setState({ all: cards, byProject })
}

function armApp(over: {
  helperModel?: string | null
  mycockpit?: Record<string, { helper: string | null }>
}): void {
  const settings = useApp.getState().settings
  useApp.setState({
    projects: [project("p1", "alpha"), project("p2", "beta")],
    settings: {
      ...settings,
      // null é valor VÁLIDO (helper desligado): só o ausente vira default.
      helperModel:
        over.helperModel === undefined ? "haiku" : over.helperModel,
    },
    // ProjectConfig completo não é necessário: proposePlan só lê `.helper`.
    mycockpit: (over.mycockpit ?? {}) as never,
  })
}

const run = vi.fn(
  async (_model: string, _cwd: string, _prompt: string) =>
    "1. Priorize o card A\nDespache: intenção",
)

beforeEach(() => {
  vi.clearAllMocks()
  seedCards([])
  armApp({})
})

describe("buildLeadPrompt (S4.2)", () => {
  it("lista cada card com estado pt-BR, projeto e marca de estagnado", () => {
    const prompt = buildLeadPrompt(
      [
        card({ title: "A", state: "backlog" }),
        card({ title: "B", state: "blocked", stalledSince: 5 }),
        card({ title: "C", state: "review", projectId: "px" }),
      ],
      new Map([["p1", "alpha"]]),
    )
    expect(prompt).toContain("- [backlog] A (alpha)")
    expect(prompt).toContain("- [bloqueado] B (alpha, parado sem atividade)")
    expect(prompt).toContain("- [em revisão] C (projeto arquivado)")
    // triagem, não despacho: o prompt pede NO MÁXIMO 1 sugestão de card
    expect(prompt).toContain("NO MÁXIMO 1 card")
  })
})

describe("proposePlan (S4.2)", () => {
  it("board com cards abertos: chama o helper e persiste a proposta", async () => {
    seedCards([card({ state: "backlog" }), card({ id: "c2", state: "review" })])
    const id = await proposePlan(undefined, run)
    expect(id).toBe("prop-1")
    // helper global (sem projectId não há cfg de projeto), cwd = home
    expect(run).toHaveBeenCalledWith(
      "haiku",
      "/home/piloto",
      expect.stringContaining("intenção"),
    )
    expect(vi.mocked(insertProposal)).toHaveBeenCalledWith({
      projectId: null,
      body: "1. Priorize o card A\nDespache: intenção",
    })
  })

  it("com projectId: só cards do projeto, cwd = pasta do projeto, persiste com o id", async () => {
    seedCards([
      card({ id: "a", title: "do-p1", projectId: "p1" }),
      card({ id: "b", title: "do-p2", projectId: "p2" }),
    ])
    await proposePlan("p1", run)
    const prompt = run.mock.calls[0][2]
    expect(prompt).toContain("do-p1")
    expect(prompt).not.toContain("do-p2")
    expect(run).toHaveBeenCalledWith("haiku", "/proj/p1", expect.any(String))
    expect(vi.mocked(insertProposal)).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: "p1" }),
    )
  })

  it("cards terminais (done/cancelled) ficam fora da triagem", async () => {
    seedCards([
      card({ id: "a", title: "aberto", state: "working" }),
      card({ id: "b", title: "fechado", state: "done" }),
      card({ id: "c", title: "abortado", state: "cancelled" }),
    ])
    await proposePlan(undefined, run)
    const prompt = run.mock.calls[0][2]
    expect(prompt).toContain("aberto")
    expect(prompt).not.toContain("fechado")
    expect(prompt).not.toContain("abortado")
  })

  it("board vazio: devolve null SEM chamar o helper (sem gasto)", async () => {
    seedCards([card({ state: "done" })])
    const id = await proposePlan(undefined, run)
    expect(id).toBeNull()
    expect(run).not.toHaveBeenCalled()
    expect(vi.mocked(insertProposal)).not.toHaveBeenCalled()
  })

  it("helper desligado: lança com mensagem pt-BR (o caller decide toast/failed)", async () => {
    armApp({ helperModel: null })
    seedCards([card()])
    await expect(proposePlan(undefined, run)).rejects.toThrow(/modelo helper/)
    expect(run).not.toHaveBeenCalled()
  })

  it("cfg do projeto VENCE o global (inclusive helper null = desligado)", async () => {
    armApp({
      helperModel: "haiku",
      mycockpit: { p1: { helper: "sonnet" } },
    })
    seedCards([card({ projectId: "p1" })])
    await proposePlan("p1", run)
    expect(run).toHaveBeenCalledWith("sonnet", "/proj/p1", expect.any(String))

    // helper null no cfg do projeto desliga MESMO com global ligado
    armApp({ helperModel: "haiku", mycockpit: { p1: { helper: null } } })
    await expect(proposePlan("p1", run)).rejects.toThrow(/modelo helper/)
  })

  it("helper mudo (resposta vazia): não grava proposta fantasma", async () => {
    seedCards([card()])
    const mute = vi.fn(async () => "   \n  ")
    const id = await proposePlan(undefined, mute)
    expect(id).toBeNull()
    expect(vi.mocked(insertProposal)).not.toHaveBeenCalled()
  })
})
