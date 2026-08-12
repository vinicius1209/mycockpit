// Fila ÚNICA de interações pendentes (§6.1 item 4 do docs/agent-office.md,
// doc histórico). Fonte de verdade compartilhada entre o InteractionHost
// (card na UI) e o lib/fleet/derive. Antes cada um mantinha a
// própria cópia (useState local + Map de módulo) e elas divergiam:
// answer_interaction NÃO emite interaction://resolved (o backend só emite no
// Drop, e só para pendentes), então quem esperava o evento ficava com a mão
// levantada o resto do turno. Aqui `answer` REMOVE da fila imediatamente
// (fail-closed local); o resolved do Drop cobre o resto (run morto/cancelado).

import { useSyncExternalStore } from "react"
import { toast } from "sonner"
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
    const req = queue.find((r) => r.id === id)
    set({ queue: queue.filter((r) => r.id !== id) })
    // Isto NÃO é best-effort: é a ÚNICA entrega da sua decisão. O comentário
    // antigo supunha "se falhou, o run já morreu e o Drop do backend cobre" —
    // suposição, não fato: o invoke pode falhar com o run VIVO, e aí o card já
    // saiu da tela (a linha acima removeu) e o turno fica pendurado sem que
    // ninguém saiba. Mesmo desenho que deixou a notificação nativa morta por
    // meses atrás de um catch vazio.
    void answerInteraction(id, answer).catch((e) => {
      console.error("[interações] resposta não entregue", id, e)
      // devolve o pedido pra fila: o card volta e você pode tentar de novo,
      // que é melhor que um turno parado sem sintoma.
      if (req) get().push(req)
      toast.error("Não consegui entregar sua resposta ao agent.", {
        description: "O pedido voltou para a fila — tente responder de novo.",
      })
    })
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
// Aprovações CONTEXTUAIS (docs/agent-office.md §8, doc histórico): mapeamento
// request→conversa + split por visibilidade. O mesmo helper alimenta o
// lib/fleet/derive e os hosts de card (inline no fluxo vs toast global).
// ---------------------------------------------------------------------------

/** Dono de um pedido pendente: a conversa + (missão) a fase resolvida do
 *  run_id. `phase` null = fase irresolvível (a conversa continua dona do
 *  pedido). */
export type InteractionTarget =
  | { convId: string; kind: "linear" }
  | { convId: string; kind: "mission"; phase: number | null }

/** Run de um pedido. O backend serializa `run_id` IRMÃO de `data` (approval.rs);
 *  o canal de compat legado (`approval://request`) o replica dentro de `data`.
 *  Ler só um dos dois deixava o roteamento cego: com o topo vazio TODO approval
 *  caía no host global, mesmo com a conversa dona aberta na tela. */
export function runIdOf(req: InteractionRequest): string | null {
  if (typeof req.run_id === "string" && req.run_id) return req.run_id
  const data = req.data as Partial<ApprovalData> | null | undefined
  return typeof data?.run_id === "string" && data.run_id ? data.run_id : null
}

/** Conversa DONA de um pedido de APROVAÇÃO (extraído do lib/fleet/derive):
 *  - linear: run_id === runId corrente da conversa (turno pausado);
 *  - missão: run_id tem prefixo `missionId::` e casa com byConv; a fase vem do
 *    sufixo `phase-N` (fallback: fase corrente).
 *
 *  Restrito a `approval` de propósito, mas o MOTIVO não é "pergunta não tem dono"
 *  (tem: o backend anexa run_id em todo pedido — ver `ownerByRunId`). É que o
 *  ÚNICO consumidor que sobrou fala só de permissão: o snapshot da frota
 *  levanta a mão com o rótulo "Aguardando aprovação" (lib/fleet/derive), e
 *  levantá-la por uma pergunta seria mentir sobre o que o agente pediu.
 *
 *  ⚠️ Se você precisa do dono para QUALQUER kind, use `ownerByRunId`. Foi essa
 *  confusão que deixou o companion mostrando pergunta pendente sem conversa, sem
 *  projeto e sem agent: ele resolvia o alvo UMA vez com esta régua e reusava no
 *  ramo `question`, onde ela devolve null. */
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

/** Conversa dona por run_id, SEM filtro de kind. O `handle_conn` do backend
 *  anexa `run_id` em TODO pedido (approval e question — approval.rs, onde o campo
 *  é `String`, não Option), então o dono de uma pergunta é tão resolvível quanto
 *  o de uma permissão. É a régua de "quem está esperando você": notificação
 *  (sino/nativa), split contextual (card inline na conversa dona) e índice de
 *  espera da sidebar. O `convIdForInteraction` fica com o recorte approval-only
 *  das superfícies que só sabem falar de permissão. */
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

