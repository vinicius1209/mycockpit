// O gesto de citar (pílula ou menu do botão direito): a seleção de uma
// mensagem do fio vira citação no rascunho da conversa ativa (capricho PRD R3).

import { toast } from "sonner"
import { agentDef } from "@/lib/agents"
import { citacaoDoTrecho, TETO_DE_CITACOES } from "@/lib/citacao"
import { focusConsoleComposer } from "@/lib/focusComposer"
import { useChat } from "@/store/chat"
import { useComposerDrafts } from "@/store/composerDrafts"

export function citarTrecho(itemId: string, selecao: string): boolean {
  const chat = useChat.getState()
  const convId = chat.activeId
  const conv = convId ? chat.byId[convId] : undefined
  if (!convId || !conv) return false
  const item = conv.items.find((i) => i.id === itemId)
  // O autor é o motor da conversa: o fio não guarda motor por item de texto.
  const citacao = citacaoDoTrecho({
    itemId,
    autor: agentDef(conv.agent)?.label ?? conv.agent,
    ts: item?.ts ?? Date.now(),
    selecao,
  })
  if (!citacao) return false
  if (!useComposerDrafts.getState().addCitacao(convId, citacao)) {
    toast.error(`Até ${TETO_DE_CITACOES} citações por mensagem. Remova uma para citar outra.`)
    return false
  }
  window.getSelection()?.removeAllRanges()
  focusConsoleComposer()
  return true
}
