// O painel dizia "o que o agente enxerga" e contava a mobília do Claude Code.
// Estes testes fixam a leitura CRUZADA com o agent da conversa — o caso real que
// expôs o buraco: 4 das 5 entregas deste repo foram do codex, que lê AGENTS.md,
// e o arquivo não existe.

import { describe, expect, it } from "vitest"
import {
  readableBy,
  sourceLabel,
  vendorReadingNote,
  vendorSources,
  type VendorFacts,
} from "./contextSources"

const NADA: VendorFacts = {
  claudeMd: false,
  agentsMd: false,
  personas: 0,
  memories: 0,
}
/** O estado real deste repo em jul/2026: nenhuma instrução, 3 subagents, 9 memórias. */
const ESTE_REPO: VendorFacts = {
  claudeMd: false,
  agentsMd: false,
  personas: 3,
  memories: 9,
}

describe("dono de cada fonte", () => {
  it("CLAUDE.md e a mobília .claude são do Claude Code; AGENTS.md é do Codex", () => {
    const donos = Object.fromEntries(
      vendorSources(ESTE_REPO).map((s) => [s.label, s.owner]),
    )
    expect(donos["CLAUDE.md"]).toBe("claude-code")
    expect(donos[".claude/agents"]).toBe("claude-code")
    expect(donos["memórias do CLI"]).toBe("claude-code")
    expect(donos["AGENTS.md"]).toBe("codex")
  })

  it("o agy não é dono de nenhuma fonte de disco conhecida", () => {
    // e o painel NÃO deve inventar que ele lê (nem que não lê) as dos outros.
    expect(readableBy("agy", ESTE_REPO)).toEqual([])
  })

  it("coleção mostra a contagem; arquivo único não", () => {
    const s = vendorSources(ESTE_REPO)
    expect(sourceLabel(s.find((x) => x.label === ".claude/agents")!)).toBe(
      ".claude/agents (3)",
    )
    expect(sourceLabel(s.find((x) => x.label === "CLAUDE.md")!)).toBe("CLAUDE.md")
  })
})

describe("vendorReadingNote", () => {
  it("codex neste repo: leria AGENTS.md, que não existe", () => {
    const nota = vendorReadingNote("codex", "Codex", ESTE_REPO)!
    expect(nota).toContain("AGENTS.md")
    expect(nota).toContain("não existe")
    // não cita as 3 personas nem as 9 memórias: não são dele.
    expect(nota).not.toContain(".claude/agents")
  })

  it("claude-code neste repo: cita o que existe (personas e memórias), não o que falta", () => {
    const nota = vendorReadingNote("claude-code", "Claude Code", ESTE_REPO)!
    expect(nota).toContain(".claude/agents (3)")
    expect(nota).toContain("memórias do CLI (9)")
    expect(nota).not.toContain("CLAUDE.md")
  })

  it("agy: admite que não sabemos de arquivo próprio e afirma só a doutrina", () => {
    const nota = vendorReadingNote("agy", "Antigravity", ESTE_REPO)!
    expect(nota).toContain("doutrina")
    expect(nota).not.toContain("AGENTS.md")
  })

  it("projeto pelado com claude: diz que leria CLAUDE.md e não achou", () => {
    expect(vendorReadingNote("claude-code", "Claude Code", NADA)).toContain(
      "CLAUDE.md",
    )
  })

  it("sem conversa aberta não há o que cruzar", () => {
    expect(vendorReadingNote(null, "", ESTE_REPO)).toBeNull()
  })
})
