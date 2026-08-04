// Modelo de NÓS de render do fio de chat: agrupa os itens brutos (texto, tools,
// results…) nos blocos que a UI desenha. Fica FORA do componente pra ser testável
// puro e não estragar o fast-refresh do MessageList.
import { isTaskTool } from "@/lib/tasks"
import type { ChatItem } from "@/store/chat"

export type ToolItem = Extract<ChatItem, { kind: "tool" }>
export type ResultItem = Extract<ChatItem, { kind: "result" }>

/** Incidente terminal normalizado para a UI. `result` continua anexado ao nó
 * para que custo, duração e tokens não desapareçam quando históricos antigos
 * são curados. `details` guarda o texto cru do provider, recolhido por padrão. */
export interface IncidentNode {
  type: "incident"
  key: string
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
  | { type: "prose"; key: string; text: string; tools: ToolItem[] }
  | { type: "tools"; key: string; tools: ToolItem[] }
  | { type: "plan"; key: string; anchorId: string }
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
      severity,
      message: message || fallbackMessage,
      resetHint,
      details: uniqueDetails(details),
      result,
    },
    end,
  }
}

/** Continuação de prosa: o corte entre `prev` e `next` foi ARTIFICIAL — o modelo
 *  interrompeu a narração (às vezes no meio da palavra) pra chamar uma tool e
 *  retomou depois. Curamos SÓ esses; frase fechada ou parágrafo/sentença nova
 *  seguem separados (é o ritmo natural, não um corte). Como o modelo parte o
 *  fluxo de caracteres cru, concatenar direto restaura o texto original. */
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

/** Agrupa um TURNO: a narração do agente (costurando fragmentos cortados no meio
 *  por tool use interleaved) vira UMA bolha; as tools que ela disparou viram um
 *  grupo compacto logo depois. Frases completas separadas por tools continuam
 *  passos distintos. Task tools somem do fluxo e viram UMA checklist. */
export function buildNodes(items: ChatItem[]): Node[] {
  const nodes: Node[] = []
  let planShownInTurn = false
  // O stream do Claude entrega tools dos subagentes separadas, mas com
  // `parentToolId`. Reúne os descendentes antecipadamente: o nó raiz viaja com
  // todo o galho e os filhos não reaparecem como bursts soltos.
  const childrenByParent = new Map<string, ToolItem[]>()
  for (const item of items) {
    if (item.kind !== "tool" || !item.parentToolId) continue
    const children = childrenByParent.get(item.parentToolId) ?? []
    children.push(item)
    childrenByParent.set(item.parentToolId, children)
  }
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
  let seg: { key: string; texts: string[]; tools: ToolItem[] } | null = null
  const flush = () => {
    if (!seg) return
    if (seg.texts.length) {
      nodes.push({
        type: "prose",
        key: seg.key,
        text: seg.texts.join(""),
        tools: seg.tools,
      })
    } else if (seg.tools.length) {
      nodes.push({ type: "tools", key: seg.key, tools: seg.tools })
    }
    seg = null
  }
  for (let i = 0; i < items.length; i++) {
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
    // Filho já será desenhado sob a tool `Task`/agent que o originou.
    if (it.kind === "tool" && it.parentToolId) continue
    if (it.kind === "tool" && isTaskTool(it.name)) {
      flush()
      if (it.name === "TaskCreate" && !planShownInTurn) {
        nodes.push({ type: "plan", key: it.id, anchorId: it.id })
        planShownInTurn = true
      }
      continue
    }
    if (it.kind === "tool") {
      if (!seg) seg = { key: it.id, texts: [], tools: [] }
      seg.tools.push(...withDescendants(it))
      continue
    }
    if (it.kind === "text") {
      // continuação do que já vinha sendo dito → costura na MESMA bolha; senão,
      // fecha o passo anterior (levando as tools dele) e abre um novo.
      if (seg && seg.texts.length && continuesProse(seg.texts.join(""), it.text)) {
        seg.texts.push(it.text)
      } else {
        flush()
        seg = { key: it.id, texts: [it.text], tools: [] }
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
  return nodes
}
