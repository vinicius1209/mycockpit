// A frase que o usuário lê depois de remover um worktree. É a única parte
// disto que dá pra testar sem git de verdade — e é a que importa: um branch
// que sobreviveu e não é dito volta a ser o lixo invisível que motivou o
// `branch -d` no lado Rust.

import { describe, expect, it } from "vitest"
import {
  corteDoArquivo,
  worktreeRemovalNote,
  MAX_LINHAS_POR_ARQUIVO,
  type DiffHunk,
} from "./git"

describe("worktreeRemovalNote", () => {
  it("sem branch legível, não inventa frase", () => {
    expect(worktreeRemovalNote({ branch: null, branchRemoved: false })).toBeNull()
  })

  it("branch apagado junto: conta o nome do que sumiu", () => {
    const nota = worktreeRemovalNote({
      branch: "mycockpit/a1b2c3d4",
      branchRemoved: true,
    })
    expect(nota).toContain("mycockpit/a1b2c3d4")
    expect(nota).toContain("apagado")
  })

  it("branch preservado: diz o nome E o motivo (senão parece falha)", () => {
    const nota = worktreeRemovalNote({
      branch: "mycockpit/a1b2c3d4",
      branchRemoved: false,
    })
    expect(nota).toContain("mycockpit/a1b2c3d4")
    expect(nota).toContain("commit")
    // "ficou" é preservação deliberada do git, não erro nosso — a frase não
    // pode soar como falha, senão o usuário tenta "consertar" apagando trabalho.
    expect(nota).not.toMatch(/falh|erro/i)
  })
})

// ─────────────────────────────────────────────── teto de render do diff (F1.4)

/** Hunk sintético: N linhas de `col` colunas. */
function hunkDe(n: number, col = 60): DiffHunk {
  const texto = "x".repeat(col)
  return {
    header: `@@ -1,${n} +1,${n} @@`,
    lines: Array.from({ length: n }, (_, i) => ({
      type: "add" as const,
      oldNo: null,
      newNo: i + 1,
      text: texto,
    })),
  }
}

describe("corteDoArquivo — o teto medido", () => {
  it("diff normal passa inteiro (o teto não pode atrapalhar o caso comum)", () => {
    // Um diff de revisão de verdade tem centenas de linhas, não dezenas de
    // milhares. Se o teto mordesse aqui, ele seria o defeito.
    expect(corteDoArquivo([hunkDe(800)])).toBeNull()
  })

  it("corta por LINHAS quando passa do teto", () => {
    const c = corteDoArquivo([hunkDe(MAX_LINHAS_POR_ARQUIVO + 1)])
    expect(c?.motivo).toBe("linhas")
    expect(c?.linhas).toBe(MAX_LINHAS_POR_ARQUIVO + 1)
  })

  it("exatamente no teto NÃO corta (o limite é o último que passa)", () => {
    expect(corteDoArquivo([hunkDe(MAX_LINHAS_POR_ARQUIVO)])).toBeNull()
  })

  it("corta por LARGURA: poucas linhas, gigantes", () => {
    // ESTE é o caso que uma medição só em Node teria deixado passar. 500 linhas
    // de 20 mil colunas custam mais scroll no navegador (91ms) que 20 MIL
    // linhas normais (58ms) — porque o `renderToStaticMarkup` não faz layout, e
    // é no layout que linha larga dói. Sem o segundo eixo, o bundle minificado
    // entra inteiro e trava o painel.
    const c = corteDoArquivo([hunkDe(500, 20_000)])
    expect(c?.motivo).toBe("largura")
    expect(c?.linhas).toBe(500)
    expect(c?.chars).toBe(500 * 20_000)
  })

  it("soma ENTRE hunks: o teto é do arquivo, não de cada pedaço", () => {
    const metade = Math.ceil(MAX_LINHAS_POR_ARQUIVO / 2) + 1
    expect(corteDoArquivo([hunkDe(metade), hunkDe(metade)])?.motivo).toBe("linhas")
  })

  it("guarda o tamanho REAL, não só o motivo", () => {
    // Um aviso que diz "grande demais" sem dizer quanto obriga a confiar. Com o
    // número o usuário decide se abre no editor ou se era um lockfile.
    const c = corteDoArquivo([hunkDe(MAX_LINHAS_POR_ARQUIVO + 10, 100)])
    expect(c?.chars).toBe((MAX_LINHAS_POR_ARQUIVO + 10) * 100)
  })

  it("arquivo sem hunk nenhum não é 'cortado'", () => {
    expect(corteDoArquivo([])).toBeNull()
  })

  it("linhas VENCE largura quando os dois estouram (motivo mais legível)", () => {
    const c = corteDoArquivo([hunkDe(MAX_LINHAS_POR_ARQUIVO + 1, 1_000)])
    expect(c?.motivo).toBe("linhas")
  })
})
