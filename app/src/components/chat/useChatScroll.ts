import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useChat, type ChatItem } from "@/store/chat"

/**
 * Scroll e ANCORAGEM do fio.
 *
 * O que este hook tem que garantir: abrir uma conversa aterrissa no FIM, e
 * acompanhar o streaming não atropela quem subiu pra ler.
 *
 * A versão anterior errava nas duas pontas, e o motivo era um só: ela
 * cancelava a aterrissagem por POSIÇÃO:
 *
 *     if (!perto) anchoringRef.current = false   // dentro do onScroll
 *
 * Só que `scroll` dispara em reflow. Numa conversa longa, cada bloco de
 * markdown, cada diff e cada imagem que termina de medir empurra o conteúdo e
 * gera um evento em que a posição NÃO está perto do fim. O código lia isso como
 * "o humano subiu", desligava a âncora, e a conversa parava no meio, que é
 * exatamente o sintoma de abrir um fio longo e cair no lugar errado.
 *
 * A correção, e ela vale pros dois problemas: quem manda é a INTENÇÃO, não a
 * posição nem o relógio.
 *
 *  1. Só GESTO solta o fio. Roda para cima, toque para cima e teclas de
 *     navegação significam "quero ler". Evento de scroll sem gesto é layout se
 *     acomodando, e layout não tem intenção.
 *  2. Voltar ao fim volta a seguir. É o gesto simétrico: descer até embaixo
 *     é dizer "de novo, me leva junto".
 *  3. Seguir não tem prazo. A primeira versão soltava depois de 800ms, e
 *     era por isso que o fio parava sozinho no meio de um turno: as linhas de
 *     ferramenta crescem DEPOIS (a tool chega, o bloco mede, o diff abre) e
 *     nenhuma delas é item novo. Quem acompanha esse crescimento é um
 *     `ResizeObserver` permanente; enquanto você não pedir pra parar, ele
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
 * O fio está escondido (outra aba da tira à vista, host em `display: none`)?
 * Sem layout, a medida não diz nada sobre leitura: o scroll zera e a altura
 * vira 0. Puro.
 */
export function escondido(m: Pick<Medida, "clientHeight">): boolean {
  return m.clientHeight === 0
}

/**
 * Onde o fio fica ao reaparecer. Quem seguia volta ao fim; quem tinha subido
 * pra ler volta onde estava. Pedido de 24/09/2026: fechar o arquivo com ⌘W
 * devolvia a conversa no COMEÇO, porque o WebKit descarta a rolagem de quem
 * fica em `display: none`. Puro.
 */
export function rolagemAoReaparecer(
  seguindo: boolean,
  guardada: number | null,
  scrollHeight: number,
): number | null {
  return seguindo ? scrollHeight : guardada
}

/**
 * A tecla significa "quero ler" (e não "quero acompanhar")?
 *
 * Seta pra baixo e End entram: quem navega pra baixo com o teclado também está
 * conduzindo a leitura, e ser puxado pelo autoscroll no meio disso é o mesmo
 * incômodo. O que fica de fora é digitação: ela acontece no composer, não aqui.
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

/**
 * O movimento da roda ou toque significa intenção de ler o passado (subir)?
 */
