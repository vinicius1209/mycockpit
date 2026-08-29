import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { LivePlanCard } from "./LivePlanCard"
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

function render(items: ChatItem[], detailInSidebar = false) {
  return renderToStaticMarkup(
    createElement(LivePlanCard, {
      items,
      running: true,
      finalizing: false,
      detailInSidebar,
    }),
  )
}

describe("LivePlanCard", () => {
  it("usa a etapa atual como resumo humano, sem inventar nome para o plano", () => {
    const html = render(active)
    expect(html).toContain("Criando branch")
    expect(html).toContain("0/2")
    expect(html).not.toContain("Plano ·")
    expect(html).toContain('data-plan-detail="composer"')
  })

  it("nasce detalhado junto ao composer quando a lateral não mostra o plano", () => {
    const html = render(pending)
    expect(html).toContain('aria-expanded="true"')
    expect(html).toContain("Próxima: Criar branch")
    expect(html).toContain("O agente ainda não informou qual etapa está em andamento.")
    expect(html).toContain('aria-label="Etapas do plano"')
  })

  it("é um trilho E0 neutro, não outro cartão sobre o composer", () => {
    const html = render(active)
    expect(html).toContain("border-l border-border/40")
    expect(html).not.toContain("shadow-")
    expect(html).not.toContain("bg-card")
    expect(html).not.toContain("text-brass")
    expect(html).not.toContain("text-st-success")
  })

  it("vira apenas resumo quando a checklist já está aberta no painel Plano", () => {
    const html = render(active, true)
    expect(html).toContain('data-plan-detail="sidebar"')
    expect(html).toContain("Etapas abertas no painel Plano")
    expect(html).toContain("Criando branch")
    expect(html).not.toContain('aria-label="Etapas do plano"')
    expect(html).not.toContain("Preparar commit")
  })

  it("some fora de um turno vivo", () => {
    const html = renderToStaticMarkup(
      createElement(LivePlanCard, {
        items: active,
        running: false,
        finalizing: false,
        detailInSidebar: false,
      }),
    )
    expect(html).toBe("")
  })
})
