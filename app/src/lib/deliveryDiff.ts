// P3 — Entrega → diff em 1 clique. O gesto do boss: clicar numa ENTREGA
// (Central · Entregas recentes, ou o strip de result na conversa) navega até a
// conversa E abre o painel de Alterações com o diff do worktree + header de
// correção ("Pedir correção" / "Fechar"). Sem worktree ou diff vazio ⇒ toast
// honesto — nada de painel vazio fingindo entrega de código.

import { toast } from "sonner"
import { isTauri } from "@/lib/db"
import { loadGitDiff } from "@/lib/git"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

export const NO_DIFF_MESSAGE = "Sem mudanças de código nesta entrega."

/** Tamanho máximo do trecho da entrega citado no prefill de correção. */
export const FIX_PREFILL_MAX = 140

/** Prefill do composer ao "Pedir correção": cita a 1ª linha da entrega
 *  (truncada) e deixa o cursor pronto pro pedido. */
export function fixPrefill(deliveryText: string): string {
  const line = deliveryText.trim().split("\n")[0] ?? ""
  const excerpt =
    line.length > FIX_PREFILL_MAX ? `${line.slice(0, FIX_PREFILL_MAX - 1)}…` : line
  return `Sobre a entrega: ${excerpt}\nCorrija: `
}

/** Executa o gesto. `projectId` presente = clique veio de FORA do Trabalho
 *  (Central do Boss): navega projeto→conversa→Trabalho antes de abrir o diff.
 *  Retorna true quando o diff abriu de fato (intenção emitida). */
export async function openDeliveryDiff(opts: {
  convId: string
  text: string
  projectId?: string
}): Promise<boolean> {
  const app = useApp.getState()
  if (opts.projectId) {
    app.setActiveProject(opts.projectId)
    await useChat.getState().openProject(opts.projectId)
    await useChat.getState().switchConversation(opts.convId)
    useApp.getState().setViewMode("linear")
  }
  // Gate honesto — só no app (no browser/sim não existe git pra consultar):
  // entrega sem worktree isolado, ou com working tree limpa, não tem diff.
  if (isTauri()) {
    const worktree = useChat.getState().byId[opts.convId]?.worktreePath ?? null
    if (!worktree) {
      toast(NO_DIFF_MESSAGE)
      return false
    }
    const diff = await loadGitDiff(worktree)
    if (!diff.isRepo || diff.files.length === 0) {
      toast(NO_DIFF_MESSAGE)
      return false
    }
  }
  const cur = useApp.getState()
  if (!cur.contextOpen) cur.toggleContext()
  cur.requestDeliveryDiff(opts.convId, opts.text)
  return true
}
