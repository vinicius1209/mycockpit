import { describe, expect, it } from "vitest"
import { lineDiff, trimOuterContext } from "./linediff"

describe("lineDiff", () => {
  it("linhas iguais viram contexto", () => {
    const d = lineDiff("a\nb\nc", "a\nb\nc")
    expect(d.added).toBe(0)
    expect(d.removed).toBe(0)
    expect(d.rows.every((r) => r.type === "ctx")).toBe(true)
  })
  it("troca de uma linha vira del+add com contexto ao redor", () => {
    const d = lineDiff("a\nb\nc", "a\nX\nc")
    expect(d.added).toBe(1)
    expect(d.removed).toBe(1)
    expect(d.rows.map((r) => r.type)).toEqual(["ctx", "del", "add", "ctx"])
    expect(d.rows[1].text).toBe("b")
    expect(d.rows[2].text).toBe("X")
  })
  it("old vazio = tudo adição (Write)", () => {
    const d = lineDiff("", "a\nb")
    expect(d.removed).toBe(0)
    expect(d.added).toBe(2)
    expect(d.rows.every((r) => r.type === "add")).toBe(true)
  })
  it("new vazio = tudo remoção", () => {
    const d = lineDiff("a\nb", "")
    expect(d.added).toBe(0)
    expect(d.removed).toBe(2)
  })
  it("inserção no meio preserva contexto", () => {
    const d = lineDiff("a\nc", "a\nb\nc")
    expect(d.added).toBe(1)
    expect(d.removed).toBe(0)
    expect(d.rows.map((r) => r.type)).toEqual(["ctx", "add", "ctx"])
  })
})

describe("trimOuterContext", () => {
  it("apara contexto externo além do pad, mantém o interno", () => {
    const rows = lineDiff(
      "1\n2\n3\n4\n5\n6\n7\n8\n9\n10",
      "1\n2\n3\n4\n5\nX\n7\n8\n9\n10",
    ).rows
    const t = trimOuterContext(rows, 2)
    // mudança na linha 6 (del 6/add X): pad 2 antes e depois
    expect(t.map((r) => r.text)).toEqual(["4", "5", "6", "X", "7", "8"])
  })
  it("sem mudanças não explode", () => {
    const rows = lineDiff("a\nb", "a\nb").rows
    expect(trimOuterContext(rows).length).toBeGreaterThan(0)
  })
})
