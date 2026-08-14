// MARCOS que a missão grava no fio da conversa (pendência M2 do
// docs/mission-mode.md): a missão roda em memória (store/mission byConv), então
// sem gravar nada a conversa reabria VAZIA após restart. Gravamos nos MARCOS
// (launch/fase/gate/recovery/fim) via useChat.appendItems — barato e legível,
// não é o transcript pleno das fases.
//
// Extraído de store/mission.ts sem mudança de comportamento (a catraca de
// tamanho cobrou a divisão do arquivo).

import type { MissionIndexRow } from "@/lib/db"
import type { MissionRun } from "@/lib/missionTypes"
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

/** A LINHA de índice da missão no banco (tabela `missions`): disco guarda os
 *  artefatos, banco guarda o índice durável e navegável. Pura — o store só
 *  entrega o run e o dono, e cuida do fire-and-forget. */
export function missionIndexRow(
  run: MissionRun,
  convId: string,
  projectId: string,
): MissionIndexRow {
  return {
    id: run.id,
    slug: run.dir.slice(run.dir.lastIndexOf("/") + 1),
    dir: run.dir,
    convId,
    projectId,
    task: run.task,
    presetName: run.presetName,
    status: run.status,
    costTotal: run.costTotal,
    phaseCurrent: run.current,
    phaseCount: run.phases.length,
    // audit trail: "done" com ressalva fica visível no histórico, não só na
    // memória do run (MH1.1).
    reviewCaveat: run.reviewCaveat ?? null,
    createdAt: run.startedAt,
    updatedAt: Date.now(),
  }
}
