// Aprovações em LOTE (frente P4): agrupamento por ASSINATURA + confirmação
// explícita. Funções PURAS (testáveis sem UI); a execução real é o
// `answerGroup` da fila (`store/interactions`). Saiu de lá pela catraca de
// tamanho (ADR-261).

import type { ApprovalData, InteractionRequest } from "@/lib/interaction"


/** Assinatura de agrupamento de UMA aprovação: tool_name + comando EXATO (só
 *  trim nas pontas — "bun test" ≠ "rm -rf", e também ≠ "bun  test"; normalizar
 *  demais aprovaria comando que o usuário não leu). Tools sem comando (Write
 *  etc.) usam o input serializado — "idêntica" tem que ser idêntica MESMO.
 *  Questions e kinds desconhecidos NUNCA agrupam ⇒ null. */
export function approvalSignature(req: InteractionRequest): string | null {
  if (req.kind !== "approval") return null
  const d = req.data as Partial<ApprovalData> | null | undefined
  const tool = typeof d?.tool_name === "string" ? d.tool_name.trim() : ""
  if (!tool) return null
  const cmd = typeof d?.command === "string" ? d.command.trim() : ""
  if (cmd) return `${tool}\u0000cmd\u0000${cmd}`
  try {
    return `${tool}\u0000input\u0000${JSON.stringify(d?.input ?? null)}`
  } catch {
    return null // input cíclico/não-serializável: não agrupa (fail-safe)
  }
}

/** Grupo pendente do request na fila (ele incluso). <2 ⇒ sem lote na UI. */
export function pendingGroup(
  queue: InteractionRequest[],
  req: InteractionRequest,
): InteractionRequest[] {
  const sig = approvalSignature(req)
  if (!sig) return []
  return queue.filter((r) => approvalSignature(r) === sig)
}

/** Confirmação pendente de um lote (o que o card mostra antes de executar). */
export interface BatchConfirm {
  signature: string
  allow: boolean
  count: number
}

export type BatchAction =
  | { type: "request"; confirm: BatchConfirm }
  | { type: "confirm" }
  | { type: "cancel" }

/** Decisão PURA do fluxo "Aprovar/Negar todas": clicar NUNCA executa direto —
 *  vira uma confirmação pendente (comando + contagem na tela); só o clique de
 *  confirmar com uma pendência ativa produz `execute`. */
export function decideBatch(
  pending: BatchConfirm | null,
  action: BatchAction,
): {
  pending: BatchConfirm | null
  execute: { signature: string; allow: boolean } | null
} {
  switch (action.type) {
    case "request":
      return { pending: action.confirm, execute: null }
    case "confirm":
      return pending
        ? {
            pending: null,
            execute: { signature: pending.signature, allow: pending.allow },
          }
        : { pending: null, execute: null }
    case "cancel":
      return { pending: null, execute: null }
  }
}

