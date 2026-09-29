// Modelo de NÓS de render do fio de chat: agrupa os itens brutos (texto, tools,
// results…) nos blocos que a UI desenha. Fica FORA do componente pra ser testável
// puro e não estragar o fast-refresh do MessageList.
import { isTaskTool } from "@/lib/tasks"
import { ehEntregaDeclarada } from "@/lib/entregas"
import type { ChatItem } from "@/store/chat"

export type ToolItem = Extract<ChatItem, { kind: "tool" }>
export type ResultItem = Extract<ChatItem, { kind: "result" }>

/** Incidente terminal normalizado para a UI. `result` continua anexado ao nó
 * para que custo, duração e tokens não desapareçam quando históricos antigos
 * são curados. `details` guarda o texto cru do provider, recolhido por padrão. */
export interface IncidentNode {
  type: "incident"
  key: string
  itemIds?: string[]
  severity: "limit" | "error"
  message: string
  resetHint?: string
  details: string[]
  result?: ResultItem
}

/** Nó de render: item comum, prosa costurada (+ tools do turno), burst de tools
 * solto, ou o marco compacto de um plano publicado. */
export type Node =
  | { type: "item"; key: string; item: ChatItem }
  | { type: "prose"; key: string; text: string; tools: ToolItem[]; itemIds?: string[] }
  | { type: "tools"; key: string; tools: ToolItem[]; itemIds?: string[] }
  | { type: "plan"; key: string; anchorId: string; itemIds?: string[] }
  | IncidentNode

const LIMIT_PATTERNS = [
  /\b(?:session|usage|rate)[\s-]?limit\b/i,
  /\b(?:limit|quota)\s+(?:has\s+been\s+)?(?:reached|exceeded)\b/i,
  /\b(?:out\s+of|insufficient)\s+(?:credits?|quota)\b/i,
  /\blimite\s+(?:de\s+)?(?:uso|sess[aã]o|taxa|cota|cr[eé]ditos?)\b/i,
  /\bcota\s+(?:atingida|excedida|esgotada)\b/i,
]

/** Detector tolerante a providers, mantido na camada de compatibilidade para
 * históricos gravados antes de `limit_reached` existir no contrato. */
export function isLimitIncident(message: string): boolean {
  return LIMIT_PATTERNS.some((pattern) => pattern.test(message))
}

/** Extrai o trecho humano do reset sem tentar interpretá-lo aqui. A UI decide
 * como exibir; timers continuam sendo responsabilidade de autoResume. */
export function resetHintFromMessage(message: string): string | undefined {
  const match = message.match(/\breset(?:s|ting)?\s+(?:at\s+)?(.+?)\s*$/i)
  return match?.[1]?.trim() || undefined
}

function normalizedMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ").toLocaleLowerCase()
}

function sameMessage(a: string, b: string): boolean {
  return normalizedMessage(a) === normalizedMessage(b)
}

/** O erro de exit code é consequência, não uma segunda causa. Só é absorvido
 * quando já há uma causa terminal no mesmo cluster. */
function isGenericExitError(message: string): boolean {
  return /^(?:o\s+)?(?:agent|agente|processo|(?:claude(?:-code)?|codex|antigravity))\b.*\b(?:saiu|encerrou|exited?)\b.*\b(?:c[oó]digo|code)\s*-?\d+\s*$/i.test(
    message.trim(),
  )
}

function uniqueDetails(messages: string[]): string[] {
  const seen = new Set<string>()
  return messages.filter((message) => {
    const normalized = normalizedMessage(message)
    if (!normalized || seen.has(normalized)) return false
    seen.add(normalized)
    return true
  })
}

/** Lê um incidente terminal a partir de `start` e devolve até onde consumiu.
 * A regra é deliberadamente conservadora: só absorve duplicatas exatas e o
 * exit-code genérico posterior. Mensagens diferentes continuam como falhas
 * separadas no transcript. */
