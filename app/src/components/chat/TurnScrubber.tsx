// TurnScrubber — Régua / Minimapa de turnos na margem esquerda da conversa.
//
// Um traço por PEDIDO seu (ADR-250; a unidade e os fatos moram em
// `marcosDaRegua.ts`). O clique leva ao pedido, o traço da tela fica em âmbar,
// e parar o mouse no trilho abre o índice da conversa (`IndiceDaConversa`).
//
// Degradação honesta (§5 do STYLEGUIDE):
//  - Conversa com menos de 2 turnos não renderiza a régua (ruído zero em fios curtos).
//  - O container mora no gutter esquerdo FORA do fluxo, sem tocar na coluna de 760px.
//  - A régua cobre a MESMA janela que o transcript pinta (`CHAT_WINDOW`): pip
//    que não tem grupo na tela não existe, em vez de existir e não navegar.
//    Quem clicar em "Mostrar N itens anteriores" ganha o histórico no fio e
//    segue com a régua da janela — menos pips, todos vivos.
//  - **A régua CABE, sempre.** Ela nasceu com `max-h-[60vh]` + `overflow-y-auto`:
//    60vh mede a JANELA, não o container (que perde a barra de abas em cima e o
//    composer embaixo), então em fio longo ela estourava por cima do chrome e
//    ganhava barra de rolagem PRÓPRIA colada na barra real. Minimapa que rola
//    deixa de ser minimapa: o que ele existe pra dizer é "onde eu estou no
//    TODO". Agora a altura real é medida (`ResizeObserver` no container) e o
//    PASSO entre marcadores encolhe até caber; se nem no piso couber, a régua
//    condensa faixas e DIZ quantos turnos cada marcador cobre.
//  - **A régua só existe quando o GUTTER existe.** Ela nasceu decidindo por
//    `lg:` — breakpoint de VIEWPORT — enquanto o espaço de que precisa é o do
//    CONTÊINER de rolagem. Janela larga com o painel direito aberto passa no
//    `lg` e mesmo assim o fio perde largura: a régua pintava por cima do texto.
//    Agora a decisão é container query (`@container` no container de rolagem em
//    `ChatPanel.tsx`, `@min-[…]` aqui), o mesmo molde do `TabBtn` do painel
//    direito (`contextPanelChrome.tsx`).

