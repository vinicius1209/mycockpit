import { describe, expect, it } from "vitest"
import { linhasDaArvore } from "./arvoreDoTurno"
import type { ProcessoNaArvore } from "./maquina"

// A árvore REAL do turno do agy (26/09/2026), como o Rust a manda.
const p = (
  pid: number,
  profundidade: number,
  papel: ProcessoNaArvore["papel"],
  nome: string,
  rssMb: number,
  executor: string | null = null,
): ProcessoNaArvore => ({ pid, profundidade, papel, nome, executor, comando: `${nome} (cmd)`, rssMb, cpuPct: 0.5, tempoS: 347 })

const AGY = [
  p(24677, 0, "motor", "agy", 293),
  p(24735, 1, "processo", "SkyComputerUseClient", 35),
  p(24737, 1, "frota", "computador", 9),
  p(24738, 1, "frota", "navegador", 9),
  p(24739, 1, "mcp", "@playwright/mcp", 78, "npm exec"),
  p(24816, 2, "mcp", "playwright-mcp", 81, "node"),
]

describe("a árvore do turno no painel (ADR-263)", () => {
  it("as ferramentas do Frota irmãs viram uma linha, com a soma", () => {
    const linhas = linhasDaArvore(AGY)
    expect(linhas.map((l) => l.nome)).toEqual([
      "agy",
      "SkyComputerUseClient",
      "computador, navegador",
      "@playwright/mcp",
      "playwright-mcp",
    ])
    const frota = linhas[2]
    expect(frota.rssMb).toBe(18)
    expect(frota.pids).toEqual([24737, 24738])
    expect(frota.comando).toBe("computador (cmd)\nnavegador (cmd)")
  })

  it("o motor e as ferramentas do Frota não se encerram daqui; processo e MCP sim", () => {
    const e = Object.fromEntries(linhasDaArvore(AGY).map((l) => [l.nome, l.encerravel]))
    expect(e).toEqual({
      agy: false,
      SkyComputerUseClient: true,
      "computador, navegador": false,
      "@playwright/mcp": true,
      "playwright-mcp": true,
    })
  })

  it("irmãos idênticos viram 'nome ×N' (renderizadores), e quem tem filho não agrupa", () => {
    const chromium = [
      p(1, 0, "motor", "Chromium", 200),
      p(2, 1, "processo", "Chromium Helper (renderer)", 90),
      p(3, 1, "processo", "Chromium Helper (renderer)", 60),
      p(4, 1, "processo", "Chromium Helper (gpu-process)", 40),
    ]
    const linhas = linhasDaArvore(chromium)
    expect(linhas.map((l) => [l.nome, l.rssMb])).toEqual([
      ["Chromium", 200],
      ["Chromium Helper (renderer) ×2", 150],
      ["Chromium Helper (gpu-process)", 40],
    ])
    expect(linhas[1].encerravel).toBe(false)
  })
})
