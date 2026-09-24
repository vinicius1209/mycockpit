// TurnScrubber — Régua / Minimapa de turnos na margem esquerda da conversa.
//
// Mapeia cada grupo/turno de interação em um marcador visual compacto (tracinho).
// Permite navegação rápida (Click to Jump), destaca o turno ativo no viewport
// e exibe resumo no hover.
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
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Bot, MessageSquareQuote, Terminal, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
  groupByAuthor,
  grupoDeCorte,
  type GroupAuthor,
  type MessageGroup,
} from "./messageGroups"
import { rotuloDoCorte } from "@/lib/corte"
import { type Node } from "./messageNodes"
import { hiddenNodeCount, useStableNodes } from "./useStableNodes"
import { CONVERSATION_COLUMN_WIDTH } from "@/lib/conversationScale"
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

export interface TurnTick {
  key: string
  groupId: string
  author: GroupAuthor
  summary: string
  label: string
  icon: "user" | "bot" | "advisor" | "tool" | "system"
  /** >1 quando o marcador representa uma FAIXA condensada de turnos. */
  span?: number
  /** Keys dos turnos engolidos pela faixa (só quando `span` > 1). */
  covers?: string[]
  /** O marcador é um corte (ADR-180): vira emenda de película na régua. */
  corte?: boolean
}

/** Passo vertical (px) de cada marcador: conforto no fio curto… */
export const PASSO_MAX = 18
/** …e piso legível (tracinho de 4px + 3px de ar) no fio longo. */
export const PASSO_MIN = 7
/** `py-2` em cima e embaixo do trilho. */
const RESPIRO = 16

export interface ScrubberPlan {
  passo: number
  ticks: TurnTick[]
}

/**
 * Condensa `ticks` em no máximo `capacidade` marcadores, por faixas contíguas
 * de tamanho igual — a POSIÇÃO do marcador continua proporcional à posição no
 * fio, que é a única coisa que faz um minimapa ser mapa.
 *
 * Dentro da faixa, quem representa é o turno DO USUÁRIO (é o que a pessoa
 * procura quando volta no fio: "onde foi que eu pedi isso?"); sem nenhum, o
 * primeiro da faixa. O `span` vira legenda no hover: marcador que engole 4
 * turnos e finge ser 1 mentiria sobre onde o clique leva.
 */
function condensar(ticks: TurnTick[], capacidade: number): TurnTick[] {
  const tamanho = Math.ceil(ticks.length / capacidade)
  const faixas: TurnTick[] = []
  for (let i = 0; i < ticks.length; i += tamanho) {
    const faixa = ticks.slice(i, i + tamanho)
    const rep = faixa.find((t) => t.author.kind === "you") ?? faixa[0]
    faixas.push(
      faixa.length === 1
        ? rep
        : { ...rep, span: faixa.length, covers: faixa.map((t) => t.key) },
    )
  }
  return faixas
}

/**
 * Decide passo e marcadores para uma altura REAL de container (px).
 * Nunca devolve um plano mais alto que o espaço: a régua não rola.
 */
export function planejarRegua(ticks: TurnTick[], altura: number): ScrubberPlan {
  const util = Math.floor(altura) - RESPIRO
  if (ticks.length === 0 || util < PASSO_MIN) return { passo: PASSO_MAX, ticks: [] }

  const capacidade = Math.max(1, Math.floor(util / PASSO_MIN))
  if (ticks.length <= capacidade) {
    const passo = Math.min(PASSO_MAX, Math.floor(util / ticks.length))
    return { passo, ticks }
  }
  return { passo: PASSO_MIN, ticks: condensar(ticks, capacidade) }
}