import {
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { cn } from "@/lib/utils"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { registrarEscolhaDeAba } from "@/components/layout/useContextPanelTab"
import { groupByAuthor } from "./messageGroups"
import { IndiceDaConversa } from "./IndiceDaConversa"
import { marcoPedeAtencao, marcosDaRegua, respostaDoMarco, type MarcoDaRegua } from "./marcosDaRegua"
import { hiddenNodeCount, useStableNodes } from "./useStableNodes"
import { historicoDePedidos } from "@/lib/conversationMap/historico"
import { CONVERSATION_COLUMN_WIDTH } from "@/lib/conversationScale"
import { useApp } from "@/store/app"
import type { ChatItem } from "@/store/chat"

/**
 * O que a régua ocupa a partir da borda do container de rolagem, em px:
 * `left-2` (8) + `px-1.5` do trilho (6+6) + o marcador mais largo, o ativo
 * (`w-4.5`, 18). O balão do hover não conta: ele é transitório e sai por cima,
 * como qualquer popover.
 */
export const GUTTER_REGUA = 38

/**
 * Desconto da barra de rolagem: o container query resolve contra a caixa que
 * AINDA conta a barra, então sem esta folga o trilho entraria uns 6px na caixa
 * da coluna no limiar exato.
 *
 * O 12 é arredondamento pra cima de 11px medidos no Chromium — e a origem
 * desses 11px NÃO é o `::-webkit-scrollbar { width: 9px }` do `index.css`.
 * Quando `scrollbar-width` está declarado (e está, na linha logo acima, `thin`),
 * o Chromium IGNORA a largura do `::-webkit-scrollbar`; `thin` lá são 11px.
 * Quem mexer nisso precisa mexer no `scrollbar-width`, não no `9px`.
 *
 * E o pior caso é o do DESENVOLVIMENTO, não o do produto: em produção isto roda
 * em WKWebView (macOS) e WebKitGTK (Linux), onde a barra é overlay e não come
 * largura nenhuma. Ou seja, a folga sobra na plataforma real — que é o lado
 * certo pra errar.
 */
export const BARRA_DE_ROLAGEM = 12

/**
 * Largura MÍNIMA do container de rolagem para a régua caber no gutter sem
 * encostar na coluna de prosa. A coluna é centrada (`mx-auto`), então a sobra
 * se divide igual entre os dois lados: para ter `GUTTER_REGUA` à esquerda é
 * preciso ter o dobro de sobra, mais a barra.
 */
export const LARGURA_MINIMA_REGUA =
  CONVERSATION_COLUMN_WIDTH + GUTTER_REGUA * 2 + BARRA_DE_ROLAGEM

/** "Cabe régua nesta largura de contêiner?" — a regra, sem CSS no meio. */
export function cabeRegua(larguraDoContainer: number): boolean {
  return larguraDoContainer >= LARGURA_MINIMA_REGUA
}

/**
 * A MESMA regra, em CSS, porque quem decide na tela é o container query (o
 * componente não remede a largura só pra escondê-la). É string literal e não
 * template: o Tailwind varre o texto do fonte, e `@min-[${x}px]` não seria
 * encontrado. O teste-contrato em `TurnScrubber.test.ts` amarra o número daqui
 * ao de `LARGURA_MINIMA_REGUA` — mudar um sem o outro quebra a suíte.
 */
export const CLASSE_VISIBILIDADE_REGUA = "hidden @min-[848px]:flex"

/** O mínimo que a régua precisa de um marcador para condensar. */
export interface Condensavel {
  key: string
  /** >1 quando o marcador representa uma FAIXA condensada. */
  span?: number
  /** Keys dos marcadores engolidos pela faixa (só quando `span` > 1). */
  covers?: string[]
}

/** Passo vertical (px) de cada marcador: conforto no fio curto… */
export const PASSO_MAX = 18
/** …e piso legível (tracinho de 4px + 3px de ar) no fio longo. */
export const PASSO_MIN = 7
/** `py-2` em cima e embaixo do trilho. */
const RESPIRO = 16

export interface ScrubberPlan<T extends Condensavel> {
  passo: number
  ticks: T[]
}

/**
 * Condensa `ticks` em no máximo `capacidade` marcadores, por faixas contíguas
 * de tamanho igual — a POSIÇÃO do marcador continua proporcional à posição no
 * fio, que é a única coisa que faz um minimapa ser mapa.
 *
 * Quem representa a faixa é o PRIMEIRO pedido dela: o clique leva ao começo
 * da faixa. O `span` vira legenda: marcador que engole 4 pedidos e finge ser 1
 * mentiria sobre onde o clique leva. (Antes da ADR-250 a faixa escolhia o
 * turno do usuário no meio de turnos do agente; agora todo marcador é pedido.)
 */
function condensar<T extends Condensavel>(ticks: T[], capacidade: number): T[] {
  const tamanho = Math.ceil(ticks.length / capacidade)
  const faixas: T[] = []
  for (let i = 0; i < ticks.length; i += tamanho) {
    const faixa = ticks.slice(i, i + tamanho)
    faixas.push(
      faixa.length === 1
        ? faixa[0]
        : { ...faixa[0], span: faixa.length, covers: faixa.map((t) => t.key) },
    )
  }
  return faixas
}

/**
 * Decide passo e marcadores para uma altura REAL de container (px).
 * Nunca devolve um plano mais alto que o espaço: a régua não rola.
 */
export function planejarRegua<T extends Condensavel>(ticks: T[], altura: number): ScrubberPlan<T> {
  const util = Math.floor(altura) - RESPIRO
  if (ticks.length === 0 || util < PASSO_MIN) return { passo: PASSO_MAX, ticks: [] }

  const capacidade = Math.max(1, Math.floor(util / PASSO_MIN))
  if (ticks.length <= capacidade) {
    const passo = Math.min(PASSO_MAX, Math.floor(util / ticks.length))
    return { passo, ticks }
  }
  return { passo: PASSO_MIN, ticks: condensar(ticks, capacidade) }
}

/** O que o leitor de tela ouve no traço: o índice é só para quem vê. */
export function rotuloDoTraco(marco: MarcoDaRegua): string {
  const faixa = marco.span ? ` (e mais ${marco.span - 1} pedidos)` : ""
  const quem = marco.pedido.retomada ? "Retomada automática" : marco.pedido.texto
  return `Pedido ${marco.ordem}: ${quem}${faixa}. ${respostaDoMarco(marco)}`
}

/** O rodapé do índice: a aba Conversa, pelo gesto humano de escolha de aba. */
function abrirHistoricoCompleto() {
  const app = useApp.getState()
  if (!app.contextOpen) app.toggleContext()
  registrarEscolhaDeAba()
  app.setContextPanelTab("conversa")
}

export const TurnScrubber = memo(function TurnScrubber({
  items,
  vivo,
  scrollRef,
}: {
  items: ChatItem[]
  /** Há turno rodando ou finalizando: é o que faz o último pedido "rodando". */
  vivo: boolean
  scrollRef: React.RefObject<HTMLDivElement | null>
}) {
  // MESMA dobra memoizada do transcript (`useStableNodes` aplica `placeNotes` e
  // reconstrói só a faixa que o token mexeu). Antes isto era `buildNodes(items)`
  // cru: refazia o fio inteiro a cada `text_delta` e, sem `placeNotes`, gerava
  // keys de grupo que não batiam com os `data-turn-key` pintados na tela.
  const nodes = useStableNodes(items)
  const visible = useMemo(() => {
    const escondidos = hiddenNodeCount(nodes.length, false)
    return escondidos > 0 ? nodes.slice(escondidos) : nodes
  }, [nodes])
  const groups = useMemo(() => groupByAuthor(visible), [visible])
  // Os fatos do pedido são a derivação da aba Conversa, que percorre o fio
  // inteiro (~8 ms na maior conversa real). Deferida: o token pinta primeiro,
  // a régua acompanha logo depois. Grupo que ainda não tem dono no mapa
  // deferido cai no último marco, que é mesmo o dono dele.
  const itemsDaRegua = useDeferredValue(items)
  const pedidos = useMemo(
    () => historicoDePedidos(itemsDaRegua, { running: vivo, finalizing: false }).pedidos,
    [itemsDaRegua, vivo],
  )
  const marcos = useMemo(() => marcosDaRegua(groups, itemsDaRegua, pedidos), [groups, itemsDaRegua, pedidos])
  const marcoDoGrupo = useMemo(
    () => new Map(marcos.flatMap((m) => m.grupos.map((g) => [g, m.key] as const))),
    [marcos],
  )
  const [grupoNaTela, setGrupoNaTela] = useState<string | null>(null)
  const [sobre, setSobre] = useState<string | null>(null)
  const [aberto, setAberto] = useState(false)

  // Altura REAL do container de rolagem (o composer e a barra de abas são
  // irmãos, então `clientHeight` já é o espaço que a régua tem). Medida em
  // layout effect + ResizeObserver: `60vh` era um chute sobre a janela inteira,
  // e chute que erra pra mais é justamente o que cortava a régua no topo.
  const [altura, setAltura] = useState(0)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const medir = () => setAltura(el.clientHeight)
    medir()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [scrollRef])

  const { passo, ticks } = useMemo(() => planejarRegua(marcos, altura), [marcos, altura])

  // O observer olha TODOS os grupos da tela, não só os primeiros de cada
  // pedido: o pedido na tela é o dono do primeiro grupo visível, e um pedido
  // longo passa várias telas sem que o grupo dele de abertura apareça.
  // Ele só precisa ser refeito quando o CONJUNTO de grupos muda — não a cada
  // token. A assinatura das keys é a dep; a lista entra por ref, senão
  // `disconnect()`/`observe()` de N elementos rodava por `text_delta`.
  const grupoSig = groups.map((g) => g.key).join("|")
  const gruposRef = useRef(groups)
  gruposRef.current = groups

  useEffect(() => {
    const container = scrollRef.current
    const atuais = gruposRef.current
    if (!container || atuais.length === 0) return

    const visiveis = new Set<string>()
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const key = entry.target.getAttribute("data-turn-key")
          if (!key) continue
          if (entry.isIntersecting) visiveis.add(key)
          else visiveis.delete(key)
        }
        // O primeiro grupo visível a partir do topo do viewport.
        const primeiro = gruposRef.current.find((g) => visiveis.has(g.key))
        if (primeiro) setGrupoNaTela(primeiro.key)
      },
      {
        root: container,
        rootMargin: "-10% 0px -40% 0px",
        threshold: [0, 0.25, 0.5, 1],
      },
    )

    for (const grupo of atuais) {
      const el = document.getElementById(`msg-group-${grupo.key}`)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [grupoSig, scrollRef])

  const jumpTo = useCallback((groupId: string) => {
    const el = document.getElementById(groupId)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [])

  const naTela = (grupoNaTela && marcoDoGrupo.get(grupoNaTela)) || marcos.at(-1)?.key || null

  // Fio com menos de 2 pedidos: não polui a lateral (§5, degradação honesta)
  if (ticks.length < 2) return null

  return (
    // Casca de ALTURA ZERO + camada absoluta: a régua NÃO entra no fluxo do
    // transcript. Com `float-left` (como nasceu) ela encurtava as line boxes da
    // coluna de 760px — o texto se estreitava em volta dela — e o
    // `-translate-y-1/2` movia só o pixel: o espaço reservado ficava no topo e a
    // régua aparecia no meio, por cima de texto que não reservou nada.
    // A visibilidade sai do CONTAINER, não da janela: `CLASSE_VISIBILIDADE_REGUA`
    // é `cabeRegua` escrita em `@min-[…]`, e resolve contra o `@container` do
    // container de rolagem (`ChatPanel.tsx`). Com o painel direito aberto o fio
    // encolhe, o gutter some e a régua some junto — coisa que `lg:` não via.
    // O centro vem em PIXEL da altura medida, não de `top-1/2`: porcentagem em
    // `sticky` resolve contra o bloco container, e aqui isso é o container de
    // rolagem inteiro — origem da régua fora do lugar em fio longo.
    <div className="sticky z-20 h-0" style={{ top: Math.round(altura / 2) }}>
      <div
        className={cn(
          "pointer-events-none absolute left-2 -translate-y-1/2 items-center",
          CLASSE_VISIBILIDADE_REGUA,
        )}
      >
        {/* O índice abre ao PARAR no trilho, com o mesmo atraso que o balão de
            cada traço tinha: o ponteiro que só atravessa a régua não abre nada. */}
        <HoverCard open={aberto} onOpenChange={setAberto} openDelay={280} closeDelay={120}>
          <HoverCardTrigger asChild>
            <nav
              aria-label="Pedidos desta conversa"
              onMouseLeave={() => setSobre(null)}
              // Trilho SEMPRE visível (ADR-249): em repouso a régua era só traços
              // soltos no gutter, e nada dizia que aquilo se clica. A aresta é a
              // da superfície (`border`, §4); o hover só acende o fundo.
              className="pointer-events-auto flex flex-col items-center rounded-full border bg-card/70 px-1 py-2 transition-colors hover:bg-card/95 hover:shadow-[var(--shadow-sm)]"
            >
              {ticks.map((tick) => {
                const isActive = naTela === tick.key || (naTela !== null && !!tick.covers?.includes(naTela))
                const estado = tick.pedido.estado
                return (
                  <button
                    key={tick.key}
                    type="button"
                    onClick={() => jumpTo(tick.groupId)}
                    onMouseEnter={() => setSobre(tick.key)}
                    aria-label={rotuloDoTraco(tick)}
                    aria-current={isActive ? "location" : undefined}
                    style={{ height: passo }}
                    className="group relative flex w-4.5 items-center justify-center focus-visible:outline-none"
                  >
                    {estado === "interrompido" ? (
                      // Emenda de película: o pedido foi cortado (ADR-180).
                      <span className="flex w-3.5 justify-between" aria-hidden="true">
                        {[0, 1].map((metade) => (
                          <span
                            key={metade}
                            className={cn(
                              "block h-1 w-1.5 rounded-full",
                              isActive ? "bg-brass" : "bg-muted-foreground/45",
                            )}
                          />
                        ))}
                      </span>
                    ) : (
                      <span
                        aria-hidden="true"
                        className={cn(
                          "block h-1 rounded-full transition-all duration-200",
                          isActive
                            ? "w-4.5 bg-brass"
                            : estado === "rodando"
                              ? // O vivo é movimento cinza (§2), não cor.
                                "w-2.5 animate-pulse bg-muted-foreground/70"
                              : "w-2.5 bg-muted-foreground/35 group-hover:w-3.5 group-hover:bg-muted-foreground/80",
                        )}
                      />
                    )}
                    {marcoPedeAtencao(tick) && !isActive && (
                      <span aria-hidden="true" className="absolute top-1/2 right-0 size-1 -translate-y-1/2 rounded-full bg-st-warning" />
                    )}
                  </button>
                )
              })}
            </nav>
          </HoverCardTrigger>
          <HoverCardContent side="right" align="center" sideOffset={10} className="p-0">
            <IndiceDaConversa
              marcos={marcos}
              total={pedidos.length}
              ativo={naTela}
              sobre={sobre}
              onIr={(marco) => {
                setAberto(false)
                jumpTo(marco.groupId)
              }}
              onHistorico={() => {
                setAberto(false)
                abrirHistoricoCompleto()
              }}
            />
          </HoverCardContent>
        </HoverCard>
      </div>
    </div>
  )
})
