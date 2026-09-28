// Fila ÚNICA de interações pendentes, compartilhada pelo InteractionHost e
// por lib/fleet/derive. `answer` remove da fila na hora: o backend só emite
// interaction://resolved no Drop (run morto ou cancelado), nunca para uma
// resposta sua.

import { useSyncExternalStore } from "react"
import { avisar } from "@/lib/avisos"
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
import { summarizeApproval } from "@/lib/approvalSummary"
import {
  engineLabel,
  projectForCwd,
  sessionPlace,
} from "@/lib/externalSessions"
import {
  notifyApproval,
  notifyHookPermission,
  notifyQuestion,
} from "@/lib/notify"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useMission } from "@/store/mission"
import { approvalSignature } from "@/store/interactions/lote"
import { nomeDoProjeto, responderRecurso, textoDoPedido } from "@/lib/pedidosDeRecurso"
import type { ApprovalAnswer, RecursoData } from "@/lib/interaction"

interface InteractionsState {
  /** Pedidos pendentes em ordem de chegada (FIFO — a UI mostra o primeiro). */
  queue: InteractionRequest[]
  /** Agrega um pedido (dedup por id: re-emit / canal de compat não duplica). */
  push: (req: InteractionRequest) => void
  /** Backend resolveu (fail-closed no fim/cancel do run) → some da fila. */
  resolve: (id: string) => void
  /** Responde o backend e remove da fila na hora (o backend não emite resolved
   *  para respostas suas). */
  answer: (id: string, answer: InteractionAnswer) => void
  /** Dispensar manual (escape hatch): responde fail-closed e remove. */
  dismiss: (req: InteractionRequest) => void
  /** Aprovação em lote: responde todas as pendentes com esta assinatura, uma a
   *  uma via answer(). O grupo é recalculado na hora: quem saiu da fila entre o
   *  clique e a confirmação não é respondido. */
  answerGroup: (signature: string, allow: boolean) => void
}

export const useInteractions = create<InteractionsState>()((set, get) => ({
  queue: [],
  push: (req) => {
    // Pergunta vazia (lixo do modelo): responde fail-closed e nem enfileira.
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
    const req = queue.find((r) => r.id === id)
    set({ queue: queue.filter((r) => r.id !== id) })
    // Gate de PLANO é LOCAL: quem executa a decisão é o app, não o backend
    // (lib/planGate). Entregar aqui cairia sempre no catch abaixo.
    if (req?.kind === "plan") return
    // Pedido de RECURSO também é local (ADR-261): ligar o navegador, liberar o
    // computador ou dizer que não. Se falhar, o pedido volta para a fila.
    if (req?.kind === "recurso") {
      void responderRecurso(req, (answer as ApprovalAnswer).allow === true, (r) => get().push(r))
      return
    }
    // Não é best-effort: é a única entrega da sua decisão. O invoke pode falhar
    // com o run vivo, e o card já saiu da tela; sem o aviso, o turno ficaria
    // pendurado sem ninguém saber.
    void answerInteraction(id, answer).catch((e) => {
      console.error("[interações] resposta não entregue", id, e)
      // devolve o pedido pra fila: o card volta e você pode tentar de novo,
      // que é melhor que um turno parado sem sintoma.
      if (req) get().push(req)
      avisar.erro("Não consegui entregar sua resposta ao agente.", {
        origem: req ? { conversa: currentOriginAnyKind(req)?.convId ?? null } : undefined,
        detalhe: "O pedido voltou para a conversa. Tente responder de novo.",
      })
    })
  },
  // Dispensar um gate de plano é "continuar planejando" (a recusa dos CLIs),
  // não o fail-closed dos pedidos que travam um run.
  dismiss: (req) =>
    req.kind === "plan"
      ? get().answer(req.id, { decision: "keepPlanning" })
      : get().answer(req.id, failClosedAnswer(req.kind)),
  answerGroup: (signature, allow) => {
    // Ids de agora, não do clique: o grupo pode ter encolhido com a confirmação
    // aberta. answer() guarda por id, então não há resposta dupla nem a
    // fantasma.
    const ids = get()
      .queue.filter((r) => approvalSignature(r) === signature)
      .map((r) => r.id)
    for (const id of ids) get().answer(id, { allow })
  },
}))

