// O switcher central é a arquitetura de informação do produto: as 3 superfícies,
// nesta ordem, com estes rótulos. Reordenar/renomear sem querer quebra a memória
// muscular de quem usa o app todo dia. (O Escritório saiu em R2 do
// office-removal-plan: superfície removida, ponte de dados vive em lib/fleet.)

import { describe, expect, it } from "vitest"

import { MODES } from "@/components/layout/titleBarModes"

describe("superfícies da barra do topo", () => {
  it("mantém as 3 abas na ordem Painel, Trabalho, Features", () => {
    expect(MODES.map((m) => m.label)).toEqual(["Painel", "Trabalho", "Features"])
  })

  it("cada aba aponta para a view que o store entende", () => {
    expect(MODES.map((m) => m.id)).toEqual(["painel", "linear", "sdd"])
  })

  it("toda aba tem descrição (o tooltip nunca fica vazio)", () => {
    for (const m of MODES) expect(m.desc.trim().length).toBeGreaterThan(0)
  })
})
