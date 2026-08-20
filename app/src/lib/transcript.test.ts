import { describe, expect, it } from "vitest"
import {
  renderTranscript,
  buildMemoryPrompt,
  memoryPointerLine,
  buildResumeFallback,
  shouldAttachResumeFallback,
  shouldInlineMemory,
  toolImagesNote,
  RESUME_FALLBACK_NOTE,
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

describe("shouldAttachResumeFallback (MyCockpit resume)", () => {
  const items: ChatItem[] = [user("adiciona o botão"), text("Botão adicionado.")]

  it("conv com itens + sessionId (claude/codex): anexa", () => {
    expect(shouldAttachResumeFallback("claude-code", items, "sess-1")).toBe(true)
    expect(shouldAttachResumeFallback("codex", items, "sess-1")).toBe(true)
  })

  it("conversa nova (sem itens) ou sem sessão: não anexa", () => {
    expect(shouldAttachResumeFallback("claude-code", [], "sess-1")).toBe(false)
    expect(shouldAttachResumeFallback("claude-code", items, null)).toBe(false)
  })

  // O agy ERA o caso "nunca anexa": sem resume, ele já levava memória própria
  // em todo turno. Com o `--conversation <ID>` da 1.1.13 ele entrou na regra
  // geral — e o fallback importa MAIS nele que nos outros, porque o agy ignora
  // id inexistente e abre conversa nova em silêncio (ver AGY_CAPS).
  it("agy anexa como claude/codex desde que ganhou resume", () => {
    expect(shouldAttachResumeFallback("agy", items, "sess-1")).toBe(true)
  })

  it("motor sem resume nunca anexa (não há resume que possa falhar)", () => {
    expect(shouldAttachResumeFallback("opencode", items, "sess-1")).toBe(false)
  })
})

describe("buildResumeFallback (memoryFallback do motor)", () => {
  const items: ChatItem[] = [
    user("adiciona o botão"),
    tool("Edit", { file_path: "src/App.tsx" }),
    text("Botão adicionado."),
  ]

  it("recap + ponteiro + linha de continuidade, nesta ordem", () => {
    const f = buildResumeFallback(items, ".mycockpit/context/abc.md")
    expect(f).toContain("Contexto da conversa até aqui:")
    expect(f).toContain(memoryPointerLine(".mycockpit/context/abc.md"))
    expect(f.endsWith(RESUME_FALLBACK_NOTE)).toBe(true)
    const recapIdx = f.indexOf("Contexto da conversa")
    const ptrIdx = f.indexOf("Memória completa desta conversa")
    const noteIdx = f.indexOf(RESUME_FALLBACK_NOTE)
    expect(recapIdx).toBeLessThan(ptrIdx)
    expect(ptrIdx).toBeLessThan(noteIdx)
  })

  it("sem ponteiro (export falhou): recap + linha de continuidade", () => {
    const f = buildResumeFallback(items, null)
    expect(f).not.toContain("Memória completa desta conversa")
    expect(f.endsWith(RESUME_FALLBACK_NOTE)).toBe(true)
  })

  it("recap respeita o orçamento curto (~3k)", () => {
    const many: ChatItem[] = [user("pedido")]
    for (let i = 0; i < 300; i++) many.push(text(`r${i}: ${"y".repeat(100)}`, `t${i}`))
    const f = buildResumeFallback(many, null)
    expect(f).toContain("itens omitidos")
    expect(f.length).toBeLessThanOrEqual(3_500)
  })
})

describe("toolImagesNote + capturas no transcript (G3.3)", () => {
  it("singular, plural e silêncio no zero", () => {
    expect(toolImagesNote(0)).toBeNull()
    expect(toolImagesNote(1)).toBe("1 captura")
    expect(toolImagesNote(3)).toBe("3 capturas")
  })

  it("tool com imagens vira menção TEXTUAL na memória (nunca render)", () => {
    const items: ChatItem[] = [
      user("tira um print da home"),
      {
        kind: "tool",
        id: "x",
        name: "computer",
        input: { action: "screenshot" },
        result: { ok: true, text: "ok", lines: 1 },
        images: ["evidence/c1/t-0.png", "evidence/c1/t-1.png"],
      },
      tool("Read", { file_path: "src/a.ts" }),
    ]
    const md = renderTranscript(items)
    expect(md).toContain("- tool `computer` — action=screenshot (2 capturas)")
    // tool sem imagem segue sem menção nenhuma
    expect(md).toContain("- tool `Read` — src/a.ts\n")
    expect(md).not.toContain("src/a.ts (0")
  })
})

describe("shouldInlineMemory (a memória entra no corpo do prompt?)", () => {
  const fio: ChatItem[] = [user("antes"), text("respondi")]
  const base = { items: fio, hasReply: true, wheelSwitch: false }

  it("FORK: motor com resume e SEM sessão leva a memória", () => {
    // O fork copia o fio pro nosso banco mas NÃO herda a sessão do CLI — sem
    // isto o agente começa cego num fio que a tela mostra cheio.
    expect(
      shouldInlineMemory({ ...base, agent: "claude-code", sessionId: null }),
    ).toBe(true)
  })

  it("sessão viva NÃO leva (o resume nativo já carrega)", () => {
    expect(
      shouldInlineMemory({ ...base, agent: "claude-code", sessionId: "sess" }),
    ).toBe(false)
  })

  it("conversa nova (sem resposta de assistant) não leva envelope nenhum", () => {
    // senão o 1º envio mandaria uma "memória" contendo só a própria pergunta.
    expect(
      shouldInlineMemory({
        agent: "claude-code",
        items: [user("primeira")],
        hasReply: false,
        sessionId: null,
        wheelSwitch: false,
      }),
    ).toBe(false)
  })

  it("troca de backend fica de fora (o fio viaja no envelope do revezamento)", () => {
    expect(
      shouldInlineMemory({
        ...base,
        agent: "claude-code",
        sessionId: null,
        wheelSwitch: true,
      }),
    ).toBe(false)
  })

  it("motor SEM resume leva em todo turno, com ou sem sessão", () => {
    // `opencode` é um dos únicos com sessionResume:false no registry — agy
    // MIGROU pro resume nativo, então não serve mais de exemplo aqui.
    expect(shouldInlineMemory({ ...base, agent: "opencode", sessionId: null })).toBe(true)
    expect(shouldInlineMemory({ ...base, agent: "opencode", sessionId: "x" })).toBe(true)
  })

  it("motor com resume: os 3 agents entregues (claude/codex/agy) dependem da sessão", () => {
    // Guarda de registry: se algum deles perder `sessionResume`, este teste cai
    // e obriga a revisitar a regra em vez de mudar o comportamento em silêncio.
    for (const agent of ["claude-code", "codex", "agy"]) {
      expect(shouldInlineMemory({ ...base, agent, sessionId: "viva" })).toBe(false)
      expect(shouldInlineMemory({ ...base, agent, sessionId: null })).toBe(true)
    }
  })
})
