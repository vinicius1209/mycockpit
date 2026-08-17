// CONTRATO COM A FRONTEIRA DO RUST.
//
// Os casos abaixo são os MESMOS da suíte de `validate_model_slug`
// (`src-tauri/src/adapters.rs`, seção "fronteira do slug de modelo", regressão
// de 14/08/2026), copiados de propósito e varridos em LOOP: o valor deste
// módulo é ser espelho, e espelho que diverge é pior que espelho nenhum — o
// composer aceitaria um id que o motor recusa, ou recusaria um que ele aceita
// (o que quebraria dia-1 de modelo novo num app agnóstico de motor).
//
// A guarda que importa: **este lado nunca pode ser mais permissivo que o
// Rust**. Se algum dia a régua de lá apertar, este arquivo falha primeiro.
import { describe, expect, it } from "vitest"
import { problemaNoSlug } from "./modelSlug"

/** Recusados na fronteira do Rust — cada um com o motivo real. */
const RECUSADOS = [
  // O erro REAL que o usuário viu: rótulo colado por TAB, saído de um parser
  // podre de `agy models` → "model … is not recognized as a known model".
  "gemini-3.7-flash-high\tGemini 3.7 Flash (High)",
  // Rótulo colado por espaço (outra listagem, mesmo estrago).
  "Gemini 3.7 Flash (High)",
  // Sobra de linha inteira.
  "gemini-3.7-flash-low\n",
  // Só espaço.
  "   ",
  "",
]

/** Aceitos na fronteira do Rust. */
const ACEITOS = [
  "gemini-3.7-flash-high",
  "claude-opus-5[1m]",
  "gpt-5.6-sol",
  "default",
]

describe("o que o Rust recusa, o composer recusa antes", () => {
  it.each(RECUSADOS)("recusa %j", (slug) => {
    expect(problemaNoSlug(slug)).not.toBeNull()
  })

  it("a mensagem aponta o id limpo e diz o que fazer", () => {
    const erro = problemaNoSlug("gemini-3.7-flash-high\tGemini 3.7 Flash (High)")
    expect(erro).toContain("gemini-3.7-flash-high")
  })

  it("id vazio tem mensagem própria (é outro problema, não texto colado)", () => {
    expect(problemaNoSlug("")).toContain("vazio")
    expect(problemaNoSlug("   ")).toContain("vazio")
  })
})

describe("o que o Rust aceita, o composer deixa passar", () => {
  it.each(ACEITOS)("aceita %j", (slug) => {
    expect(problemaNoSlug(slug)).toBeNull()
  })

  it("sem modelo é estado legítimo (o CLI escolhe), não erro", () => {
    expect(problemaNoSlug(null)).toBeNull()
  })

  it("não inventa allowlist: id de motor que ainda não existe passa", () => {
    // Dia-1 de modelo novo é o caso de uso do "Modelo custom…". Um espelho que
    // só aceita o catálogo curado mataria justamente o motivo do campo existir.
    for (const futuro of [
      "claude-opus-6-preview",
      "gpt-6.1-codex-max",
      "qwen3-coder-480b-a35b",
      "llama-5:70b",
    ]) {
      expect(problemaNoSlug(futuro)).toBeNull()
    }
  })
})
