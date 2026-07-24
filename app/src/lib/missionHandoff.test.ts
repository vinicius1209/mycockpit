import { describe, expect, it } from "vitest"
import type { GitDiff } from "@/lib/git"
import {
  changedFilesRef,
  formatPriorHandoffs,
  parseHandoff,
} from "./missionHandoff"

describe("parseHandoff", () => {
  it("parseia JSON limpo e normaliza campos", () => {
    const doc = parseHandoff(
      JSON.stringify({
        intent: "fiz X",
        decisions: [{ choice: "usar A", rejected: "B", reason: "mais simples" }],
        files_touched: ["a.ts", "b.ts"],
        open_questions: ["e o timeout?"],
        for_next_agent: "valide o contrato",
      }),
    )
    expect(doc).not.toBeNull()
    expect(doc!.intent).toBe("fiz X")
    expect(doc!.decisions[0].choice).toBe("usar A")
    expect(doc!.files_touched).toEqual(["a.ts", "b.ts"])
  })

  it("tolera cercas ```json e prosa em volta", () => {
    const raw = 'Aqui está:\n```json\n{"intent":"oi","for_next_agent":"vai"}\n```\nfim'
    const doc = parseHandoff(raw)
    expect(doc?.intent).toBe("oi")
    expect(doc?.for_next_agent).toBe("vai")
  })

  it("aplica caps (máx 5 decisions e open_questions)", () => {
    const doc = parseHandoff(
      JSON.stringify({
        intent: "x",
        decisions: Array.from({ length: 9 }, (_, i) => ({ choice: `d${i}` })),
        open_questions: Array.from({ length: 9 }, (_, i) => `q${i}`),
      }),
    )
    expect(doc!.decisions).toHaveLength(5)
    expect(doc!.open_questions).toHaveLength(5)
  })

  it("null p/ lixo sem sinal útil ou JSON inválido", () => {
    expect(parseHandoff("")).toBeNull()
    expect(parseHandoff("não é json")).toBeNull()
    expect(parseHandoff(JSON.stringify({ files_touched: ["só isso"] }))).toBeNull()
  })
})

describe("formatPriorHandoffs", () => {
  it("achata intenção, decisões e pendências", () => {
    const txt = formatPriorHandoffs([
      {
        label: "Planejar",
        persona: "planner",
        doc: {
          intent: "planejei o login",
          decisions: [{ choice: "JWT", rejected: "sessão", reason: "stateless" }],
          files_touched: ["auth.ts"],
          open_questions: ["refresh token?"],
          for_next_agent: "implemente o middleware",
        },
      },
    ])
    expect(txt).toContain("Planejar (planner)")
    expect(txt).toContain("planejei o login")
    expect(txt).toContain("JWT")
    expect(txt).toContain("descartou: sessão")
    expect(txt).toContain("refresh token?")
    expect(txt).toContain("implemente o middleware")
  })
})

describe("changedFilesRef", () => {
  const mk = (files: GitDiff["files"]): GitDiff => ({
    isRepo: true,
    branch: "main",
    files,
  })

  it("lista referências (status + path + stat), sem patch", () => {
    const ref = changedFilesRef(
      mk([
        {
          path: "src/a.ts",
          oldPath: null,
          status: "modified",
          additions: 3,
          deletions: 1,
          binary: false,
          hunks: [],
        },
      ]),
    )
    expect(ref).toContain("src/a.ts")
    expect(ref).toContain("+3 -1")
  })

  it("mensagens p/ fora de repo e sem mudanças", () => {
    expect(changedFilesRef({ isRepo: false, branch: null, files: [] })).toContain(
      "fora de um repositório",
    )
    expect(changedFilesRef(mk([]))).toContain("nenhuma mudança")
  })
})
