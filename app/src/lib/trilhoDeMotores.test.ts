import { describe, expect, it } from "vitest"
import { motoresDoTrilho } from "./trilhoDeMotores"

const TODOS = ["claude-code", "codex", "agy"]

describe("trilho de motores do seletor", () => {
  it("conversa nova mostra todos os motores", () => {
    expect(motoresDoTrilho(TODOS, { locked: false, ativo: "codex", elegiveis: [] })).toEqual(TODOS)
  })

  it("conversa iniciada mostra o atual e só os elegíveis para revezar, na ordem do trilho", () => {
    expect(motoresDoTrilho(TODOS, { locked: true, ativo: "codex", elegiveis: ["agy"] })).toEqual(["codex", "agy"])
  })

  it("sem destino elegível, só o motor atual fica", () => {
    expect(motoresDoTrilho(TODOS, { locked: true, ativo: "claude-code", elegiveis: [] })).toEqual(["claude-code"])
  })
})
