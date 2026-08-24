import { describe, expect, it } from "vitest"
import {
  historicoDeModelos,
  seletorDoAgente,
  totalDeModelos,
} from "@/lib/seletorDeModelos"
import type { ModelProposal, ModelRetirement } from "@/lib/modelLedger"

const modelo = (value: string, label = value) => ({ value, label })

const aposentadoria = (agent: string, value: string, successor: string): ModelRetirement => ({
  agent,
  value,
  successor,
  vendorNote: null,
  reason: "",
  seenAt: 1000,
})

const proposta = (over: Partial<ModelProposal> = {}): ModelProposal => ({
  id: "p1",
  agent: "codex",
  value: "gpt-5.6",
  label: "Grande Contexto",
  description: "",
  status: "proposed",
  origin: "cli",
  decidedBy: "app",
  reason: "",
  evidence: null,
  successor: null,
  createdAt: 500,
  decidedAt: 0,
  ...over,
})

describe("seletorDoAgente", () => {
  it("marca o PADRÃO e só ele", () => {
    const s = seletorDoAgente(
      "codex",
      [modelo("default"), modelo("gpt-5.6-sol")],
      "default",
      [],
      [],
    )
    expect(s.linhas.map((l) => l.padrao)).toEqual([true, false])
  })

  it("casa a aposentadoria por AGENT + VALUE, nunca só pelo value", () => {
    // O defeito que isto impede: `default` existe nos três motores. Casar só
    // pelo id marcaria o `default` do Claude como aposentado porque o do Codex
    // está — um aviso de fim de vida no modelo errado.
    const aps = [aposentadoria("codex", "default", "gpt-5.6-sol")]
    const claude = seletorDoAgente("claude-code", [modelo("default")], "default", aps, [])
    const codex = seletorDoAgente("codex", [modelo("default")], "default", aps, [])
    expect(claude.linhas[0].aposentando).toBeNull()
    expect(codex.linhas[0].aposentando).toEqual({ sucessor: "gpt-5.6-sol" })
  })

  it("o cabeçalho do cartão conta as aposentadorias (pra ver sem abrir)", () => {
    const s = seletorDoAgente(
      "codex",
      [modelo("gpt-5.4"), modelo("gpt-5.4-mini"), modelo("gpt-5.6-sol")],
      "gpt-5.6-sol",
      [
        aposentadoria("codex", "gpt-5.4", "gpt-5.6-terra"),
        aposentadoria("codex", "gpt-5.4-mini", "gpt-5.6-luna"),
      ],
      [],
    )
    expect(s.aposentando).toBe(2)
  })

  it("só o modelo que ENTROU por proposta pode ser tirado", () => {
    // Modelo da lista curada não entrou por decisão sua, então "tirar" nele
    // prometeria um gesto que não existe.
    const s = seletorDoAgente(
      "codex",
      [modelo("gpt-5.6-sol"), modelo("gpt-5.6")],
      "gpt-5.6-sol",
      [],
      [proposta({ value: "gpt-5.6", status: "active", decidedBy: "human" })],
    )
    expect(s.linhas[0].removivelPor).toBeNull()
    expect(s.linhas[1].removivelPor?.value).toBe("gpt-5.6")
  })

  it("proposta PENDENTE não torna a linha removível (ela nem está no seletor)", () => {
    const s = seletorDoAgente(
      "codex",
      [modelo("gpt-5.6")],
      "default",
      [],
      [proposta({ value: "gpt-5.6", status: "proposed" })],
    )
    expect(s.linhas[0].removivelPor).toBeNull()
  })
})

describe("totalDeModelos", () => {
  it("soma os agents — é o 27 do rótulo 'No seu seletor'", () => {
    const a = seletorDoAgente("claude-code", [modelo("a"), modelo("b")], "a", [], [])
    const b = seletorDoAgente("codex", [modelo("c")], "c", [], [])
    expect(totalDeModelos([a, b])).toBe(3)
  })
})

describe("historicoDeModelos", () => {
  it("a fila NÃO é histórico: pendente fica de fora", () => {
    const h = historicoDeModelos([proposta({ status: "proposed" })], [])
    expect(h).toEqual([])
  })

  it("distingue as três histórias com desfecho", () => {
    const h = historicoDeModelos(
      [
        proposta({ id: "a", value: "m1", status: "active", decidedBy: "app", decidedAt: 3 }),
        proposta({ id: "b", value: "m2", status: "active", decidedBy: "human", decidedAt: 2 }),
        proposta({ id: "c", value: "m3", status: "rejected", decidedAt: 1 }),
      ],
      [],
    )
    expect(h.map((e) => e.texto)).toEqual([
      "m1 entrou sozinho",
      "você adicionou m2",
      "m3 não passou",
    ])
  })

  it("ordena do mais novo pro mais velho, misturando propostas e aposentadorias", () => {
    const h = historicoDeModelos(
      [proposta({ id: "a", value: "m1", status: "active", decidedAt: 100 })],
      [{ ...aposentadoria("codex", "gpt-5.4", "gpt-5.6-terra"), seenAt: 200 }],
    )
    expect(h[0].texto).toMatch(/aposentar gpt-5\.4/)
    expect(h[1].texto).toBe("m1 entrou sozinho")
  })

  it("linha antiga sem decidedAt cai no createdAt, nunca em 1970", () => {
    // `decidedAt` é 0 em linha que nunca foi redecidida. Zero viraria
    // 01/01/1970 no topo da lista, empurrando o histórico real pra baixo.
    const h = historicoDeModelos(
      [proposta({ status: "active", decidedAt: 0, createdAt: 777 })],
      [],
    )
    expect(h[0].quando).toBe(777)
  })
})