/** Extrai resumo textual curto de um nó de render. */
function summaryOfNode(node: Node): string {
  switch (node.type) {
    case "prose":
      return node.text.trim().slice(0, 70)
    case "tools": {
      const count = node.tools.length
      return count === 1 ? `1 ferramenta (${node.tools[0].name})` : `${count} ferramentas executadas`
    }
    case "plan":
      return "Plano de execução"
    case "incident":
      return node.message.slice(0, 70)
    case "item": {
      const it = node.item
      if (it.kind === "user") return it.text.trim().slice(0, 70)
      if (it.kind === "advice") return it.text.trim().slice(0, 70)
      if (it.kind === "planGate") return it.text.trim().slice(0, 70)
      if (it.kind === "notice") return it.message.slice(0, 70)
      if (it.kind === "limit") return it.message.slice(0, 70)
      if (it.kind === "cancelled") return rotuloDoCorte(it.cause)
      return ""
    }
  }
}

/** Deriva os marcadores a partir dos grupos de mensagens. */
export function deriveTurnTicks(groups: MessageGroup[]): TurnTick[] {
  return groups.map((g, idx) => {
    let summary = ""
    for (const node of g.nodes) {
      summary = summaryOfNode(node)
      if (summary) break
    }

    let label = `Turno ${idx + 1}`
    let icon: TurnTick["icon"] = "bot"

    switch (g.author.kind) {
      case "you":
        label = "Você"
        icon = "user"
        break
      case "executor":
        label = "Agent"
        icon = g.nodes.some((n) => n.type === "tools") ? "tool" : "bot"
        break
      case "especialista":
        label = g.author.personaName
        icon = "advisor"
        break
      case "system":
        label = "Sistema"
        icon = "system"
        break
    }

    return {
      key: g.key,
      groupId: `msg-group-${g.key}`,
      author: g.author,
      summary: summary || label,
      label,
      icon,
      ...(grupoDeCorte(g) ? { corte: true } : {}),
    }
  })
}

