// Reconstrução INCREMENTAL do modelo de nós do fio.
//
// `buildNodes` é uma DOBRA COM VIZINHANÇA, não um `map`: um `text_delta` muda UM
// item, mas o nó que sai dali depende dos vizinhos (prosa costurada, tools do
// mesmo passo, incidente que absorve os erros seguintes). Então incremental aqui
// não é "recalcular o item", é RECONSTRUIR A FAIXA AFETADA — e reaproveitar,
// intacto, o prefixo de nós que a mudança comprovadamente não alcança.
//
// A prova de que a faixa está certa mora em `messageNodes.incremental.test.ts`:
// sequências e mutações pseudoaleatórias com semente, e a exigência de que o
// resultado incremental seja PROFUNDAMENTE idêntico ao da passada inteira.
//
// Três fatos sustentam o corte:
//
//  1. O fold só olha PRA FRENTE. `terminalIncidentAt`, o colapso de results
//     consecutivos e a costura de prosa leem `items[i]` e adiante.
//  2. O estado que atravessa iterações é `seg` + `planShownInTurn`. Num índice
//     em que `seg` está fechado, retomar com o booleano certo dá o mesmo
//     resultado — é o `Restart` que o fold registra.
//  3. A ÚNICA exceção é o galho dos subagentes: `withDescendants` faz o nó do
//     tool RAIZ carregar filhos que nascem depois dele. Um filho na faixa que
//     mudou envelhece o nó do pai, então a reconstrução recua até a raiz.
//
// Onde não dá pra provar, degrada pro fio inteiro (o custo de hoje), nunca pra
// uma faixa curta: errar pra menos aqui é corrupção visual (fusão perdida, nó
// duplicado, ordem trocada), que é pior que lentidão.
import type { ChatItem } from "@/store/chat"
import {
  childrenByParentOf,
  foldNodes,
  type Node,
  type Restart,
  type ToolItem,
} from "./messageNodes"

/** Memória de uma reconstrução: o que ela produziu e o bastante pra próxima
 *  retomar no meio. Opaca para quem chama — só `nodes` e `rebuiltFrom` são
 *  para consumo externo. */
export interface NodesMemo {
  /** O fio de onde `nodes` saiu (comparado por IDENTIDADE de item). */
  readonly items: ChatItem[]
  readonly nodes: Node[]
  /** Índice do 1º nó RECONSTRUÍDO nesta rodada: abaixo dele `nodes[i]` é o
   *  mesmo objeto do frame anterior. */
  readonly rebuiltFrom: number
  readonly restarts: Restart[]
  readonly children: Map<string, ToolItem[]>
}

/** Primeiro índice em que os dois fios divergem POR IDENTIDADE.
 *
 *  Vale porque o reducer preserva a referência de todo item que não mudou (um
 *  `text_delta` troca só a bolha viva, o resto do array é o mesmo objeto). Se
 *  um dia deixar de valer, isto só aponta mais cedo: a faixa fica maior e o
 *  resultado continua correto. */
function firstDiff(a: ChatItem[], b: ChatItem[]): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i++
  return i
}

/** Entra na comparação do mapa de filhos quem pode MUDÁ-LO: o filho (a aresta)
 *  e o candidato a pai (o `toolId` que decide se a aresta é válida ou ÓRFÃ).
 *  Comparar só a aresta não basta desde que o órfão ficou fora do mapa: um pai
 *  que chega adota um filho que já estava no fio, e o mapa do frame anterior
 *  ficaria velho sem que nenhuma aresta tivesse mudado. */
const ehAresta = (it: ChatItem): boolean =>
  it.kind === "tool" && (!!it.parentToolId || !!it.toolId)

/** Os dois fios têm a MESMA sequência de tools filhos de `from` em diante?
 *
 *  O mapa de filhos depende só da sequência ordenada de tools com
 *  `parentToolId` (e dos `toolId` que dão pai a elas); o prefixo até `from` já é
 *  idêntico por identidade. Se a
 *  sequência que sobra também for idêntica, o mapa do frame anterior serve
 *  inteiro E nenhum galho de subagente envelheceu — a faixa não precisa recuar
 *  até raiz nenhuma.
 *
 *  Comparar as SEQUÊNCIAS (e não "existe algum filho aqui?") é o que salva o
 *  caso em que a faixa é longa mas nada de subagente mudou: sem isso, um fio com
 *  filhos remontava o mapa inteiro a cada frame. */
function mesmosFilhos(a: ChatItem[], b: ChatItem[], from: number): boolean {
  let i = from
  let j = from
  for (;;) {
    while (i < a.length && !ehAresta(a[i])) i++
    while (j < b.length && !ehAresta(b[j])) j++
    if (i >= a.length || j >= b.length) return i >= a.length && j >= b.length
    if (a[i] !== b[j]) return false
    i++
    j++
  }
}

/** `toolId` → índice, ou `null` quando algum `toolId` se REPETE no fio.
 *
 *  Com `toolId` único cada tool tem um pai só, então o galho é uma floresta e
 *  todo descendente tem UMA raiz — é isso que faz "recuar até a raiz" ser
 *  suficiente. Repetido, o mesmo filho pode pendurar em dois galhos ao mesmo
 *  tempo (`withDescendants` o empurra nos dois) e não existe "a" raiz: aí a
 *  resposta honesta é reconstruir o fio inteiro, não escolher uma. */
