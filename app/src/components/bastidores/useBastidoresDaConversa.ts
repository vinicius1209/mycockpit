// A lista de Bastidores da conversa ativa, a mesma para a aba do painel direito
// (índice) e para o painel de vistas ao lado da conversa (ADR-200).

import { useMemo } from "react"
import { bastidoresDaConversa, type Bastidor } from "@/lib/bastidores"
import { chaveDaSaida, useBastidores } from "@/store/bastidores"
import { useChat, type ChatItem } from "@/store/chat"

const SEM_ITENS: ChatItem[] = []

export interface BastidoresDaConversa {
  convId: string | null
  items: ChatItem[]
  lista: Bastidor[]
}

export function useBastidoresDaConversa(): BastidoresDaConversa {
  const convId = useChat((s) => s.activeId)
  const items = useChat((s) => (convId ? s.byId[convId]?.items : undefined)) ?? SEM_ITENS
  const saidas = useBastidores((s) => s.saidas)
  const prefixo = convId ? chaveDaSaida(convId, "") : null
  const comStream = useMemo(() => {
    const ids = new Set<string>()
    if (!prefixo) return ids
    for (const chave of Object.keys(saidas)) {
      if (chave.startsWith(prefixo)) ids.add(chave.slice(prefixo.length))
    }
    return ids
  }, [saidas, prefixo])
  const lista = useMemo(() => bastidoresDaConversa(items, comStream), [items, comStream])
  return { convId, items, lista }
}