export function ehGestoDeSubida(deltaY: number): boolean {
  return deltaY < 0
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
  const [contentEl, setContentEl] = useState<HTMLDivElement | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  // Espelho do estado pro efeito de autoscroll não depender DELE: com `atBottom`
  // na lista de deps, voltar pro fim disparava um `scrollTo` instantâneo que
  // matava a animação suave do botão "Rolar pro fim" no primeiro frame.
  const atBottomRef = useRef(true)
  // "Me leva junto." Nasce ligado (abrir conversa é aterrissar no fim), morre
  // no primeiro gesto de leitura e renasce quando você volta pro fim.
  const seguindoRef = useRef(true)
  // Onde o fio estava da última vez que foi visto, e se está visível agora:
  // é o que devolve a leitura quando outra aba da tira sai da frente.
  const posicaoRef = useRef<number | null>(null)
  const visivelRef = useRef(true)
  // O disclosure das ferramentas consulta a mesma intenção no scroller. Sem
  // isso ele voltaria a inferi-la por posição durante um reflow.
  const setFollowing = useCallback((value: boolean) => {
    seguindoRef.current = value
    const el = scrollRef.current
    if (el) el.dataset.threadFollowing = String(value)
  }, [])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    // Escondido, o scroll que chega é o WebKit zerando a rolagem, não leitura.
    if (escondido(el)) return
    posicaoRef.current = el.scrollTop
    // SÓ mede; e a única coisa que a posição LIGA é o seguir (chegar no fim é
    // pedir pra ser levado junto). Desligar por posição é o que confundia
    // reflow com gesto e parava o fio no meio do turno.
    const perto = pertoDoFim(el)
    atBottomRef.current = perto
    if (perto) setFollowing(true)
    setAtBottom(perto)
  }, [setFollowing])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    atBottomRef.current = true
    setFollowing(true)
    setAtBottom(true)
  }, [setFollowing])

  // Enviar é um gesto explícito de voltar ao presente. Diferente do botão
  // "Rolar pro fim", aqui o salto é imediato: o item do humano entra logo
  // depois e o efeito de crescimento precisa encontrá-lo já ancorado.
  const followLatest = useCallback(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "auto" })
    atBottomRef.current = true
    setFollowing(true)
    setAtBottom(true)
  }, [setFollowing])

  // Gesto de leitura solta o fio. Ouvido no container porque o alvo real pode
  // ser qualquer filho (um bloco de código, uma imagem).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const soltar = () => {
      setFollowing(false)
    }

    const onWheel = (e: WheelEvent) => {
      // Subir (deltaY < 0) é intenção explícita de leitura no passado: solta o fio.
      if (ehGestoDeSubida(e.deltaY)) {
        soltar()
      } else if (e.deltaY > 0) {
        // Descer (deltaY > 0) vai em direção ao presente. Se já está ou chegou perto
        // do fim, religa o seguimento (evita que inércia ou micro-scrolls no Mac
        // soltem o fio indevidamente).
        if (pertoDoFim(el)) {
          atBottomRef.current = true
          setFollowing(true)
          setAtBottom(true)
        }
      }
    }

    let touchStartY = 0
    const onTouchStart = (e: TouchEvent) => {
      touchStartY = e.touches[0]?.clientY ?? 0
    }
    const onTouchMove = (e: TouchEvent) => {
      const currentY = e.touches[0]?.clientY ?? 0
      const deltaY = touchStartY - currentY
      if (deltaY < 0) {
        // Arrastou o dedo para baixo (conteúdo subiu para ver o passado)
        soltar()
      } else if (deltaY > 0) {
        // Arrastou o dedo para cima (conteúdo desceu para ver o presente)
        if (pertoDoFim(el)) {
          atBottomRef.current = true
          setFollowing(true)
          setAtBottom(true)
        }
      }
      touchStartY = currentY
    }

    const porTecla = (e: KeyboardEvent) => {
      if (ehGestoDeLeitura(e.key)) soltar()
    }

    el.addEventListener("wheel", onWheel, { passive: true })
    el.addEventListener("touchstart", onTouchStart, { passive: true })
    el.addEventListener("touchmove", onTouchMove, { passive: true })
    el.addEventListener("keydown", porTecla)
    return () => {
      el.removeEventListener("wheel", onWheel)
      el.removeEventListener("touchstart", onTouchStart)
      el.removeEventListener("touchmove", onTouchMove)
      el.removeEventListener("keydown", porTecla)
    }
  }, [setFollowing])

  // Autoscroll enquanto a conversa cresce. `atBottom` NÃO é dependência (ver o
  // espelho acima): o efeito responde a conteúdo novo, não a mudança de flag.
  const last = items[items.length - 1]
  const streamTick = last && last.kind === "text" ? last.text.length : 0
  const lastKey = last
    ? last.kind === "text"
      ? `${last.id}:${last.text.length}`
      : last.kind === "tool"
        ? `${last.id}:${last.activityAt ?? 0}:${last.result ? "done" : "run"}`
        : `${last.id}:${last.kind}`
    : ""
  useEffect(() => {
    const el = scrollRef.current
    if (el && seguindoRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "auto" })
    }
  }, [items.length, streamTick, lastKey, running])

  // O observador PERMANENTE do crescimento.
  //
  // O efeito acima só acorda com item novo, e é aí que o fio escapava: a linha
  // de ferramenta chega como um item e CRESCE depois (o resultado volta, o
  // bloco mede, o diff abre). Sem isto, cada uma dessas alturas empurrava a
  // conversa e o fim escorregava pra fora da tela no meio do turno.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !contentEl) return
    const ro = new ResizeObserver(() => {
      const atual = scrollRef.current
      // O callback pode ter sido enfileirado antes da troca de conversa.
      if (!atual || useChat.getState().activeId !== activeId) return
      const visivel = !escondido(atual)
      const reapareceu = visivel && !visivelRef.current
      visivelRef.current = visivel
      if (!visivel) return
      if (seguindoRef.current) {
        atual.scrollTo({ top: atual.scrollHeight, behavior: "auto" })
        return
      }
      if (!reapareceu) return
      const alvo = rolagemAoReaparecer(false, posicaoRef.current, atual.scrollHeight)
      if (alvo !== null) atual.scrollTop = alvo
    })
    // Observa o wrapper EXATO do transcript. `firstElementChild` não serve:
    // a régua de turnos e a timeline podem vir antes dele, e na troca o wrapper
    // keyed é substituído. O callback-ref entrega o nó novo e religa este efeito.
    ro.observe(contentEl)
    ro.observe(el)
    return () => ro.disconnect()
  }, [activeId, contentEl])

  // Ao trocar de conversa: aterrissa no fim de imediato (no mesmo commit, antes do paint)
  // para que a nova conversa nunca apareça na posição de rolagem da anterior.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = true
    posicaoRef.current = null
    setFollowing(true)
    setAtBottom(true)
    el.scrollTop = el.scrollHeight
  }, [activeId, setFollowing])

  // Trocar de conversa (ou os itens chegarem do disco) aterrissa no fim e
  // volta a seguir. Acompanha os primeiros frames de layout após o paint.
  const vazio = items.length === 0
  useEffect(() => {
    atBottomRef.current = true
    setFollowing(true)
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
    let cancelRaf: (() => void) | null = null
    const raf1 = requestAnimationFrame(() => {
      land()
      const raf2 = requestAnimationFrame(land)
      cancelRaf = () => window.cancelAnimationFrame(raf2)
    })
    cancelRaf = () => window.cancelAnimationFrame(raf1)
    return () => {
      cancelRaf?.()
    }
  }, [activeId, vazio, setFollowing])

  return { scrollRef, contentRef: setContentEl, atBottom, onScroll, scrollToBottom, followLatest, setAtBottom }
}
