// O MEDIDOR do fio: quanto custa renderizar UM TOKEN.
//
// Por que este arquivo existe, e por que ele é a peça que faltava: a frente de
// perf de 13-14/08/2026 (`docs/perf-fio-plan.md`) baixou o custo por token de
// 1,028 ms para 0,223 ms e **não deixou nada que impeça isso de voltar**. O
// que foi commitado lá são as provas de CORREÇÃO (a dobra incremental diz o
// mesmo que a dobra inteira); nenhuma delas mede coisa alguma. Uma prop que
// volte a nascer com identidade nova por token não quebra teste nenhum hoje:
// volta como "parece que ficou lento", meses depois, sem número.
//
// O que este medidor NÃO faz, de propósito: cronometrar. Tempo de parede é
// dependente de máquina (o CI não é este M1 Pro) e do JIT — o próprio plano
// anterior viu `buildNodes` oscilar 0,58 → 0,82 sem uma linha alterada. Guarda
// que dá falso positivo é desligada em duas semanas, e aí não guarda nada.
//
// Então o que ele mede são CONTADORES DETERMINÍSTICOS, iguais em qualquer
// máquina, e que são exatamente as invariantes que a frente anterior comprou:
//
//  · `nosNovos`     — quantos nós VISÍVEIS ganham identidade nova por token.
//                     P1 levou isso de 149/149 para 1/149 (a bolha viva, que
//                     mudou de verdade). É o que os `memo` do MessageList leem.
//  · `attReadsNovos`— idem para o mapa de selos de anexo, que atravessa o
//                     `memo` do MessageItem.
//  · `rebuiltFrom`  — de que nó a dobra recomeçou. A Etapa B trocou "refaz o
//                     fio" por "refaz a faixa que o token mexeu"; quanto mais
//                     alto, menor a faixa.
//  · `sufixoVarrido`— quantos ITENS as derivações escopadas varrem para servir
//                     a janela. A Etapa A levou isso de 1.885 para 571.
//
// O tempo de parede continua disponível (`tempos`), mas para PERFILAR à mão
// (F2 do `fluidez-do-fio-plan.md`), nunca para reprovar build.
//
// A cadeia abaixo é a do `MessageList` por frame, na mesma ordem e com os
// mesmos memos. Se ela sair de sincronia com o componente, o medidor mede
// outra coisa — por isso `fio.fluidez.test.ts` também compara a lista de
// passes com o fonte do MessageList.

import { reduceItems, type ChatItem, type ItemReducible } from "@/store/chat"
import type { AgentEvent } from "@/lib/agent"
import { attachmentReadsByItem, type ReadLabels } from "@/lib/attachmentRead"
import { placeNotes } from "@/lib/notes"
import { taskPlansOf } from "@/lib/tasks"
import { pendingDeferred } from "@/store/chat/terminalTools"
import { buildNodesMemo, type NodesMemo } from "./nodesMemo"
import { groupByAuthor } from "./messageGroups"
import { reuseNodes, type Node } from "./messageNodes"
import {
  feedbackTextByResult,
  tsForGroups,
  turnStartIndex,
  visibleThreadItems,
  windowStartIndex,
} from "./threadWindow"
import { CHAT_WINDOW, hiddenNodeCount } from "./useStableNodes"

/** Os passes cronometrados, na ordem em que o `MessageList` os executa. */
export const PASSES = [
  "reducer",
  "visibleThreadItems",
  "buildNodes",
  "reuseNodes",
  "taskPlansOf",
  "pendingDeferred",
  "groupByAuthor",
  "windowStartIndex",
  "feedbackTextByResult",
  "attReads",
  "tsForGroups",
] as const

export type Passe = (typeof PASSES)[number]

export interface Contadores {
  /** Tokens medidos (o de aquecimento não entra). */
  tokens: number
  itens: number
  nos: number
  visiveis: number
  /** Soma de nós visíveis com identidade NOVA, ao longo dos tokens medidos. */
  nosNovos: number
  /** Pior caso (o MAIOR) de nós novos num único token. */
  nosNovosPior: number
  /** Soma de entradas de `attReads` com identidade nova. */
  attReadsNovos: number
  /** Entradas no mapa de selos. Zero tornaria `attReadsNovos` vazio de sentido. */
  attReadsEntradas: number
  /** Menor `rebuiltFrom` observado: o pior recuo da dobra. */
  rebuiltFromPior: number
  /** Maior sufixo de itens varrido pelas derivações escopadas num token. */
  sufixoVarridoPior: number
}

export interface Medida {
  contadores: Contadores
  /** Mediana de ms por token, por passe. Para perfilar, não para reprovar. */
  tempos: Record<Passe, number>
}

export interface OpcoesMedida {
  /** Quantos `text_delta` aplicar. Ímpar: a mediana quer um meio. */
  tokens?: number
  /** `showAll` clicado (janela = fio inteiro). */
  showAll?: boolean
  agent?: string
  /** Texto de cada token. O default imita um delta curto de modelo. */
  token?: string
}

/** Um frame: o que o `MessageList` deriva a cada token, na mesma ordem. */
interface Frame {
  nodes: Node[]
  visible: Node[]
  attReads: Map<string, ReadLabels>
  sufixoVarrido: number
  rebuiltFrom: number
}

const mediana = (xs: number[]): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const meio = s.length >> 1
  return s.length % 2 ? s[meio] : (s[meio - 1] + s[meio]) / 2
}

