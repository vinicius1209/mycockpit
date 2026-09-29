// A entrega declarada (`deliver`, ADR-286). Os itens partem da forma REAL de
// uma chamada do `frota-work` no Claude (o `work_plan` de `fio-real.json`,
// com `toolId`, `result` e `ts` como o stream deixou); muda só o nome e o
// input, porque a `deliver` ainda não existia quando o fio foi colhido.
import { describe, expect, it } from "vitest"
import type { ChatItem } from "@/store/chat"
import { buildNodes } from "@/components/chat/messageNodes"
import { linhaDaEntrega } from "@/components/chat/EntregasDoTurno"
import { presentTool } from "@/lib/toolview"
import { entregasDoTrecho } from "./entregas"

type Tool = Extract<ChatItem, { kind: "tool" }>
const fioReal = JSON.parse(
  Object.values(import.meta.glob("../test/fio-real.json", { query: "?raw", import: "default", eager: true }))[0] as string,
) as ChatItem[]
const moldeReal = fioReal.find((it): it is Tool => it.kind === "tool" && it.name.endsWith("__work_plan"))!

const entrega = (id: string, input: Record<string, unknown>, result: Tool["result"] = moldeReal.result): Tool => ({
  ...moldeReal,
  id,
  toolId: `toolu_${id}`,
  name: "mcp__frota-work__deliver",
  input,
  result,
})
const escrita = (id: string, file_path: string): Tool => ({ ...moldeReal, id, toolId: `toolu_${id}`, name: "Write", input: { file_path } })

describe("entrega declarada (ADR-286)", () => {
  it("a declarada vale, com a frase, e cede a inferida do mesmo turno (D5)", () => {
    const itens = [
      escrita("w1", "/proj/saida/rascunho.pdf"),
      entrega("d1", { path: "/tmp/relatorio-setembro.pdf", summary: "Relatório de desempenho do checkout" }),
    ]
    expect(entregasDoTrecho(itens)).toEqual([
      { caminho: "/tmp/relatorio-setembro.pdf", frase: "Relatório de desempenho do checkout" },
    ])
  })

  it("sem declaração, fica a inferência de antes", () => {
    expect(entregasDoTrecho([escrita("w1", "/proj/saida/rascunho.pdf")])).toEqual([{ caminho: "/proj/saida/rascunho.pdf" }])
  })

  it("entrega que falhou não vira cartão, e a linha dela fica no fio", () => {
    const falhou = entrega("d2", { path: "/tmp/nao-existe.pdf" }, { ok: false, text: "não achei /tmp/nao-existe.pdf", lines: 1 })
    expect(entregasDoTrecho([falhou])).toEqual([])
    const nos = buildNodes([falhou])
    expect(nos.some((n) => n.type === "tools" && n.tools.some((t) => t.id === "d2"))).toBe(true)
  })

  it("a que deu certo não repete como linha no grupo de ações", () => {
    const nos = buildNodes([entrega("d3", { path: "/tmp/funil.png" }), escrita("w2", "/proj/a.ts")])
    const ids = nos.flatMap((n) => (n.type === "tools" || n.type === "prose" ? n.tools.map((t) => t.id) : []))
    expect(ids).toEqual(["w2"])
  })

  it("o cartão diz tipo, tamanho e a frase; a linha que falhou tem nome humano", () => {
    expect(linhaDaEntrega("/tmp/relatorio.pdf", 286_720, "Relatório de setembro")).toBe("PDF · 280.0 KB · Relatório de setembro")
    expect(linhaDaEntrega("/tmp/relatorio.pdf", null)).toBe("PDF")
    const v = presentTool("mcp__frota-work__deliver", { path: "/tmp/relatorio.pdf" })
    expect(v.verb).toBe("Entregar arquivo")
    expect(v.object).toEqual({ kind: "text", text: "relatorio.pdf" })
  })
})
