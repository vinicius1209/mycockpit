// Fila ÚNICA de interações pendentes (§6.1 item 4 do docs/agent-office.md).
// Fonte de verdade compartilhada entre o InteractionHost (card na UI) e o
// bridge/derive do office (mão levantada na mesa). Antes cada um mantinha a
// própria cópia (useState local + Map de módulo) e elas divergiam:
// answer_interaction NÃO emite interaction://resolved (o backend só emite no
// Drop, e só para pendentes), então quem esperava o evento ficava com a mão
// levantada o resto do turno. Aqui `answer` REMOVE da fila imediatamente
// (fail-closed local); o resolved do Drop cobre o resto (run morto/cancelado).

import { useSyncExternalStore } from "react"
import { create } from "zustand"
import { isTauri } from "@/lib/db"
import {
  answerInteraction,
  failClosedAnswer,
  onInteractionRequest,
  onInteractionResolved,
  type ApprovalData,
  type InteractionAnswer,
  type InteractionRequest,
  type QuestionData,
} from "@/lib/interaction"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useMission } from "@/store/mission"

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
  /** Aprovações em LOTE: responde TODAS as pendentes com esta assinatura
   *  (approvalSignature), uma a uma via answer() — o guard síncrono garante um
   *  envio por pedido. Recomputa o grupo NA HORA da chamada: quem sumiu da
   *  fila entre o clique e a confirmação (resolved do Drop) NÃO é respondido. */
  answerGroup: (signature: string, allow: boolean) => void
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
  answerGroup: (signature, allow) => {
    // snapshot dos ids AGORA (não do momento do clique): o grupo pode ter
    // encolhido enquanto a confirmação estava aberta. O loop é síncrono e
    // answer() guarda por id — sem resposta dupla nem resposta a fantasma.
    const ids = get()
      .queue.filter((r) => approvalSignature(r) === signature)
      .map((r) => r.id)
    for (const id of ids) get().answer(id, { allow })
  },
}))

// ---------------------------------------------------------------------------
// Aprovações em LOTE (frente P4): agrupamento por ASSINATURA + confirmação
// explícita. Funções PURAS (testáveis sem UI); a execução real é answerGroup.
// ---------------------------------------------------------------------------

/** Assinatura de agrupamento de UMA aprovação: tool_name + comando EXATO (só
 *  trim nas pontas — "bun test" ≠ "rm -rf", e também ≠ "bun  test"; normalizar
 *  demais aprovaria comando que o usuário não leu). Tools sem comando (Write
 *  etc.) usam o input serializado — "idêntica" tem que ser idêntica MESMO.
 *  Questions e kinds desconhecidos NUNCA agrupam ⇒ null. */
export function approvalSignature(req: InteractionRequest): string | null {
  if (req.kind !== "approval") return null
  const d = req.data as Partial<ApprovalData> | null | undefined
  const tool = typeof d?.tool_name === "string" ? d.tool_name.trim() : ""
  if (!tool) return null
  const cmd = typeof d?.command === "string" ? d.command.trim() : ""
  if (cmd) return `${tool}\u0000cmd\u0000${cmd}`
  try {
    return `${tool}\u0000input\u0000${JSON.stringify(d?.input ?? null)}`
  } catch {
    return null // input cíclico/não-serializável: não agrupa (fail-safe)
  }
}

/** Grupo pendente do request na fila (ele incluso). <2 ⇒ sem lote na UI. */
export function pendingGroup(
  queue: InteractionRequest[],
  req: InteractionRequest,
): InteractionRequest[] {
  const sig = approvalSignature(req)
  if (!sig) return []
  return queue.filter((r) => approvalSignature(r) === sig)
}

/** Confirmação pendente de um lote (o que o card mostra antes de executar). */
export interface BatchConfirm {
  signature: string
  allow: boolean
  count: number
}

export type BatchAction =
  | { type: "request"; confirm: BatchConfirm }
  | { type: "confirm" }
  | { type: "cancel" }

/** Decisão PURA do fluxo "Aprovar/Negar todas": clicar NUNCA executa direto —
 *  vira uma confirmação pendente (comando + contagem na tela); só o clique de
 *  confirmar com uma pendência ativa produz `execute`. */
export function decideBatch(
  pending: BatchConfirm | null,
  action: BatchAction,
): {
  pending: BatchConfirm | null
  execute: { signature: string; allow: boolean } | null
} {
  switch (action.type) {
    case "request":
      return { pending: action.confirm, execute: null }
    case "confirm":
      return pending
        ? {
            pending: null,
            execute: { signature: pending.signature, allow: pending.allow },
          }
        : { pending: null, execute: null }
    case "cancel":
      return { pending: null, execute: null }
  }
}

// ---------------------------------------------------------------------------
// Aprovações CONTEXTUAIS (docs/agent-office.md §8): mapeamento request→conversa
// + split por visibilidade. O mesmo helper alimenta o office (mão levantada na
// mesa, bridge/derive) e os hosts de card (inline no fluxo vs toast global).
// ---------------------------------------------------------------------------

/** Dono de um pedido pendente: a conversa + (missão) a fase resolvida do
 *  run_id. `phase` null = fase irresolvível (sem mesa no office, mas a
 *  conversa continua dona do pedido). */
export type InteractionTarget =
  | { convId: string; kind: "linear" }
  | { convId: string; kind: "mission"; phase: number | null }

