import type { AgentEvent } from "@/lib/agent"
import type { ChatItem } from "@/store/chat"
import type { DeferredWork } from "@/lib/work"

export type ToolTerminal = "cancelled" | "done"

/** Trabalhos diferidos ainda vivos no fio, derivados dos itens persistidos. */
export function pendingDeferred(items: ChatItem[]): DeferredWork[] {
  const out: DeferredWork[] = []
  for (const item of items) {
    if (item.kind === "tool" && item.deferred?.status === "running") {
      out.push(item.deferred)
    }
  }
  return out
}

/** Reconciles work that came from a persisted snapshot. A new app instance
 * cannot own an old process, and a tool without a result must not keep
 * presenting itself as active after hydration. */
export function settleOrphanedTool(item: ChatItem, now: number): ChatItem {
  if (item.kind !== "tool") return item
  if (item.deferred?.status === "running") {
    const message =
      "O aplicativo reiniciou com este trabalho em background em andamento; ele morreu junto com o processo do agent. Envie uma nova mensagem para retomar."
    return {
      ...item,
      deferred: { ...item.deferred, status: "interrupted", updatedAt: now },
      result: { ok: false, text: message, lines: 1, interrupted: true },
    }
  }
  if (
    item.managedProcess &&
    ["running", "stopping"].includes(item.managedProcess.status)
  ) {
    const message =
      "O aplicativo reiniciou e perdeu o controle deste processo. O PID histórico foi preservado para auditoria."
    return {
      ...item,
      managedProcess: { ...item.managedProcess, status: "orphaned", updatedAt: now },
      result: {
        ok: false,
        text: [item.managedProcess.output, message].filter(Boolean).join("\n"),
        lines: item.managedProcess.output.trim()
          ? item.managedProcess.output.split("\n").length + 1
          : 1,
      },
    }
  }
  if (item.result || item.managedProcess || item.deferred) return item
  return {
    ...item,
    result: {
      ok: false,
      text: "O aplicativo retomou esta conversa sem receber o desfecho desta ferramenta. O processo anterior não está mais sob controle.",
      lines: 1,
    },
    activityAt: now,
  }
}

/** Fecha ações sem resultado apenas no turno atual. Um terminal do runner não
 * pode deixar spinner vivo, mas também não sobrescreve resultado confirmado. */
export function settleTerminalTools(
  items: ChatItem[],
  terminal: ToolTerminal,
  now: number,
): ChatItem[] {
  const turnStart = items.findLastIndex((item) => item.kind === "user")
  let changed = false
  const next = items.map((item, index) => {
    if (index <= turnStart || item.kind !== "tool" || item.result) return item
    // Processo gerenciado pertence ao app, não ao turno: segue vivo após
    // a devolução da conversa (dev servers, watchers). Quem fecha é o registry.
    if (
      item.managedProcess &&
      (item.managedProcess.status === "running" || item.managedProcess.status === "stopping") &&
      terminal !== "cancelled"
    ) {
      return item
    }
    changed = true
    const message =
      terminal === "cancelled"
        ? "Você interrompeu o turno antes de esta ferramenta publicar um resultado."
        : item.deferred?.status === "running"
          ? "O processo do agent encerrou sem a conclusão deste trabalho em background. Envie uma nova mensagem para retomar."
          : "O processo do agent encerrou sem publicar o desfecho desta ferramenta."
    return {
      ...item,
      managedProcess: item.managedProcess
        ? {
            ...item.managedProcess,
            status: terminal === "cancelled" ? ("stopped" as const) : ("failed" as const),
            updatedAt: now,
          }
        : undefined,
      deferred:
        item.deferred?.status === "running"
          ? { ...item.deferred, status: "interrupted" as const, updatedAt: now }
          : item.deferred,
      result: {
        ok: false,
        text: message,
        lines: 1,
        // Corte seu não é falha: a ação PAROU (ADR-180). Trabalho em background
        // que encerra com o processo do runner também parou sem desfecho,
        // não é falha técnica da ferramenta (ADR-182). O fio diz "parou" em
        // cinza, nunca "erro" em vermelho.
        ...(terminal === "cancelled" || item.deferred?.status === "running"
          ? { interrupted: true as const }
          : {}),
      },
      activityAt: now,
    }
  })
  return changed ? next : items
}

/** Os dois terminais do runner sobre os itens. Saíram do `reduceItems` pela
 *  catraca e porque são uma regra só: nenhum terminal deixa spinner vivo.
 *  O motor só diz QUE parou; a causa, quando existe, veio do gesto (lib/corte).
 *  Sem causa, o marco não inventa uma e o item fica sem o campo. */
export function reduceTerminalEvent(
  items: ChatItem[],
  e: Extract<AgentEvent, { type: "cancelled" | "done" }>,
  now: number,
): { items?: ChatItem[]; streamingTextId: null } {
  if (e.type === "cancelled") {
    const marco: ChatItem = e.cause
      ? { kind: "cancelled", id: crypto.randomUUID(), ts: now, cause: e.cause }
      : { kind: "cancelled", id: crypto.randomUUID(), ts: now }
    return {
      items: [...settleTerminalTools(items, "cancelled", now), marco],
      streamingTextId: null,
    }
  }
  // EOF nunca deixa ferramenta ou trabalho diferido com spinner vivo.
  const settled = settleTerminalTools(items, "done", now)
  return settled === items
    ? { streamingTextId: null }
    : { streamingTextId: null, items: settled }
}

/** Processo marcado vivo no snapshot anterior não é desta instância: vira
 * órfão (PID e tail preservados), nunca "rodando". O mesmo com o trabalho
 * DIFERIDO do provider, que morreu junto com o CLI: `running` do disco vira
 * `interrupted` (deferred-work-plan D1.5). */
export const markOrphanedProcesses = (items: ChatItem[]): ChatItem[] =>
  items.map((item) => settleOrphanedTool(item, Date.now()))