/**
 * Roda a cadeia de derivação do fio por N tokens e devolve contadores e tempos.
 *
 * Usa o REDUCER REAL (`reduceItems`), não uma imitação: metade do contrato que
 * a guarda protege é dele (o array tem que ser novo, e os itens intocados têm
 * que voltar por referência). Imitar o reducer aqui seria medir a imitação.
 */
export function medirFio(base: ChatItem[], opts: OpcoesMedida = {}): Medida {
  const tokens = opts.tokens ?? 201
  const showAll = opts.showAll ?? false
  const agent = opts.agent ?? "claude-code"
  const token = opts.token ?? " token"

  let estado: ItemReducible = {
    items: base,
    streamingTextId: null,
    model: null,
    sessionId: null,
    startedAt: null,
    contextTokens: undefined,
  }

  // Os memos que o React guardaria em `useRef` (`useStableNodes` e
  // `useStableAttReads`). Sem eles não há incremental nenhum para medir.
  let memo: NodesMemo | null = null
  let prevAttReads = new Map<string, ReadLabels>()

  const ms: Record<Passe, number[]> = Object.fromEntries(
    PASSES.map((p) => [p, [] as number[]]),
  ) as Record<Passe, number[]>

  const delta: AgentEvent = { type: "text_delta", text: token }

  const frame = (medir: boolean): Frame => {
    const t = (p: Passe, f: () => void) => {
      if (!medir) return f()
      const i = performance.now()
      f()
      ms[p].push(performance.now() - i)
    }

    const items = estado.items
    let threadItems!: ChatItem[]
    t("visibleThreadItems", () => {
      threadItems = visibleThreadItems(items, false)
    })

    // `useStableNodes`, passo a passo (o hook faz os dois juntos).
    const prev = memo
    let proximo!: NodesMemo
    t("buildNodes", () => {
      proximo = buildNodesMemo(prev, placeNotes(threadItems))
    })
    memo = proximo
    let nodes!: Node[]
    t("reuseNodes", () => {
      nodes = prev
        ? reuseNodes(prev.nodes, proximo.nodes, proximo.rebuiltFrom)
        : proximo.nodes
    })

    t("taskPlansOf", () => void taskPlansOf(threadItems))
    t("pendingDeferred", () => void pendingDeferred(threadItems))

    const hiddenCount = hiddenNodeCount(nodes.length, showAll, CHAT_WINDOW)
    const visible = hiddenCount > 0 ? nodes.slice(hiddenCount) : nodes
    let groups!: ReturnType<typeof groupByAuthor>
    t("groupByAuthor", () => {
      groups = groupByAuthor(visible)
    })

    const firstVisibleKey = visible.length ? visible[0].key : null
    let windowStart = 0
    t("windowStartIndex", () => {
      windowStart = hiddenCount > 0 ? windowStartIndex(threadItems, firstVisibleKey) : 0
    })
    t("feedbackTextByResult", () => {
      void feedbackTextByResult(threadItems, turnStartIndex(threadItems, windowStart))
    })
    let attReads!: Map<string, ReadLabels>
    t("attReads", () => {
      attReads = attachmentReadsByItem(
        threadItems,
        agent,
        true,
        prevAttReads,
        windowStart,
      )
    })
    prevAttReads = attReads
    t("tsForGroups", () => void tsForGroups(threadItems, groups))

    return {
      nodes,
      visible,
      attReads,
      sufixoVarrido: threadItems.length - windowStart,
      rebuiltFrom: proximo.rebuiltFrom,
    }
  }

  const aplicar = (medir: boolean) => {
    if (!medir) {
      estado = { ...estado, ...reduceItems(estado, delta) }
      return
    }
    const i = performance.now()
    const saida = reduceItems(estado, delta)
    ms.reducer.push(performance.now() - i)
    estado = { ...estado, ...saida }
  }

  // Aquecimento: o 1º delta CRIA a bolha viva (o fio real termina em outro
  // kind), e o 1º frame não tem memo anterior com que comparar identidade.
  // Medir isso seria medir a montagem, não o token.
  aplicar(false)
  let anterior = frame(false)

  const contadores: Contadores = {
    tokens,
    itens: 0,
    nos: 0,
    visiveis: 0,
    nosNovos: 0,
    nosNovosPior: 0,
    attReadsNovos: 0,
    attReadsEntradas: 0,
    rebuiltFromPior: Number.POSITIVE_INFINITY,
    sufixoVarridoPior: 0,
  }

  for (let n = 0; n < tokens; n++) {
    aplicar(true)
    const atual = frame(true)

    const antesPorChave = new Map(anterior.visible.map((no) => [no.key, no]))
    let novos = 0
    for (const no of atual.visible) if (antesPorChave.get(no.key) !== no) novos++
    contadores.nosNovos += novos
    contadores.nosNovosPior = Math.max(contadores.nosNovosPior, novos)

    for (const [id, labels] of atual.attReads) {
      if (anterior.attReads.get(id) !== labels) contadores.attReadsNovos++
    }

    contadores.rebuiltFromPior = Math.min(contadores.rebuiltFromPior, atual.rebuiltFrom)
    contadores.sufixoVarridoPior = Math.max(
      contadores.sufixoVarridoPior,
      atual.sufixoVarrido,
    )
    anterior = atual
  }

  contadores.attReadsEntradas = anterior.attReads.size
  contadores.itens = estado.items.length
  contadores.nos = anterior.nodes.length
  contadores.visiveis = anterior.visible.length

  return {
    contadores,
    tempos: Object.fromEntries(PASSES.map((p) => [p, mediana(ms[p])])) as Record<
      Passe,
      number
    >,
  }
}
