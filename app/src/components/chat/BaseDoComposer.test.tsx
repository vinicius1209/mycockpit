// A base do composer (ADR-247). Os casos do plano vieram do teste do antigo
// `LivePlanCard` (tasks.AGENTS.md): as mesmas garantias, agora na tira.
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it } from "vitest"
import { BaseDoComposer, resumoDoPlano } from "./BaseDoComposer"
import { useApp } from "@/store/app"
import type { Attachment } from "@/lib/attachments"
import type { ChatItem } from "@/store/chat"

function create(id: string, subject: string, activeForm: string): ChatItem {
  return {
    kind: "tool",
    id: `create-${id}`,
    name: "TaskCreate",
    input: { taskId: id, subject, activeForm },
    toolId: `tool-create-${id}`,
  }
}

function update(id: string, status: "in_progress" | "completed"): ChatItem {
  return {
    kind: "tool",
    id: `update-${id}-${status}`,
    name: "TaskUpdate",
    input: { taskId: id, status },
    toolId: `tool-update-${id}-${status}`,
  }
}

const pending: ChatItem[] = [
  { kind: "user", id: "turno", text: "prepare a sprint" },
  create("branch", "Criar branch", "Criando branch"),
  create("commit", "Preparar commit", "Preparando commit"),
]

const active: ChatItem[] = [...pending, update("branch", "in_progress")]

// Anexo com a forma real do `save_attachment` (lib/attachments.ts).
const print: Attachment = { path: "attachments/14ff6eb1/c8ed950eab5154d6.png", name: "image.png", mime: "image/png", kind: "image", bytes: 184_000 }
const print2: Attachment = { ...print, path: "attachments/14ff6eb1/02c07c2d69b130f2.png" }
const pdf: Attachment = { path: "attachments/14ff6eb1/contrato.pdf", name: "contrato.pdf", mime: "application/pdf", kind: "pdf", bytes: 88_000 }

function render(items: ChatItem[], over: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(BaseDoComposer, {
      conv: { items, running: true, finalizing: false, runManifest: undefined, agent: "claude-code", queued: [], ...over } as never,
      convId: "c1",
    }),
  )
}

afterEach(() => useApp.setState({ contextOpen: false }))

describe("base do composer · plano", () => {
  it("usa a etapa atual como resumo humano, com o 1/N no fim", () => {
    const html = render(active)
    expect(html).toContain("Criando branch")
    expect(html).toContain("0/2")
    expect(html).not.toContain("Plano ·")
    expect(html.indexOf("Criando branch")).toBeLessThan(html.indexOf("0/2"))
  })

  it("sem etapa corrente, mostra a próxima e avisa que o agente não disse qual", () => {
    expect(render(pending)).toContain("Próxima: Criar branch")
    expect(resumoDoPlano(pending, true)?.semEtapaCorrente).toBe(true)
    expect(resumoDoPlano(active, true)?.semEtapaCorrente).toBe(false)
  })

  it("é uma tira presa ao composer, neutra: nada de sombra de popover nem cor de marco", () => {
    const html = render(active)
    expect(html).toContain("data-base-do-composer")
    expect(html).toContain("rounded-t-xl border border-b-0")
    expect(html).not.toContain("shadow-[var(--shadow-pop)]")
    expect(html).not.toContain("text-brass")
    expect(html).not.toContain("text-st-success")
  })

  it("com a checklist aberta no painel, a tira é só resumo e a gaveta não abre", () => {
    useApp.setState({ contextOpen: true, contextPanelTab: "conversa" } as never)
    const html = render(active)
    expect(html).toContain('title="Etapas abertas no painel Plano"')
    expect(html).toContain("disabled")
    expect(html).toContain("Criando branch")
  })

  it("some fora de um turno vivo, se não há fila nem aviso", () => {
    expect(render(active, { running: false })).toBe("")
  })

  it("nasce fechada: a gaveta só abre por gesto", () => {
    expect(render(active)).not.toContain('aria-label="Etapas do plano"')
  })
})

describe("base do composer · fila e anexos (24/09: \"quero ter visibilidade\")", () => {
  const fila = [
    { text: "ficou essa mensagem de \u201crovogar\u201d e nao saiu, iso é normal?", attachments: [print] },
    { text: "aqui outro problema na fila, veja", attachments: [print2, pdf] },
  ]

  it("com mensagem na fila, a gaveta da fila nasce aberta: o texto fica à vista", () => {
    const html = render([], { running: true, queued: fila })
    expect(html).toContain("aqui outro problema na fila, veja")
    expect(html).toContain("contrato.pdf")
  })

  it("na tira, a fila diz quantas e mostra o que vai junto", () => {
    const html = render([], { running: false, queued: fila })
    expect(html).toContain("na fila")
    expect(html).toContain('title="2 mensagens na fila · 2 imagens e 1 documento vão junto"')
    // documento aparece pelo ícone do tipo, não some
    expect(html).toContain('data-file-icon="pdf"')
  })

  it("mais de três anexos viram +N", () => {
    const muitos = [{ text: "prints", attachments: [print, print2, pdf, { ...print, path: "a/4.png" }] }]
    expect(render([], { running: false, queued: muitos })).toContain(">+1<")
  })
})

describe("base do composer · avisos", () => {
  it("exceção do turno vira contador na tira, não cartão solto", () => {
    const html = render([], {
      running: false,
      runManifest: {
        schemaVersion: 7, agentId: "engine", managedExternalMcp: true, notices: [], resources: [], unobservedResources: false,
        sources: [], omissions: [{ sourceId: "figma", sourceLabel: "figma", code: "health-unavailable", detail: null }],
      },
    })
    expect(html).toContain("1 aviso")
    expect(html).not.toContain("figma não entrou")
  })
})
