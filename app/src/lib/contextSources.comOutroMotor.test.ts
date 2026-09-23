import { describe, expect, it } from "vitest"
import { comOutroMotor } from "./contextSources"

// Os fatos do disco do repositório da Frota em 23/09/2026: CLAUDE.md (link
// para o AGENTS.md), AGENTS.md, 3 subagents e 24 memórias do Claude.
const FROTA = { claudeMd: true, agentsMd: true, personas: 3, memories: 24 }
const MOTORES = [
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
  { id: "agy", label: "Antigravity" },
]

describe("com outro motor muda", () => {
  it("numa conversa Claude, diz o que Codex e agy leriam", () => {
    expect(comOutroMotor("claude-code", FROTA, MOTORES)).toBe(
      "o Codex lê AGENTS.md; o Antigravity não tem arquivo próprio conhecido. As regras do projeto chegam a todos.",
    )
  })

  it("arquivo que o outro motor leria e não existe é dito como ausente", () => {
    const semAgents = { ...FROTA, agentsMd: false }
    expect(comOutroMotor("claude-code", semAgents, MOTORES)).toContain("o Codex leria AGENTS.md, que não existe aqui")
  })

  it("numa conversa Codex, o Claude aparece com o que é dele", () => {
    expect(comOutroMotor("codex", FROTA, MOTORES)).toContain(
      "o Claude Code lê CLAUDE.md, .claude/agents (3), memórias do CLI (24)",
    )
  })

  it("sem outro motor, não há o que comparar", () => {
    expect(comOutroMotor("codex", FROTA, [{ id: "codex", label: "Codex" }])).toBeNull()
  })
})
