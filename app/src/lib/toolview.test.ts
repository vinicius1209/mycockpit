import { describe, expect, it } from "vitest"
import { cleanResultText } from "./toolview"

const ok = (text: string) => ({ ok: true, text, lines: text.split("\n").length })

describe("cleanResultText", () => {
  it("suprime 'File created successfully at:' no Write", () => {
    const r = ok(
      "File created successfully at: /a/b/c.ts (file state is current in your context — no need to Read it back)",
    )
    expect(cleanResultText("Write", r)).toBe("")
  })

  it("suprime 'has been updated successfully' no Edit", () => {
    const r = ok(
      "The file /a/b/c.ts has been updated successfully. (file state is current — no need to Read it back)",
    )
    expect(cleanResultText("Edit", r)).toBe("")
  })

  it("remove só o sufixo de estado, preserva texto útil", () => {
    const r = ok(
      "Applied 3 edits (file state is current in your context — no need to Read it back)",
    )
    expect(cleanResultText("MultiEdit", r)).toBe("Applied 3 edits")
  })

  it("não mexe em output de Bash", () => {
    const r = ok("File created successfully at: /tmp/x")
    expect(cleanResultText("Bash", r)).toBe("File created successfully at: /tmp/x")
  })

  it("não mexe em erro de write/edit", () => {
    const r = { ok: false, text: "Error: file not found", lines: 1 }
    expect(cleanResultText("Write", r)).toBe("Error: file not found")
  })

  it("result vazio/undefined vira ''", () => {
    expect(cleanResultText("Write", undefined)).toBe("")
  })
})
