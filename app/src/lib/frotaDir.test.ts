import { describe, expect, it } from "vitest"

import { caminhoNaPasta, PASTA, PASTA_LEGADA, sobAPasta } from "@/lib/frotaDir"

describe("pasta da Frota", () => {
  it("constrói sempre com o nome novo", () => {
    expect(caminhoNaPasta("agents")).toBe(`${PASTA}/agents`)
    expect(caminhoNaPasta("context/c1.md")).toBe(`${PASTA}/context/c1.md`)
  })

  it("reconhece o nome novo", () => {
    expect(sobAPasta(`${PASTA}/missions/x/0.json`)).toBe(true)
  })

  it("reconhece o nome legado, que é a janela do rename", () => {
    // Projeto aberto antes de 21/09/2026 tem doutrina, personas e comandos
    // COMMITADOS em .mycockpit/. Parar de reconhecer é quebrar esses projetos.
    expect(sobAPasta(`${PASTA_LEGADA}/missions/x/0.json`)).toBe(true)
  })

  it("reconhece subcaminho nas duas grafias", () => {
    expect(sobAPasta(`${PASTA}/agents/aline.md`, "agents/")).toBe(true)
    expect(sobAPasta(`${PASTA_LEGADA}/agents/aline.md`, "agents/")).toBe(true)
  })

  it("não confunde subcaminho diferente", () => {
    expect(sobAPasta(`${PASTA}/commands/x.md`, "agents/")).toBe(false)
  })

  it("não casa pasta de outro dono", () => {
    expect(sobAPasta(".claude/agents/externo.md")).toBe(false)
    expect(sobAPasta("src/frota/coisa.ts")).toBe(false)
  })

  it("não casa prefixo parcial do nome", () => {
    // `.frotamento/` não é a pasta da Frota: a barra faz parte do prefixo.
    expect(sobAPasta(".frotamento/x.md")).toBe(false)
  })
})
