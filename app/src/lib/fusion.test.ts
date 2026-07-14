import { describe, expect, it } from "vitest"
import { serializeContext, toolDigest, CONTEXT_BUDGET } from "./fusion"
import type { ChatItem } from "@/store/chat"

const user = (text: string, id = "u"): ChatItem => ({ kind: "user", id, text })
const text = (t: string, id = "t"): ChatItem => ({ kind: "text", id, text: t })
const tool = (name: string, input: unknown, id = "x"): ChatItem => ({
  kind: "tool",
  id,
  name,
  input,
})

describe("toolDigest", () => {
  it("prefere file_path", () => {
    expect(toolDigest({ file_path: "src/a.ts", content: "..." })).toBe("src/a.ts")
  })
  it("command: só a 1ª linha, cortada em ~80 chars", () => {
    const long = `bun run build && ${"x".repeat(100)}\nsegunda linha`
    const d = toolDigest({ command: long })
    expect(d.startsWith("bun run build && ")).toBe(true)
    expect(d.endsWith("…")).toBe(true)
    expect(d.length).toBeLessThanOrEqual(81)
    expect(d).not.toContain("segunda")
  })
  it("sem chave conhecida: cai na 1ª chave primitiva", () => {
    expect(toolDigest({ todos: [{ a: 1 }], limit: 5 })).toBe("limit=5")
  })
  it("input string/null são tolerados", () => {
    expect(toolDigest("ls -la")).toBe("ls -la")
    expect(toolDigest(null)).toBe("")
  })
})

describe("serializeContext (enriquecido)", () => {
  it("inclui user/text e tool como linha compacta", () => {
    const out = serializeContext([
      user("corrige o bug"),
      tool("Bash", { command: "bun run test" }),
      text("feito"),
    ])
    expect(out).toContain("Usuário: corrige o bug")
    expect(out).toContain("· tool Bash: bun run test")
    expect(out).toContain("Assistente: feito")
  })

  it("colapsa sequências do mesmo tool (×N + digests distintos + …)", () => {
    const items: ChatItem[] = [
      user("leia tudo"),
      tool("Read", { file_path: "a.ts" }, "1"),
      tool("Read", { file_path: "b.rs" }, "2"),
      tool("Read", { file_path: "c.md" }, "3"),
      tool("Read", { file_path: "d.txt" }, "4"),
      tool("Read", { file_path: "a.ts" }, "5"), // digest repetido não duplica
      tool("Bash", { command: "ls" }, "6"),
    ]
    const out = serializeContext(items)
    expect(out).toContain("· tool Read ×5: a.ts, b.rs, c.md, …")
    expect(out).toContain("· tool Bash: ls")
  })

  it("orçamento: mantém o 1º pedido + o final, corta o meio com o marcador", () => {
    const items: ChatItem[] = [user("PRIMEIRO pedido do usuário")]
    for (let i = 0; i < 200; i++) {
      items.push(text(`resposta ${i}: ${"blá ".repeat(40)}`, `t${i}`))
    }
    items.push(text("ÚLTIMA resposta, a mais recente", "fim"))
    const out = serializeContext(items)
    expect(out.length).toBeLessThanOrEqual(CONTEXT_BUDGET + 200) // folga do marcador
    expect(out).toContain("PRIMEIRO pedido do usuário")
    expect(out).toContain("ÚLTIMA resposta, a mais recente")
    expect(out).toMatch(/\[… \d+ itens omitidos …\]/)
    // o corte é no MEIO: o início vem antes do marcador, o fim depois
    const cut = out.indexOf("itens omitidos")
    expect(out.indexOf("PRIMEIRO")).toBeLessThan(cut)
    expect(out.indexOf("ÚLTIMA")).toBeGreaterThan(cut)
  })

  it("abaixo do orçamento: devolve tudo, sem marcador", () => {
    const out = serializeContext([user("oi"), text("olá")])
    expect(out).not.toContain("itens omitidos")
  })

  it("orçamento menor (recap do agy) corta mais", () => {
    const items: ChatItem[] = [user("pedido")]
    for (let i = 0; i < 100; i++) items.push(text(`r${i}: ${"x".repeat(120)}`, `t${i}`))
    const out = serializeContext(items, 4_000)
    expect(out.length).toBeLessThanOrEqual(4_200)
    expect(out).toContain("pedido")
    expect(out).toContain("itens omitidos")
  })
})
