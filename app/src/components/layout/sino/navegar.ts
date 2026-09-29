// Para onde cada linha do sino leva. O pedido mora na conversa que pediu
// (ADR-261); o sino aponta, não responde.

import { openCardConversation } from "@/store/cards"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useInteractions } from "@/store/interactions"
import { useMission } from "@/store/mission"
import { avisar } from "@/lib/avisos"
import { conversasQuePedem, proximaQuePede } from "@/lib/proximaQuePede"
import type { Decision } from "@/lib/inbox"
import type { Espera } from "@/lib/sino/esperando"

export async function abrirConversa(projectId: string, convId?: string) {
  const app = useApp.getState()
  if (projectId) app.setActiveProject(projectId)
  // Navegar até a conversa fecha o Agendado, como a sidebar faz.
  app.setScheduledOpen(false)
  if (projectId) await useChat.getState().openProject(projectId)
  if (convId) await useChat.getState().switchConversation(convId)
  app.setViewMode("linear")
}

/** A decisão abre onde ela mora: a conversa da disputa, a do card, ou a fila
 *  da faixa (proposta, e card sem conversa ligada). */
export async function abrirDecisao(d: Decision) {
  const app = useApp.getState()
  if (d.kind === "proposal") {
    if (d.projectId) app.setActiveProject(d.projectId)
    app.setDecisionsOpen(true)
    return
  }
  if (d.kind === "fusion") return abrirConversa(d.projectId, d.convId)
  app.setActiveProject(d.projectId)
  if (!(await openCardConversation(d.cardId))) app.setDecisionsOpen(true)
}

/** Pedido de sessão no terminal não tem conversa: o cartão dele já está no
 *  canto da tela, e fechar o sino basta. */
export function abrirEspera(e: Espera, abrirMotor: (agent: string) => void) {
  if (e.tipo === "ferramenta") return abrirMotor(e.agent)
  if (e.tipo === "decisao") return void abrirDecisao(e.decisao)
  if (e.convId) return void abrirConversa(e.projectId, e.convId)
}

/** "Próxima que pede você" (⌘⇧A e ⌘K): abre a conversa com pedido pendente
 *  que espera há mais tempo e, repetido, a seguinte. */
export function irParaProximaQuePede() {
  const chat = useChat.getState()
  const conversas = conversasQuePedem(useInteractions.getState().queue, chat, useMission.getState())
  const alvo = proximaQuePede(conversas, chat.activeId)
  if (!alvo) {
    avisar.nota("Nenhuma conversa pede você agora")
    return
  }
  void abrirConversa(alvo.projectId, alvo.convId)
}
