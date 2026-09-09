// Checklist viva: TaskCreate/TaskUpdate deixam de ser cartões de JSON e viram
// UMA lista derivada dos items (create = linha; update = muta a linha no lugar).
// Replay-safe: derivar do histórico persiste o estado final após restart.

import type { ChatItem } from "@/store/chat"

// `unsettled` pertence à leitura, nunca é escrito no transcript do provider.
export type AgentTaskStatus = "pending" | "in_progress" | "completed" | "unsettled"

export interface AgentTask {
  id: string
  title: string
  description: string | null
  /** Forma "fazendo…" (activeForm), mostrada enquanto in_progress. */
  active: string | null
  status: AgentTaskStatus
}

export type AgentPlanTerminal =
  | "completed"
  | "error"
  | "cancelled"
  | "limit"

/** Um plano pertence a UM pedido do usuário. O transcript pode ter vários
 * planos ao longo da conversa; misturá-los criava ids colidindo e fazia o
 * primeiro cartão histórico representar tarefas de turnos futuros. */
export interface AgentPlan {
  id: string
  /** id do item `user` que abriu o turno (`conversation-start` em legado). */
  turnId: string
  /** primeiro TaskCreate: posição do marco "Plano publicado" no transcript. */
  anchorId: string
  tasks: AgentTask[]
  reportedUpdates: number
  createdAt?: number
  updatedAt?: number
  terminal: AgentPlanTerminal | null
}

export function isTaskTool(name: string): boolean {
  return name === "TaskCreate" || name === "TaskUpdate"
}

function s(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null
}

function terminalOf(item: ChatItem): AgentPlanTerminal | null {
  if (item.kind === "result") return item.ok ? "completed" : "error"
  if (item.kind === "error") return "error"
  if (item.kind === "cancelled") return "cancelled"
  if (item.kind === "limit") return "limit"
  return null
}

/** Reconstrói todos os planos, segmentados pelo pedido (`user`) que os criou.
 * TaskUpdate só pode alterar o plano do turno corrente; um provider que reinicia
 * a numeração no próximo pedido não contamina o histórico anterior. */
export function deriveTaskPlans(items: ChatItem[]): AgentPlan[] {
  const plans: AgentPlan[] = []
  let turnId = "conversation-start"
  let current: AgentPlan | null = null
  let counter = 0

  for (const it of items) {
    if (it.kind === "user") {
      turnId = it.id
      current = null
      counter = 0
      continue
    }
    const terminal = terminalOf(it)
    if (terminal && current) {
      current.terminal = terminal
      current.updatedAt = it.ts ?? current.updatedAt
    }
    // To-dos de um subagente pertencem ao galho dele no Fio Vivo. Misturá-los
    // à checklist do executor causa colisão de ids e uma falsa lista única.
    if (
      it.kind !== "tool" ||
      it.parentToolId ||
      !isTaskTool(it.name)
    )
      continue
    const i = (it.input ?? {}) as Record<string, unknown>
    if (it.name === "TaskCreate") {
      if (!current || current.terminal) {
        current = {
          id: `plan:${turnId}:${it.id}`,
          turnId,
          anchorId: it.id,
          tasks: [],
          reportedUpdates: 0,
          createdAt: it.ts,
          updatedAt: it.ts,
          terminal: null,
        }
        plans.push(current)
        counter = 0
      }
      const real = it.result?.text?.match(/#(\d+)/)?.[1]
      const supplied = s(i.taskId)
      counter = real ? Math.max(counter, parseInt(real, 10)) : counter + 1
      const id = supplied ?? real ?? String(counter)
      if (current.tasks.some((t) => t.id === id)) continue
      current.tasks.push({
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
      current.updatedAt = it.ts ?? current.updatedAt
    } else {
      if (!current) continue
      const rawId = i.taskId
      const id =
        typeof rawId === "string"
          ? rawId
          : typeof rawId === "number"
            ? String(rawId)
            : null
      const t = id ? current.tasks.find((x) => x.id === id) : undefined
      if (!t) continue
      const status = s(i.status)
      if (status === "deleted") {
        current.tasks.splice(current.tasks.indexOf(t), 1)
        current.reportedUpdates += 1
        current.updatedAt = it.ts ?? current.updatedAt
        continue
      }
      if (
        status === "pending" ||
        status === "in_progress" ||
        status === "completed"
      ) {
        t.status = status
        current.reportedUpdates += 1
      }
      if (s(i.subject)) t.title = s(i.subject) as string
      if (s(i.description)) t.description = s(i.description)
      if (s(i.activeForm)) t.active = s(i.activeForm)
      current.updatedAt = it.ts ?? current.updatedAt
    }
  }
  for (const plan of plans) {
    if (plan.terminal || plan.turnId !== turnId) {
      for (const task of plan.tasks) {
        if (task.status !== "completed") task.status = "unsettled"
      }
    }
  }
  return plans
}

/** O runtime fecha também o replay sem evento terminal. Conclusão exige
 * update explícito; um turno parado só prova ausência de execução. */
export function taskStatusForDisplay(task: AgentTask, live: boolean): AgentTaskStatus {
  return !live && task.status !== "completed" ? "unsettled" : task.status
}

/** Leitura completa do plano de um fio: os planos, o turno corrente e o plano
 *  VIVO desse turno. Os três consumidores precisavam exatamente disto e cada um
 *  recalculava por conta própria. */
export interface TaskPlansView {
  plans: AgentPlan[]
  /** id do último item `user` = o turno corrente ("conversation-start" em fio
   *  legado sem `user` vira `undefined` aqui, e nenhum plano casa: correto). */
  latestUserId: string | undefined
  /** Plano do turno corrente ainda em aberto. null = o último plano é de um
   *  turno anterior ou já fechou (terminal). */
  live: AgentPlan | null
}

/** Memo por IDENTIDADE do array de items. A derivação é O(N) sobre o fio
 *  inteiro e três lugares a pediam para o MESMO array no MESMO frame — o
 *  ChatPanel (plano vivo acima do composer), o MessageList (marcos no
 *  transcript) e o ContextPanel (aba Conversa). Rodava 2 a 3 vezes por token do
 *  streaming; agora o primeiro que chegar calcula e os outros consomem.
 *
 *  WeakMap e não cache de 1 entrada: a chave é o próprio array, então duas
 *  conversas na tela não brigam pelo slot, e a entrada morre junto com o array
 *  que o reducer descartou (sem despejo manual, sem vazamento).
 *
 *  Pré-condição do compartilhamento: a view é IMUTÁVEL para quem lê. Ninguém
 *  pode mutar `plans`/`tasks` depois (hoje todos só leem); mutar passaria a
 *  contaminar os outros consumidores em vez de a própria cópia. */
const planViewCache = new WeakMap<ChatItem[], TaskPlansView>()

export function taskPlansOf(items: ChatItem[]): TaskPlansView {
  const cached = planViewCache.get(items)
  if (cached) return cached
  const plans = deriveTaskPlans(items)
  const latestUserId = items.findLast((it) => it.kind === "user")?.id
  const latest = plans.at(-1)
  const view: TaskPlansView = {
    plans,
    latestUserId,
    live:
      latest && latest.turnId === latestUserId && latest.terminal == null
        ? latest
        : null,
  }
  planViewCache.set(items, view)
  return view
}

/** Checklist viva = somente o plano mais recente. Mantém a API histórica dos
 * consumidores que não precisam dos marcos de turnos anteriores. */
export function deriveTasks(items: ChatItem[]): AgentTask[] {
  return taskPlansOf(items).plans.at(-1)?.tasks ?? []
}
