import { describe, expect, it } from "vitest"
import { contextWindowFor } from "./contextWindow"

describe("contextWindowFor — honesto: sem fonte, null (não inventa %)", () => {
  it("sem modelo, null", () => {
    expect(contextWindowFor(null)).toBeNull()
  })

  it("modelo desconhecido (fora de todas as famílias), null", () => {
    expect(contextWindowFor("modelo-que-nao-existe")).toBeNull()
  })

  it("claude: 200k por padrão, 1M só com o sufixo [1m]", () => {
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
