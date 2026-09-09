// Desfecho do ÚLTIMO turno de executor de uma conversa.
//
// Existe separado do store porque é uma régua PURA, lida por duas superfícies
// que precisam concordar: o composer (destrava o seletor de modelo) e o
// despacho (aceita o modelo trocado). Régua duplicada aqui significaria a UI
// oferecendo uma escolha que o envio descartaria em silêncio.

import type { Attachment } from "@/lib/attachments"
import { executorItems, type ChatItem } from "@/store/chat"

export interface ExecutorTurnOutcome {
  kind: "succeeded" | "failed"
  terminalId: string
}

export interface PendingExecutorRequest {
  index: number
  text: string
  attachments: Attachment[]
}

/** Desfecho comprovado do último turno de executor. Texto/tool/notice no fim
 * não é terminal e portanto não autoriza a UI a afirmar sucesso ou falha. */
export function lastExecutorTurnOutcome(
  items: ChatItem[],
): ExecutorTurnOutcome | null {
  const last = executorItems(items).at(-1)
  if (!last) return null
  if (last.kind === "error" || last.kind === "limit") {
    return { kind: "failed", terminalId: last.id }
  }
  if (last.kind === "result") {
    return {
      kind: last.ok ? "succeeded" : "failed",
      terminalId: last.id,
    }
  }
  return null
}

/** Último pedido dirigido ao executor. Consultas a Especialistas aparecem no
 * mesmo fio, mas não podem substituir o trabalho que ficou pendente. */
export function pendingExecutorRequest(
  items: ChatItem[],
): PendingExecutorRequest | null {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]
    if (item.kind !== "user" || item.advisorTo) continue
    return {
      index,
      text: item.text,
      attachments: item.attachments ?? [],
    }
  }
  return null
}

/** O último turno de EXECUTOR terminou em falha (erro do CLI/adapter ou teto de
 *  uso)? É a condição da SAÍDA DE EMERGÊNCIA: a identidade da conversa trava no
 *  1º envio, e quando é o próprio MODELO que mata o turno (slug inválido,
 *  modelo sem acesso, teto da conta) a conversa virava um beco — reenviar
 *  repetia o mesmo erro e a única saída era trocar de AGENT no card do
 *  incidente, jogando fora a escolha de modelo. Turno que falhou destrava o
 *  MODELO; o agent segue travado (trocar de motor é handoff, com sessão nova).
 *
 *  Olha só o ÚLTIMO: conversa que se recuperou não está em emergência. Pareceres
 *  de conselheiro não contam (não são turno de executor, Especialistas E1), então
 *  consultar alguém sobre o erro não fecha a saída. */
export function lastExecutorTurnFailed(items: ChatItem[]): boolean {
  return lastExecutorTurnOutcome(items)?.kind === "failed"
}