/** Conversa DONA de um request (extraído do bridge/derive — fonte única):
 *  - linear: run_id === runId corrente da conversa (turno pausado);
 *  - missão: run_id tem prefixo `missionId::` e casa com byConv; a fase vem do
 *    sufixo `phase-N` (fallback: fase corrente);
 *  - question NÃO carrega run_id ⇒ null (sempre no host global). */
export function convIdForInteraction(
  req: InteractionRequest,
  chat: { byId: Record<string, { runId: string | null }> },
  missions: {
    byConv: Record<
      string,
      { id: string; current: number; phases: readonly unknown[] }
    >
  },
): InteractionTarget | null {
  if (req.kind !== "approval") return null
  const data = req.data as Partial<ApprovalData> | null | undefined
  const runId = typeof data?.run_id === "string" ? data.run_id : null
  if (!runId) return null
  // turno linear: run_id É o runId corrente da conversa.
  for (const [convId, c] of Object.entries(chat.byId)) {
    if (c.runId === runId) return { convId, kind: "linear" }
  }
  // missão: prefixo `missionId::`; a fase sai do sufixo `phase-N`.
  for (const [convId, run] of Object.entries(missions.byConv)) {
    if (!runId.startsWith(`${run.id}::`)) continue
    const m = /^phase-(\d+)$/.exec(runId.slice(run.id.length + 2))
    const idx = m ? Number(m[1]) : run.current
    const phase =
      run.phases[idx] != null
        ? idx
        : run.phases[run.current] != null
          ? run.current
          : null
    return { convId, kind: "mission", phase }
  }
  return null
}

/** Split derivado por VISIBILIDADE: pedidos da conversa visível na tela saem
 *  do toast global e renderizam INLINE no fluxo (nunca os dois ao mesmo tempo). */
export interface ContextualSplit {
  /** Pedidos da conversa VISÍVEL (viewMode linear + !scheduledOpen + ativa). */
  inline: InteractionRequest[]
  /** Dona dos `inline` (o convId visível); null = nada inline. Guarda dos
   *  componentes: só a superfície DESSA conversa renderiza os cards. */
  inlineConvId: string | null
  /** O resto — toast global no canto, como sempre (inclui question sem run_id,
   *  conversa não-ativa, outros viewModes: office/painel/sdd/agendado). */
  global: InteractionRequest[]
}

const EMPTY_SPLIT: ContextualSplit = { inline: [], inlineConvId: null, global: [] }

/** Computa o split a partir dos stores (puro sobre getState; exportado p/
 *  teste). Office/painel/sdd/agendado ⇒ nenhuma conversa visível ⇒ tudo global. */
export function computeContextualSplit(): ContextualSplit {
  const queue = useInteractions.getState().queue
  if (queue.length === 0) return EMPTY_SPLIT
  const app = useApp.getState()
  const visible =
    app.viewMode === "linear" && !app.scheduledOpen
      ? useChat.getState().activeId
      : null
  if (!visible) return { inline: [], inlineConvId: null, global: queue }
  const chat = useChat.getState()
  const missions = useMission.getState()
  const inline: InteractionRequest[] = []
  const global: InteractionRequest[] = []
  for (const req of queue) {
    const target = convIdForInteraction(req, chat, missions)
    if (target?.convId === visible) inline.push(req)
    else global.push(req)
  }
  return {
    inline,
    inlineConvId: inline.length > 0 ? visible : null,
    global,
  }
}

function sameReqs(a: InteractionRequest[], b: InteractionRequest[]): boolean {
  return a.length === b.length && a.every((r, i) => r === b[i])
}

// Cache por VALOR (refs dos requests são estáveis na fila): o chat streamando
// dispara o subscribe a cada token, mas o snapshot devolve a MESMA ref se o
// split não mudou de membros — useSyncExternalStore não re-renderiza.
let splitCache: ContextualSplit = EMPTY_SPLIT

function splitSnapshot(): ContextualSplit {
  const next = computeContextualSplit()
  if (
    next === splitCache ||
    (next.inlineConvId === splitCache.inlineConvId &&
      sameReqs(next.inline, splitCache.inline) &&
      sameReqs(next.global, splitCache.global))
  ) {
    return splitCache
  }
  splitCache = next
  return next
}

function subscribeSplit(cb: () => void): () => void {
  const unsubs = [
    useInteractions.subscribe(cb),
    useApp.subscribe(cb),
    useChat.subscribe(cb),
    useMission.subscribe(cb),
  ]
  return () => {
    for (const u of unsubs) u()
  }
}

/** Seletor derivado das aprovações contextuais: {inline, global} com refs
 *  estáveis. Responder em qualquer host remove da fila (answer é síncrono no
 *  store) ⇒ o outro host nunca pisca o mesmo request. */
export function useContextualSplit(): ContextualSplit {
  return useSyncExternalStore(subscribeSplit, splitSnapshot)
}

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

// Loop visual (dev no browser, SEM Tauri — não entra no build): expõe os
// stores no window pra simular pedidos/missões pelo console e conferir o
// split contextual a olho (ex.: __mcStores.useInteractions.getState().push(...)).
if (import.meta.env.DEV && !isTauri() && typeof window !== "undefined") {
  ;(window as unknown as Record<string, unknown>).__mcStores = {
    useInteractions,
    useApp,
    useChat,
    useMission,
  }
}
