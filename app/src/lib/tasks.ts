// Checklist viva: TaskCreate/TaskUpdate deixam de ser cartões de JSON e viram
// UMA lista derivada dos items (create = linha; update = muta a linha no lugar).
// Replay-safe: derivar do histórico persiste o estado final após restart.

import type { ChatItem } from "@/store/chat"

export type AgentTaskStatus = "pending" | "in_progress" | "completed"

export interface AgentTask {
  id: string
  title: string
  description: string | null
  /** Forma "fazendo…" (activeForm), mostrada enquanto in_progress. */
  active: string | null
  status: AgentTaskStatus
}

export function isTaskTool(name: string): boolean {
  return name === "TaskCreate" || name === "TaskUpdate"
}

function s(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null
}

/** Deriva a checklist dos items. O id REAL vem do tool_result do TaskCreate
 *  ("Task #53 created…"); sem resultado (histórico antigo), assume sequencial,
 *  que bate com a numeração do CLI numa sessão nova. Update com id desconhecido
 *  é ignorado (sessão retomada com tasks de antes do cockpit observar). */
export function deriveTasks(items: ChatItem[]): AgentTask[] {
  const tasks: AgentTask[] = []
  let counter = 0
  for (const it of items) {
    if (it.kind !== "tool" || !isTaskTool(it.name)) continue
    const i = (it.input ?? {}) as Record<string, unknown>
    if (it.name === "TaskCreate") {
      const real = it.result?.text?.match(/#(\d+)/)?.[1]
      counter = real ? Math.max(counter, parseInt(real, 10)) : counter + 1
      const id = real ?? String(counter)
      if (tasks.some((t) => t.id === id)) continue
      tasks.push({
        id,
        title:
          s(i.subject) ??
          s(i.activeForm) ??
          s(i.description)?.slice(0, 80) ??
          `Tarefa ${id}`,
        description: s(i.description),
        active: s(i.activeForm),
        status: "pending",
      })
    } else {
      const rawId = i.taskId
      const id =
        typeof rawId === "string"
          ? rawId
          : typeof rawId === "number"
            ? String(rawId)
            : null
      const t = id ? tasks.find((x) => x.id === id) : undefined
      if (!t) continue
      const status = s(i.status)
      if (status === "deleted") {
        tasks.splice(tasks.indexOf(t), 1)
        continue
      }
      if (
        status === "pending" ||
        status === "in_progress" ||
        status === "completed"
      ) {
        t.status = status
      }
      if (s(i.subject)) t.title = s(i.subject) as string
      if (s(i.description)) t.description = s(i.description)
      if (s(i.activeForm)) t.active = s(i.activeForm)
    }
  }
  return tasks
}