function terminalIncidentAt(
  items: ChatItem[],
  start: number,
): { node: IncidentNode; end: number } | null {
  const first = items[start]
  let result: ResultItem | undefined
  let cause: Extract<ChatItem, { kind: "limit" | "error" }> | undefined
  let message = ""
  let severity: IncidentNode["severity"] = "error"
  let resetHint: string | undefined
  let end = start
  const initialDetails: string[] = []

  if (first.kind === "result" && !first.ok) {
    result = first
    message = first.text?.trim() ?? ""
    if (message) initialDetails.push(message)
    const next = items[start + 1]
    if (
      next?.kind === "limit" ||
      (next?.kind === "error" &&
        (!message || sameMessage(next.message, message) || isGenericExitError(next.message)))
    ) {
      cause = next
      end = start + 1
      if (!message || next.kind === "limit") message = next.message
    }
  } else if (first.kind === "limit" || first.kind === "error") {
    cause = first
    message = first.message
  } else {
    return null
  }

  if (cause?.kind === "limit" || isLimitIncident(message)) {
    severity = "limit"
    resetHint =
      (cause?.kind === "limit" ? cause.resetHint : undefined) ??
      resetHintFromMessage(message)
  }

  const details = [...initialDetails, message]
  // Uma causa estruturada pode vir depois do Result puramente telemétrico.
  if (cause && cause.message !== message) details.push(cause.message)

  for (let i = end + 1; i < items.length; i++) {
    const candidate = items[i]
    if (candidate.kind !== "error" && candidate.kind !== "limit") break
    const candidateMessage = candidate.message
    const duplicate = details.some((detail) => sameMessage(detail, candidateMessage))
    const genericConsequence =
      details.some((detail) => !isGenericExitError(detail)) &&
      candidate.kind === "error" &&
      isGenericExitError(candidateMessage)
    if (!duplicate && !genericConsequence) break
    details.push(candidateMessage)
    end = i
    if (candidate.kind === "limit") {
      severity = "limit"
      resetHint ??=
        candidate.resetHint ?? resetHintFromMessage(candidate.message)
    }
  }

  const fallbackMessage =
    severity === "limit"
      ? "O limite de uso desta sessão foi atingido."
      : "A execução foi encerrada antes de concluir."

  return {
    node: {
      type: "incident",
      key: first.id,
      itemIds: items.slice(start, end + 1).map((item) => item.id),
      severity,
      message: message || fallbackMessage,
      resetHint,
      details: uniqueDetails(details),
      result,
    },
    end,
  }
}

/** Continuação de prosa: o modelo cortou a narração (às vezes no meio da
 *  palavra) para chamar uma tool e retomou. Só esses cortes artificiais se
 *  curam, concatenando o texto cru; frase fechada ou parágrafo novo seguem
 *  separados. */
