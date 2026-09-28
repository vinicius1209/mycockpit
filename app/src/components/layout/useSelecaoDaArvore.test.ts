import { describe, expect, it } from "vitest"
import { alvoDosItens, aposOClique, itensDoGesto, SEM_SELECAO } from "./useSelecaoDaArvore"

const ORDEM = ["docs", "docs/edicao-de-arquivos-prd.md", "docs/composer-vira-nota-prd.md", "docs/decisions.md", "AGENTS.md"]
const nada = { alternar: false, intervalo: false }

const FONTES = import.meta.glob(["./ProjectFilesPanel.tsx", "./MenuDeArquivo.tsx", "./useSelecaoDaArvore.tsx"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

describe("seleção múltipla da árvore", () => {
  it("⌘+clique alterna, Shift+clique pega o intervalo desde a âncora, clique simples não é seleção", () => {
    const um = aposOClique(SEM_SELECAO, ORDEM[1], { ...nada, alternar: true }, ORDEM)!
    const dois = aposOClique(um, ORDEM[3], { ...nada, alternar: true }, ORDEM)!
    expect([...dois.selecionados]).toEqual([ORDEM[1], ORDEM[3]])
    const fora = aposOClique(dois, ORDEM[1], { ...nada, alternar: true }, ORDEM)!
    expect([...fora.selecionados]).toEqual([ORDEM[3]])

    const intervalo = aposOClique({ selecionados: new Set([ORDEM[1]]), ancora: ORDEM[1] }, ORDEM[3], { ...nada, intervalo: true }, ORDEM)!
    expect([...intervalo.selecionados]).toEqual([ORDEM[1], ORDEM[2], ORDEM[3]])
    const paraCima = aposOClique(intervalo, ORDEM[0], { ...nada, intervalo: true }, ORDEM)!
    expect([...paraCima.selecionados]).toEqual([ORDEM[0], ORDEM[1]])

    expect(aposOClique(dois, ORDEM[4], nada, ORDEM)).toBeNull()
  })

  it("o gesto numa linha selecionada vale para a seleção; fora dela, só para a linha", () => {
    const sel = { selecionados: new Set([ORDEM[1], ORDEM[2], ORDEM[0]]), ancora: ORDEM[1] }
    expect(itensDoGesto(sel, ORDEM[2])).toHaveLength(3)
    expect(itensDoGesto(sel, ORDEM[4])).toEqual([ORDEM[4]])
    const alvo = alvoDosItens(itensDoGesto(sel, ORDEM[2]), (rel) => rel === "docs")
    expect(alvo).toMatchObject({ tipo: "varios" })
    expect(alvo.tipo === "varios" && alvo.itens.find((i) => i.rel === "docs")?.pasta).toBe(true)
    expect(alvoDosItens(["docs"], () => true)).toEqual({ tipo: "pasta", rel: "docs" })
  })

  it("o ⌘↵ mora no teclado da linha, nunca na janela (D5)", () => {
    const painel = Object.entries(FONTES).find(([k]) => k.endsWith("ProjectFilesPanel.tsx"))![1]
    expect(painel).toContain('event.key === "Enter" && (event.metaKey || event.ctrlKey)')
    for (const fonte of Object.values(FONTES)) expect(fonte).not.toMatch(/(window|document)\.addEventListener\("keydown"/)
  })
})