/** Split derivado por VISIBILIDADE: pedidos da conversa visível na tela saem
 *  do toast global e renderizam INLINE no fluxo (nunca os dois ao mesmo tempo). */
export interface ContextualSplit {
  /** Pedidos da conversa VISÍVEL (viewMode linear + !scheduledOpen + ativa). */
  inline: InteractionRequest[]
  /** Dona dos `inline` (o convId visível); null = nada inline. Guarda dos
   *  componentes: só a superfície DESSA conversa renderiza os cards. */
  inlineConvId: string | null
  /** O resto — toast global no canto, como sempre (conversa dona não-ativa,
   *  outros viewModes: painel/sdd/agendado, ou pedido sem dono
   *  resolvível: run órfão / sem run_id). */
  global: InteractionRequest[]
}

const EMPTY_SPLIT: ContextualSplit = { inline: [], inlineConvId: null, global: [] }

/** Computa o split a partir dos stores (puro sobre getState; exportado p/
 *  teste). Painel/sdd/agendado ⇒ nenhuma conversa visível ⇒ tudo global. */
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
    // dono SEM filtro de kind (`ownerByRunId`): a PERGUNTA também carrega run_id
    // (o backend anexa em todo pedido, ver approval.rs), então ela renderiza
    // inline na conversa dona igual à permissão. Antes toda pergunta caía no
    // toast global — inclusive a da conversa que estava aberta na sua frente,
    // que é justo o caso em que o card pertence ao fluxo e não ao canto da tela.
    const target = ownerByRunId(req, chat, missions)
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

// ---------------------------------------------------------------------------
// ORIGEM (projeto · conversa) e ÍNDICE de espera. Um pedido pendente (permissão
// ou pergunta) é do PROJETO, não do app: o card precisa dizer de onde veio e a
// sidebar precisa acender onde a resposta é esperada — senão o turno fica
// pausado num canto que você não está olhando.
// ---------------------------------------------------------------------------

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

/** Resolve projeto+conversa de um pedido de APROVAÇÃO (usa a régua approval-only
 *  do `convIdForInteraction` — é o cabeçalho "projeto · conversa" do card de
 *  permissão). null quando o dono é irresolvível (run órfão) ou o kind não é
 *  approval; p/ qualquer kind existe `currentOriginAnyKind`. */
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

/** Chave estável do índice (mesmo idioma dos seletores da Sidebar: string
 *  ordenada ⇒ streaming não re-renderiza a árvore inteira). */
/** Quantas DECISÕES esperam por você — CONVERSAS distintas, não pedidos.
 *
 *  É o número da bandeja. Um turno pode pedir 20 `Bash` idênticos e um clique em
 *  "Aprovar todas" zerar os 20: anunciar "20 decisões" infla justamente o número
 *  que deveria dizer quanto trabalho te espera. Mesma colapsagem que o aviso já
 *  faz por episódio (`announceArrival` dedupa por conversa) e o card por
 *  assinatura. Pedido órfão conta como um (não pode sumir do total). PURA. */
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
    // `ownerByRunId` (sem filtro de kind): uma PERGUNTA da tool ask_user deixa o
    // turno tão parado quanto uma permissão, e o backend manda run_id nela também
    // (approval.rs) — o dono é resolvível. Com o filtro de approval aqui, pergunta
    // pendente não acendia NADA na sidebar: o turno esperava numa conversa que
    // você não tinha como saber qual era.
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

/** Avisa que chegou interação pendente BLOQUEANTE (feed do sino + nativa quando
 *  você não está olhando). Exportada só p/ teste (em runtime quem chama é o
 *  listener de `interaction://request`, no fim deste módulo).
 *  Cobre os dois kinds: `approval` (autorização) e
 *  `question` (conteúdo) — os dois deixam o turno literalmente parado, então os
 *  dois avisam. `before` é a fila ANTES do push: se a conversa dona já tinha
 *  pedido pendente, este é continuação de rajada e não avisa de novo. */
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
  const split = computeContextualSplit()
  const focused = typeof document !== "undefined" && document.hasFocus()
  const seen = split.inlineConvId === origin.convId && focused

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

// Alimentação ÚNICA da fila: assina os eventos globais no IMPORT do módulo —
// o App.tsx importa cedo (side-effect), então approvals disparados no boot já
// entram na fila antes de qualquer superfície montar. Listeners vivem a vida
// inteira do app (sem unlisten, de propósito). Fora do Tauri não há eventos.
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
    toast.error("Pedidos de permissão não vão aparecer nesta sessão.", {
      description: "Reinicie o app. Enquanto isso, turnos que pedirem permissão podem ficar parados.",
      duration: 12_000,
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
