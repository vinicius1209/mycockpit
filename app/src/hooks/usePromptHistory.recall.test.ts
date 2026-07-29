// FASE 2 do composer Lexical: a decisão PURA da borda do recall ↑/↓, que os
// DOIS motores compartilham (o textarea deriva before/after do
// selectionStart/End; o editor Lexical, do texto ao redor do caret). A regra
// não pode divergir entre eles — é por isso que ela mora numa função sem React
// nem DOM, provada aqui.

import { describe, expect, it } from "vitest"
import { historyRecallIntent } from "./usePromptHistory"

describe("historyRecallIntent — borda do recall ↑/↓ do histórico", () => {
  it("↑ na 1ª linha (nada antes) com prompts enviados → recupera o anterior", () => {
    expect(
      historyRecallIntent({
        key: "ArrowUp",
        before: "meio de um",
        after: "",
        canPrev: true,
        navigating: false,
      }),
    ).toBe("prev")
  })

  it("↑ fora da 1ª linha (há \\n antes) NÃO recupera, deixa a seta navegar", () => {
    expect(
      historyRecallIntent({
        key: "ArrowUp",
        before: "linha 1\nlinha 2",
        after: "",
        canPrev: true,
        navigating: false,
      }),
    ).toBeNull()
  })

  it("↑ sem prompts enviados NÃO recupera (nada pra trazer)", () => {
    expect(
      historyRecallIntent({
        key: "ArrowUp",
        before: "",
        after: "",
        canPrev: false,
        navigating: false,
      }),
    ).toBeNull()
  })

  it("↓ navegando o histórico, na última linha (nada depois) → avança", () => {
    expect(
      historyRecallIntent({
        key: "ArrowDown",
        before: "",
        after: "resto da linha",
        canPrev: true,
        navigating: true,
      }),
    ).toBe("next")
  })

  it("↓ navegando mas fora da última linha (há \\n depois) NÃO avança", () => {
    expect(
      historyRecallIntent({
        key: "ArrowDown",
        before: "",
        after: "linha 2\nlinha 3",
        canPrev: true,
        navigating: true,
      }),
    ).toBeNull()
  })

  it("↓ sem estar navegando NÃO faz nada (só desce dentro do texto)", () => {
    expect(
      historyRecallIntent({
        key: "ArrowDown",
        before: "",
        after: "",
        canPrev: true,
        navigating: false,
      }),
    ).toBeNull()
  })

  it("editor vazio (before e after vazios): ↑ recupera, ↓ só se navegando", () => {
    const base = { before: "", after: "", canPrev: true }
    expect(
      historyRecallIntent({ ...base, key: "ArrowUp", navigating: false }),
    ).toBe("prev")
    expect(
      historyRecallIntent({ ...base, key: "ArrowDown", navigating: false }),
    ).toBeNull()
    expect(
      historyRecallIntent({ ...base, key: "ArrowDown", navigating: true }),
    ).toBe("next")
  })
})
