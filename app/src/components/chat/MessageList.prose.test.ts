// Costura de prosa (paridade Claude Code): o modelo, com tool use interleaved,
// às vezes parte a narração NO MEIO DA PALAVRA pra chamar uma ferramenta e
// retoma depois ("...sobre ro" [Read] "teamento."). Antes isso virava bolha /
// grupo de status / bolha — a palavra estraçalhada. Agora `buildNodes` costura
// os fragmentos que são continuação numa bolha só e agrupa as tools do turno.
import { describe, expect, it } from "vitest"
import { buildNodes, continuesProse } from "./messageNodes"
import type { ChatItem } from "@/store/chat"

const text = (id: string, t: string): ChatItem => ({ kind: "text", id, text: t })
const tool = (id: string, command = "ls"): ChatItem => ({
  kind: "tool",
  id,
  name: "Bash",
  input: { command },
  result: { ok: true, text: "", lines: 0 },
})

describe("continuesProse — só cura corte artificial", () => {
  it("meio de palavra (sem pontuação, retoma minúsculo) → continua", () => {
    expect(continuesProse("Descoberta importante sobre ro", "teamento.")).toBe(true)
    expect(continuesProse("Mapeei o terreno d", "os dois lados")).toBe(true)
  })
  it("frase fechada (. ! ?) → passo novo, NÃO cura", () => {
    expect(continuesProse("Li o estado real do código.", "Memória encontrada")).toBe(false)
    expect(continuesProse("Pronto!", "agora vou")).toBe(false)
  })
  it("retoma em MAIÚSCULA ou marcador markdown → nova sentença/bloco", () => {
    expect(continuesProse("Vou checar as migrations:", "I now have")).toBe(false)
    expect(continuesProse("Resumo do que achei", "- item um")).toBe(false)
  })
  it("vazio dos dois lados → false", () => {
    expect(continuesProse("", "x")).toBe(false)
    expect(continuesProse("x", "   ")).toBe(false)
  })
})

describe("buildNodes — costura o turno", () => {
  it("palavra partida por um tool vira UMA bolha íntegra + grupo de tools", () => {
    const nodes = buildNodes([
      text("t1", "Descoberta importante sobre ro"),
      tool("k1"),
      text("t2", "teamento. Vou verificar."),
    ])
    expect(nodes).toHaveLength(1)
    const n = nodes[0]
    expect(n.type).toBe("prose")
    if (n.type !== "prose") throw new Error("esperava prose")
    expect(n.text).toBe("Descoberta importante sobre roteamento. Vou verificar.")
    expect(n.tools.map((t) => t.id)).toEqual(["k1"])
  })

  it("narração cortada por VÁRIOS tools costura tudo e junta as tools", () => {
    const nodes = buildNodes([
      text("t1", "Mapeei o terreno d"),
      tool("k1"),
      tool("k2"),
      text("t2", "os dois lados e travei o contrato que o app esp"),
      tool("k3"),
      text("t3", "era: a resposta HTTP."),
    ])
    expect(nodes).toHaveLength(1)
    const n = nodes[0]
    if (n.type !== "prose") throw new Error("esperava prose")
    expect(n.text).toBe(
      "Mapeei o terreno dos dois lados e travei o contrato que o app espera: a resposta HTTP.",
    )
    expect(n.tools.map((t) => t.id)).toEqual(["k1", "k2", "k3"])
  })

  it("frases COMPLETAS separadas por tool são passos distintos (não cola)", () => {
    const nodes = buildNodes([
      text("t1", "Li o estado do código."),
      tool("k1"),
      text("t2", "Encontrei a discrepância."),
    ])
    expect(nodes.map((n) => n.type)).toEqual(["prose", "prose"])
    const [a, b] = nodes
    if (a.type !== "prose" || b.type !== "prose") throw new Error("esperava prose")
    // a 1ª bolha leva a tool que ela disparou; a 2ª é a narração seguinte.
    expect(a.text).toBe("Li o estado do código.")
    expect(a.tools.map((t) => t.id)).toEqual(["k1"])
    expect(b.text).toBe("Encontrei a discrepância.")
    expect(b.tools).toHaveLength(0)
  })

  it("tools soltas (sem narração) seguem como burst agrupado", () => {
    const nodes = buildNodes([tool("k1"), tool("k2")])
    expect(nodes).toHaveLength(1)
    expect(nodes[0].type).toBe("tools")
  })
})
