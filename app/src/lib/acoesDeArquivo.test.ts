import { describe, expect, it } from "vitest"
import { ROTULOS } from "@/lib/contextMenu"
import {
  DIVISOR_DE_ARQUIVO as D,
  itensDoArquivo,
  ROTULOS_DE_ARQUIVO,
  rotuloDaAcao,
  type RecursosDoArquivo,
} from "@/lib/acoesDeArquivo"

const TUDO: RecursosDoArquivo = { noApp: true, conversa: true, ladoCabe: true, alterado: true, expandida: true }

const FONTES = import.meta.glob(
  ["../components/layout/AbasDeArquivo.tsx", "../components/layout/ProjectFilesPanel.tsx", "../components/layout/MenuDeArquivo.tsx"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>
const fonte = (nome: string) => Object.entries(FONTES).find(([k]) => k.endsWith(nome))![1]

describe("o catálogo de arquivo", () => {
  it("num arquivo alterado da árvore, os quatro grupos do mock na ordem", () => {
    expect(itensDoArquivo({ tipo: "arquivo", rel: "PLAN.md" }, TUDO)).toEqual([
      "abrir", "abrir-ao-lado", "abrir-no-editor",
      D, "citar", "ver-alteracoes",
      D, "copiar-nome", "copiar-caminho-relativo", "copiar-caminho-completo",
      D, "mostrar-na-pasta",
    ])
  })

  it("numa pasta aberta: citar, buscar e recolher, os caminhos e a pasta", () => {
    expect(itensDoArquivo({ tipo: "pasta", rel: "docs" }, TUDO)).toEqual([
      "citar",
      D, "buscar-na-pasta", "recolher-dentro",
      D, "copiar-caminho-relativo", "copiar-caminho-completo",
      D, "mostrar-na-pasta",
    ])
    expect(itensDoArquivo({ tipo: "pasta", rel: "docs" }, { ...TUDO, expandida: false })).not.toContain("recolher-dentro")
  })

  it("com três itens: citar os três e copiar os caminhos", () => {
    const alvo = { tipo: "varios" as const, itens: [{ rel: "a.md", pasta: false }, { rel: "b.md", pasta: false }, { rel: "docs", pasta: true }] }
    expect(itensDoArquivo(alvo, TUDO)).toEqual(["citar", D, "copiar-caminhos"])
    expect(rotuloDaAcao("citar", alvo)).toBe("Citar 3 itens no composer")
    expect(rotuloDaAcao("citar", { tipo: "pasta", rel: "docs" })).toBe("Citar a pasta no composer")
  })

  it("item que não faz não existe: fora do app, sem git, sem conversa, sem espaço ao lado", () => {
    const arquivo = { tipo: "arquivo" as const, rel: "PLAN.md" }
    const itens = itensDoArquivo(arquivo, { noApp: false, conversa: false, ladoCabe: false, alterado: false, expandida: false })
    for (const some of ["mostrar-na-pasta", "abrir-no-app", "ver-alteracoes", "citar", "abrir-ao-lado"] as const)
      expect(itens).not.toContain(some)
    expect(itens.at(-1)).not.toBe(D)
    expect(itens[0]).not.toBe(D)
  })

  it("o app padrão é só para o que o visualizador não mostra como texto", () => {
    expect(itensDoArquivo({ tipo: "arquivo", rel: "docs/print.png" }, TUDO)).toContain("abrir-no-app")
    expect(itensDoArquivo({ tipo: "arquivo", rel: "relatorio.pdf" }, TUDO)).toContain("abrir-no-app")
    expect(itensDoArquivo({ tipo: "arquivo", rel: "src/lib.rs" }, TUDO)).not.toContain("abrir-no-app")
    expect(itensDoArquivo({ tipo: "arquivo", rel: "README.md" }, TUDO)).not.toContain("abrir-no-app")
  })

  it("na aba não há Abrir, há Mostrar na árvore, e arquivo de fora da raiz perde o que depende dela", () => {
    const naAba = itensDoArquivo({ tipo: "arquivo", rel: "PLAN.md" }, TUDO, "aba")
    expect(naAba).not.toContain("abrir")
    expect(naAba).toContain("mostrar-na-arvore")
    const fora = itensDoArquivo({ tipo: "arquivo", rel: "/Users/v/.zshrc", fora: true }, TUDO, "aba")
    for (const some of ["mostrar-na-arvore", "copiar-caminho-relativo", "ver-alteracoes"] as const)
      expect(fora).not.toContain(some)
    expect(fora).toContain("copiar-caminho-completo")
  })

  it("a aba, a árvore e o chip do fio leem o mesmo catálogo, com os mesmos rótulos", () => {
    expect(fonte("AbasDeArquivo.tsx")).toContain("itensDoArquivo(")
    expect(fonte("AbasDeArquivo.tsx")).not.toContain("Copiar caminho")
    expect(fonte("MenuDeArquivo.tsx")).toContain("itensDoArquivo(")
    expect(fonte("ProjectFilesPanel.tsx")).toContain("useMenuDaArvore(")
    expect(ROTULOS["abrir-arquivo"]).toBe(ROTULOS_DE_ARQUIVO["abrir-no-editor"])
    expect(ROTULOS["copiar-caminho-absoluto"]).toBe(ROTULOS_DE_ARQUIVO["copiar-caminho-completo"])
  })

  it("nenhum rótulo usa travessão nem diz Finder", () => {
    for (const r of Object.values(ROTULOS_DE_ARQUIVO)) {
      expect(r).not.toContain("—")
      expect(r).not.toContain("Finder")
    }
  })
})
