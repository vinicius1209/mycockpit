import { describe, expect, it } from "vitest"
import type { ChatItem } from "@/store/chat"
import { deriveTaskPlans, deriveTasks } from "./tasks"

function create(
  id: string,
  taskId: string,
  title: string,
): Extract<ChatItem, { kind: "tool" }> {
  return {
    kind: "tool",
    id,
    name: "TaskCreate",
    input: { taskId, subject: title, activeForm: `Fazendo ${title}` },
  }
}

function update(
  id: string,
  taskId: string,
  status: "pending" | "in_progress" | "completed",
): Extract<ChatItem, { kind: "tool" }> {
  return {
    kind: "tool",
    id,
    name: "TaskUpdate",
    input: { taskId, status },
  }
}

describe("planos por pedido", () => {
  it("não mistura ids e updates de turnos diferentes", () => {
    const items: ChatItem[] = [
      { kind: "user", id: "u1", text: "Primeiro" },
      create("c1", "1", "Tarefa antiga"),
      update("x1", "1", "completed"),
      { kind: "result", id: "r1", ok: true },
      { kind: "user", id: "u2", text: "Segundo" },
      create("c2", "1", "Tarefa nova"),
      update("x2", "1", "in_progress"),
    ]

    const plans = deriveTaskPlans(items)
    expect(plans).toHaveLength(2)
    expect(plans[0].tasks[0]).toMatchObject({
      title: "Tarefa antiga",
      status: "completed",
    })
    expect(plans[0].terminal).toBe("completed")
    expect(plans[1].tasks[0]).toMatchObject({
      title: "Tarefa nova",
      status: "in_progress",
    })
    expect(deriveTasks(items)).toEqual(plans[1].tasks)
  })

  it("não inventa progresso quando só recebeu TaskCreate", () => {
    const plans = deriveTaskPlans([
      { kind: "user", id: "u1", text: "Faça" },
      create("c1", "1", "Primeira"),
      create("c2", "2", "Segunda"),
    ])
    expect(plans[0].reportedUpdates).toBe(0)
    expect(plans[0].tasks.map((task) => task.status)).toEqual([
      "pending",
      "pending",
    ])
  })

  it("ignora tarefas internas de subagente no plano do executor", () => {
    const child = {
      ...create("child", "1", "Plano interno"),
      parentToolId: "agent-1",
    }
    expect(
      deriveTaskPlans([
        { kind: "user", id: "u1", text: "Faça" },
        child,
      ]),
    ).toEqual([])
  })
})
