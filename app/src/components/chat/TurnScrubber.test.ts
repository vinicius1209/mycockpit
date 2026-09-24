import { describe, expect, it } from "vitest"
import {
  BARRA_DE_ROLAGEM,
  cabeRegua,
  CLASSE_VISIBILIDADE_REGUA,
  GUTTER_REGUA,
  LARGURA_MINIMA_REGUA,
  planejarRegua,
  PASSO_MAX,
  PASSO_MIN,
  type Condensavel,
} from "./TurnScrubber"
import { CONVERSATION_COLUMN_WIDTH } from "@/lib/conversationScale"

/** Marcadores sintéticos: só o que a régua precisa para dimensionar. */
function ticksFalsos(total: number): Condensavel[] {
  return Array.from({ length: total }, (_, i) => ({ key: `t${i}` }))
}

/** Altura que o plano ocupa de fato, com o respiro do `py-2`. */
function alturaOcupada(plano: { passo: number; ticks: Condensavel[] }): number {
  return plano.passo * plano.ticks.length + 16
}

describe("planejarRegua", () => {
  it("não pinta nada antes de medir o container", () => {
    expect(planejarRegua(ticksFalsos(30), 0).ticks).toEqual([])
  })

  it("usa o passo confortável quando o fio é curto", () => {
    const plano = planejarRegua(ticksFalsos(4), 500)
    expect(plano.passo).toBe(PASSO_MAX)
    expect(plano.ticks).toHaveLength(4)
  })

  it("aperta o passo em vez de rolar quando o fio cresce", () => {
    const plano = planejarRegua(ticksFalsos(40), 420)
    expect(plano.ticks).toHaveLength(40)
    expect(plano.passo).toBeLessThan(PASSO_MAX)
    expect(plano.passo).toBeGreaterThanOrEqual(PASSO_MIN)
    expect(alturaOcupada(plano)).toBeLessThanOrEqual(420)
  })

  it("cabe na altura disponível em qualquer tamanho de fio", () => {
    for (const total of [2, 12, 40, 90, 300, 2000]) {
      for (const altura of [180, 420, 900]) {
        const plano = planejarRegua(ticksFalsos(total), altura)
        expect(alturaOcupada(plano)).toBeLessThanOrEqual(altura)
      }
    }
  })

  it("condensa em faixas contíguas quando nem o piso cabe, sem perder turno", () => {
    const plano = planejarRegua(ticksFalsos(300), 420)
    expect(plano.passo).toBe(PASSO_MIN)
    expect(plano.ticks.length).toBeLessThan(300)

    const cobertos = plano.ticks.flatMap((t) => t.covers ?? [t.key])
    expect(cobertos).toHaveLength(300)
    expect(new Set(cobertos).size).toBe(300)
    // A ordem do fio sobrevive à condensação: a posição continua sendo mapa.
    expect(cobertos[0]).toBe("t0")
    expect(cobertos[299]).toBe("t299")
  })

  it("a faixa é representada pelo primeiro pedido dela, e diz quantos engoliu", () => {
    // 100 pedidos em 100px: capacidade 12, faixas de 9. Desde a ADR-250 todo
    // marcador é pedido, então quem representa é o começo da faixa: é pra lá
    // que o clique leva.
    const plano = planejarRegua(ticksFalsos(100), 100)
    expect(plano.ticks[0].key).toBe("t0")
    expect(plano.ticks[0].span).toBe(9)
    expect(plano.ticks[0].covers).toEqual(Array.from({ length: 9 }, (_, i) => `t${i}`))
    expect(plano.ticks[1].key).toBe("t9")
  })
})

/**
 * Largura do container de rolagem do fio para uma janela, no layout real do
 * `AppShell`: sidebar 19%, e o resto dividido 70/30 quando o painel direito
 * está aberto (`AppShell.tsx`, `ResizablePanel` do chat e do contexto).
 * Sem file:line de propósito: a citação anterior apontava pra `191` e a frente
 * das notas inseriu 8 linhas no arquivo, envelhecendo o número no mesmo sprint.
 */
function larguraDoFio(janela: number, painelDireitoAberto: boolean): number {
  const resto = janela * 0.81
  return painelDireitoAberto ? resto * 0.7 : resto
}

