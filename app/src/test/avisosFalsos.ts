// Avisos falsos para teste (ADR-261): espiões no lugar da porta `lib/avisos`,
// para o teste cobrar QUAL natureza de aviso saiu e com que texto, sem pintar
// toast nenhum. Uso:
//
//   vi.mock("@/lib/avisos", async () => (await import("@/test/avisosFalsos")).moduloDeAvisosFalsos())
//   import { avisar } from "@/lib/avisos"
//   expect(avisar.erro).toHaveBeenCalledWith("Não consegui copiar")
//
// Não importa o módulo original de propósito: ele puxa os stores, e o ciclo
// fazia o módulo sob teste receber a porta REAL em vez dos espiões.

import { vi } from "vitest"
import { mensagemDe } from "@/lib/mensagemDe"

export function avisosFalsos() {
  return { feito: vi.fn(), nota: vi.fn(), evento: vi.fn(), erro: vi.fn(), fechar: vi.fn() }
}

export function moduloDeAvisosFalsos(avisar: Record<string, unknown> = avisosFalsos()) {
  return { avisar, mensagemDe }
}
