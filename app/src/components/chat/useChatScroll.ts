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
 * A correção, e ela vale pros dois problemas: **quem manda é a INTENÇÃO, não a
 * posição nem o relógio.**
 *
 *  1. **Só GESTO solta o fio.** Roda, toque e tecla de navegação significam
 *     "quero ler". Evento de scroll sem gesto é layout se acomodando, e layout
 *     não tem intenção.
 *  2. **Voltar ao fim volta a seguir.** É o gesto simétrico: descer até embaixo
 *     é dizer "de novo, me leva junto".
 *  3. **Seguir não tem prazo.** A primeira versão soltava depois de 800ms, e
 *     era por isso que o fio parava sozinho no meio de um turno: as linhas de
 *     ferramenta crescem DEPOIS (a tool chega, o bloco mede, o diff abre) e
 *     nenhuma delas é item novo. Quem acompanha esse crescimento é um
 *     `ResizeObserver` permanente — enquanto você não pedir pra parar, ele
 *     segura o fim.
 */

/** Distância do fim que ainda conta como "está no fim". */
export const PERTO_DO_FIM_PX = 80

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
  // "Me leva junto." Nasce ligado (abrir conversa é aterrissar no fim), morre
  // no primeiro gesto de leitura e renasce quando você volta pro fim.
  const seguindoRef = useRef(true)

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    // SÓ mede — e a única coisa que a posição LIGA é o seguir (chegar no fim é
    // pedir pra ser levado junto). Desligar por posição é o que confundia
    // reflow com gesto e parava o fio no meio do turno.
    const perto = pertoDoFim(el)
    atBottomRef.current = perto
    if (perto) seguindoRef.current = true
    setAtBottom(perto)
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    atBottomRef.current = true
    seguindoRef.current = true
    setAtBottom(true)
  }, [])

  // Gesto de leitura solta o fio. Ouvido no container porque o alvo real pode
  // ser qualquer filho (um bloco de código, uma imagem).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const soltar = () => {
      seguindoRef.current = false
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
    if (el && seguindoRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" })
    }
  }, [items.length, streamTick, running])

  // O observador PERMANENTE do crescimento.
  //
  // O efeito acima só acorda com item novo, e é aí que o fio escapava: a linha
  // de ferramenta chega como um item e CRESCE depois (o resultado volta, o
  // bloco mede, o diff abre). Sem isto, cada uma dessas alturas empurrava a
  // conversa e o fim escorregava pra fora da tela no meio do turno.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      if (!seguindoRef.current) return
      const atual = scrollRef.current
      if (atual) atual.scrollTo({ top: atual.scrollHeight, behavior: "auto" })
    })
    // O primeiro filho é o conteúdo (é ele que cresce); o container cobre
    // redimensionamento de janela e abertura de painel.
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Trocar de conversa (ou os itens chegarem do disco) aterrissa no fim e
  // volta a seguir. Não há mais janela de ancoragem com prazo: quem segura o
  // fim durante os reflows é o observador acima, e ele só solta por gesto seu.
  const vazio = items.length === 0
  useEffect(() => {
    atBottomRef.current = true
    seguindoRef.current = true
    setAtBottom(true)
    const el = scrollRef.current
    if (!el) return
    const land = () => {
      const atual = scrollRef.current
      if (!atual) return
      // A conversa pode ter trocado entre o agendamento e o frame: aterrissar
      // aqui jogaria a rolagem da conversa NOVA pro fim medido da antiga.
      if (useChat.getState().activeId !== activeId) return
      atual.scrollTo({ top: atual.scrollHeight, behavior: "auto" })
    }
    land()
    const rafId = requestAnimationFrame(land)
    return () => window.cancelAnimationFrame(rafId)
  }, [activeId, vazio])

  return { scrollRef, atBottom, onScroll, scrollToBottom, setAtBottom }
}
