import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"
import { MessageList, type FeedbackApi } from "./MessageList"
import { buildToolForest } from "./toolTree"
import { feedbackTextByResult } from "./threadWindow"
import type { ChatItem } from "@/store/chat"

function tool(
  id: string,
  name: string,
  parentToolId?: string,
): Extract<ChatItem, { kind: "tool" }> {
  return {
    kind: "tool",
    id: `item-${id}`,
    name,
    input:
      name === "Task"
        ? { description: `Agente ${id}`, subagent_type: "general-purpose" }
        : { command: `echo ${id}` },
    toolId: id,
    parentToolId,
  }
}

describe("Fio Vivo", () => {
  it("reconstrói subagentes e subprocessos pelos ponteiros do provider", () => {
    const forest = buildToolForest([
      tool("task-1", "Task"),
      tool("bash-1", "Bash", "task-1"),
      tool("task-2", "Task", "task-1"),
      tool("bash-2", "Bash", "task-2"),
    ])
    expect(forest).toHaveLength(1)
    expect(forest[0].item.toolId).toBe("task-1")
    expect(forest[0].children.map((node) => node.item.toolId)).toEqual([
      "bash-1",
      "task-2",
    ])
    expect(forest[0].children[1].children[0].item.toolId).toBe("bash-2")
  })

  it("filho órfão (pai fora do fio) vira raiz e continua na tela", () => {
    // `buildToolForest` já promovia o órfão a raiz, mas a dobra do fio o pulava
    // antes ("o pai desenha") e a ação sumia da tela. Fail-open no render: nada
    // que aconteceu pode desaparecer porque a origem não veio no histórico.
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        items: [
          { kind: "user", id: "u1", text: "Faça" },
          tool("bash-1", "Bash", "task-que-nao-veio"),
        ],
        running: true,
        finalizing: false,
        startedAt: Date.now(),
        agent: "claude-code",
      }),
    )
    expect(html).toContain('aria-label="Fio Vivo da execução"')
    expect(html).toContain('aria-level="1"')
  })

  it("desenha a árvore viva com semântica e níveis de teclado", () => {
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        items: [
          { kind: "user", id: "u1", text: "Faça" },
          tool("task-1", "Task"),
          tool("bash-1", "Bash", "task-1"),
        ],
        running: true,
        finalizing: false,
        startedAt: Date.now(),
        agent: "claude-code",
      }),
    )
    expect(html).toContain('aria-label="Fio Vivo da execução"')
    expect(html).toContain('aria-level="1"')
    expect(html).toContain('aria-level="2"')
    expect(html).toContain("Agente task-1")
  })

  it("recolhe briefing e ações anteriores, deixando o ramo atual em evidência", () => {
    const agent = {
      ...tool("task-1", "Task"),
      input: {
        description: "Investigar a regra",
        subagent_type: "Explore",
        prompt: "Primeira linha\nSegunda linha\nTerceira linha",
      },
    }
    const completed = ["bash-1", "bash-2", "bash-3"].map((id) => ({
      ...tool(id, "Bash", "task-1"),
      result: { ok: true, text: "ok", lines: 1 },
    }))
    const active = tool("bash-4", "Bash", "task-1")
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        items: [
          { kind: "user", id: "u1", text: "Faça" },
          agent,
          ...completed,
          active,
        ],
        running: true,
        finalizing: false,
        startedAt: Date.now(),
        agent: "claude-code",
      }),
    )

    expect(html).toContain("Briefing do agente")
    expect(html).toContain("3 linhas")
    expect(html).not.toContain("Primeira linha")
    expect(html).toContain("Rodou 3 comandos")
    expect(html).toContain("1 agente")
    expect(html).toContain("4 shells")
    expect(html).toContain("Claude Code")
  })
})

describe("plano vivo", () => {
  const taskCreate = (
    id: string,
    taskId: string,
    subject: string,
  ): ChatItem => ({
    kind: "tool",
    id,
    name: "TaskCreate",
    input: { taskId, subject },
  })

  it("mantém apenas um marco compacto no transcript durante o turno", () => {
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        items: [
          { kind: "user", id: "u1", text: "Implemente" },
          taskCreate("c1", "1", "Primeira etapa"),
          taskCreate("c2", "2", "Segunda etapa"),
        ],
        running: true,
        finalizing: false,
        startedAt: Date.now(),
        agent: "claude-code",
      }),
    )

    expect(html).toContain("Plano publicado")
    expect(html).toContain("2 etapas")
    expect(html).not.toContain("Primeira etapa")
    expect(html).not.toContain("Segunda etapa")
  })

  it("transforma o marco em resumo final sem abrir outra checklist", () => {
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        items: [
          { kind: "user", id: "u1", text: "Implemente" },
          taskCreate("c1", "1", "Primeira etapa"),
          {
            kind: "tool",
            id: "x1",
            name: "TaskUpdate",
            input: { taskId: "1", status: "completed" },
          },
          { kind: "result", id: "r1", ok: true },
        ],
        running: false,
        finalizing: false,
        startedAt: null,
        agent: "claude-code",
      }),
    )

    expect(html).toContain("Plano concluído")
    expect(html).toContain("1/1")
    expect(html).not.toContain("Primeira etapa")
  })
})

