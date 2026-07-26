// Modelo de NÓS de render do fio de chat: agrupa os itens brutos (texto, tools,
// results…) nos blocos que a UI desenha. Fica FORA do componente pra ser testável
// puro e não estragar o fast-refresh do MessageList.
import { isTaskTool } from "@/lib/tasks"
import type { ChatItem } from "@/store/chat"

export type ToolItem = Extract<ChatItem, { kind: "tool" }>

/** Nó de render: item comum, prosa costurada (+ tools do turno), burst de tools
 *  solto, ou A checklist (task tools). */
export type Node =
  | { type: "item"; key: string; item: ChatItem }
  | { type: "prose"; key: string; text: string; tools: ToolItem[] }
  | { type: "tools"; key: string; tools: ToolItem[] }
  | { type: "tasklist"; key: string }

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
  let taskShown = false
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
    if (it.kind === "tool" && isTaskTool(it.name)) {
      flush()
      if (!taskShown) {
        nodes.push({ type: "tasklist", key: it.id })
        taskShown = true
      }
      continue
    }
    if (it.kind === "tool") {
      if (!seg) seg = { key: it.id, texts: [], tools: [] }
      seg.tools.push(it)
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
    // outros kinds (user/error/limit/cancelled/notice/result final).
    flush()
    nodes.push({ type: "item", key: it.id, item: it })
  }
  flush()
  return nodes
}
