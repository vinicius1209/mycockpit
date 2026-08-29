import { useCallback, useEffect, useRef, useState } from "react"
import { useChat, type ChatItem } from "@/store/chat"

/**
 * Hook de gerenciamento de scroll e ancoragem do transcript de conversa.
 *
 * Garante que:
 *  - Ao trocar de conversa ou carregar itens do DB, a visualização aterrissa
 *    imediatamente no final (última mensagem) sem ser enganada por reflows
 *    intermediários de markdown, diffs ou imagens.
 *  - O autoscroll acompanha o streaming de tokens sem interromper a leitura manual
 *    do usuário caso ele tenha subido o scroll.
 */
export function useChatScroll({
  activeId,
  items,
  running,
}: {
  activeId: string | null
  items: ChatItem[]
  running: boolean
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const anchoringRef = useRef(false)

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const perto = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    // Quem SUBIU pra ler encerra a aterrissagem na hora. Antes este ramo
    // forçava `atBottom = true` durante toda a janela de ancoragem, e o gesto
    // de leitura era desfeito pelo autoscroll no token seguinte — a regra do
    // "não puxa de volta" valia pra todo mundo menos nos 800ms em que ela mais
    // importa (logo depois de abrir a conversa).
    if (!perto) anchoringRef.current = false
    setAtBottom(perto)
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    setAtBottom(true)
  }, [])

  // Autoscroll conforme a conversa cresce (streaming de tokens / novas tools)
  const last = items[items.length - 1]
  const streamTick = last && last.kind === "text" ? last.text.length : 0
  useEffect(() => {
    const el = scrollRef.current
    if (el && atBottom) el.scrollTo({ top: el.scrollHeight, behavior: "auto" })
  }, [items.length, streamTick, running, atBottom])

  // Ao trocar de conversa ou carregar itens do DB pela 1ª vez na conversa ativa,
  // aterrissa no fim com ancoragem protegida contra reflows assíncronos (markdown, diffs, imagens).
  const vazio = items.length === 0
  useEffect(() => {
    setAtBottom(true)
    const el = scrollRef.current
    // A marca vem DEPOIS do guard: ligada antes, um container ainda não montado
    // deixava `anchoringRef` acesa pra sempre, sem cleanup que a apagasse.
    if (!el) return
    anchoringRef.current = true

    const land = () => {
      if (!scrollRef.current) return
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "auto" })
    }

    land()
    const rafId = requestAnimationFrame(land)

    const ro = new ResizeObserver(() => {
      // `anchoringRef` desliga no primeiro gesto de leitura (ver `onScroll`):
      // sem esta linha o observer continuava reancorando por cima de quem subiu.
      if (!anchoringRef.current) return
      if (useChat.getState().activeId === activeId) land()
    })

    if (el.firstElementChild) ro.observe(el.firstElementChild)
    ro.observe(el)

    const stop = window.setTimeout(() => {
      anchoringRef.current = false
      ro.disconnect()
    }, 800)

    return () => {
      anchoringRef.current = false
      window.cancelAnimationFrame(rafId)
      ro.disconnect()
      window.clearTimeout(stop)
    }
  }, [activeId, vazio])

  return { scrollRef, atBottom, onScroll, scrollToBottom, setAtBottom }
}