export function continuesProse(prev: string, next: string): boolean {
  const p = prev.replace(/\s+$/u, "")
  const n = next.replace(/^\s+/u, "")
  if (!p || !n) return false
  // frase fechada (. ! ? …) → passo novo de narração, não continuação.
  if (/[.!?…]$/u.test(p)) return false
  const first = [...n][0]!
  if (/\p{Lu}/u.test(first)) return false // começa MAIÚSCULA → nova sentença
  if (/[#>\-*+`|]/u.test(first)) return false // marcador markdown → novo bloco
  return true
}

/** Ponto onde a dobra pode RECOMEÇAR sem olhar pra trás.
 *
 *  A dobra carrega dois estados entre iterações: o segmento aberto (`seg`) e
 *  `planShownInTurn`. Num índice em que `seg` está FECHADO, tudo que já foi
 *  emitido é definitivo e o único estado que atravessa é o booleano — então
 *  retomar dali produz exatamente os mesmos nós que uma passada inteira. É o
 *  que permite reconstruir só a FAIXA afetada (ver `nodesMemo.ts`). */
export interface Restart {
  /** índice do item no topo do loop */
  readonly item: number
  /** quantos nós já haviam sido emitidos */
  readonly node: number
  readonly planShownInTurn: boolean
}

/** Tools filhos indexados por `parentToolId`: o nó raiz viaja com o galho
 *  inteiro, sem os filhos reaparecerem soltos. Fica fora do fold porque é a
 *  única dependência que olha para frente no fio. Filho órfão (pai fora do
 *  fio) fica fora do mapa e vira raiz: pular sumiria com uma ação que
 *  aconteceu (fail-open, como `buildToolForest`).
 *  @internal */
export function childrenByParentOf(items: ChatItem[]): Map<string, ToolItem[]> {
  const known = new Set<string>()
  for (const item of items) {
    if (item.kind === "tool" && item.toolId) known.add(item.toolId)
  }
  const out = new Map<string, ToolItem[]>()
  for (const item of items) {
    if (item.kind !== "tool" || !item.parentToolId) continue
    if (!known.has(item.parentToolId)) continue
    const children = out.get(item.parentToolId) ?? []
    children.push(item)
    out.set(item.parentToolId, children)
  }
  return out
}

/** O motor da dobra: percorre `items` a partir de `from` e ANEXA os nós em
 *  `nodes`. Fora dos descendentes (ver `childrenByParentOf`), toda leitura é
 *  daqui pra frente — `terminalIncidentAt`, o colapso de results consecutivos e
 *  a costura de prosa só olham `items[i]` e adiante.
 *
 *  `restarts`, quando presente, recebe um ponto por índice em que o segmento
 *  estava fechado no topo do loop. Passar `null` desliga o registro.
 *  @internal */
export function foldNodes(
  items: ChatItem[],
  from: number,
  planShown: boolean,
  childrenByParent: Map<string, ToolItem[]>,
  nodes: Node[],
  restarts: Restart[] | null,
): void {
  let planShownInTurn = planShown
  const withDescendants = (root: ToolItem): ToolItem[] => {
    const out: ToolItem[] = [root]
    const seen = new Set<string>()
    const visit = (parent: ToolItem) => {
      const id = parent.toolId
      if (!id || seen.has(id)) return
      seen.add(id)
      for (const child of childrenByParent.get(id) ?? []) {
        out.push(child)
        visit(child)
      }
    }
    visit(root)
    return out
  }
  // segmento corrente: prosa costurada (`texts`, concatenada direto) + as tools
  // que ela disparou. `texts` vazio e só `tools` = burst solto (sem narração).
  let seg: { key: string; texts: string[]; tools: ToolItem[]; itemIds: string[] } | null = null
  const flush = () => {
    if (!seg) return
    if (seg.texts.length) {
      nodes.push({
        type: "prose",
        key: seg.key,
        text: seg.texts.join(""),
        tools: seg.tools,
        itemIds: seg.itemIds,
      })
    } else if (seg.tools.length) {
      nodes.push({ type: "tools", key: seg.key, tools: seg.tools, itemIds: seg.itemIds })
    }
    seg = null
  }
  for (let i = from; i < items.length; i++) {
    // Segmento fechado no topo do loop = ponto de retomada exato.
    if (!seg) restarts?.push({ item: i, node: nodes.length, planShownInTurn })
    const it = items[i]
    // results consecutivos = parciais da MESMA invocação (histórico antigo,
    // persistido antes do colapso no reducer): só o último vale.
    if (it.kind === "result" && items[i + 1]?.kind === "result") continue
    const incident = terminalIncidentAt(items, i)
    if (incident) {
      flush()
      nodes.push(incident.node)
      i = incident.end
      continue
    }
    // Filho já será desenhado sob a tool `Task`/agent que o originou — mas só
    // quando esse pai EXISTE no fio (o mapa deixa órfão de fora): senão pular
    // aqui apagaria a ação da tela.
    if (
      it.kind === "tool" &&
      it.parentToolId &&
      childrenByParent.has(it.parentToolId)
    )
      continue
    // A entrega declarada aparece como cartão no fim do turno (ADR-286); a
    // linha no grupo só repetiria. Se falhou, a linha fica: a falha é do fio.
    if (it.kind === "tool" && ehEntregaDeclarada(it) && it.result?.ok !== false) continue
    if (it.kind === "tool" && isTaskTool(it.name)) {
      flush()
      if (it.name === "TaskCreate" && !planShownInTurn) {
        nodes.push({ type: "plan", key: it.id, anchorId: it.id, itemIds: [it.id] })
        planShownInTurn = true
      }
      continue
    }
    if (it.kind === "tool") {
      if (!seg) seg = { key: it.id, texts: [], tools: [], itemIds: [] }
      const tools = withDescendants(it)
      seg.tools.push(...tools)
      seg.itemIds.push(...tools.map((tool) => tool.id))
      continue
    }
    if (it.kind === "text") {
      // continuação do que já vinha sendo dito → costura na MESMA bolha; senão,
      // fecha o passo anterior (levando as tools dele) e abre um novo.
      if (seg && seg.texts.length && continuesProse(seg.texts.join(""), it.text)) {
        seg.texts.push(it.text)
        seg.itemIds.push(it.id)
      } else {
        flush()
        seg = { key: it.id, texts: [it.text], tools: [], itemIds: [it.id] }
      }
      continue
    }
    // Um novo pedido abre um novo espaço de plano. O próprio item de usuário
    // continua no fio; só reiniciamos o dedupe do marco.
    if (it.kind === "user") planShownInTurn = false
    // outros kinds (user/error/limit/cancelled/notice/result final).
    flush()
    nodes.push({ type: "item", key: it.id, item: it })
  }
  flush()
}

/** Agrupa um TURNO: a narração do agente (costurando fragmentos cortados no meio
 *  por tool use interleaved) vira UMA bolha; as tools que ela disparou viram um
 *  grupo compacto logo depois. Frases completas separadas por tools continuam
 *  passos distintos. Task tools somem do fluxo e viram UMA checklist. */
export function buildNodes(items: ChatItem[]): Node[] {
  const nodes: Node[] = []
  foldNodes(items, 0, false, childrenByParentOf(items), nodes, null)
  return nodes
}

/** Duas listas de tools são a MESMA coisa? Compara por identidade de item: o
 *  reducer do store preserva a referência de todo item que não mudou, então
 *  identidade igual = conteúdo igual (e mais barato que comparar campo a campo). */
function sameTools(a: ToolItem[], b: ToolItem[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function sameStrings(a: string[], b: string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/** O nó `next` diz exatamente o mesmo que `prev` (mesmo tipo, mesma chave, mesmo
 *  conteúdo)? */
function sameNode(prev: Node, next: Node): boolean {
  if (prev.type !== next.type || prev.key !== next.key) return false
  switch (next.type) {
    case "item":
      return prev.type === "item" && prev.item === next.item
    case "plan":
      return (
        prev.type === "plan" &&
        prev.anchorId === next.anchorId &&
        sameStrings(prev.itemIds ?? [], next.itemIds ?? [])
      )
    case "prose":
      return (
        prev.type === "prose" &&
        prev.text === next.text &&
        sameStrings(prev.itemIds ?? [], next.itemIds ?? []) &&
        sameTools(prev.tools, next.tools)
      )
    case "tools":
      return (
        prev.type === "tools" &&
        sameStrings(prev.itemIds ?? [], next.itemIds ?? []) &&
        sameTools(prev.tools, next.tools)
      )
    case "incident":
      return (
        prev.type === "incident" &&
        prev.severity === next.severity &&
        prev.message === next.message &&
        prev.resetHint === next.resetHint &&
        prev.result === next.result &&
        sameStrings(prev.itemIds ?? [], next.itemIds ?? []) &&
        sameStrings(prev.details, next.details)
      )
  }
}

/** Reaproveita a identidade dos nós que não mudaram entre dois `buildNodes`:
 *  sem isto, um `text_delta` devolve centenas de nós novos e a memoização por
 *  prop (`ToolLine`, `buildToolForest`) vira decoração. O nó que mudou ainda
 *  reaproveita o array de tools quando elas não mudaram.
 *  Puro em relação a `next` (recém-construído). `from` é o 1º nó refeito pela
 *  reconstrução incremental (`nodesMemo.ts`): abaixo dele já é o objeto de
 *  `prev`, e como as keys são monótonas no índice, a contraparte de um nó
 *  refeito só pode estar em `prev[from..]`. */
export function reuseNodes(prev: Node[], next: Node[], from = 0): Node[] {
  if (!prev.length || from >= next.length) return next
  const byKey = new Map<string, Node>()
  for (let i = from; i < prev.length; i++) byKey.set(prev[i].key, prev[i])
  for (let i = from; i < next.length; i++) {
    const n = next[i]
    const p = byKey.get(n.key)
    if (!p || p.type !== n.type) continue
    if (sameNode(p, n)) {
      next[i] = p
      continue
    }
    // Mudou (tipicamente a bolha viva, cujo texto cresceu por um token): ainda
    // assim as TOOLS costuradas nela costumam ser as mesmas — devolver o array
    // antigo mantém o `ToolGroup` daquele turno inteiramente memoizado.
    if (
      (n.type === "prose" || n.type === "tools") &&
      (p.type === "prose" || p.type === "tools") &&
      sameTools(p.tools, n.tools)
    ) {
      n.tools = p.tools
    }
  }
  return next
}
