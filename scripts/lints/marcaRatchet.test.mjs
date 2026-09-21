import { describe, expect, it } from "vitest"

import {
  avaliarMarca,
  baselineDesatualizada,
  contarOcorrencias,
  linhasComMarca,
} from "./marcaRatchet.mjs"

// Linhas REAIS do repositório em 21/09/2026 (ADR-016: fixture inventada só
// prova que a guarda pega a fixture inventada). Conferidas no arquivo citado.
const IDENTIFICADOR = `  "identifier": "dev.vinicius.mycockpit",` // app/src-tauri/tauri.conf.json:5
const KEYCHAIN = `const KEYCHAIN_SERVICE: &str = "dev.vinicius.mycockpit.mcp-oauth";` // mcp_auth.rs:28
const FORMATO = `export const MISSION_PLAN_FORMAT = "mycockpit.flight-plan"` // missionPlans.ts:13
const COMENTARIO = `// MCP read-only de memória/contexto do MyCockpit.` // context_gateway.rs:1

describe("contagem", () => {
  it("acha o nome em qualquer casing", () => {
    expect(contarOcorrencias("MyCockpit mycockpit MYCOCKPIT Mycockpit")).toBe(4)
  })

  it("conta cada ocorrência, não cada linha", () => {
    const linha = `cp "$HOME/Library/Application Support/dev.vinicius.mycockpit/mycockpit.db" /tmp/f.db`
    expect(contarOcorrencias(linha)).toBe(2)
  })

  it("não inventa ocorrência em texto limpo", () => {
    expect(contarOcorrencias("o produto se chama Frota")).toBe(0)
  })

  it("pega comentário, que a guarda antiga deixava passar", () => {
    expect(contarOcorrencias(COMENTARIO)).toBe(1)
  })

  it("aponta a linha de cada achado", () => {
    const fonte = ["limpo", IDENTIFICADOR, "limpo", KEYCHAIN].join("\n")
    expect(linhasComMarca(fonte).map((a) => a.linha)).toEqual([2, 4])
  })
})

describe("catraca", () => {
  it("arquivo sem entrada na baseline tem teto ZERO", () => {
    const { violacoes } = avaliarMarca([{ relPath: "novo.ts", ocorrencias: 1 }], {})
    expect(violacoes).toHaveLength(1)
    expect(violacoes[0]).toMatchObject({ relPath: "novo.ts", base: 0, novo: true })
  })

  it("arquivo já limpo não pode reintroduzir o nome", () => {
    // Saiu da baseline quando zerou; voltar é violação, não folga.
    const { violacoes } = avaliarMarca([{ relPath: "limpo.ts", ocorrencias: 3 }], {})
    expect(violacoes[0].base).toBe(0)
  })

  it("segurar o número congelado passa", () => {
    const { violacoes, encolheram } = avaliarMarca(
      [{ relPath: "lib.rs", ocorrencias: 4 }],
      { "lib.rs": 4 },
    )
    expect(violacoes).toEqual([])
    expect(encolheram).toEqual([])
  })

  it("crescer acima do congelado é violação", () => {
    const { violacoes } = avaliarMarca([{ relPath: "lib.rs", ocorrencias: 5 }], { "lib.rs": 4 })
    expect(violacoes[0]).toMatchObject({ ocorrencias: 5, base: 4 })
  })

  it("encolher cobra a atualização da baseline, senão a catraca afrouxa sozinha", () => {
    const { encolheram, baselineNova } = avaliarMarca(
      [{ relPath: "lib.rs", ocorrencias: 1 }],
      { "lib.rs": 4 },
    )
    expect(encolheram[0]).toMatchObject({ de: 4, para: 1 })
    expect(baselineNova["lib.rs"]).toBe(1)
  })

  it("update de arquivo que violou NÃO sobe o número", () => {
    const { baselineNova } = avaliarMarca([{ relPath: "lib.rs", ocorrencias: 9 }], { "lib.rs": 4 })
    expect(baselineNova["lib.rs"]).toBe(4)
  })

  it("arquivo zerado sai da baseline", () => {
    const { baselineNova, obsoletos } = avaliarMarca(
      [{ relPath: "lib.rs", ocorrencias: 0 }],
      { "lib.rs": 4 },
    )
    expect(baselineNova).not.toHaveProperty("lib.rs")
    expect(obsoletos).toEqual(["lib.rs"])
  })

  it("arquivo apagado vira entrada obsoleta", () => {
    const { obsoletos } = avaliarMarca([], { "sumiu.ts": 2 })
    expect(obsoletos).toEqual(["sumiu.ts"])
  })

  it("soma o total para o relatório do rename", () => {
    const { total } = avaliarMarca(
      [
        { relPath: "a.ts", ocorrencias: 2 },
        { relPath: "b.rs", ocorrencias: 3 },
      ],
      { "a.ts": 2, "b.rs": 3 },
    )
    expect(total).toBe(5)
  })

  it("a baseline sai ordenada, para o diff não embaralhar", () => {
    const { baselineNova } = avaliarMarca(
      [
        { relPath: "z.ts", ocorrencias: 1 },
        { relPath: "a.ts", ocorrencias: 1 },
      ],
      { "z.ts": 1, "a.ts": 1 },
    )
    expect(Object.keys(baselineNova)).toEqual(["a.ts", "z.ts"])
  })
})

describe("baselineDesatualizada", () => {
  it("é falsa quando nada mudou", () => {
    expect(baselineDesatualizada({ "a.ts": 2 }, { "a.ts": 2 })).toBe(false)
  })

  it("é verdadeira quando um arquivo encolheu", () => {
    expect(baselineDesatualizada({ "a.ts": 2 }, { "a.ts": 1 })).toBe(true)
  })

  it("é verdadeira quando uma entrada sumiu", () => {
    expect(baselineDesatualizada({ "a.ts": 2 }, {})).toBe(true)
  })
})

describe("os três nomes persistidos que passam batido (ADR-222)", () => {
  it("a guarda enxerga identificador, Keychain e formato de plano", () => {
    for (const linha of [IDENTIFICADOR, KEYCHAIN, FORMATO]) {
      expect(contarOcorrencias(linha)).toBeGreaterThan(0)
    }
  })
})

describe("janela de compatibilidade", () => {
  it("arquivo declarado na janela pode citar o nome antigo", () => {
    // `frotaDir.ts` existe PARA reconhecer `.mycockpit/`. Sem esta porta, a
    // guarda barraria justamente o módulo que permite aposentar o nome.
    const { violacoes, baselineNova } = avaliarMarca(
      [{ relPath: "app/src/lib/frotaDir.ts", ocorrencias: 3 }],
      {},
      new Set(["app/src/lib/frotaDir.ts"]),
    )
    expect(violacoes).toEqual([])
    expect(baselineNova["app/src/lib/frotaDir.ts"]).toBe(3)
  })

  it("quem não está na janela continua barrado", () => {
    const { violacoes } = avaliarMarca(
      [{ relPath: "outro.ts", ocorrencias: 1 }],
      {},
      new Set(["app/src/lib/frotaDir.ts"]),
    )
    expect(violacoes).toHaveLength(1)
  })

  it("sem janela declarada, nada passa", () => {
    const { violacoes } = avaliarMarca([{ relPath: "novo.ts", ocorrencias: 1 }], {}, null)
    expect(violacoes).toHaveLength(1)
  })
})
