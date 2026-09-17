// A lista de Bastidores da conversa ativa, a mesma para a aba do painel direito
// (índice) e para o painel de vistas ao lado da conversa (ADR-200).

import { useEffect, useMemo, useState } from "react"
import { COMANDO_LONGO_MS, bastidoresDaConversa, type Bastidor } from "@/lib/bastidores"
import { chaveDaSaida, useBastidores } from "@/store/bastidores"
import { useChat, type ChatItem } from "@/store/chat"

const SEM_ITENS: ChatItem[] = []

export interface BastidoresDaConversa {
  convId: string | null
  items: ChatItem[]
  lista: Bastidor[]
}

/** Quanto falta para o comando vivo mais novo ficar "longo", ou null. Puro. */
export function proximoComandoLongo(items: ChatItem[], agora: number): number | null {
  let falta: number | null = null
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]
    if (it.kind !== "tool" || it.result || it.name !== "Bash" || !it.ts) continue
    const resta = it.ts + COMANDO_LONGO_MS - agora
    if (resta > 0) falta = falta == null ? resta : Math.min(falta, resta)
  }
  return falta
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
  // Um comando que ainda não fez COMANDO_LONGO_MS entra sozinho quando fizer:
  // um timeout só, para o mais novo, e nenhum relógio quando não há o que medir.
  const [tique, setTique] = useState(0)
  useEffect(() => {
    const falta = proximoComandoLongo(items, Date.now())
    if (falta == null) return
    const id = setTimeout(() => setTique((n) => n + 1), falta + 50)
    return () => clearTimeout(id)
  }, [items, tique])
  const lista = useMemo(
    () => bastidoresDaConversa(items, comStream, Date.now()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tique` é o relógio do comando que ficou longo
    [items, comStream, tique],
  )
  return { convId, items, lista }
}