function indexByToolId(items: ChatItem[]): Map<string, number> | null {
  const out = new Map<string, number>()
  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (it.kind !== "tool" || !it.toolId) continue
    if (out.has(it.toolId)) return null
    out.set(it.toolId, i)
  }
  return out
}

/** Até onde recuar quando um tool FILHO entrou (ou saiu) da faixa que mudou: o
 *  nó do ancestral raiz carrega o galho inteiro, então ele envelheceu junto.
 *  Ancestral que não dá pra resolver (pai sumido do fio, ciclo) → `0`, fio
 *  inteiro. */
function rootStart(items: ChatItem[], prevItems: ChatItem[], diff: number): number {
  // Já vai reconstruir tudo: não há raiz mais antiga pra procurar, e montar o
  // índice de tools aqui seria uma varredura do fio jogada fora.
  if (diff === 0) return 0
  const byId = indexByToolId(items)
  if (!byId) return 0
  let start = diff
  // Um Set só, reciclado: são centenas de filhos por chamada e a cadeia de
  // ancestrais quase sempre tem um elo.
  const visitados = new Set<string>()
  const recuar = (it: ChatItem) => {
    if (it.kind !== "tool" || !it.parentToolId) return
    visitados.clear()
    let parentId: string | undefined = it.parentToolId
    while (parentId) {
      if (visitados.has(parentId)) {
        start = 0
        return
      }
      visitados.add(parentId)
      const p = byId.get(parentId)
      if (p === undefined) {
        start = 0
        return
      }
      if (p < start) start = p
      const pai = items[p]
      parentId = pai.kind === "tool" ? pai.parentToolId : undefined
    }
  }
  for (let i = diff; i < items.length && start > 0; i++) recuar(items[i])
  for (let i = diff; i < prevItems.length && start > 0; i++) recuar(prevItems[i])
  return start
}

/** Último ponto de retomada em `item <= alvo`. Busca binária: os pontos saem do
 *  fold em ordem crescente de índice. `-1` = nenhum (reconstrói do zero). */
function restartAtOrBefore(restarts: Restart[], alvo: number): number {
  let lo = 0
  let hi = restarts.length - 1
  let achado = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (restarts[mid].item <= alvo) {
      achado = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return achado
}

function memoInteiro(
  items: ChatItem[],
  children = childrenByParentOf(items),
): NodesMemo {
  const nodes: Node[] = []
  const restarts: Restart[] = []
  foldNodes(items, 0, false, children, nodes, restarts)
  return { items, nodes, rebuiltFrom: 0, restarts, children }
}

/** Reconstrói o modelo de nós reaproveitando o prefixo que a mudança não
 *  alcança. `prev` nulo (1ª renderização) = passada inteira. */
export function buildNodesMemo(prev: NodesMemo | null, items: ChatItem[]): NodesMemo {
  if (!prev) return memoInteiro(items)
  const diff = firstDiff(prev.items, items)
  // Fio de conteúdo idêntico: nada a refazer. O array pode ser outro (o React
  // recebe um novo a cada frame), os nós não precisam ser.
  if (diff === prev.items.length && diff === items.length)
    return items === prev.items
      ? prev
      : { ...prev, items, rebuiltFrom: prev.nodes.length }

  // O mapa de filhos é a única leitura do fold que atravessa a faixa.
  const filhoMexeu = !mesmosFilhos(prev.items, items, diff)
  const start = filhoMexeu ? rootStart(items, prev.items, diff) : diff
  const children = filhoMexeu ? childrenByParentOf(items) : prev.children

  // A dobra olha pra frente DENTRO da iteração: o colapso de results lê
  // `items[i+1]` e o incidente lê um item além do último que absorveu. Em ambos
  // a leitura para exatamente no PRÓXIMO topo de loop — ou seja, uma iteração lê
  // no máximo até o índice em que a seguinte começa. Logo, retomar em `c` só é
  // seguro se `c < diff`: aí tudo que as iterações anteriores leram está no
  // prefixo idêntico. Sem esse `-1`, inserir um item no meio apagava o nó
  // ANTERIOR a ele (um result que só existia porque parou de ser seguido por
  // outro result) — foi o teste de propriedade que achou.
  const alvo = Math.min(start, diff - 1)
  const r = alvo < 0 ? -1 : restartAtOrBefore(prev.restarts, alvo)
  // Sem ponto de retomada útil, o fio inteiro — mas ainda com o mapa de filhos
  // que já sabemos válido, em vez de remontá-lo à toa.
  if (r < 0) return memoInteiro(items, children)
  const ponto = prev.restarts[r]
  // O próprio ponto é reemitido pelo fold (ele começa com o segmento fechado),
  // por isso o corte é exclusivo.
  const nodes = prev.nodes.slice(0, ponto.node)
  const restarts = prev.restarts.slice(0, r)
  foldNodes(items, ponto.item, ponto.planShownInTurn, children, nodes, restarts)
  return { items, nodes, rebuiltFrom: ponto.node, restarts, children }
}
