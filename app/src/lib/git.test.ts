// A frase que o usuário lê depois de remover um worktree. É a única parte
// disto que dá pra testar sem git de verdade — e é a que importa: um branch
// que sobreviveu e não é dito volta a ser o lixo invisível que motivou o
// `branch -d` no lado Rust.

import { describe, expect, it } from "vitest"
import { worktreeRemovalNote } from "./git"

describe("worktreeRemovalNote", () => {
  it("sem branch legível, não inventa frase", () => {
    expect(worktreeRemovalNote({ branch: null, branchRemoved: false })).toBeNull()
  })

  it("branch apagado junto: conta o nome do que sumiu", () => {
    const nota = worktreeRemovalNote({
      branch: "mycockpit/a1b2c3d4",
      branchRemoved: true,
    })
    expect(nota).toContain("mycockpit/a1b2c3d4")
    expect(nota).toContain("apagado")
  })

  it("branch preservado: diz o nome E o motivo (senão parece falha)", () => {
    const nota = worktreeRemovalNote({
      branch: "mycockpit/a1b2c3d4",
      branchRemoved: false,
    })
    expect(nota).toContain("mycockpit/a1b2c3d4")
    expect(nota).toContain("commit")
    // "ficou" é preservação deliberada do git, não erro nosso — a frase não
    // pode soar como falha, senão o usuário tenta "consertar" apagando trabalho.
    expect(nota).not.toMatch(/falh|erro/i)
  })
})