// Aprovações em LOTE (frente P4): moram em `store/interactions/lote.ts`, que
// saiu daqui pela catraca de tamanho. A porta continua sendo este módulo.
export {
  approvalSignature,
  decideBatch,
  pendingGroup,
  type BatchAction,
  type BatchConfirm,
} from "@/store/interactions/lote"

// ---------------------------------------------------------------------------
// Aprovações contextuais: pedido → conversa e o split por visibilidade, para
// lib/fleet/derive e os hosts de card (inline no fluxo ou toast global).
// ---------------------------------------------------------------------------

/** Dono de um pedido pendente: a conversa + (missão) a fase resolvida do
 *  run_id. `phase` null = fase irresolvível (a conversa continua dona do
 *  pedido). */
export type InteractionTarget =
  | { convId: string; kind: "linear" }
  | { convId: string; kind: "mission"; phase: number | null }

/** Run de um pedido. O backend manda `run_id` irmão de `data` (approval.rs); o
 *  canal legado o replica dentro de `data`. Lê os dois. */
export function runIdOf(req: InteractionRequest): string | null {
  if (typeof req.run_id === "string" && req.run_id) return req.run_id
  const data = req.data as Partial<ApprovalData> | null | undefined
  return typeof data?.run_id === "string" && data.run_id ? data.run_id : null
}

/** Conversa dona de um pedido de APROVAÇÃO: linear (run_id = runId corrente)
 *  ou missão (prefixo `missionId::`, fase pelo sufixo `phase-N`). Só approval
 *  porque o consumidor que sobrou é a mão da mesa, que só sabe dizer
 *  "Aguardando aprovação". Para o dono de qualquer kind, use `ownerByRunId`. */
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
  // recorte, não cegueira: a pergunta tem dono (ownerByRunId resolve), só não
  // tem lugar nas superfícies que este helper alimenta.
  if (req.kind !== "approval") return null
  return ownerByRunId(req, chat, missions)
}

/** Conversa dona por run_id, sem filtro de kind: o backend anexa `run_id` em
 *  todo pedido (approval.rs). É a régua de "quem está esperando você":
 *  notificação, card inline e índice de espera da sidebar. */
