// O QUE O SNAPSHOT DO CELULAR BUSCA POR FORA.
//
// Três carregamentos preguiçosos que o snapshot precisa e que o desktop só faz
// sob demanda: metas de conversa por projeto, especialistas globais e o par
// ledger + entregas (com TTL). Saíram do `lib/companion.ts` quando a catraca de
// tamanho disparou, e é recorte fechado: tudo aqui responde "de onde vem o dado
// que o snapshot não tem em mãos".
//
// Cada um avisa quando termina pelo `reagendar` que recebe: é o mesmo
// `schedulePush` do bridge, passado como parâmetro para este módulo não
// depender de volta do dono do ciclo.

import { listRecentDeliveries, loadLedger } from "@/lib/db"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { usePresets } from "@/store/presets"
import { EMPTY_EXTRAS, type CompanionExtras } from "@/lib/companionTypes"

/** Cache do ledger/entregas: re-lê o DB no máx. a cada 30s. */
const EXTRAS_TTL_MS = 30_000

let extrasCache: CompanionExtras = EMPTY_EXTRAS
let extrasAt = 0

/** O que o snapshot deve usar agora (o cache; vazio antes da primeira leitura). */
export function extrasAtuais(): CompanionExtras {
  return extrasCache
}

/** Volta ao estado de fábrica quando o bridge para. */
export function zerarExtras(): void {
  extrasCache = EMPTY_EXTRAS
  extrasAt = 0
  metasRequested.clear()
  specialistsRequested = false
}

/** Metas de conversa de TODOS os projetos, carregadas lazy (1x por projeto):
 *  o deskConvId do snapshot sai de conversationsByProject, mas o desktop só
 *  carrega metas sob demanda — sem este empurrão, projetos nunca abertos na
 *  sessão apareceriam sem mesa no celular. loadProjectConversations é no-op
 *  quando já carregado; o setState dela dispara novo push sozinho. */
const metasRequested = new Set<string>()
export function maybeLoadDeskMetas(): void {
  const chat = useChat.getState()
  for (const p of useApp.getState().projects) {
    if (metasRequested.has(p.id) || chat.conversationsByProject[p.id]) continue
    metasRequested.add(p.id)
    void chat.loadProjectConversations(p.id).catch(() => {
      metasRequested.delete(p.id) // falhou → tenta de novo no próximo push
    })
  }
}

/** Especialistas no snapshot (C2): garante os presets GLOBAIS carregados no
 *  store — headless, o CommandConsole (que faz o load no desktop) pode nunca
 *  montar. Só dispara quando o store ainda não carregou NADA (loaded false):
 *  nunca sobrescreve um load por-projeto já feito pela UI. Falhou → tenta de
 *  novo no próximo push. */
let specialistsRequested = false
export function maybeLoadSpecialists(): void {
  if (specialistsRequested || usePresets.getState().loaded) return
  specialistsRequested = true
  void usePresets
    .getState()
    .load(null)
    .catch(() => {
      specialistsRequested = false
    })
}

export function maybeRefreshExtras(reagendar: () => void): void {
  if (Date.now() - extrasAt < EXTRAS_TTL_MS) return
  extrasAt = Date.now()
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  void Promise.all([loadLedger(startOfToday.getTime()), listRecentDeliveries(6)])
    .then(([ledger, deliveries]) => {
      extrasCache = { ledger, deliveries }
      reagendar() // dados novos → re-empurra (dedupe segura se nada mudou)
    })
    .catch(() => {})
}