export const TurnScrubber = memo(function TurnScrubber({
  items,
  scrollRef,
}: {
  items: ChatItem[]
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
  const todos = useMemo(() => deriveTurnTicks(groups), [groups])
  const [activeKey, setActiveKey] = useState<string | null>(null)

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

  const { passo, ticks } = useMemo(() => planejarRegua(todos, altura), [todos, altura])

  // O observer olha TODOS os turnos, não só os marcadores pintados: com a régua
  // condensada, observar apenas os representantes deixaria o ativo congelado
  // enquanto a pessoa rola dentro de uma faixa.
  // Ele só precisa ser refeito quando o CONJUNTO de turnos muda — não a cada
  // token. A assinatura das keys é a dep; a lista entra por ref, senão
  // `disconnect()`/`observe()` de N elementos rodava por `text_delta`.
  const tickSig = todos.map((t) => t.key).join("|")
  const ticksRef = useRef(todos)
  ticksRef.current = todos

  // Atualiza o marcador ativo conforme o scroll do container usando IntersectionObserver
  useEffect(() => {
    const container = scrollRef.current
    const atuais = ticksRef.current
    if (!container || atuais.length === 0) return

    const visibleMap = new Map<string, number>()

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const key = entry.target.getAttribute("data-turn-key")
          if (!key) continue
          if (entry.isIntersecting) {
            visibleMap.set(key, entry.intersectionRatio)
          } else {
            visibleMap.delete(key)
          }
        }

        // Escolhe o primeiro grupo visível a partir do topo do viewport
        for (const tick of ticksRef.current) {
          if (visibleMap.has(tick.key)) {
            setActiveKey(tick.key)
            break
          }
        }
      },
      {
        root: container,
        rootMargin: "-10% 0px -40% 0px",
        threshold: [0, 0.25, 0.5, 1],
      },
    )

    for (const tick of atuais) {
      const el = document.getElementById(tick.groupId)
      if (el) observer.observe(el)
    }

    return () => observer.disconnect()
  }, [tickSig, scrollRef])

  const jumpTo = useCallback((groupId: string) => {
    const el = document.getElementById(groupId)
    if (!el) return
    el.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [])

  // Fio com menos de 2 turnos: não polui a lateral (§5, degradação honesta)
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
        <nav
          aria-label="Navegação rápida de turnos"
          // Trilho SEMPRE visível (ADR-249): em repouso a régua era só traços
          // soltos no gutter, e nada dizia que aquilo se clica. A aresta é a
          // da superfície (`border`, §4); o hover só acende o fundo.
          className="pointer-events-auto flex flex-col items-center rounded-full border bg-card/70 px-1 py-2 transition-colors hover:bg-card/95 hover:shadow-[var(--shadow-sm)]"
        >
          {ticks.map((tick, idx) => {
            const isActive =
              activeKey === tick.key ||
              (activeKey !== null && tick.covers?.includes(activeKey)) ||
              (activeKey === null && idx === ticks.length - 1)
            const isUser = tick.author.kind === "you"
            const faixa = tick.span ? ` (faixa de ${tick.span} turnos)` : ""

            return (
              // Atraso PRÓPRIO: o provider global abre em 0ms, e com o passo
              // apertado o ponteiro cruza uma dúzia de marcadores até chegar no
              // que interessa — sem espera, isso vira uma metralhadora de balão
              // por cima do fio.
              <Tooltip key={tick.key} delayDuration={280}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => jumpTo(tick.groupId)}
                    aria-label={`${tick.label}: ${tick.summary}${faixa}`}
                    style={{ height: passo }}
                    className="group relative flex items-center justify-center transition-all focus-visible:outline-none"
                  >
                    {tick.corte ? (
                      // Emenda de película: o turno foi cortado aqui (ADR-180).
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
                      className={cn(
                        "block h-1 rounded-full transition-all duration-200",
                        isActive
                          ? "w-4.5 bg-brass"
                          : isUser
                            ? "w-2.5 bg-brass/50 hover:w-3.5 hover:bg-brass"
                            : "w-2.5 bg-muted-foreground/35 hover:w-3.5 hover:bg-muted-foreground/80",
                      )}
                    />
                    )}
                  </button>
                </TooltipTrigger>
                {/* Superfície de cartão SEM hairline: a seta do primitive herda
                    o fundo do balão (`bg-inherit`), então ela some no contorno em
                    vez de virar losango escuro grudado no texto. Borda aqui
                    reapareceria como aba saindo do cartão, e o §4 já dispensa o
                    fio: E2 se separa por cor + raio + `--shadow-pop`. */}
                <TooltipContent
                  side="right"
                  sideOffset={8}
                  className="max-w-[280px] bg-card px-2.5 py-1.5 text-foreground shadow-[var(--shadow-pop)]"
                >
                  <span className="flex items-center gap-1.5 text-[11px] leading-tight">
                    <span className="flex shrink-0 items-center gap-1 font-medium text-brass">
                      {tick.icon === "user" && <User className="size-3" />}
                      {tick.icon === "bot" && <Bot className="size-3" />}
                      {tick.icon === "advisor" && <MessageSquareQuote className="size-3" />}
                      {tick.icon === "tool" && <Terminal className="size-3" />}
                      {tick.label}
                    </span>
                    {/* Marcador que engole vários turnos DIZ isso: o clique leva
                        ao começo da faixa, e prometer "um turno" seria mentira. */}
                    {tick.span && (
                      <span className="shrink-0 text-muted-foreground">
                        · {tick.span} turnos
                      </span>
                    )}
                    <span className="truncate text-muted-foreground">{tick.summary}</span>
                  </span>
                  {/* A legenda das três marcas (ADR-249): as cores não se
                      explicavam sozinhas. */}
                  <span aria-hidden className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="h-1 w-2.5 rounded-full bg-brass/50" />seu pedido
                    <span className="h-1 w-2.5 rounded-full bg-muted-foreground/45" />resposta
                    <span className="h-1 w-4 rounded-full bg-brass" />na tela
                  </span>
                </TooltipContent>
              </Tooltip>
            )
          })}
        </nav>
      </div>
    </div>
  )
})
