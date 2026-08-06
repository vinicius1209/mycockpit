// Status de trabalho em background: UM lugar canônico pro "agora"
// (background-status B2.1 a B2.5). Aqui a checagem é de MARCAÇÃO — o que a
// linha viva mostra em cada estado, e o que o nó no fio deixou de ser.
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { MessageList } from "./MessageList"
import type { ChatItem } from "@/store/chat"
import type { DeferredWork } from "@/lib/work"

const T0 = 1_754_400_000_000

function deferred(over: Partial<DeferredWork> = {}): DeferredWork {
  return {
    id: "wpue6int0",
    toolUseId: "toolu_01",
    kind: "local_workflow",
    name: "spike-ping",
    status: "running",
    summary: null,
    outputFile: null,
    tokens: null,
    startedAt: T0,
    updatedAt: T0,
    ...over,
  }
}

/** Nó sintético igual ao que o reducer cria no `deferred_work` (chat.ts). */
function node(d: DeferredWork): ChatItem {
  return {
    kind: "tool",
    id: `deferred-${d.id}`,
    name: "DeferredWork",
    input: { name: d.name, kind: d.kind, description: d.summary },
    toolId: `deferred:${d.id}`,
    deferred: d,
    ts: T0,
  }
}

function render(items: ChatItem[], over: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(MessageList, {
      items,
      running: true,
      finalizing: false,
      startedAt: T0,
      agent: "claude-code",
      ...over,
    } as never),
  )
}

describe("linha viva do rodapé (B2.1/B2.2/B2.5)", () => {
  it("um trabalho: nomeia o trabalho e reserva largura pro cronômetro", () => {
    const html = render([
      { kind: "user", id: "u1", text: "Pesquise" },
      node(deferred()),
    ])
    expect(html).toContain("trabalho em background · spike-ping")
    // o tempo é irmão do que anima, com largura reservada e sem encolher
    expect(html).toContain("min-w-[4.5rem] shrink-0")
    expect(html).toContain("tabular-nums")
    // quem cede espaço é o nome
    expect(html).toContain("min-w-0 truncate")
  })

  it("N trabalhos: conta e mostra o mais recente, com a lista inteira no title", () => {
    const html = render([
      { kind: "user", id: "u1", text: "Pesquise" },
      node(deferred({ id: "a", name: "spike-ping", startedAt: T0 })),
      node(deferred({ id: "b", name: "deep-research", startedAt: T0 + 5_000 })),
    ])
    expect(html).toContain("2 trabalhos em background · deep-research")
    expect(html).toContain('title="spike-ping, deep-research"')
    expect(html).not.toContain("trabalho em background rodando")
  })

  it("sem trabalho em background a linha volta a falar do turno", () => {
    const html = render([{ kind: "user", id: "u1", text: "Oi" }])
    expect(html).toContain("está trabalhando…")
    expect(html).not.toContain("em background")
  })

  it("turno finalizando com background vivo mantém o cronômetro (o turno perdeu o startedAt)", () => {
    const html = render(
      [{ kind: "user", id: "u1", text: "Pesquise" }, node(deferred())],
      { running: false, finalizing: true, startedAt: null },
    )
    expect(html).toContain("trabalho em background · spike-ping")
    expect(html).toContain("min-w-[4.5rem] shrink-0")
    expect(html).not.toContain("finalizando…")
  })

  it("trabalho terminado derruba a linha viva e o marco sobrevive no fio", () => {
    const done = deferred({ status: "completed" })
    const html = render(
      [
        { kind: "user", id: "u1", text: "Pesquise" },
        {
          ...(node(done) as Extract<ChatItem, { kind: "tool" }>),
          result: { ok: true, text: "pronto", lines: 1 },
        },
      ],
      { running: false, finalizing: false, startedAt: null },
    )
    // o "agora" some com o turno; o marco continua no fio, com estado de sucesso
    expect(html).not.toContain("trabalho em background · spike-ping")
    expect(html).toContain("Trabalho em background: spike-ping")
    expect(html).toContain("text-st-success")
  })
})

describe("nó no fio é marco, não segundo painel vivo (B2.2/B2.3/B2.4)", () => {
  it("marco enquanto roda: 'iniciado', e resultado quando termina", () => {
    const html = render([
      { kind: "user", id: "u1", text: "Pesquise" },
      node(deferred()),
      {
        ...(node(
          deferred({ id: "b", name: "auditoria", status: "completed" }),
        ) as Extract<ChatItem, { kind: "tool" }>),
        result: { ok: true, text: "pronto", lines: 1 },
      },
    ])
    expect(html).toContain("Trabalho em background: spike-ping")
    // a meta do nó vivo é MARCO; o "em background" quem diz é a linha viva
    expect(html).toContain(">iniciado<")
    expect(html).not.toContain(">em background<")
    expect(html).toContain(">concluiu<")
  })

  it("não vaza o task_type técnico do provider na meta do nó", () => {
    const html = render([
      { kind: "user", id: "u1", text: "Pesquise" },
      node(deferred({ kind: "local_agent", name: "auditoria" })),
    ])
    expect(html).not.toContain("local_agent")
  })

  it("o cartão do trabalho não oferece 'Interromper turno' (ação de outro dono)", () => {
    const html = render(
      [{ kind: "user", id: "u1", text: "Pesquise" }, node(deferred())],
      { onStop: () => {} },
    )
    expect(html).not.toContain("Interromper turno")
  })

  it("subagente comum continua com a interrupção do turno explicada", () => {
    const html = render(
      [
        { kind: "user", id: "u1", text: "Pesquise" },
        {
          kind: "tool",
          id: "t1",
          name: "Task",
          input: { description: "Investigar", subagent_type: "Explore" },
          toolId: "task-1",
        },
      ],
      { onStop: () => {} },
    )
    expect(html).toContain("Interromper turno")
  })
})
