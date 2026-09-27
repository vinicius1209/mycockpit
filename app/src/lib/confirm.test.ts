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

describe("as três respostas do confirm", () => {
  it("confirm continua booleano, e a alternativa não chega nele", async () => {
    const { confirm, useConfirm } = await import("./confirm")
    const sim = confirm({ title: "Apagar?", alternativa: "ignorada" })
    expect(useConfirm.getState().req?.alternativa).toBeUndefined()
    useConfirm.getState().close(true)
    expect(await sim).toBe(true)
    const nao = confirm({ title: "Apagar?" })
    useConfirm.getState().close(false)
    expect(await nao).toBe(false)
  })

  it("perguntar devolve confirmar, alternativa ou cancelar", async () => {
    const { perguntar, useConfirm } = await import("./confirm")
    for (const r of ["confirmar", "alternativa", "cancelar"] as const) {
      const p = perguntar({ title: "Salvar?", alternativa: "Não salvar" })
      expect(useConfirm.getState().req?.alternativa).toBe("Não salvar")
      useConfirm.getState().close(r)
      expect(await p).toBe(r)
    }
  })

  it("abrir outro por cima cancela o anterior", async () => {
    const { perguntar, useConfirm } = await import("./confirm")
    const primeiro = perguntar({ title: "A?", alternativa: "x" })
    const segundo = perguntar({ title: "B?", alternativa: "y" })
    expect(await primeiro).toBe("cancelar")
    useConfirm.getState().close("alternativa")
    expect(await segundo).toBe("alternativa")
  })
})
