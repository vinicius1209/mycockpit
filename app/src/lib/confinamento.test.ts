// A rede do selo. O que se testa aqui é a HONESTIDADE dele, não a mecânica.

import { describe, expect, it } from "vitest"
import { ganhaSelo, notaDeQuemSegura, SEM_CONFINAMENTO } from "./confinamento"

describe("ganhaSelo", () => {
  it("os modos que prometem não escrever ganham", () => {
    expect(ganhaSelo("leitura")).toBe(true)
    expect(ganhaSelo("fusionRo")).toBe(true)
  })

  it("o PLANO ganha — foi ele que motivou o sandbox", () => {
    // ADR-061: `agy --mode plan` criou o arquivo. Se o plano ficasse fora do
    // selo, a tela esconderia justamente a proteção do caso que originou tudo.
    expect(ganhaSelo("plan")).toBe(true)
  })

  it("modo de escrita NÃO ganha selo", () => {
    // Selo em modo que escreve seria enfeite: não há garantia nenhuma ali, e
    // insinuar que há é o defeito que este módulo combate.
    for (const m of ["padrao", "auto", "liberado"]) {
      expect(ganhaSelo(m), m).toBe(false)
    }
  })
})

describe("o default é o pessimista", () => {
  it("sem Tauri, sem confinamento — e sem nota", () => {
    // Selo otimista por omissão seria pior que selo nenhum: prometeria
    // garantia justamente onde não dá pra verificar.
    expect(SEM_CONFINAMENTO.selo).toBe("ausente")
    expect(SEM_CONFINAMENTO.nota).toBe("")
  })
})

describe("notaDeQuemSegura", () => {
  const PARCIAL = {
    selo: "parcial" as const,
    nota: "o sistema barra escrita no projeto",
  }

  it("com confinamento, o SELO vence a nota do motor", () => {
    // O motor do agy segura por prompt; com o sandbox ligado quem segura é o
    // sistema. Manter "só um pedido no prompt" ali descreveria o freio ANTIGO
    // enquanto o novo é que está valendo.
    expect(notaDeQuemSegura("leitura", PARCIAL, "só um pedido no prompt")).toBe(
      "confinamento parcial: o sistema barra escrita no projeto",
    )
  })

  it("diz PARCIAL, nunca completa", () => {
    // A política é denylist: protege o projeto, não o disco. "Completa" aqui
    // seria repetir com a nossa assinatura o rótulo sem dente que o sandbox
    // veio consertar.
    const nota = notaDeQuemSegura("leitura", PARCIAL, "x")
    expect(nota).toContain("parcial")
    expect(nota).not.toContain("completa")
  })

  it("modo de ESCRITA mantém a nota do motor, mesmo com sandbox disponível", () => {
    // Não há confinamento em modo que escreve (o `confina()` do Rust recusa), e
    // insinuar que há seria a mentira mais perigosa da tela.
    expect(notaDeQuemSegura("auto", PARCIAL, "modo da CLI")).toBe("modo da CLI")
  })

  it("sem confinamento, a nota do motor passa intacta", () => {
    expect(notaDeQuemSegura("leitura", SEM_CONFINAMENTO, "sandbox do sistema")).toBe(
      "sandbox do sistema",
    )
  })
})
