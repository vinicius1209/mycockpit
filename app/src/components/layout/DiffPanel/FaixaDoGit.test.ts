import { describe, expect, it } from "vitest"
import { fraseDaFaixa } from "./FaixaDoGit"

const erro = {
  detalhe: "",
  dono: null as string | null,
  contaAtiva: null as string | null,
  contas: [] as string[],
}

describe("a frase da faixa", () => {
  it("conta errada do GitHub diz qual está ativa e quem é o dono", () => {
    const f = fraseDaFaixa(
      {
        gesto: "enviar",
        erro: { ...erro, tipo: "acesso", dono: "vinicius1209", contaAtiva: "empresa", contas: ["empresa", "vinicius1209"] },
      },
      { ahead: 3, behind: 0 },
    )
    expect(f).toBe(
      "O GitHub recusou: a conta ativa (empresa) não tem acesso a este repositório. O dono é vinicius1209, uma conta que também está no gh.",
    )
  })

  it("divergência conta os dois lados, com a contagem do status", () => {
    const f = fraseDaFaixa({ gesto: "trazer-e-enviar", erro: { ...erro, tipo: "divergiu" } }, { ahead: 3, behind: 2 })
    expect(f).toBe(
      "O remoto tem 2 commits que você não tem, e você tem 3 que ele não tem. Trazer sem mesclar não dá.",
    )
  })

  it("nenhuma frase usa travessão", () => {
    const tipos = ["acesso", "recusado", "divergiu", "alteracoes-locais", "sem-rede", "prazo", "outro"] as const
    for (const tipo of tipos) {
      expect(fraseDaFaixa({ gesto: "enviar", erro: { ...erro, tipo } }, { ahead: 1, behind: 1 })).not.toContain("—")
    }
  })
})
