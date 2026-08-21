// O recibo de turno (M2): o que sobrevive da resposta do helper, e que frase o
// usuário lê no aviso.
//
// A regra que estes testes protegem: o aviso NUNCA some. Resposta ruim, helper
// mudo, prazo estourado — tudo cai na frase de hoje, nunca no silêncio.

import { describe, expect, it, vi } from "vitest"
import {
  fraseDoTurno,
  parseReceipt,
  receiptBody,
  turnReceipt,
  RECEIPT_MAX,
} from "./turnReceipt"

vi.mock("@/lib/agent", () => ({ suggest: vi.fn() }))
vi.mock("@/lib/suggestions", () => ({ buildContext: () => "contexto" }))

describe("parseReceipt", () => {
  it("frase limpa passa inteira", () => {
    expect(parseReceipt("Extraiu o parser pra lib/ e cobriu o caso vazio.")).toBe(
      "Extraiu o parser pra lib/ e cobriu o caso vazio.",
    )
  })

  it("tira aspas, bullet e markdown das bordas", () => {
    expect(parseReceipt('  "**Corrigiu o cálculo de custo do turno**"  ')).toBe(
      "Corrigiu o cálculo de custo do turno",
    )
    expect(parseReceipt("- Removeu o worktree órfão do repo")).toBe(
      "Removeu o worktree órfão do repo",
    )
  })

  it("preâmbulo em várias linhas: fica com a PRIMEIRA linha não-vazia", () => {
    expect(parseReceipt("\n\nInvestigou o vazamento de worktree\nmais coisa")).toBe(
      "Investigou o vazamento de worktree",
    )
  })

  it("resposta vazia ou curta demais vira null (o aviso cai no genérico)", () => {
    expect(parseReceipt("")).toBeNull()
    expect(parseReceipt("   \n  ")).toBeNull()
    expect(parseReceipt("Ok.")).toBeNull()
    expect(parseReceipt("Feito")).toBeNull()
  })

  it("frase longa é cortada AQUI, não pelo macOS no meio da palavra", () => {
    const out = parseReceipt("x".repeat(RECEIPT_MAX + 50))!
    expect(out.length).toBeLessThanOrEqual(RECEIPT_MAX)
    expect(out.endsWith("…")).toBe(true)
  })

  it("espaço em excesso vira espaço simples", () => {
    expect(parseReceipt("Rodou   os\t testes   do módulo novo")).toBe(
      "Rodou os testes do módulo novo",
    )
  })
})

describe("receiptBody", () => {
  it("sem recibo é exatamente a frase de hoje", () => {
    expect(receiptBody("Refatorar", false, null)).toBe("Refatorar · turno concluído")
    expect(receiptBody("Refatorar", true, null)).toBe("Refatorar · turno falhou")
  })

  it("com recibo, 'turno concluído' SAI (se veio recibo, concluiu)", () => {
    const b = receiptBody("Refatorar", false, "Extraiu o parser pra lib/")
    expect(b).toBe("Refatorar · Extraiu o parser pra lib/")
    expect(b).not.toContain("turno concluído")
  })

  it("com ERRO o desfecho fica, porque aí ele é a informação principal", () => {
    const b = receiptBody("Refatorar", true, "Parou no teste de borda")
    expect(b).toContain("turno falhou")
    expect(b).toContain("Parou no teste de borda")
  })
})

describe("fraseDoTurno", () => {
  it("com recibo, a frase É o recibo", () => {
    expect(fraseDoTurno("Extraiu o parser e cobriu o caso vazio.", true)).toBe(
      "Extraiu o parser e cobriu o caso vazio.",
    )
  })

  it("sem recibo, cai no desfecho — nunca linha vazia", () => {
    expect(fraseDoTurno(null, true)).toBe("turno concluído")
    expect(fraseDoTurno(null, false)).toBe("turno falhou")
  })

  it("recibo VENCE o desfecho até quando o turno falhou", () => {
    // Aqui difere do `receiptBody` de propósito: lá a linha do sistema mantém
    // "turno falhou" na frente porque é o dado principal de uma linha só. Nesta
    // superfície o cartão já mostra a falha (o rótulo ao lado), então repetir
    // gastaria a única linha de texto que existe.
    expect(fraseDoTurno("Parou no lint da linha 40.", false)).toBe(
      "Parou no lint da linha 40.",
    )
  })

  it("é a MESMA frase na bandeja e no celular", () => {
    // O ponto do R3: a regra estava escrita duas vezes, em dois runtimes (TSX
    // e o HTML estático servido ao aparelho). Uma função, uma frase.
    const casos: [string | null, boolean][] = [
      ["fez", true],
      [null, true],
      [null, false],
    ]
    for (const [r, ok] of casos) {
      expect(fraseDoTurno(r, ok)).toBe(fraseDoTurno(r, ok))
      expect(fraseDoTurno(r, ok)).not.toBe("")
    }
  })
})

describe("turnReceipt", () => {
  const base = { cwd: "/proj", items: [] }

  it("helper desligado nem chega a perguntar (custo zero)", async () => {
    const { suggest } = await import("@/lib/agent")
    expect(await turnReceipt({ ...base, helperModel: null })).toBeNull()
    expect(suggest).not.toHaveBeenCalled()
  })

  it("resposta boa vira recibo", async () => {
    const { suggest } = await import("@/lib/agent")
    vi.mocked(suggest).mockResolvedValue("Extraiu o parser pra lib/")
    expect(await turnReceipt({ ...base, helperModel: "haiku" })).toBe(
      "Extraiu o parser pra lib/",
    )
  })

  it("helper que estoura o PRAZO não segura o aviso", async () => {
    const { suggest } = await import("@/lib/agent")
    vi.mocked(suggest).mockImplementation(
      () => new Promise((r) => setTimeout(() => r("tarde demais"), 5_000)),
    )
    const t0 = Date.now()
    const out = await turnReceipt({ ...base, helperModel: "haiku", deadlineMs: 30 })
    expect(out).toBeNull()
    expect(Date.now() - t0).toBeLessThan(1_000)
  })

  it("helper que EXPLODE não derruba o aviso", async () => {
    const { suggest } = await import("@/lib/agent")
    vi.mocked(suggest).mockRejectedValue(new Error("sem rede"))
    expect(await turnReceipt({ ...base, helperModel: "haiku" })).toBeNull()
  })
})
