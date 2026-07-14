import { describe, expect, it } from "vitest"
import {
  renderTranscript,
  buildMemoryPrompt,
  memoryPointerLine,
} from "./transcript"
import type { ChatItem } from "@/store/chat"

const user = (text: string, id = "u"): ChatItem => ({ kind: "user", id, text })
const text = (t: string, id = "t"): ChatItem => ({ kind: "text", id, text: t })
const tool = (
  name: string,
  input: unknown,
  result?: { ok: boolean; text: string; lines: number },
  id = "x",
): ChatItem => ({ kind: "tool", id, name, input, result })

describe("renderTranscript", () => {
  it("golden: cabeçalho + turnos + tools + erro, sem truncar", () => {
    const items: ChatItem[] = [
      user("corrige o build"),
      tool("Read", { file_path: "src/a.ts" }, { ok: true, text: "…", lines: 10 }),
      tool("Bash", { command: "bun run build" }, { ok: false, text: "erro", lines: 2 }),
      text("Corrigi o import quebrado em src/a.ts."),
      { kind: "error", id: "e", message: "processo saiu com código 1" },
    ]
    const md = renderTranscript(items, {
      agent: "claude-code",
      date: new Date("2026-07-14T12:00:00.000Z"),
    })
    expect(md).toBe(
      `# Memória da conversa

- Data: 2026-07-14T12:00:00.000Z
- Agent: Claude Code

## Usuário

corrige o build
- tool \`Read\` — src/a.ts
- tool \`Bash\` — bun run build (falhou)

## Assistente

Corrigi o import quebrado em src/a.ts.

> Erro: processo saiu com código 1
`,
    )
  })

  it("não trunca textos longos (memória plena)", () => {
    const long = "linha ".repeat(10_000)
    const md = renderTranscript([user("oi"), text(long)])
    expect(md).toContain(long)
    expect(md).not.toContain("itens omitidos")
  })

  it("agent desconhecido usa o id cru; sem agent, sem a linha", () => {
    expect(renderTranscript([], { agent: "zzz" })).toContain("- Agent: zzz")
    expect(renderTranscript([])).not.toContain("- Agent:")
  })
})

describe("buildMemoryPrompt (agy sem resume)", () => {
  const items: ChatItem[] = [
    user("adiciona o botão"),
    tool("Edit", { file_path: "src/App.tsx" }),
    text("Botão adicionado."),
  ]

  it("recap + ponteiro + separador + pedido, nesta ordem", () => {
    const p = buildMemoryPrompt(items, ".mycockpit/context/abc.md", "agora estiliza")
    expect(p).toContain("Contexto da conversa até aqui:")
    expect(p).toContain("· tool Edit: src/App.tsx")
    expect(p).toContain(memoryPointerLine(".mycockpit/context/abc.md"))
    expect(p.endsWith("\n\n---\n\nagora estiliza")).toBe(true)
    const recapIdx = p.indexOf("Contexto da conversa")
    const ptrIdx = p.indexOf("Memória completa desta conversa")
    const askIdx = p.indexOf("agora estiliza")
    expect(recapIdx).toBeLessThan(ptrIdx)
    expect(ptrIdx).toBeLessThan(askIdx)
  })

  it("sem ponteiro (export falhou): só recap + pedido", () => {
    const p = buildMemoryPrompt(items, null, "agora estiliza")
    expect(p).not.toContain("Memória completa desta conversa")
    expect(p.endsWith("\n\n---\n\nagora estiliza")).toBe(true)
  })

  it("recap do agy respeita o orçamento menor (~4k)", () => {
    const many: ChatItem[] = [user("pedido")]
    for (let i = 0; i < 300; i++) many.push(text(`r${i}: ${"y".repeat(100)}`, `t${i}`))
    const p = buildMemoryPrompt(many, null, "continua")
    // recap cortado (marcador presente) e bem menor que o transcript pleno
    expect(p).toContain("itens omitidos")
    expect(p.length).toBeLessThanOrEqual(4_500)
  })
})
