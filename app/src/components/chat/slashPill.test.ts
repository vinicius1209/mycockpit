// Pill atômico do comando "/" no composer: a lógica PURA da conversão
// texto→pill (no gatilho do whitespace), da re-materialização do draft e da
// serialização de volta. O CONTRATO que estes testes fixam: o texto que sai do
// editor com pill é BYTE-IDÊNTICO ao que o textarea produzia — o pipeline de
// send (expansão, builtin /compactar, fila, histórico ↑/↓) não vê diferença.

import { describe, expect, it } from "vitest"
import {
  slashPillCaretOffset,
  slashPillMatch,
  slashPillSourceLabel,
} from "./slashPill"
import { planDraft, serializePlan } from "./lexicalDraft"

const COMANDOS = ["compactar", "review", "meu:cmd"]
const NOMES = ["Ana", "Bruno"]

describe("slashPillMatch — conversão/re-materialização no gatilho", () => {
  it("'/nome ' com match exato no inventário vira pill (rest preserva o espaço)", () => {
    expect(slashPillMatch("/compactar ", COMANDOS)).toEqual({
      name: "compactar",
      rest: " ",
    })
  })

  it("args depois do espaço ficam no rest, intactos", () => {
    expect(slashPillMatch("/review src/lib/db.ts agora", COMANDOS)).toEqual({
      name: "review",
      rest: " src/lib/db.ts agora",
    })
  })

  it("quebra de linha também é gatilho (args na linha de baixo)", () => {
    expect(slashPillMatch("/compactar\ntudo isso", COMANDOS)).toEqual({
      name: "compactar",
      rest: "\ntudo isso",
    })
  })

  it("nome com ':' e '-' (gramática do parseSlashInvocation) casa", () => {
    expect(slashPillMatch("/meu:cmd x", COMANDOS)).toEqual({
      name: "meu:cmd",
      rest: " x",
    })
  })

  it("comando que não existe no inventário NÃO vira pill (fail-open)", () => {
    expect(slashPillMatch("/fantasma args", COMANDOS)).toBeNull()
  })

  it("match é EXATO: prefixo de comando não converte", () => {
    expect(slashPillMatch("/comp x", COMANDOS)).toBeNull()
    expect(slashPillMatch("/compactarr x", COMANDOS)).toBeNull()
  })

  it("match é case-sensitive (o insertCommand insere o nome exato)", () => {
    expect(slashPillMatch("/Compactar x", COMANDOS)).toBeNull()
  })

  it("sem whitespace depois do nome, ainda é digitação em curso: não converte", () => {
    expect(slashPillMatch("/compactar", COMANDOS)).toBeNull()
  })

  it("'/' fora do começo do input nunca converte", () => {
    expect(slashPillMatch("oi /compactar tudo", COMANDOS)).toBeNull()
    expect(slashPillMatch(" /compactar tudo", COMANDOS)).toBeNull()
  })

  it("inventário vazio: nada converte", () => {
    expect(slashPillMatch("/compactar ", [])).toBeNull()
  })
})

describe("planDraft com inventário '/' — re-materialização do draft/histórico", () => {
  it("draft que começa com '/nome ' vira token slash + resto texto", () => {
    expect(planDraft("/compactar agora", NOMES, COMANDOS)).toEqual([
      [
        { type: "slash", name: "compactar" },
        { type: "text", text: " agora" },
      ],
    ])
  })

  it("comando que não existe mais fica texto normal (fail-open)", () => {
    expect(planDraft("/sumiu args", NOMES, COMANDOS)).toEqual([
      [{ type: "text", text: "/sumiu args" }],
    ])
  })

  it("sem inventário (param omitido), comportamento de sempre: tudo texto", () => {
    expect(planDraft("/compactar agora", NOMES)).toEqual([
      [{ type: "text", text: "/compactar agora" }],
    ])
  })

  it("só UM pill por mensagem: '/' repetido nos args segue texto", () => {
    expect(planDraft("/review /compactar x", NOMES, COMANDOS)).toEqual([
      [
        { type: "slash", name: "review" },
        { type: "text", text: " /compactar x" },
      ],
    ])
  })

  it("menção @ nos args continua virando pill de menção, junto do comando", () => {
    expect(planDraft("/review @Ana olha isso", NOMES, COMANDOS)).toEqual([
      [
        { type: "slash", name: "review" },
        { type: "text", text: " " },
        { type: "mention", name: "Ana" },
        { type: "text", text: " olha isso" },
      ],
    ])
  })

  it("args na linha de baixo: o pill fica sozinho na 1ª linha do plano", () => {
    expect(planDraft("/compactar\ntudo", NOMES, COMANDOS)).toEqual([
      [{ type: "slash", name: "compactar" }],
      [{ type: "text", text: "tudo" }],
    ])
  })
})

describe("round-trip pill→texto: serializePlan(planDraft(v)) === v, byte a byte", () => {
  const casos = [
    "/compactar ",
    "/compactar agora mesmo",
    "/review @Ana olha isso",
    "/review src/lib/db.ts",
    "/compactar\nlinha 2\nlinha 3",
    "/meu:cmd x",
    "/fantasma não existe",
    "/compactar", // sem espaço: fica texto, e continua idêntico
    "texto normal sem comando",
    "oi /compactar no meio segue texto",
    "",
  ]
  for (const v of casos) {
    it(`preserva ${JSON.stringify(v)}`, () => {
      expect(serializePlan(planDraft(v, NOMES, COMANDOS))).toBe(v)
    })
  }
})

describe("slashPillCaretOffset — caret depois da conversão texto→pill", () => {
  it("caret que estava depois do prefixo desloca pelo tamanho de '/nome'", () => {
    // "/compactar |args" (offset 11) → " |args" (offset 1)
    expect(slashPillCaretOffset(11, "compactar")).toBe(1)
  })

  it("caret dentro do prefixo colapsa pro começo do texto restante", () => {
    expect(slashPillCaretOffset(4, "compactar")).toBe(0)
  })
})

describe("slashPillSourceLabel — micro-chip de origem do pill", () => {
  it("é o MESMO primeiro chip do popover (commandBadges → source)", () => {
    expect(
      slashPillSourceLabel({
        name: "compactar",
        source: "app",
        origin: "app",
        kind: "command",
      }),
    ).toBe("app")
    expect(
      slashPillSourceLabel({
        name: "review",
        source: "mycockpit",
        origin: "project",
        kind: "command",
      }),
    ).toBe("mycockpit")
    expect(
      slashPillSourceLabel({
        name: "deploy",
        source: "claude",
        origin: "global",
        kind: "skill",
      }),
    ).toBe("claude")
  })
})
