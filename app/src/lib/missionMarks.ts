// MARCOS que a missão grava no fio da conversa (pendência M2 do
// docs/mission-mode.md): a missão roda em memória (store/mission byConv), então
// sem gravar nada a conversa reabria VAZIA após restart. Gravamos nos MARCOS
// (launch/fase/gate/recovery/fim) via useChat.appendItems — barato e legível,
// não é o transcript pleno das fases.
//
// Extraído de store/mission.ts sem mudança de comportamento (a catraca de
// tamanho cobrou a divisão do arquivo).

import { useChat, type ChatItem } from "@/store/chat"

/** Tamanho máx. do resumo de fase gravado na conversa (o transcript inteiro
 *  não cabe e não é o objetivo dos marcos). */
export const PHASE_SUMMARY_MAX = 2000

/** Trunca o resumo de fase no teto (com reticências). */
export function summarize(text: string): string {
  return text.length > PHASE_SUMMARY_MAX
    ? `${text.slice(0, PHASE_SUMMARY_MAX)}…`
    : text
}

export function noticeItem(message: string): ChatItem {
  return { kind: "notice", id: crypto.randomUUID(), message }
}

/** Grava itens de MARCO no fio da conversa. BEST-EFFORT: falha de persistência
 *  NUNCA derruba a missão (o run em memória segue sendo a fonte da timeline);
 *  o appendItems já no-opa se a conversa não está carregada (launcher garante). */
export async function recordHistory(
  convId: string,
  items: ChatItem[],
): Promise<void> {
  try {
    await useChat.getState().appendItems(convId, items)
  } catch (err) {
    console.warn("[missão] falha ao gravar histórico na conversa:", err)
  }
}
