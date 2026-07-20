// Fila ÚNICA de interações pendentes (§6.1 item 4 do docs/agent-office.md).
// Fonte de verdade compartilhada entre o InteractionHost (card na UI) e o
// bridge/derive do office (mão levantada na mesa). Antes cada um mantinha a
// própria cópia (useState local + Map de módulo) e elas divergiam:
// answer_interaction NÃO emite interaction://resolved (o backend só emite no
// Drop, e só para pendentes), então quem esperava o evento ficava com a mão
// levantada o resto do turno. Aqui `answer` REMOVE da fila imediatamente
// (fail-closed local); o resolved do Drop cobre o resto (run morto/cancelado).

import { create } from "zustand"
import { isTauri } from "@/lib/db"
import {
  answerInteraction,
  failClosedAnswer,
  onInteractionRequest,
  onInteractionResolved,
  type InteractionAnswer,
  type InteractionRequest,
  type QuestionData,
} from "@/lib/interaction"

interface InteractionsState {
  /** Pedidos pendentes em ordem de chegada (FIFO — a UI mostra o primeiro). */
  queue: InteractionRequest[]
  /** Agrega um pedido (dedup por id: re-emit / canal de compat não duplica). */
  push: (req: InteractionRequest) => void
  /** Backend resolveu (fail-closed no fim/cancel do run) → some da fila. */
  resolve: (id: string) => void
  /** Responde o backend E remove da fila NA HORA: o backend não emite resolved
   *  para respostas do usuário (só o Drop emite), então esperar confirmação
   *  deixava card/mão pendurados. Envio best-effort — se falhar, o run já
   *  morreu e o Drop fail-closed cobre o lado de lá. */
  answer: (id: string, answer: InteractionAnswer) => void
  /** Dispensar manual (escape hatch): responde fail-closed e remove. */
  dismiss: (req: InteractionRequest) => void
}

export const useInteractions = create<InteractionsState>()((set, get) => ({
  queue: [],
  push: (req) => {
    // pergunta VAZIA (modelo mandou lixo): sem guard o card habilitava
    // "Responder" vacuamente (achado M4) → responde fail-closed e nem enfileira.
    if (req.kind === "question") {
      const d = req.data as QuestionData | null | undefined
      if (!d?.questions?.length) {
        void answerInteraction(req.id, failClosedAnswer("question")).catch(
          () => {},
        )
        return
      }
    }
    set((s) =>
      s.queue.some((r) => r.id === req.id) ? s : { queue: [...s.queue, req] },
    )
  },
  resolve: (id) =>
    set((s) =>
      s.queue.some((r) => r.id === id)
        ? { queue: s.queue.filter((r) => r.id !== id) }
        : s,
    ),
  answer: (id, answer) => {
    const { queue } = get()
    if (!queue.some((r) => r.id === id)) return // já respondido/resolvido
    set({ queue: queue.filter((r) => r.id !== id) })
    void answerInteraction(id, answer).catch(() => {})
  },
  dismiss: (req) => get().answer(req.id, failClosedAnswer(req.kind)),
}))

// Alimentação ÚNICA da fila: assina os eventos globais no IMPORT do módulo —
// o App.tsx importa cedo (side-effect), então approvals disparados no boot já
// entram na fila antes da 1ª visita ao office. Listeners vivem a vida inteira
// do app (sem unlisten, de propósito). Fora do Tauri não há eventos (o
// sim-data do office cobre o dev no browser).
if (isTauri()) {
  void onInteractionRequest((req) =>
    useInteractions.getState().push(req),
  ).catch(() => {})
  void onInteractionResolved((id) =>
    useInteractions.getState().resolve(id),
  ).catch(() => {})
}
