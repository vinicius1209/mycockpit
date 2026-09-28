// ONDE cada pedido pendente é desenhado: inline no fluxo da conversa visível,
// ou no toast global do canto — nunca os dois ao mesmo tempo.
//
// Saiu de store/interactions.ts, que está 200+ linhas acima do teto e cresceu
// de novo com o gate de plano. O recorte é fechado: nada aqui é usado pela
// mecânica da fila (push/answer/dismiss), só por quem RENDERIZA.

import { useSyncExternalStore } from "react"
import type { InteractionRequest } from "@/lib/interaction"
import { ownerByRunId, useInteractions } from "@/store/interactions"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useMission } from "@/store/mission"

/** Split derivado por VISIBILIDADE: pedidos da conversa visível na tela saem
 *  do toast global e renderizam INLINE no fluxo (nunca os dois ao mesmo tempo). */
export interface ContextualSplit {
  /** Pedidos da conversa VISÍVEL (viewMode linear + !scheduledOpen + ativa). */
  inline: InteractionRequest[]
  /** Dona dos `inline` (o convId visível); null = nada inline. Guarda dos
   *  componentes: só a superfície DESSA conversa renderiza os cards. */
  inlineConvId: string | null
  /** O resto — toast global no canto, como sempre (conversa dona não-ativa,
   *  outros viewModes: painel/agendado, ou pedido sem dono
   *  resolvível: run órfão / sem run_id). */
  global: InteractionRequest[]
}

const EMPTY_SPLIT: ContextualSplit = { inline: [], inlineConvId: null, global: [] }

/** A conversa que está na tela: modo linear, sem Agendado, planos de voo ou
 *  Frota por cima. É a mesma régua para o card inline e para o sino marcar
 *  como visto (ADR-271). */
export function conversaVisivel(): string | null {
  const app = useApp.getState()
  return app.viewMode === "linear" && !app.scheduledOpen && !app.flightPlansOpen && !app.fleetOpen
    ? useChat.getState().activeId
    : null
}

/** Computa o split a partir dos stores (puro sobre getState; exportado p/
 *  teste). Painel/agendado ⇒ nenhuma conversa visível ⇒ tudo global. */
export function computeContextualSplit(): ContextualSplit {
  const queue = useInteractions.getState().queue
  if (queue.length === 0) return EMPTY_SPLIT
  const visible = conversaVisivel()
  if (!visible) return { inline: [], inlineConvId: null, global: queue }
  const chat = useChat.getState()
  const missions = useMission.getState()
  const inline: InteractionRequest[] = []
  const global: InteractionRequest[] = []
  for (const req of queue) {
    // dono SEM filtro de kind (`ownerByRunId`): a PERGUNTA também carrega run_id
    // (o backend anexa em todo pedido, ver approval.rs), então ela renderiza
    // inline na conversa dona igual à permissão. Antes toda pergunta caía no
    // toast global — inclusive a da conversa que estava aberta na sua frente,
    // que é justo o caso em que o card pertence ao fluxo e não ao canto da tela.
    const target = ownerByRunId(req, chat, missions)
    if (target?.convId === visible) inline.push(req)
    else global.push(req)
  }
  return {
    inline,
    inlineConvId: inline.length > 0 ? visible : null,
    global,
  }
}

function sameReqs(a: InteractionRequest[], b: InteractionRequest[]): boolean {
  return a.length === b.length && a.every((r, i) => r === b[i])
}

// Cache por VALOR (refs dos requests são estáveis na fila): o chat streamando
// dispara o subscribe a cada token, mas o snapshot devolve a MESMA ref se o
// split não mudou de membros — useSyncExternalStore não re-renderiza.
let splitCache: ContextualSplit = EMPTY_SPLIT

function splitSnapshot(): ContextualSplit {
  const next = computeContextualSplit()
  if (
    next === splitCache ||
    (next.inlineConvId === splitCache.inlineConvId &&
      sameReqs(next.inline, splitCache.inline) &&
      sameReqs(next.global, splitCache.global))
  ) {
    return splitCache
  }
  splitCache = next
  return next
}

function subscribeSplit(cb: () => void): () => void {
  const unsubs = [
    useInteractions.subscribe(cb),
    useApp.subscribe(cb),
    useChat.subscribe(cb),
    useMission.subscribe(cb),
  ]
  return () => {
    for (const u of unsubs) u()
  }
}

/** Seletor derivado das aprovações contextuais: {inline, global} com refs
 *  estáveis. Responder em qualquer host remove da fila (answer é síncrono no
 *  store) ⇒ o outro host nunca pisca o mesmo request. */
export function useContextualSplit(): ContextualSplit {
  return useSyncExternalStore(subscribeSplit, splitSnapshot)
}
