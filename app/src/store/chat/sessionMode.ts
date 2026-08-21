// O MODO desta conversa (docs/modos-de-sessao-plan.md, M3).
//
// Extraído de store/chat.ts (no teto do ratchet), mesmo padrão de clone.ts,
// notes.ts, remove.ts e planGate.ts.
//
// O que o M3 mudou de escopo: antes o controle do composer alterava a permissão
// do PROJETO — todas as conversas dele junto — sem nunca dizer isso. Agora o
// modo é da conversa e o projeto é o DEFAULT de quem não decidiu; gravar esse
// default virou gesto próprio no menu.
//
// E o modo PERSISTE (migração 37). O antigo `planFirst` só vivia em memória:
// ligar "Planejar", fechar o app e reabrir desligava sozinho — a mesma classe
// de sumiço silencioso do `pendingPlan` (ADR-056).

import type { ChatState } from "@/store/chat"
import type { SessionMode } from "@/lib/sessionMode"

type Get = () => ChatState
type Set = (fn: (s: ChatState) => Partial<ChatState>) => void

/**
 * Define o modo desta conversa. `null` = volta a HERDAR o projeto — e é isso
 * que aprovar o plano faz, em vez de chutar um valor: quem trabalha em "Só lê"
 * não pode sair do planejamento em "Pede" sem ter pedido.
 */
export function setSessionModeImpl(
  get: Get,
  set: Set,
  convId: string,
  mode: SessionMode | null,
) {
  let mudou = false
  set((s) => {
    const cur = s.byId[convId]
    // Referência preservada quando nada muda: é ela que segura o `memo` por
    // item do fio, e um modo regravado igual não pode re-renderizar markdown.
    if (!cur || (cur.sessionMode ?? null) === mode) return {}
    mudou = true
    return { byId: { ...s.byId, [convId]: { ...cur, sessionMode: mode } } }
  })
  if (mudou) void get().persist(convId)
}
