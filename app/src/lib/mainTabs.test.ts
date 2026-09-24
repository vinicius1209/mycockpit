// Quais abas existem e quando a tira aparece.
//
// A âncora permanente é decisão de produto e vive no comentário do módulo, não
// num predicado: por isso aqui não há teste de "a tira aparece?" — ele só podia
// afirmar `true === true`. O que dá pra afirmar é a LISTA: a conversa nunca sai
// dela, e nunca fecha.

import { describe, expect, it } from "vitest"
import { latestCompletedTurnId, mainTabEntries, type MainTab } from "./mainTabs"
import { chaveDoDiff } from "./abasDeArquivo"

const conversa: MainTab = { kind: "conversa" }
const diff: MainTab = { kind: "diff" }
const arquivo: MainTab = { kind: "arquivo", path: "src/components/App.tsx" }
const navegador: MainTab = { kind: "navegador" }

describe("mainTabEntries", () => {
  it("a conversa está sempre lá: ela é o fundo, não um item que entra e sai", () => {
    expect(mainTabEntries(conversa).map((e) => e.kind)).toEqual(["conversa"])
    expect(mainTabEntries(diff).map((e) => e.kind)).toEqual(["conversa", "diff"])
    expect(mainTabEntries(arquivo).map((e) => e.kind)).toEqual(["conversa", "arquivo"])
  })

  it("a conversa NÃO fecha; a do diff, sim", () => {
    const [conv, alt] = mainTabEntries(diff)
    expect(conv.closable).toBe(false)
    expect(alt.closable).toBe(true)
  })

  it("a ordem é estável: a conversa vem primeiro sempre", () => {
    expect(mainTabEntries(diff)[0].kind).toBe("conversa")
    expect(mainTabEntries(arquivo)[0].kind).toBe("conversa")
  })

  it("a aba de arquivo usa o nome curto sem perder o caminho no estado", () => {
    expect(mainTabEntries(arquivo)[1]).toEqual({
      kind: "arquivo",
      label: "App.tsx",
      closable: true,
    })
    expect(arquivo).toEqual({ kind: "arquivo", path: "src/components/App.tsx" })
  })

  it("o navegador entra como aba que fecha, depois da conversa", () => {
    expect(mainTabEntries(navegador)).toEqual([
      { kind: "conversa", label: "Conversa", closable: false },
      { kind: "navegador", label: "Navegador", closable: true },
    ])
  })

  it("o navegador FICA na tira com a conversa à vista: voltar não é fechar", () => {
    expect(mainTabEntries(conversa, { navegadorAberto: true })).toEqual([
      { kind: "conversa", label: "Conversa", closable: false },
      { kind: "navegador", label: "Navegador", closable: true },
    ])
    // e convive com a aba transitória do diff
    expect(mainTabEntries(diff, { navegadorAberto: true }).map((e) => e.kind)).toEqual([
      "conversa",
      "navegador",
      "diff",
    ])
    // fechado, some
    expect(mainTabEntries(conversa, { navegadorAberto: false }).map((e) => e.kind)).toEqual(["conversa"])
  })

  it("focusPath não muda a lista de abas (é estado DENTRO da aba)", () => {
    const comFoco: MainTab = { kind: "diff", focusPath: "src/x.ts" }
    expect(mainTabEntries(comFoco)).toEqual(mainTabEntries(diff))
  })
})

describe("latestCompletedTurnId", () => {
  it("escolhe o resultado mais recente", () => {
    expect(
      latestCompletedTurnId([
        { id: "u1", kind: "user" },
        { id: "r1", kind: "result" },
        { id: "u2", kind: "user" },
        { id: "r2", kind: "result" },
      ]),
    ).toBe("r2")
  })

  it("nota posterior não muda silenciosamente o ponto de corte", () => {
    expect(
      latestCompletedTurnId([
        { id: "r1", kind: "result" },
        { id: "n1", kind: "note" },
      ]),
    ).toBe("r1")
  })

  it("sem turno concluído, não oferece fork", () => {
    expect(latestCompletedTurnId([{ id: "u1", kind: "user" }])).toBeNull()
    expect(latestCompletedTurnId([])).toBeNull()
  })
})

describe("mainTabEntries com arquivos abertos (ADR-243)", () => {
  it("os arquivos abertos ficam na tira com a Conversa à vista, antes de Alterações", () => {
    const abertos = ["docs/architecture.md", "docs/agent-runner.md"]
    expect(
      mainTabEntries({ kind: "conversa" }, { arquivosAbertos: abertos }).map((e) => e.label),
    ).toEqual(["Conversa", "architecture.md", "agent-runner.md"])
    expect(
      mainTabEntries({ kind: "diff" }, { arquivosAbertos: abertos }).map((e) => e.kind),
    ).toEqual(["conversa", "arquivo", "arquivo", "diff"])
  })

  it("o arquivo à vista não duplica quando já está entre os abertos", () => {
    const entradas = mainTabEntries(
      { kind: "arquivo", path: "docs/architecture.md" },
      { arquivosAbertos: ["docs/architecture.md"] },
    )
    expect(entradas.map((e) => e.kind)).toEqual(["conversa", "arquivo"])
  })
})

describe("mainTabEntries com as alterações de um arquivo (ADR-248)", () => {
  it("o diff de um arquivo aberto na conversa é aba dele, não 'Alterações'", () => {
    const tab: MainTab = { kind: "diff", focusPath: "src/x.ts" }
    expect(mainTabEntries(tab, { arquivosAbertos: [chaveDoDiff("src/x.ts")] })).toEqual([
      { kind: "conversa", label: "Conversa", closable: false },
      { kind: "diff", label: "x.ts", closable: true },
    ])
  })
})