describe("cabeRegua", () => {
  it("exige o gutter dos DOIS lados, porque a coluna é centrada", () => {
    expect(LARGURA_MINIMA_REGUA).toBe(
      CONVERSATION_COLUMN_WIDTH + GUTTER_REGUA * 2 + BARRA_DE_ROLAGEM,
    )
    expect(LARGURA_MINIMA_REGUA).toBe(848)
  })

  it("no limiar, o trilho ainda cabe depois de a barra de rolagem comer largura", () => {
    // O container query resolve contra a caixa que conta a barra; quem sobra
    // pra coluna é `largura - BARRA_DE_ROLAGEM`.
    const util = LARGURA_MINIMA_REGUA - BARRA_DE_ROLAGEM
    const gutter = (util - CONVERSATION_COLUMN_WIDTH) / 2
    expect(gutter).toBeGreaterThanOrEqual(GUTTER_REGUA)
  })

  it("recusa a régua um pixel antes de o gutter caber", () => {
    expect(cabeRegua(LARGURA_MINIMA_REGUA - 1)).toBe(false)
    expect(cabeRegua(LARGURA_MINIMA_REGUA)).toBe(true)
  })

  it("recusa a régua quando o fio tem só a coluna, sem sobra nenhuma", () => {
    expect(cabeRegua(CONVERSATION_COLUMN_WIDTH)).toBe(false)
  })

  it("some numa janela larga quando o painel direito come a largura do fio", () => {
    // 1440px de janela é o caso do mock (#c/#e): passava no `lg:` de viewport e
    // mesmo assim pintava por cima do texto.
    const comPainel = larguraDoFio(1440, true)
    expect(comPainel).toBeLessThan(LARGURA_MINIMA_REGUA)
    expect(cabeRegua(comPainel)).toBe(false)
  })

  it("continua aparecendo na MESMA janela larga sem o painel direito", () => {
    expect(cabeRegua(larguraDoFio(1440, false))).toBe(true)
  })

  it("volta a caber quando a janela é grande o bastante até com o painel", () => {
    expect(cabeRegua(larguraDoFio(1920, true))).toBe(true)
  })

  it("segue escondida em janela estreita, como já era", () => {
    expect(cabeRegua(larguraDoFio(1000, false))).toBe(false)
  })

  it("a classe de visibilidade usa o MESMO limiar do predicado", () => {
    // Contrato entre a regra (TS) e quem decide na tela (CSS). O literal existe
    // porque o Tailwind varre texto; este teste é o que impede os dois de
    // andarem separados.
    expect(CLASSE_VISIBILIDADE_REGUA).toBe(
      `hidden @min-[${LARGURA_MINIMA_REGUA}px]:flex`,
    )
    expect(CLASSE_VISIBILIDADE_REGUA).not.toContain("lg:")
  })

  it("o container de rolagem do fio declara `@container`", () => {
    // A outra METADE do contrato, e a que falha em silêncio: `@min-[…]` sem um
    // ancestral `@container` nunca casa, e a régua sumiria pra sempre sem
    // ninguém reclamar — nem tipo, nem teste, nem guarda. O teste do limiar
    // acima protege o NÚMERO; este protege a EXISTÊNCIA.
    //
    // O fonte entra pelo mecanismo do Vite (`?raw`), não por `node:fs`: o
    // tsconfig do `src/` não tem os tipos do node de propósito, e `tsc -b`
    // (que a build roda) reprova o import. Mesmo padrão de `janelaViva.test.ts`.
    const [fonte] = Object.values(
      import.meta.glob("./ChatPanel.tsx", {
        query: "?raw",
        import: "default",
        eager: true,
      }) as Record<string, string>,
    )
    expect(fonte, "ChatPanel.tsx não foi lido").toBeTruthy()
    const linha = fonte
      .split("\n")
      .find((l: string) => l.includes("overflow-y-auto") && l.includes("flex-1"))
    expect(linha, "container de rolagem do fio não encontrado").toBeDefined()
    expect(linha).toContain("@container")
  })

  it("o gutter declarado é o que o marcador realmente ocupa", () => {
    // A ponta que o teste-contrato do limiar NÃO amarra: `GUTTER_REGUA = 38`
    // deriva de três classes soltas no JSX (`left-2` 8 + `px-1.5` 6+6 +
    // `w-4.5` 18). Trocar `w-4.5` por `w-6` deslocaria o gutter real e o
    // limiar continuaria 848 — a régua voltaria a encostar na coluna com a
    // suíte inteira verde.
    const [fonte] = Object.values(
      import.meta.glob("./TurnScrubber.tsx", {
        query: "?raw",
        import: "default",
        eager: true,
      }) as Record<string, string>,
    )
    expect(GUTTER_REGUA).toBe(8 + 6 + 6 + 18)
    expect(fonte).toContain("left-2")
    expect(fonte).toContain("px-1.5")
    expect(fonte).toContain("w-4.5")
  })
})
