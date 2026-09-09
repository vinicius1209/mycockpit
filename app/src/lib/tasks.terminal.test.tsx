import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { ChatItem } from "@/store/chat"
import { TaskChecklist } from "@/components/chat/TaskChecklist"
import { LivePlanCard } from "@/components/chat/LivePlanCard"
import { deriveTaskPlans, deriveTasks, taskPlansOf } from "./tasks"
import captured from "./__fixtures__/plano-encerrado-4-de-7.json"

// Incidente e78edeef-2ace-4ad7-b158-27bd77d16465, extraído do SQLite em
// 08/09/2026. Payloads TaskCreate/TaskUpdate intactos; prosa do pedido omitida.
const items = captured as ChatItem[]
const beforeEnd = items.slice(0, -1)

describe("plano encerrado com quatro de sete etapas concluídas", () => {
  it("preserva as quatro conclusões e encerra as três restantes sem alterar o histórico", () => {
    const original = JSON.stringify(items)
    const [plan] = deriveTaskPlans(items)
    expect(plan.terminal).toBe("completed")
    expect(plan.tasks.map((task) => task.status)).toEqual([
      "unsettled", "unsettled", "unsettled", "completed", "completed", "completed", "completed",
    ])
    expect(JSON.stringify(items)).toBe(original)
    expect(taskPlansOf(items).live).toBeNull()
    const html = renderToStaticMarkup(<TaskChecklist tasks={plan.tasks} live />)
    expect(html).not.toContain("animate-spin")
    expect(html).toContain("Sem conclusão registrada")
    expect(html).toContain("4/7")
  })

  it.each([
    { kind: "error", id: "failure", text: "Falha" },
    { kind: "cancelled", id: "cancel" },
    { kind: "limit", id: "limit", text: "Limite" },
    { kind: "result", id: "failure-result", ok: false },
  ] as ChatItem[])("encerra também com $kind, sem concluir por inferência", (terminal) => {
    const tasks = deriveTasks([...beforeEnd, terminal])
    expect(tasks.filter((task) => task.status === "completed")).toHaveLength(4)
    expect(tasks.filter((task) => task.status === "unsettled")).toHaveLength(3)
  })

  it("outro pedido não reanima o plano anterior mesmo sem terminal persistido", () => {
    const next: ChatItem[] = [...beforeEnd, { kind: "user", id: "next", text: "Continue" }]
    expect(taskPlansOf(next).live).toBeNull()
    expect(renderToStaticMarkup(<TaskChecklist tasks={deriveTasks(next)} live />))
      .not.toContain("animate-spin")
  })

  it("replay sem processo vivo é estático, mas o plano em execução ainda anima", () => {
    const tasks = deriveTasks(beforeEnd)
    expect(renderToStaticMarkup(<TaskChecklist tasks={tasks} />)).not.toContain("animate-spin")
    expect(renderToStaticMarkup(<TaskChecklist tasks={tasks} live />)).toContain("animate-spin")
    expect(tasks[0].status).toBe("in_progress")
  })

  it("o card vivo desaparece no terminal mesmo durante a finalização", () => {
    expect(renderToStaticMarkup(
      <LivePlanCard items={items} running={false} finalizing detailInSidebar={false} />,
    )).toBe("")
  })
})
