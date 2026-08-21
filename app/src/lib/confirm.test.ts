// O Enter do diálogo de confirmação.
//
// Isto existe porque uma correção visual (tirar o `autoFocus` do botão, que
// acendia o anel âmbar antes de qualquer gesto) levou junto um comportamento
// que ninguém pediu pra perder: Enter fechava o confirm desde sempre, e passou
// a não fazer nada. São 12 chamadas de `confirm({…})` no app — excluir
// conversa, arquivar projeto, remover isolamento.

import { describe, expect, it } from "vitest"
import { enterConfirma } from "./confirm"

const container = { id: "content" }
const botao = { id: "cancelar" }

describe("enterConfirma", () => {
  it("Enter no próprio container confirma", () => {
    expect(
      enterConfirma({ key: "Enter", target: container, currentTarget: container }),
    ).toBe(true)
  })

  it("Enter com o foco num BOTÃO não é nosso", () => {
    // O pior desfecho possível: interceptar aqui faria Enter em cima de
    // "Cancelar" confirmar uma exclusão.
    expect(
      enterConfirma({ key: "Enter", target: botao, currentTarget: container }),
    ).toBe(false)
  })

  it("outras teclas não confirmam nada", () => {
    for (const key of ["Escape", " ", "a", "Tab", "NumpadEnter"]) {
      expect(enterConfirma({ key, target: container, currentTarget: container })).toBe(
        false,
      )
    }
  })
})