export function ownerByRunId(
  req: InteractionRequest,
  chat: { byId: Record<string, { runId: string | null }> },
  missions: {
    byConv: Record<
      string,
      { id: string; current: number; phases: readonly unknown[] }
    >
  },
): InteractionTarget | null {
  // Gate de PLANO traz a conversa no payload: nasce com o turno já encerrado,
  // sem `run_id` vivo pra amarrar (lib/planGate). O pedido de RECURSO também
  // (ADR-261): o evento do backend já diz de qual conversa é.
  if (req.kind === "plan" || req.kind === "recurso") {
    const convId = (req.data as { convId?: string } | null)?.convId
    return convId ? { convId, kind: "linear" } : null
  }
  const runId = runIdOf(req)
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


// ---------------------------------------------------------------------------
// Origem (projeto · conversa) e índice de espera: o pedido é do projeto, e a
// sidebar acende onde a resposta é esperada.
// ---------------------------------------------------------------------------

// A porta de entrada continua sendo `@/store/interactions`: quem já importava
// o split daqui não precisa saber que ele mudou de arquivo.
import { computeContextualSplit as computeSplitLocal } from "@/store/interactions/split"

export {
  computeContextualSplit,
  useContextualSplit,
  type ContextualSplit,
} from "@/store/interactions/split"

/** De onde veio um pedido, em nomes que dá pra ler no card. */
export interface InteractionOrigin {
  convId: string
  projectId: string
  /** Nome do projeto dono (fallback genérico se ele não está carregado). */
  projectName: string
  /** Título da conversa dona (idem). */
  convTitle: string
}

/** Metas mínimas que a origem precisa (estrutural: o store real satisfaz). */
interface ConvMetaLike {
  id: string
  title?: string | null
}

/** Projeto e conversa de um pedido de aprovação, para o cabeçalho do card.
 *  null quando o dono é irresolvível ou o kind não é approval; para qualquer
 *  kind, `currentOriginAnyKind`. */
export function originForInteraction(
  req: InteractionRequest,
  chat: {
    byId: Record<string, { runId: string | null; projectId?: string }>
    conversations: ConvMetaLike[]
    conversationsByProject: Record<string, ConvMetaLike[]>
  },
  app: { projects: { id: string; name: string }[] },
  missions: {
    byConv: Record<
      string,
      { id: string; current: number; phases: readonly unknown[] }
    >
  },
): InteractionOrigin | null {
  return originFrom(convIdForInteraction(req, chat, missions), chat, app)
}

/** Monta a origem a partir de um alvo JÁ resolvido (compartilhado pelas duas
 *  réguas: a approval-only e a de qualquer kind). */
function originFrom(
  target: InteractionTarget | null,
  chat: {
    byId: Record<string, { runId: string | null; projectId?: string }>
    conversations: ConvMetaLike[]
    conversationsByProject: Record<string, ConvMetaLike[]>
  },
  app: { projects: { id: string; name: string }[] },
): InteractionOrigin | null {
  if (!target) return null
  const { convId } = target
  const projectId = chat.byId[convId]?.projectId ?? ""
  // usa a lista do projeto DONO (o turno pode ter rodado em background, fora do
  // espelho `conversations` do projeto ativo) — mesma régua do notifyTurnEnd.
  const metas = chat.conversationsByProject[projectId] ?? chat.conversations
  const meta = metas.find((c) => c.id === convId)
  return {
    convId,
    projectId,
    projectName: app.projects.find((p) => p.id === projectId)?.name ?? "Projeto",
    convTitle: meta?.title?.trim() || "Conversa",
  }
}

/** Origem de QUALQUER kind (approval E question), a partir dos stores vivos. É o
 *  que a notificação e a tray usam: o aviso precisa dizer de qual conversa e
 *  projeto o pedido veio, e levar você até lá, seja permissão ou pergunta. */
export function currentOriginAnyKind(
  req: InteractionRequest,
): InteractionOrigin | null {
  const chat = useChat.getState()
  return originFrom(
    ownerByRunId(req, chat, useMission.getState()),
    chat,
    useApp.getState(),
  )
}

/** Origem a partir dos stores vivos (atalho do caminho de UI/notificação). */
export function currentOrigin(req: InteractionRequest): InteractionOrigin | null {
  return originForInteraction(
    req,
    useChat.getState(),
    useApp.getState(),
    useMission.getState(),
  )
}

/** Onde há pedido pendente (permissão OU pergunta) — alimenta os sinais da
 *  sidebar (conversa e projeto). Sets prontos p/ `.has()` na render de cada
 *  linha. Os dois kinds param o turno, então os dois acendem. */
export interface AwaitingIndex {
  convIds: Set<string>
  projectIds: Set<string>
}

const EMPTY_AWAITING: AwaitingIndex = {
  convIds: new Set(),
  projectIds: new Set(),
}

/** Chave estável do índice (string ordenada: streaming não re-renderiza a
 *  árvore). */
/** Quantas decisões esperam por você: CONVERSAS distintas, não pedidos (20
 *  `Bash` idênticos são uma decisão, "Aprovar todas"). Pedido órfão conta
 *  como um. Pura. */
export function awaitingDecisionCount(
  queue: InteractionRequest[],
  chat: { byId: Record<string, { runId: string | null }> },
  missions: {
    byConv: Record<
      string,
      { id: string; current: number; phases: readonly unknown[] }
    >
  },
): number {
  const convs = new Set<string>()
  for (const req of queue) {
    const target = ownerByRunId(req, chat, missions)
    convs.add(target?.convId ?? `orfao:${req.id}`)
  }
  return convs.size
}

export function awaitingKey(
  queue: InteractionRequest[],
  chat: {
    byId: Record<string, { runId: string | null; projectId?: string }>
  },
  missions: {
    byConv: Record<
      string,
      { id: string; current: number; phases: readonly unknown[] }
    >
  },
): string {
  const pairs = new Set<string>()
  for (const req of queue) {
    // Sem filtro de kind: uma pergunta deixa o turno tão parado quanto uma
    // permissão, e precisa acender a conversa na sidebar.
    const target = ownerByRunId(req, chat, missions)
    if (!target) continue
    // `convId|projectId`, pares separados por vírgula: os ids são uuid e nunca
    // contêm nenhum dos dois separadores.
    pairs.add(`${target.convId}|${chat.byId[target.convId]?.projectId ?? ""}`)
  }
  return [...pairs].sort().join(",")
}

let awaitingCacheKey: string | null = null
let awaitingCache: AwaitingIndex = EMPTY_AWAITING

function awaitingSnapshot(): AwaitingIndex {
  const key = awaitingKey(
    useInteractions.getState().queue,
    useChat.getState(),
    useMission.getState(),
  )
  if (key === awaitingCacheKey) return awaitingCache
  awaitingCacheKey = key
  awaitingCache = key
    ? {
        convIds: new Set(key.split(",").map((p) => p.split("|")[0])),
        projectIds: new Set(
          key
            .split(",")
            .map((p) => p.split("|")[1])
            .filter(Boolean),
        ),
      }
    : EMPTY_AWAITING
  return awaitingCache
}

function subscribeAwaiting(cb: () => void): () => void {
  const unsubs = [
    useInteractions.subscribe(cb),
    useChat.subscribe(cb),
    useMission.subscribe(cb),
  ]
  return () => {
    for (const u of unsubs) u()
  }
}

/** Conversas/projetos esperando você (permissão ou pergunta pendente), com ref
 *  estável entre mudanças. */
export function useAwaiting(): AwaitingIndex {
  return useSyncExternalStore(subscribeAwaiting, awaitingSnapshot)
}

/** Resumo de uma linha de um pedido de PERGUNTA: o `header` da 1ª pergunta (é o
 *  rótulo curto que o próprio modelo escolheu), com o enunciado como reserva.
 *  Puro — testado direto. */
export function questionHeadline(data: QuestionData | undefined): string {
  const first = data?.questions?.[0]
  const header = (first?.header ?? "").trim()
  if (header) return header
  const q = (first?.question ?? "").trim()
  if (!q) return "uma decisão"
  return q.length > 60 ? `${q.slice(0, 60)}…` : q
}

/** Avisa que chegou interação bloqueante (sino e nativa fora da vista), para
 *  approval e question: as duas param o turno. `before` é a fila antes do
 *  push: conversa que já tinha pedido pendente não avisa de novo. Exportada
 *  para teste. */
export function announceArrival(
  req: InteractionRequest,
  before: InteractionRequest[],
): void {
  // anyKind: o `convIdForInteraction` filtra approval (é o recorte das
  // superfícies de permissão); aqui precisamos do dono de QUALQUER pedido
  // bloqueante — mesma régua do split contextual e do índice de espera.
  const origin = currentOriginAnyKind(req)
  if (!origin) {
    // Permissão de HOOK (H2 do hooks-plan): sessão EXTERNA no terminal, sem
    // conversa dona POR DESENHO (não somos donos dela). Ainda assim avisa:
    // a janela de resposta é de 30s e o pedido nasceu fora do app.
    const hook = (req.data as Partial<ApprovalData> | null | undefined)?.hook
    if (req.kind === "approval" && hook) {
      const projects = useApp.getState().projects
      const project = projectForCwd(hook.cwd ?? "", projects)
      const data = req.data as ApprovalData
      notifyHookPermission({
        engine: engineLabel(hook.engine),
        place: sessionPlace({ cwd: hook.cwd ?? "" }, projects),
        projectId: project?.id ?? null,
        toolName: (data?.tool_name ?? "").trim() || "uma tool",
        headline: summarizeApproval(data ?? ({} as ApprovalData)).headline,
      })
    }
    return // run órfão sem origem de hook: não há onde mandar você
  }

  const chat = useChat.getState()
  const missions = useMission.getState()
  const burst = before.some(
    (r) => ownerByRunId(r, chat, missions)?.convId === origin.convId,
  )
  if (burst) return

  // "visível" = o card vai renderizar inline NESTA conversa E a janela está em
  // foco. Fora disso (outro projeto, outro modo, app em background) a nativa é
  // o único sinal que te alcança.
  const split = computeSplitLocal()
  const focused = typeof document !== "undefined" && document.hasFocus()
  const seen = split.inlineConvId === origin.convId && focused

  if (req.kind === "recurso") {
    // Autorização de recurso é uma permissão: mesmo sino e mesma nativa.
    const data = req.data as RecursoData
    const texto = textoDoPedido(data, nomeDoProjeto(data.projectPath))
    notifyApproval({ ...origin, toolName: texto.oQue, headline: texto.resumo, seen })
    return
  }

  if (req.kind === "question") {
    const data = req.data as QuestionData | undefined
    notifyQuestion({
      projectId: origin.projectId,
      convId: origin.convId,
      projectName: origin.projectName,
      convTitle: origin.convTitle,
      headline: questionHeadline(data),
      count: data?.questions?.length ?? 1,
      seen,
    })
    return
  }

  const data = req.data as ApprovalData
  notifyApproval({
    projectId: origin.projectId,
    convId: origin.convId,
    projectName: origin.projectName,
    convTitle: origin.convTitle,
    toolName: (data?.tool_name ?? "").trim() || "uma tool",
    headline: summarizeApproval(data ?? ({} as ApprovalData)).headline,
    seen,
  })
}

// A fila se alimenta no import do módulo (o App.tsx importa cedo), então
// approvals do boot entram antes de qualquer superfície montar. Os listeners
// vivem a vida inteira do app. Fora do Tauri não há eventos.
if (isTauri()) {
  void onInteractionRequest((req) => {
    const before = useInteractions.getState().queue
    useInteractions.getState().push(req)
    // só avisa o que REALMENTE entrou na fila: `push` descarta id duplicado
    // (re-emit + canal de compat) e question vazia (fail-closed).
    if (useInteractions.getState().queue.length > before.length) {
      announceArrival(req, before)
    }
  }).catch((e) => {
    // Sem este listener não existe pedido de permissão NENHUM nesta sessão: a
    // feature inteira apaga e o sintoma é "o agent travou sozinho". Falha rara,
    // custo de diagnosticar altíssimo — por isso grita.
    console.error("[interações] listener de pedidos não registrou", e)
    avisar.erro("Pedidos de permissão não vão aparecer nesta sessão.", {
      detalhe: "Reinicie o app. Enquanto isso, turnos que pedirem permissão podem ficar parados.",
      duracao: Infinity,
    })
  })
  void onInteractionResolved((id) =>
    useInteractions.getState().resolve(id),
  ).catch((e) =>
    // menos grave (o `answer` já remove da fila localmente), mas sem ele um card
    // resolvido pelo backend fica na tela até você dispensar.
    console.warn("[interações] listener de resolvidos não registrou", e),
  )
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
