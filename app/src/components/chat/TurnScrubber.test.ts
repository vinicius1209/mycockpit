import { describe, expect, it } from "vitest"
import {
  BARRA_DE_ROLAGEM,
  cabeRegua,
  CLASSE_VISIBILIDADE_REGUA,
  deriveTurnTicks,
  GUTTER_REGUA,
  LARGURA_MINIMA_REGUA,
  planejarRegua,
  PASSO_MAX,
  PASSO_MIN,
  type TurnTick,
} from "./TurnScrubber"
import { groupByAuthor } from "./messageGroups"
import { buildNodes } from "./messageNodes"
import { CONVERSATION_COLUMN_WIDTH } from "@/lib/conversationScale"
import type { ChatItem } from "@/store/chat"

describe("deriveTurnTicks", () => {
  it("deriva marcadores para turnos do usuário e do agente", () => {
    const items: ChatItem[] = [
      { kind: "user", id: "u1", text: "Como fazer cache na Frota?" },
      { kind: "text", id: "a1", text: "A Frota possui o módulo cacheDoTurno.ts." },
    ]

    const nodes = buildNodes(items)
    const groups = groupByAuthor(nodes)
    const ticks = deriveTurnTicks(groups)

    expect(ticks.length).toBe(2)
    expect(ticks[0].label).toBe("Você")
    expect(ticks[0].icon).toBe("user")
    expect(ticks[0].summary).toContain("Como fazer cache")
    expect(ticks[0].groupId).toBe(`msg-group-${groups[0].key}`)

    expect(ticks[1].label).toBe("Agent")
    expect(ticks[1].icon).toBe("bot")
    expect(ticks[1].summary).toContain("cacheDoTurno.ts")
  })

  it("identifica ferramentas e atribui ícone de tool", () => {
    const items: ChatItem[] = [
      { kind: "user", id: "u1", text: "Leia o arquivo" },
      {
        kind: "tool",
        id: "t1",
        name: "read_file",
        input: { path: "src/lib/agents.ts" },
        result: { ok: true, text: "conteudo", lines: 10 },
      },
    ]

    const nodes = buildNodes(items)
    const groups = groupByAuthor(nodes)
    const ticks = deriveTurnTicks(groups)

    expect(ticks.length).toBe(2)
    expect(ticks[1].icon).toBe("tool")
    expect(ticks[1].summary).toContain("1 ferramenta (read_file)")
  })

  it("identifica parecer de especialista com nome da persona", () => {
    const items: ChatItem[] = [
      {
        kind: "advice",
        id: "adv1",
        personaId: "aline",
        personaName: "Aline",
        personaVersion: 1,
        digest: "d1",
        question: "Dúvida de arquitetura",
        text: "Recomendo isolar a camada de persistência.",
      },
    ]

    const nodes = buildNodes(items)
    const groups = groupByAuthor(nodes)
    const ticks = deriveTurnTicks(groups)

    expect(ticks.length).toBe(1)
    expect(ticks[0].label).toBe("Aline")
    expect(ticks[0].icon).toBe("advisor")
    expect(ticks[0].summary).toContain("Recomendo isolar")
  })
})

/** Marcadores sintéticos: `usuarios` são os índices que viraram turno do humano. */
function ticksFalsos(total: number, usuarios: number[] = []): TurnTick[] {
  return Array.from({ length: total }, (_, i) => ({
    key: `t${i}`,
    groupId: `msg-group-t${i}`,
    author: usuarios.includes(i) ? { kind: "you" as const } : { kind: "executor" as const },
    summary: `turno ${i}`,
    label: usuarios.includes(i) ? "Você" : "Agent",
    icon: usuarios.includes(i) ? ("user" as const) : ("bot" as const),
  }))
}

/** Altura que o plano ocupa de fato, com o respiro do `py-2`. */
function alturaOcupada(plano: { passo: number; ticks: TurnTick[] }): number {
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

  it("a faixa é representada pelo turno do usuário, e diz quantos engoliu", () => {
    // 100 turnos em 100px: capacidade 12, faixas de 9.
    const plano = planejarRegua(ticksFalsos(100, [5, 40]), 100)
    const comUsuario = plano.ticks.filter((t) => t.author.kind === "you")
    expect(comUsuario).toHaveLength(2)
    expect(comUsuario[0].key).toBe("t5")
    expect(comUsuario[1].key).toBe("t40")
    expect(comUsuario[0].span).toBeGreaterThan(1)
    expect(comUsuario[0].covers).toContain("t5")
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