describe("feedback terminal do turno", () => {
  it("associa a resposta consolidada ao result, não a cada fragmento", () => {
    const items: ChatItem[] = [
      { kind: "user", id: "u1", text: "Faça A" },
      { kind: "text", id: "t1", text: "Primeiro passo." },
      { kind: "result", id: "r0", ok: true },
      { kind: "text", id: "t2", text: "Entrega final." },
      { kind: "result", id: "r1", ok: true },
      { kind: "user", id: "u2", text: "Agora B" },
      { kind: "text", id: "t3", text: "Segundo turno." },
      { kind: "result", id: "r2", ok: true },
    ]
    const byResult = feedbackTextByResult(items)
    expect(byResult.has("r0")).toBe(false)
    expect(byResult.get("r1")).toBe("Primeiro passo.\n\nEntrega final.")
    expect(byResult.get("r2")).toBe("Segundo turno.")
  })

  it("mostra uma única régua de reações para um turno fragmentado", () => {
    const feedback: FeedbackApi = {
      onReact: vi.fn(async () => true),
      distill: vi.fn(async () => ({ rule: "Teste", learnable: true })),
      save: vi.fn(async () => "salva" as const),
    }
    const html = renderToStaticMarkup(
      createElement(MessageList, {
        items: [
          { kind: "user", id: "u1", text: "Faça" },
          { kind: "text", id: "t1", text: "Investigando." },
          tool("bash-1", "Bash"),
          { kind: "text", id: "t2", text: "Concluído." },
          { kind: "result", id: "r1", ok: true },
        ],
        running: false,
        finalizing: false,
        startedAt: null,
        agent: "codex",
        feedback,
      }),
    )
    // botão ícone-só: title (tooltip) + sr-only (nome acessível), mesmo padrão
    // já usado nos botões de reação (👍/👎, ver MessageList.tsx TurnActions).
    expect(html.match(/Transformar em aprendizado/g)).toHaveLength(2)
    // 👍/👎 só (a taxonomia de 6 reações foi removida — ver MessageList.tsx).
    expect(html.match(/aria-pressed=/g)).toHaveLength(2)
    // Fork: sempre visível (não depende de it.ok), mesmo padrão título+sr-only.
    expect(html.match(/Fork: nova conversa a partir daqui/g)).toHaveLength(2)
  })

  describe("coalescimento de autor durante a execução (Defeito B4, ADR-150)", () => {
    it("com ações do executor, o nome do agente aparece apenas UMA vez no HTML (sem duplicar avatar)", () => {
      const html = renderToStaticMarkup(
        createElement(MessageList, {
          items: [
            { kind: "user", id: "u1", text: "proceed" },
            tool("view-1", "view_file"),
            tool("grep-1", "grep_search"),
          ],
          running: true,
          finalizing: false,
          startedAt: Date.now() - 3000,
          agent: "agy",
        }),
      )
      // O nome do agente ("Antigravity") deve aparecer exatamente uma vez no cabeçalho do grupo,
      // e a linha viva ("está trabalhando…") mora dentro do mesmo grupo sem duplicar avatar/cabeçalho.
      const ocorrencias = html.match(/Antigravity/g) ?? []
      expect(ocorrencias).toHaveLength(1)
      expect(html).toContain("está trabalhando…")
      expect(html).toContain("view_file")
      expect(html).toContain("grep_search")
    })

    it("quando o turno começou apenas com pedido do usuário, o WorkingIndicator standalone é renderizado", () => {
      const html = renderToStaticMarkup(
        createElement(MessageList, {
          items: [{ kind: "user", id: "u1", text: "proceed" }],
          running: true,
          finalizing: false,
          startedAt: Date.now(),
          agent: "agy",
        }),
      )
      // Como ainda não há nós do executor no transcript, o indicador standalone introduz o agente
      const ocorrencias = html.match(/Antigravity/g) ?? []
      expect(ocorrencias).toHaveLength(1)
      expect(html).toContain("está trabalhando…")
    })
  })
})
