import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useChat, type ChatItem } from "@/store/chat"
import {
  alturaDaPista,
  deveTeleportar,
  molaParada,
  passoDaMola,
  QUADRO_MS,
  type EstadoDaMola,
} from "@/components/chat/molaDoFio"
import {
  ehGestoDeLeitura,
  ehGestoDeSubida,
  escondido,
  pertoDoFim,
  rolagemAoReaparecer,
} from "@/components/chat/medidaDoFio"

export {
  PERTO_DO_FIM_PX,
  ehGestoDeLeitura,
  ehGestoDeSubida,
  escondido,
  pertoDoFim,
  rolagemAoReaparecer,
  type Medida,
} from "@/components/chat/medidaDoFio"

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
 *  4. Seguir é com mola, e enviar arma a pista (ADR-290, física em
 *     `molaDoFio.ts`). Aterrissar continua seco: abrir não é evento.
 */

/** O último pedido SEU no fio: é nele que a pista se ancora. */
function ultimoPedido(items: ChatItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === "user") return items[i].id
  }
  return null
}

function movimentoReduzido(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
}

/** O topo do pedido no conteúdo rolável. Quando ele abre o grupo, conta do
 *  grupo, para o "Você" ficar à vista junto. */
function topoDoPedido(scroller: HTMLElement, id: string): number | null {
  const no = scroller.querySelector<HTMLElement>(`[data-chat-item-ids~="${CSS.escape(id)}"]`)
  if (!no) return null
  const grupo = no.closest<HTMLElement>("[data-turn-key]")
  const alvo = grupo && grupo.querySelector("[data-chat-item-ids]") === no ? grupo : no
  return alvo.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
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
  // O espaço reservado da pista, irmão do transcript dentro do scroller. A
  // altura é escrita direto no DOM: mudar por token via estado seria um render
  // do ChatPanel por delta.
  const pistaRef = useRef<HTMLDivElement | null>(null)
  // A última altura ESCRITA na pista: reler `offsetHeight` arredondado fazia
  // o cálculo oscilar.
  const alturaDaPistaRef = useRef(0)
  // Onde a tela estava da última vez que a VIMOS (evento de scroll ou quadro
  // da mola). Quando o fim encolhe, o navegador corrige o `scrollTop` no
  // layout, antes do ResizeObserver: é por esta que a pista sabe para onde
  // devolver a tela.
  const topoVistoRef = useRef<number | null>(null)
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
  // Aterrissar não é evento (ADR-179): enquanto o fio só se acomoda depois de
  // aberto (janela progressiva, markdown medindo), o fim é seguido seco. O
  // primeiro conteúdo NOVO na cauda encerra a aterrissagem e a mola assume.
  const aterrissandoRef = useRef(true)
  const caudaNaAterrissagemRef = useRef("")
  // A pista (ADR-290): o pedido enviado fica no topo e a resposta nasce
  // embaixo, sem a tela andar. `pendente` guarda o último pedido que existia
  // quando você enviou; o primeiro pedido novo depois dele recebe a pista.
  const ancoraDaPistaRef = useRef<{ pedido: string } | null>(null)
  const pistaPendenteRef = useRef<{ antes: string | null } | null>(null)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const molaRef = useRef<{ estado: EstadoDaMola | null; escrito: number; raf: number; tAnt: number }>({
    estado: null,
    escrito: 0,
    raf: 0,
    tAnt: 0,
  })

  const pararMola = useCallback(() => {
    const m = molaRef.current
    if (m.raf) cancelAnimationFrame(m.raf)
    m.raf = 0
    m.tAnt = 0
    m.estado = null
  }, [])

  // O disclosure das ferramentas consulta a mesma intenção no scroller. Sem
  // isso ele voltaria a inferi-la por posição durante um reflow.
  const setFollowing = useCallback((value: boolean) => {
    seguindoRef.current = value
    const el = scrollRef.current
    if (el) el.dataset.threadFollowing = String(value)
  }, [])

  const ajustarPista = useCallback(() => {
    const el = scrollRef.current
    const pista = pistaRef.current
    const ancora = ancoraDaPistaRef.current
    if (!el || !pista || !ancora || escondido(el)) return
    const topo = topoDoPedido(el, ancora.pedido)
    if (topo === null) return
    const visto = topoVistoRef.current ?? el.scrollTop
    const altura = alturaDaPista({
      alturaAtual: alturaDaPistaRef.current,
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollTop: visto,
      topoDaMensagem: topo,
    })
    // A pista fica até você sair da conversa ou enviar de novo: zerada, ela
    // ainda absorve o que encolher no fim (ver `alturaDaPista`).
    if (altura !== alturaDaPistaRef.current) {
      alturaDaPistaRef.current = altura
      pista.style.height = `${altura}px`
    }
    // O navegador já puxou a tela para baixo no encolhimento: devolve antes
    // da pintura, e ninguém vê o vai e vem. Só seguindo: o gesto de subir
    // desliga o seguir antes do scroll, e aí a tela é de quem rolou.
    if (seguindoRef.current && el.scrollTop < visto - 1) el.scrollTop = visto
  }, [])

  const quadroDaMola = useCallback(
    function quadro(t: number) {
      const m = molaRef.current
      m.raf = 0
      const el = scrollRef.current
      if (!el || !seguindoRef.current || escondido(el)) {
        pararMola()
        return
      }
      const alvo = el.scrollHeight - el.clientHeight
      // Alguém mexeu no scroll fora do laço (aterrissagem, gesto que religou):
      // a mola recomeça de onde a tela está, sem tranco.
      if (!m.estado || Math.abs(el.scrollTop - m.escrito) > 1.5) {
        m.estado = { ...molaParada(el.scrollTop), deslizando: m.estado?.deslizando ?? false }
      }
      const quadros = m.tAnt ? (t - m.tAnt) / QUADRO_MS : 1
      m.tAnt = t
      const r = passoDaMola(m.estado, alvo, quadros)
      m.estado = r.estado
      el.scrollTop = r.estado.pos
      m.escrito = el.scrollTop
      topoVistoRef.current = m.escrito
      if (r.assentou) {
        m.tAnt = 0
        return
      }
      m.raf = requestAnimationFrame(quadro)
    },
    [pararMola],
  )

  /** Leva ao fim: seco quando é aterrissagem, movimento reduzido ou longe
   *  demais; com a mola quando é conteúdo nascendo na cauda. */
  const irAoFim = useCallback(
    (modo: "seco" | "mola") => {
      const el = scrollRef.current
      if (!el) return
      const distancia = el.scrollHeight - el.clientHeight - el.scrollTop
      if (modo === "seco" || movimentoReduzido() || deveTeleportar(distancia, el.clientHeight)) {
        pararMola()
        el.scrollTo({ top: el.scrollHeight, behavior: "auto" })
        return
      }
      const m = molaRef.current
      if (!m.raf) m.raf = requestAnimationFrame(quadroDaMola)
    },
    [pararMola, quadroDaMola],
  )

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    // Escondido, o scroll que chega é o WebKit zerando a rolagem, não leitura.
    if (escondido(el)) return
    posicaoRef.current = el.scrollTop
    topoVistoRef.current = el.scrollTop
    // SÓ mede; e a única coisa que a posição LIGA é o seguir (chegar no fim é
    // pedir pra ser levado junto). Desligar por posição é o que confundia
    // reflow com gesto e parava o fio no meio do turno.
    const perto = pertoDoFim(el)
    if (perto) setFollowing(true)
    // Com a mola perseguindo, o fim está a caminho: o botão "Rolar pro fim"
    // piscaria a cada bloco que cresce mais rápido que ela.
    const noFim = perto || molaRef.current.raf !== 0
    atBottomRef.current = noFim
    setAtBottom(noFim)
  }, [setFollowing])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current
    pararMola()
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    atBottomRef.current = true
    setFollowing(true)
    setAtBottom(true)
  }, [setFollowing, pararMola])

  // Enviar é um gesto explícito de voltar ao presente, e arma a pista: quando
  // o seu pedido entrar no fio, ele sobe até o topo e a resposta nasce embaixo.
  const followLatest = useCallback(() => {
    aterrissandoRef.current = false
    pistaPendenteRef.current = { antes: ultimoPedido(itemsRef.current) }
    atBottomRef.current = true
    setFollowing(true)
    setAtBottom(true)
    irAoFim("mola")
  }, [setFollowing, irAoFim])

  // Gesto de leitura solta o fio. Ouvido no container porque o alvo real pode
  // ser qualquer filho (um bloco de código, uma imagem).
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const soltar = () => {
      setFollowing(false)
      pararMola()
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
  }, [setFollowing, pararMola])

  // O laço não sobrevive ao componente.
  useEffect(() => pararMola, [pararMola])

  // O observador PERMANENTE do crescimento.
  //
  // O efeito da cauda (abaixo) só acorda com item novo, e é aí que o fio
  // escapava: a linha de ferramenta chega como um item e CRESCE depois (o
  // resultado volta, o bloco mede, o diff abre). Sem isto, cada uma dessas
  // alturas empurrava a conversa e o fim escorregava pra fora da tela.
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
      // A pista se ajusta ANTES da pintura, no mesmo quadro em que o conteúdo
      // cresceu: é isso que deixa a tela parada enquanto a resposta preenche.
      ajustarPista()
      if (seguindoRef.current) {
        irAoFim(aterrissandoRef.current || reapareceu ? "seco" : "mola")
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
  }, [activeId, contentEl, ajustarPista, irAoFim])

  const last = items[items.length - 1]
  const streamTick = last && last.kind === "text" ? last.text.length : 0
  const lastKey = last
    ? last.kind === "text"
      ? `${last.id}:${last.text.length}`
      : last.kind === "tool"
        ? `${last.id}:${last.activityAt ?? 0}:${last.result ? "done" : "run"}`
        : `${last.id}:${last.kind}`
    : ""
  const lastKeyRef = useRef(lastKey)
  lastKeyRef.current = lastKey

  const aterrissar = useCallback(() => {
    aterrissandoRef.current = true
    caudaNaAterrissagemRef.current = lastKeyRef.current
  }, [])

  // Ao trocar de conversa: aterrissa no fim de imediato (no mesmo commit, antes do paint)
  // para que a nova conversa nunca apareça na posição de rolagem da anterior.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    pararMola()
    aterrissar()
    ancoraDaPistaRef.current = null
    pistaPendenteRef.current = null
    alturaDaPistaRef.current = 0
    topoVistoRef.current = null
    if (pistaRef.current) pistaRef.current.style.height = "0px"
    atBottomRef.current = true
    posicaoRef.current = null
    setFollowing(true)
    setAtBottom(true)
    el.scrollTop = el.scrollHeight
  }, [activeId, setFollowing, pararMola, aterrissar])

  // Trocar de conversa (ou os itens chegarem do disco) aterrissa no fim e
  // volta a seguir. Acompanha os primeiros frames de layout após o paint.
  const vazio = items.length === 0
  useEffect(() => {
    aterrissar()
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
  }, [activeId, vazio, setFollowing, aterrissar])

  // Conteúdo novo na cauda. Declarado DEPOIS da aterrissagem de propósito:
  // no commit da troca, ela carimba a cauda antes, e este efeito a reconhece
  // como a mesma (logo, ainda aterrissando). `atBottom` NÃO é dependência (ver
  // o espelho acima): o efeito responde a conteúdo novo, não a mudança de flag.
  useEffect(() => {
    if (lastKey !== caudaNaAterrissagemRef.current) aterrissandoRef.current = false
    const pendente = pistaPendenteRef.current
    if (pendente) {
      const pedido = ultimoPedido(itemsRef.current)
      if (pedido && pedido !== pendente.antes) {
        pistaPendenteRef.current = null
        ancoraDaPistaRef.current = { pedido }
        const m = molaRef.current
        // O pedido desliza até o lugar; com movimento reduzido, vai direto.
        m.estado = scrollRef.current
          ? { ...molaParada(scrollRef.current.scrollTop), deslizando: !movimentoReduzido() }
          : null
        m.escrito = scrollRef.current?.scrollTop ?? 0
      }
    }
    ajustarPista()
    if (seguindoRef.current) irAoFim(aterrissandoRef.current ? "seco" : "mola")
  }, [items.length, streamTick, lastKey, running, ajustarPista, irAoFim])

  return {
    scrollRef,
    contentRef: setContentEl,
    pistaRef,
    atBottom,
    onScroll,
    scrollToBottom,
    followLatest,
    setAtBottom,
  }
}
