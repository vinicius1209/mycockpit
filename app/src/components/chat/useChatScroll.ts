import { useCallback, useEffect, useRef, useState } from "react"
import { useChat, type ChatItem } from "@/store/chat"

/**
 * Scroll e ANCORAGEM do fio.
 *
 * O que este hook tem que garantir: abrir uma conversa aterrissa no FIM, e
 * acompanhar o streaming não atropela quem subiu pra ler.
 *
 * A versão anterior errava nas duas pontas, e o motivo era um só — **ela
 * cancelava a aterrissagem por POSIÇÃO**:
 *
 *     if (!perto) anchoringRef.current = false   // dentro do onScroll
 *
 * Só que `scroll` dispara em reflow. Numa conversa longa, cada bloco de
 * markdown, cada diff e cada imagem que termina de medir empurra o conteúdo e
 * gera um evento em que a posição NÃO está perto do fim. O código lia isso como
 * "o humano subiu", desligava a âncora, e a conversa parava no meio — que é
 * exatamente o sintoma de abrir um fio longo e cair no lugar errado.
 *
 * As duas correções:
 *
 *  1. **Cancelar por GESTO, não por posição.** Só roda, touch e tecla de
 *     navegação significam "quero ler". Evento de scroll sem gesto é layout se
 *     acomodando, e layout não tem intenção.
 *  2. **A janela fecha quando o layout SOSSEGA**, não num prazo fixo. 800ms
 *     bastam pra um fio curto e não bastam pra um com imagem e diff; o que
 *     encerra é o silêncio do `ResizeObserver`, com teto pra nunca ancorar
 *     pra sempre.
 */

/** Distância do fim que ainda conta como "está no fim". */
export const PERTO_DO_FIM_PX = 80

/** Silêncio de reflow que encerra a aterrissagem. */
export const SILENCIO_DE_REFLOW_MS = 400

/** Teto duro: aterrissagem não dura pra sempre, mesmo com conteúdo que nunca
 *  para de medir (gif, iframe, imagem quebrada que tenta de novo). */
export const TETO_DE_ANCORAGEM_MS = 4000

export interface Medida {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}

export function pertoDoFim(m: Medida): boolean {
  return m.scrollHeight - m.scrollTop - m.clientHeight < PERTO_DO_FIM_PX
}

/**
 * A tecla significa "quero ler" (e não "quero acompanhar")?
 *
 * Seta pra baixo e End entram: quem navega pra baixo com o teclado também está
 * conduzindo a leitura, e ser puxado pelo autoscroll no meio disso é o mesmo
 * incômodo. O que fica de fora é digitação — ela acontece no composer, não aqui.
 */
export function ehGestoDeLeitura(key: string): boolean {
  return (
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "PageUp" ||
    key === "PageDown" ||
    key === "Home" ||
    key === "End"
  )
}

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
  // Espelho do estado pro efeito de autoscroll não depender DELE: com `atBottom`
  // na lista de deps, voltar pro fim disparava um `scrollTo` instantâneo que
  // matava a animação suave do botão "Rolar pro fim" no primeiro frame.
  const atBottomRef = useRef(true)
  const anchoringRef = useRef(false)

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    // SÓ mede. Cancelar aterrissagem aqui é o que confundia reflow com gesto.
    const perto = pertoDoFim(el)
    atBottomRef.current = perto
    setAtBottom(perto)
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    atBottomRef.current = true
    setAtBottom(true)
  }, [])

  // Gesto de leitura solta a âncora. Ouvido no container, em captura, porque o
  // alvo real pode ser qualquer filho (um bloco de código, uma imagem).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const soltar = () => {
      anchoringRef.current = false
    }
    const porTecla = (e: KeyboardEvent) => {
      if (ehGestoDeLeitura(e.key)) soltar()
    }
    el.addEventListener("wheel", soltar, { passive: true })
    el.addEventListener("touchmove", soltar, { passive: true })
    el.addEventListener("keydown", porTecla)
    return () => {
      el.removeEventListener("wheel", soltar)
      el.removeEventListener("touchmove", soltar)
      el.removeEventListener("keydown", porTecla)
    }
  }, [])

  // Autoscroll enquanto a conversa cresce. `atBottom` NÃO é dependência (ver o
  // espelho acima): o efeito responde a conteúdo novo, não a mudança de flag.
  const last = items[items.length - 1]
  const streamTick = last && last.kind === "text" ? last.text.length : 0
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (atBottomRef.current || anchoringRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" })
    }
  }, [items.length, streamTick, running])

  // Trocar de conversa (ou os itens chegarem do disco) aterrissa no fim.
  const vazio = items.length === 0
  useEffect(() => {
    atBottomRef.current = true
    setAtBottom(true)
    const el = scrollRef.current
    // A marca vem DEPOIS do guard: ligada antes, um container ainda não montado
    // deixava `anchoringRef` acesa pra sempre, sem cleanup que a apagasse.
    if (!el) return
    anchoringRef.current = true

    const land = () => {
      const atual = scrollRef.current
      if (!atual) return
      atual.scrollTo({ top: atual.scrollHeight, behavior: "auto" })
    }

    land()
    const rafId = requestAnimationFrame(land)

    let silencio = 0
    const encerrar = () => {
      anchoringRef.current = false
      ro.disconnect()
      window.clearTimeout(silencio)
      window.clearTimeout(teto)
    }
    const adiarEncerramento = () => {
      window.clearTimeout(silencio)
      silencio = window.setTimeout(encerrar, SILENCIO_DE_REFLOW_MS)
    }

    const ro = new ResizeObserver(() => {
      if (!anchoringRef.current) return
      // A conversa pode ter mudado no meio da janela: reancorar aqui jogaria a
      // rolagem da conversa NOVA pro fim da antiga.
      if (useChat.getState().activeId !== activeId) return
      land()
      adiarEncerramento()
    })

    if (el.firstElementChild) ro.observe(el.firstElementChild)
    ro.observe(el)

    const teto = window.setTimeout(encerrar, TETO_DE_ANCORAGEM_MS)
    adiarEncerramento()

    return () => {
      anchoringRef.current = false
      window.cancelAnimationFrame(rafId)
      ro.disconnect()
      window.clearTimeout(silencio)
      window.clearTimeout(teto)
    }
  }, [activeId, vazio])

  return { scrollRef, atBottom, onScroll, scrollToBottom, setAtBottom }
}
