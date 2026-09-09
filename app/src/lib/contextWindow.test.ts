import { beforeEach, describe, expect, it } from "vitest"
import {
  _resetJanelasForTests,
  contextWindowFor,
  hidratarJanelasDoCatalogo,
} from "./contextWindow"

beforeEach(() => _resetJanelasForTests())

describe("contextWindowFor — honesto: sem fonte, null (não inventa %)", () => {
  it("sem modelo, null", () => {
    expect(contextWindowFor(null)).toBeNull()
  })

  it("modelo desconhecido (fora de todas as famílias), null", () => {
    expect(contextWindowFor("modelo-que-nao-existe")).toBeNull()
  })

  it("SEM catálogo, claude cai no fallback: 200k, 1M só com o sufixo [1m]", () => {
    expect(contextWindowFor("claude-opus-5")).toBe(200_000)
    expect(contextWindowFor("claude-opus-5[1m]")).toBe(1_000_000)
  })

  it("gemini: família geral 1M, 'pro' na família 2M", () => {
    expect(contextWindowFor("gemini-3.7-flash-high")).toBe(1_000_000)
    expect(contextWindowFor("gemini-3.1-pro-high")).toBe(2_000_000)
  })

  it("gpt-oss fica na família própria (200k), não cai na família gpt (272k)", () => {
    // Ordem importa: "gpt-oss-120b" contém "gpt", então o branch gpt-oss
    // precisa vir ANTES do branch gpt genérico — mesma classe de risco que
    // pricing.rs já documentou pro `contains` de preço.
    expect(contextWindowFor("gpt-oss-120b")).toBe(200_000)
  })

  it("família gpt-5.6-{sol,terra,luna} (SEED de pricing.rs): 272k", () => {
    expect(contextWindowFor("gpt-5.6-sol")).toBe(272_000)
    expect(contextWindowFor("gpt-5.6-terra")).toBe(272_000)
    expect(contextWindowFor("gpt-5.6-luna")).toBe(272_000)
  })

  it("claude-fable-5 cai no branch claude (contém \"claude\"), não teve branch próprio duplicado", () => {
    // Achado da revisão: um branch "fable" separado abaixo do branch claude
    // era código MORTO — todo id real de Fable já contém "claude" e nunca
    // chegava lá. Removido em vez de mantido como decoração.
    expect(contextWindowFor("claude-fable-5")).toBe(200_000)
  })
})

// Regressão de 09/09/2026: uma chamada REAL de `claude-opus-5` mediu 320.702
// tokens contra uma "janela" de 200.000, e o anel escondeu o percentual (certo:
// não forçou 100%). O catálogo NESTA máquina já dizia `context: 1_000_000` —
// o app tinha o número em disco e usava um palpite escrito à mão.
describe("catálogo manda no palpite", () => {
  // Recorte REAL do models-catalog.json desta máquina (models.dev).
  const CATALOGO = [
    { id: "claude-opus-5", context: 1_000_000 },
    { id: "claude-sonnet-5", context: 1_000_000 },
  ]

  it("a janela vem do catálogo, não da tabela de casa", () => {
    hidratarJanelasDoCatalogo(CATALOGO)
    expect(contextWindowFor("claude-opus-5")).toBe(1_000_000)
    // 320.702 tokens agora CABEM: o anel volta a ter percentual.
    expect(contextWindowFor("claude-opus-5")!).toBeGreaterThan(320_702)
  })

  it("o sufixo [1m] é dialeto de flag e não atrapalha o casamento", () => {
    hidratarJanelasDoCatalogo(CATALOGO)
    expect(contextWindowFor("claude-opus-5[1m]")).toBe(1_000_000)
  })

  it("modelo fora do catálogo continua no fallback declarado", () => {
    // Os slugs do agy e do Codex não são ids de models.dev: a tabela de casa
    // segue sendo a resposta pra eles, e some no dia em que o catálogo cobrir.
    hidratarJanelasDoCatalogo(CATALOGO)
    expect(contextWindowFor("gemini-3.1-pro-high")).toBe(2_000_000)
    expect(contextWindowFor("gpt-5.6-sol")).toBe(272_000)
  })

  it("catálogo sem contexto declarado não apaga o fallback", () => {
    // `null` do models.dev é "não informou", nunca "não tem janela".
    hidratarJanelasDoCatalogo([{ id: "claude-opus-5", context: null }])
    expect(contextWindowFor("claude-opus-5")).toBe(200_000)
  })
})
