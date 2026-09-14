// A conversa como o COMPOSER a enxerga: a mesma referência enquanto a única
// mudança for o texto da bolha em streaming.
//
// Por que existe (ADR-190): o `CommandConsole` lia `useActiveConv()`, então o
// composer inteiro re-renderizava por token. Cada render recriava props de
// filhos e reacendia efeitos que gravam estado (a busca de menções, a âncora do
// menu de modo). Numa conversa longa os commits encavalavam, o React desistia
// no 51º (#185) e a exceção congelava o canal do run. O composer não mostra o
// texto que está chegando; ele precisa saber de turno, fila, anexos, diferidos
// e identidade. Nenhum desses muda quando só a prosa cresce.

import { useRef } from "react"
import { emptyConv, useChat, type ChatItem, type ConvState } from "@/store/chat"

const VAZIA = emptyConv("")

/** `items` é comparado à parte. `runLiveness` é a telemetria do processo, trocada
 *  a CADA evento (ADR-183) e lida só pelo indicador de trabalho, que tem seletor
 *  próprio; nada no composer a usa. */
const IGNORADOS = new Set(["items", "runLiveness"])

function soOTextoCresceu(a: ChatItem, b: ChatItem): boolean {
  if (a.kind !== "text" || b.kind !== "text" || a.id !== b.id) return false
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (k === "text") continue
    if (!Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
  }
  return true
}

/** Puro: `b` difere de `a` só no texto de UMA bolha de texto já existente?
 *  Item novo, item de outro tipo mudando (ferramenta, diferido) ou qualquer
 *  campo da conversa fora de `items` contam como mudança real. A varredura
 *  compara referências (o reducer preserva a identidade dos outros itens). */
export function mesmaConversaParaOComposer(a: ConvState, b: ConvState): boolean {
  if (a === b) return true
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (IGNORADOS.has(k)) continue
    if (!Object.is((a as unknown as Record<string, unknown>)[k], (b as unknown as Record<string, unknown>)[k])) return false
  }
  if (a.items === b.items) return true
  if (a.items.length !== b.items.length) return false
  let mudadas = 0
  for (let i = a.items.length - 1; i >= 0; i--) {
    if (a.items[i] === b.items[i]) continue
    if (!soOTextoCresceu(a.items[i], b.items[i]) || ++mudadas > 1) return false
  }
  return true
}

/** Conversa ativa para o composer. Troca de referência só em mudança que o
 *  composer usa; o texto em streaming fica com o fio, não com o composer. */
export function useConvDoComposer(): ConvState {
  const anterior = useRef<ConvState | null>(null)
  return useChat((s) => {
    const atual = (s.activeId ? s.byId[s.activeId] : undefined) ?? VAZIA
    const prev = anterior.current
    if (prev && mesmaConversaParaOComposer(prev, atual)) return prev
    anterior.current = atual
    return atual
  })
}
