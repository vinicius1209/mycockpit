// O cruzamento que decide quem está solto. O erro caro deste módulo não é
// deixar de listar algo: é listar um worktree VIVO como solto, porque aí o
// diálogo oferece recolher a pasta em que uma conversa está trabalhando.

import { describe, expect, it } from "vitest"
import { looseWorktrees, worktreeStatusText, type WorktreeEntry } from "./worktrees"

const wt = (branch: string, path: string | null, ownCommits = 0): WorktreeEntry => ({
  branch,
  path,
  ownCommits,
})

const VIVO = "/proj/.mycockpit/worktrees/aaa11111"
const SOLTO = "/proj/.mycockpit/worktrees/bbb22222"

describe("looseWorktrees", () => {
  it("worktree que uma conversa usa NÃO está solto", () => {
    const out = looseWorktrees([wt("mycockpit/aaa11111", VIVO)], [VIVO])
    expect(out).toEqual([])
  })

  it("worktree que ninguém reivindica está solto", () => {
    const out = looseWorktrees([wt("mycockpit/bbb22222", SOLTO)], [VIVO])
    expect(out.map((w) => w.branch)).toEqual(["mycockpit/bbb22222"])
  })

  it("branch sem pasta está sempre solto (é a forma comum do vazamento)", () => {
    const out = looseWorktrees([wt("mycockpit/ccc33333", null)], [VIVO])
    expect(out.map((w) => w.branch)).toEqual(["mycockpit/ccc33333"])
  })

  it("barra final não faz worktree vivo passar por solto", () => {
    const out = looseWorktrees([wt("mycockpit/aaa11111", `${VIVO}/`)], [VIVO])
    expect(out).toEqual([])
  })

  it("conversa de OUTRO projeto também segura a pasta", () => {
    // a lista de reivindicações vem de todas as conversas, não só do ativo
    const out = looseWorktrees([wt("mycockpit/aaa11111", VIVO)], [null, undefined, VIVO])
    expect(out).toEqual([])
  })

  it("sem commit próprio é limpo; com commit, não", () => {
    const out = looseWorktrees(
      [wt("mycockpit/b1", SOLTO, 0), wt("mycockpit/b2", null, 3)],
      [],
    )
    expect(out.map((w) => w.clean)).toEqual([true, false])
  })

  it("nada solto devolve lista vazia (a faixa não desenha item)", () => {
    expect(looseWorktrees([], [])).toEqual([])
  })
})

describe("worktreeStatusText", () => {
  it("limpo diz que não há commit próprio", () => {
    const [w] = looseWorktrees([wt("mycockpit/b1", SOLTO, 0)], [])
    expect(worktreeStatusText(w)).toContain("sem commit próprio")
    expect(worktreeStatusText(w)).toContain(SOLTO)
  })

  it("com trabalho, o NÚMERO aparece (é o que faz o usuário ir buscar)", () => {
    const [w] = looseWorktrees([wt("mycockpit/b2", SOLTO, 3)], [])
    expect(worktreeStatusText(w)).toContain("3 commits")
  })

  it("um commit não vira '1 commits'", () => {
    const [w] = looseWorktrees([wt("mycockpit/b3", SOLTO, 1)], [])
    expect(worktreeStatusText(w)).toContain("1 commit que só existe aqui")
  })

  it("pasta ausente é dita, não vira caminho vazio", () => {
    const [w] = looseWorktrees([wt("mycockpit/b4", null, 0)], [])
    expect(worktreeStatusText(w)).toContain("pasta ausente")
  })
})
