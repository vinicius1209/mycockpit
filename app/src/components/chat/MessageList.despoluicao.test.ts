// Despoluição do fio (direção B + paleta A, docs/mocks/fio-despoluicao-b.html):
// concluído recolhe pra UMA linha com duração congelada; falha nasce aberta
// nomeando a culpada e escondendo as concluídas atrás do stub; o filho não
// repete o rótulo que o cabeçalho já mostra.
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { MessageList } from "./MessageList"
import type { ChatItem } from "@/store/chat"
import type { DeferredWork } from "@/lib/work"

const T0 = 1_754_400_000_000

function render(items: ChatItem[], running = false): string {
  return renderToStaticMarkup(
    createElement(MessageList, {
      items,
      running,
      finalizing: false,
      startedAt: running ? T0 : null,
      agent: "claude-code",
    }),
  )
}

function bash(
  id: string,
  command: string,
  over: Partial<Extract<ChatItem, { kind: "tool" }>> = {},
): ChatItem {
  return {
    kind: "tool",
    id,
    name: "Bash",
    input: { command },
    result: { ok: true, text: "", lines: 0 },
    ...over,
  }
}

describe("MessageList · grupo assentado com falha (a falha não se esconde)", () => {
  const items: ChatItem[] = [
    { kind: "user", id: "u1", text: "Roda o estudo" },
    bash("1", "ls"),
    bash("2", "pwd"),
    bash("3", "node probe.mjs", {
      input: { description: "Gerar PDF (iPhone SE)", command: "node probe.mjs" },
      result: { ok: false, text: "saiu 1", lines: 1 },
    }),
    bash("4", "git status"),
    bash("5", "git diff"),
    bash("6", "rg foo src"),
    bash("7", "cat a.txt"),
  ]

  it("o resumo nomeia a culpada e o grupo nasce aberto", () => {
    const html = render(items)
    expect(html).toContain("1 de 7 falhou · Gerar PDF (iPhone SE)")
    expect(html).toContain('aria-expanded="true"')
  })

  it("expandido mostra SÓ a linha falhada; as concluídas viram stub", () => {
    const html = render(items)
    // a linha falhada é evidência: o nome aparece no cabeçalho E na linha
    expect(html.match(/Gerar PDF \(iPhone SE\)/g)).toHaveLength(2)
    expect(html).toContain("6 concluídas · mostrar")
    // as concluídas não rendem até serem pedidas
    expect(html).not.toContain("Verificar o estado do repositório")
    expect(html).not.toContain("Inspecionar alterações")
  })
})

describe("MessageList · concluído recolhe pra UMA linha com tempo congelado", () => {
  it("grupo assentado nasce recolhido, com duração total no cabeçalho", () => {
    const html = render([
      { kind: "user", id: "u1", text: "Confere as pré-condições" },
      bash("1", "git status --short", { ts: T0, activityAt: T0 + 300 }),
      bash("2", "cat src/styles/print-pdf.css", {
        ts: T0 + 400,
        activityAt: T0 + 3_000,
      }),
    ])
    expect(html).toContain("2 verificações concluídas")
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain(">3s<")
    // recolhido: nenhuma linha filha no DOM até o clique
    expect(html).not.toContain("Inspecionar arquivos")
  })

  it("sem carimbos não inventa relógio (nunca 0s)", () => {
    const html = render([
      { kind: "user", id: "u1", text: "Confere" },
      bash("1", "ls"),
      bash("2", "pwd"),
    ])
    expect(html).toContain("2 verificações concluídas")
    expect(html).not.toContain(">0s<")
  })
})

describe("MessageList · o filho mostra só o delta (rótulo uma vez)", () => {
  it("trabalho em background vivo: o cabeçalho é o dono do nome, o filho mostra o estado", () => {
    const deferred: DeferredWork = {
      id: "w1",
      toolUseId: "toolu_01",
      kind: "local_workflow",
      name: "spike-ping",
      status: "running",
      summary: null,
      outputFile: null,
      tokens: null,
      startedAt: T0,
      updatedAt: T0,
    }
    const html = render(
      [
        { kind: "user", id: "u1", text: "Pesquise" },
        {
          kind: "tool",
          id: "deferred-w1",
          name: "DeferredWork",
          input: { name: "spike-ping", kind: "local_workflow" },
          toolId: "deferred:w1",
          deferred,
          ts: T0,
        },
      ],
      true,
    )
    // o rótulo aparece UMA vez no fio do grupo (cabeçalho); o filho vira delta
    const inThread = html.split("trabalho em background · spike-ping").join("")
    expect(inThread.match(/Trabalho em background: spike-ping/g)).toHaveLength(1)
    expect(html).toContain(">iniciado<")
  })
})
