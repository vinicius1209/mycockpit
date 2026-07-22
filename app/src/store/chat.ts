import { create } from "zustand"
import type { AgentEvent, CostSource } from "@/lib/agent"
import { suggest } from "@/lib/agent"
import type { Attachment } from "@/lib/attachments"
import {
  deleteAttachment,
  revokeAttachmentUrl,
  wipeAttachments,
} from "@/lib/attachments"
import { detectBlockedDir } from "@/lib/blockedDir"
import {
  SUGGEST_PROMPT,
  SUGGEST_DEBOUNCE_MS,
  buildContext,
  parseSuggestions,
} from "@/lib/suggestions"
import { useApp } from "@/store/app"
import type { FusionCandidate } from "@/store/fusion"
import { normalizeAgyModel } from "@/lib/agents"
import {
  aliasShiftNotice,
  isAliasRequest,
  resolutionNotice,
} from "@/lib/modelResolution"
import {
  listConversations as dbList,
  loadConversation as dbLoad,
  createConversation as dbCreate,
  saveConversation as dbSave,
  deleteConversation as dbDelete,
  renameConversation as dbRename,
  setConversationColor as dbSetColor,
  setConversationWorktree as dbSetWorktree,
  recordTurnCost,
  isTauri,
  type ConversationMeta,
} from "@/lib/db"
import { perfSpan } from "@/office/engine/perf"

export type ChatItem =
  | { kind: "user"; id: string; text: string; attachments?: Attachment[] }
  | { kind: "text"; id: string; text: string }
  | {
      kind: "tool"
      id: string
      name: string
      input: unknown
      /** tool_use_id do CLI (liga o tool_result à linha). */
      toolId?: string
      /** Resumo do resultado (texto truncado + nº de linhas do output). */
      result?: { ok: boolean; text: string; lines: number }
    }
  | {
      kind: "result"
      id: string
      ok: boolean
      text?: string
      costUsd?: number
      costSource?: CostSource
      model?: string | null
      usage?: {
        input: number
        output: number
        cacheRead: number
        cacheCreation: number
      }
      /** Duração total do turno em ms (start→result). */
      durationMs?: number
    }
  | { kind: "error"; id: string; message: string }
  | { kind: "cancelled"; id: string }
  | { kind: "notice"; id: string; message: string }
  /** Limite de uso/cota do agent atingido: cartão acionável (revezamento). */
  | { kind: "limit"; id: string; message: string; resetHint?: string }

/** Mensagem enfileirada durante o turno: texto + anexos do momento do Enter. */
export interface QueuedMsg {
  text: string
  attachments: Attachment[]
}

/** Estado de UMA conversa, vive em byId[convId]; runs em background escrevem aqui. */
export interface ConvState {
  projectId: string
  /** Agent que roda esta conversa (claude-code|codex|…), trava no 1º run. */
  agent: string
  /** Modelo + effort escolhidos (null = default do CLI), travam no 1º run. */
  reqModel: string | null
  effort: string | null
  /** Worktree isolado desta conversa (null = compartilha a pasta do projeto). */
  worktreePath: string | null
  /** Linha corrompida no banco (JSON não parseou): envio e persist BLOQUEADOS
   *  pra não sobrescrever dados ainda recuperáveis via SQLite. */
  corrupt?: boolean
  /** Footprint atual do contexto (tokens do prompt da última chamada), o anel. */
  contextTokens?: number
  items: ChatItem[]
  sessionId: string | null
  model: string | null
  /** Id da bolha de texto em streaming (H2). null = nenhuma aberta. */
  streamingTextId: string | null
  running: boolean
  /** Turno terminou (Result) mas o processo do CLI ainda finaliza, ex. flush da
   *  sessão do Codex. Bloqueia o próximo send p/ o resume não cair em "session
   *  not found" (corrida: liberar no Result dispara o resume antes do flush). */
  finalizing: boolean
  /** runId do run em andamento (p/ cancelar). */
  runId: string | null
  /** Timestamp (ms) de início do run atual, p/ cronômetro ao vivo. */
  startedAt: number | null
  /** Sugestões dinâmicas pós-turno (Sprint 3). */
  suggestions: string[]
  suggesting: boolean
  /** Mensagens digitadas ENQUANTO o turno roda: enfileiradas e coalescidas num
   *  único envio quando o turno atual termina (Done). Cada item leva os anexos
   *  do composer no momento do Enter — sem isso a imagem "enviada" fica órfã
   *  no composer e nunca acompanha a mensagem. Efêmero (não persiste). */
  queued?: QueuedMsg[]
  /** Pasta que o agent tentou acessar e foi barrada pelo gate de diretório
   *  (detecção heurística em tool_result falho). Alimenta o banner "Liberar e
   *  reenviar". Efêmero. null/undefined = nada bloqueado. */
  blockedDir?: string | null
  /** "Planejar primeiro" LIGADO nesta conversa: o próximo envio vai com
   *  plan_first (o agent só propõe um plano). Desliga sozinho ao aprovar um
   *  plano, ou manualmente no toggle do composer. Efêmero (não persiste). */
  planFirst?: boolean
  /** Plano PENDENTE de aprovação (turno plan_first terminou): guarda o texto
   *  final do assistente (p/ agents sem resume, o prompt de execução embute).
   *  Limpo ao aprovar, descartar, ou qualquer novo envio. Efêmero. */
  pendingPlan?: { text: string }
  /** true se um `limit_reached` bateu no turno CORRENTE (limite da CLI). Alimenta
   *  a detecção FORTE do auto-resume no fim do turno. Zerado a cada novo run. */
  limitHitThisTurn?: boolean
  /** Hint textual de quando o limite reseta (do último limit_reached do turno). */
  resetHint?: string | null
  /** Auto-revive em andamento nesta conversa (efêmero, NÃO persiste). Enquanto
   *  existe, um resume está agendado; o banner no ChatPanel lê `nextAt`/`tries`. */
  autoResume?: {
    tries: number
    maxTries: number
    /** epoch (ms) do próximo resume agendado (countdown do banner). */
    nextAt: number
    /** motivo curto (limite da CLI / texto do turno), pro aviso. */
    reason: string
    /** timer do setTimeout (p/ cancelar). */
    timer: ReturnType<typeof setTimeout>
  }
  /** Turno MUDO (watchdog P2): epoch ms da ÚLTIMA atividade quando o episódio
   *  foi notificado. Presente = já avisado neste episódio (1 aviso por
   *  episódio); atividade nova/fim do turno limpa. Efêmero (não persiste). */
  stalledSince?: number
}

interface ChatState {
  projectId: string | null
  activeId: string | null
  /** Metas das conversas do projeto ATIVO. Espelho de conversationsByProject[projectId]
   *  (mantido p/ compat: leitores que só olham o projeto ativo seguem reativos). */
  conversations: ConversationMeta[]
  /** Fonte de verdade: metas por projeto (árvore independente — vários projetos
   *  podem estar expandidos ao mesmo tempo, cada um com sua lista). Populado lazy
   *  ao expandir um projeto (loadProjectConversations). */
  conversationsByProject: Record<string, ConversationMeta[]>
  /** Estado de cada conversa carregada (Sprint 4, runs em background). */
  byId: Record<string, ConvState>
  /** Rascunho não-enviado por conversa, sobrevive a trocar de modo/conversa. */
  drafts: Record<string, string>
  /** Prompt enfileirado por outra UI (ex.: ⌘K) p/ o ChatPanel disparar. */
  queuedPrompt: string | null

  openProject: (projectId: string | null) => Promise<void>
  /** Carrega (lazy) as metas de um projeto no mapa; no-op se já carregadas.
   *  Chamada quando um projeto é expandido no sidebar. */
  loadProjectConversations: (projectId: string) => Promise<void>
  newConversation: (projectId: string) => Promise<void>
  /** F6 — cria uma conversa em BACKGROUND (automação agendada): grava no DB com
   *  título fixo e registra no store SEM roubar a seleção do usuário (não mexe
   *  em activeId/projectId ativo). O run escreve nela via start/handleEvent.
   *  `agent` (opcional, office §5.3) carimba o agent já na criação — meta,
   *  byId E banco (a coluna nasce NOT NULL DEFAULT claude-code; sem o carimbo
   *  a mesa de outro agent adotaria a conversa recém-criada). */
  registerConversation: (
    projectId: string,
    id: string,
    title: string,
    agent?: string,
  ) => Promise<void>
  switchConversation: (id: string) => Promise<void>
  /** Garante que a conversa está carregada em byId (do disco se preciso) SEM
   *  roubar a seleção — não toca em activeId/projectId. É a `ensureLoaded`
   *  promovida a action p/ superfícies fora do ChatPanel (ex.: office). */
  ensureConversationLoaded: (projectId: string, convId: string) => Promise<void>
  removeConversation: (id: string) => Promise<void>
  /** Renomeia manualmente (o título passa a ser fixo, não mais auto-derivado). */
  renameConversation: (id: string, title: string) => Promise<void>
  /** Define/limpa (null) a cor-rótulo da conversa. */
  setConversationColor: (id: string, color: string | null) => Promise<void>
  /** Isola a conversa num worktree (path) ou volta pra pasta compartilhada (null). */
  setWorktree: (convId: string, path: string | null) => void
  /** Zera a sessão nativa da conversa (resume falhou → a sessão antiga está
   *  morta; o run em fallback vai emitir `session` e gravar a nova). */
  clearSession: (convId: string) => void
  /** Duplica a conversa (copia o histórico; sessão nova, sem resume). */
  duplicateConversation: (id: string) => Promise<void>
  persist: (convId: string) => Promise<void>
  /** Anexa itens PRONTOS ao fio da conversa e persiste (marcos da missão, M2).
   *  EXIGE a conversa carregada em byId (ensureConversationLoaded antes) —
   *  no-op com aviso se não, pra nunca fabricar estado vazio que o persist
   *  (UPSERT de linha inteira) gravaria por cima do histórico real. NUNCA
   *  mexe em running/runId — é só conteúdo, não controle de turno. */
  appendItems: (convId: string, items: ChatItem[]) => Promise<void>
  start: (
    convId: string,
    text: string,
    runId: string,
    agent: string,
    model: string | null,
    effort: string | null,
    attachments: Attachment[],
  ) => void
  handleEvent: (convId: string, e: AgentEvent) => void
  /** Dispensa o aviso de pasta bloqueada desta conversa. */
  clearBlockedDir: (convId: string) => void
  /** Liga/desliga o "Planejar primeiro" desta conversa (toggle do composer). */
  setPlanFirst: (convId: string, v: boolean) => void
  /** Registra o plano pendente de aprovação (fim de um turno plan_first). */
  setPendingPlan: (convId: string, text: string) => void
  /** Limpa o plano pendente (aprovar, descartar, ou novo envio manual). */
  clearPendingPlan: (convId: string) => void
  /** Registra um resume automático agendado (banner + timer). */
  setAutoResume: (convId: string, s: ConvState["autoResume"]) => void
  /** Cancela/limpa o auto-resume agendado (para o timer). Chamar ao enviar
   *  manual, parar o run, ou quando o loop termina/atinge o cap. */
  cancelAutoResume: (convId: string) => void
  /** Watchdog: marca o turno como mudo (since = epoch da última atividade). */
  markStalled: (convId: string, since: number) => void
  /** Watchdog: atividade voltou / turno acabou — fecha o episódio de mudez. */
  clearStalled: (convId: string) => void
  /** Revezamento: assume OUTRO agent na MESMA conversa (sessão zerada; o
   *  contexto vai por preâmbulo). NÃO adiciona item de usuário, o pedido
   *  pendente já está no fio. */
  beginTransplant: (convId: string, runId: string, agent: string) => void
  finish: (convId: string) => void
  setSuggestions: (convId: string, s: string[]) => void
  setSuggesting: (convId: string, v: boolean) => void
  /** Novo run desta conversa → invalida a geração de sugestão pendente/em-voo
   *  (bumpa o token + cancela o timer). Chamar ANTES de iniciar o run. */
  invalidateSuggestions: (convId: string) => void
  /** Agenda a geração ~700ms após o turno (debounce contra rajadas). */
  scheduleSuggestions: (convId: string) => void
  /** Gera sugestões contextuais (fire-and-forget; degrada pros chips estáticos). */
  generateSuggestions: (convId: string) => Promise<void>
  queuePrompt: (t: string | null) => void
  /** Fila da conversa: enfileira uma mensagem digitada durante o turno
   *  (com os anexos pendentes do composer, que viajam junto). */
  enqueue: (convId: string, text: string, attachments?: Attachment[]) => void
  /** Esvazia a fila e devolve as mensagens pendentes (p/ coalescer no envio). */
  dequeueQueued: (convId: string) => QueuedMsg[]
  /** Remove UMA mensagem enfileirada (o X no chip da fila). */
  removeQueued: (convId: string, index: number) => void
  /** Atualiza o rascunho (input não-enviado) de uma conversa. */
  setDraft: (convId: string, text: string) => void
  /** Fusion: add o balão do usuário à conversa + marca running (turno visível). */
  beginFusion: (convId: string, text: string, attachments: Attachment[]) => void
  /** Fusion: promove o vencedor, anexa os itens dele + assume sessão/agent.
   *  `notice` (opcional) marca a promoção no transcript (rastro da disputa). */
  promoteFusion: (
    convId: string,
    winner: FusionCandidate,
    notice?: string,
  ) => Promise<void>
}

function uid(): string {
  return crypto.randomUUID()
}

/** Acha a chave (projectId) cujo array de metas contém `convId`. Como o id de
 *  conversa é ÚNICO globalmente, no máximo um projeto casa → miramos a conversa
 *  EXATA, sem risco de mexer no projeto errado. */
function projectOfConv(
  map: Record<string, ConversationMeta[]>,
  convId: string,
): string | undefined {
  for (const [pid, list] of Object.entries(map)) {
    if (list.some((c) => c.id === convId)) return pid
  }
  return undefined
}

/** Aplica um patch imutável na meta `convId` dentro do mapa por projeto (mira o
 *  id único → projeto certo) E espelha em `conversations` se for o projeto ativo.
 *  `update` recebe a meta atual e devolve a nova. Retorna o patch p/ set(). */
function patchConvMeta(
  s: Pick<ChatState, "conversationsByProject" | "conversations" | "projectId">,
  convId: string,
  update: (c: ConversationMeta) => ConversationMeta,
): Pick<ChatState, "conversationsByProject" | "conversations"> {
  const pid = projectOfConv(s.conversationsByProject, convId)
  if (!pid) return { conversationsByProject: s.conversationsByProject, conversations: s.conversations }
  const nextList = s.conversationsByProject[pid].map((c) =>
    c.id === convId ? update(c) : c,
  )
  const conversationsByProject = { ...s.conversationsByProject, [pid]: nextList }
  return {
    conversationsByProject,
    conversations: pid === s.projectId ? nextList : s.conversations,
  }
}

/** Título derivado do 1º prompt do usuário (S4). */
function deriveTitle(items: ChatItem[]): string | null {
  const first = items.find((it) => it.kind === "user")
  if (first && first.kind === "user") {
    const t = first.text.trim().replace(/\s+/g, " ")
    return t.length > 44 ? `${t.slice(0, 44)}…` : t
  }
  return null
}

function emptyConv(projectId: string): ConvState {
  return {
    projectId,
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null,
    items: [],
    sessionId: null,
    model: null,
    streamingTextId: null,
    running: false,
    finalizing: false,
    runId: null,
    startedAt: null,
    suggestions: [],
    suggesting: false,
  }
}

const EMPTY_CONV = emptyConv("")

/** Campos de CONTEÚDO de uma conversa, o que o reducer de itens lê/escreve.
 *  Usado pelo Linear (via reduceEvent) e por cada lane do Fusion. */
export type ItemReducible = Pick<
  ConvState,
  "items" | "streamingTextId" | "model" | "sessionId" | "startedAt" | "contextTokens"
>

/** Contexto opcional do run pro reducer validar pedido×resolvido no init da
 *  sessão (lib/modelResolution). Sem ctx, comporta como sempre (sem checagem). */
export interface ReduceCtx {
  agent: string
  reqModel: string | null
}

/** Núcleo PURO de itens (T1.1). NÃO mexe em running/finalizing/runId/startedAt,
 *  o controle fica no controlFlow (Linear) ou no status da lane (Fusion). */
export function reduceItems(
  c: ItemReducible,
  e: AgentEvent,
  ctx?: ReduceCtx,
): Partial<ItemReducible> {
  switch (e.type) {
    case "session": {
      // Divergência DURA pedido×resolvido → notice no fio (não bloqueia; a
      // verdade do CLI manda). Dedup por mensagem: cada retomada re-emite
      // `session`, e a mesma divergência não deve virar eco a cada turno.
      const warn = ctx
        ? resolutionNotice(ctx.agent, ctx.reqModel, e.model)
        : null
      const fresh =
        warn != null &&
        !c.items.some((it) => it.kind === "notice" && it.message === warn)
      return {
        sessionId: e.session_id,
        model: e.model,
        ...(fresh
          ? { items: [...c.items, { kind: "notice", id: uid(), message: warn }] }
          : {}),
      }
    }
    // H2, texto completo do assistant: se já veio por deltas, descarta (dedup).
    case "text":
      if (c.streamingTextId) return { streamingTextId: null }
      return { items: [...c.items, { kind: "text", id: uid(), text: e.text }] }
    // H2, delta em streaming: acumula na bolha corrente (cria se não houver).
    case "text_delta": {
      if (c.streamingTextId) {
        return {
          items: c.items.map((it) =>
            it.id === c.streamingTextId && it.kind === "text"
              ? { ...it, text: it.text + e.text }
              : it,
          ),
        }
      }
      const id = uid()
      return {
        items: [...c.items, { kind: "text", id, text: e.text }],
        streamingTextId: id,
      }
    }
    case "tool":
      return {
        items: [
          ...c.items,
          { kind: "tool", id: uid(), name: e.name, input: e.input, toolId: e.id },
        ],
        streamingTextId: null,
      }
    // resultado resumido de uma tool: anexa à linha correspondente (pelo toolId).
    case "tool_result":
      return {
        items: c.items.map((it) =>
          it.kind === "tool" && it.toolId === e.id && !it.result
            ? { ...it, result: { ok: e.ok, text: e.text, lines: e.lines } }
            : it,
        ),
      }
    case "result": {
      // O CLI pode emitir results INTERMEDIÁRIOS na mesma invocação (fases/
      // subagents), cada um com o total-até-ali: o ÚLTIMO carrega o total real
      // do turno. Colapsa consecutivos (senão o custo da sessão soma os
      // parciais e infla, visto no uso real: 5 results = US$120 "somados"
      // num turno que custou US$31).
      const prev = c.items[c.items.length - 1]
      const base =
        prev && prev.kind === "result" ? c.items.slice(0, -1) : c.items
      return {
        items: [
          ...base,
          {
            kind: "result",
            id: uid(),
            ok: e.ok,
            text: e.text ?? undefined,
            costUsd: e.cost_usd ?? undefined,
            costSource: e.cost_source,
            model: c.model,
            usage: {
              input: e.input_tokens,
              output: e.output_tokens,
              cacheRead: e.cache_read,
              cacheCreation: e.cache_creation,
            },
            durationMs:
              c.startedAt != null
                ? Date.now() - c.startedAt
                : prev && prev.kind === "result"
                  ? prev.durationMs
                  : undefined,
          },
        ],
        streamingTextId: null,
      }
    }
    // footprint do contexto (anel): só atualiza o número, sem item.
    case "context_usage":
      return { contextTokens: e.tokens }
    // limite de uso/cota: cartão ACIONÁVEL no fio (o revezamento mora nele).
    case "limit_reached":
      return {
        items: [
          ...c.items,
          {
            kind: "limit",
            id: uid(),
            message: e.message,
            resetHint: e.reset_hint ?? undefined,
          },
        ],
        streamingTextId: null,
      }
    // aviso não-fatal (anexo expirado/não-suportado), só adiciona a linha.
    case "notice":
      return {
        items: [...c.items, { kind: "notice", id: uid(), message: e.message }],
      }
    case "error":
      return {
        items: [...c.items, { kind: "error", id: uid(), message: e.message }],
        streamingTextId: null,
      }
    case "cancelled":
      return {
        items: [...c.items, { kind: "cancelled", id: uid() }],
        streamingTextId: null,
      }
    case "done":
      return { streamingTextId: null }
    default:
      return {}
  }
}

/** Controle do turno Linear (running/finalizing/runId/startedAt). Só o Linear usa
 * , a lane do Fusion deriva o status dela explicitamente (handleCandidateEvent). */
function controlFlow(_c: ConvState, e: AgentEvent): Partial<ConvState> {
  switch (e.type) {
    case "result":
      // turno acabou, mas o processo ainda finaliza (flush) → segura até o Done.
      return { running: false, finalizing: true, runId: null, startedAt: null }
    case "error":
    case "cancelled":
      return { running: false, runId: null, startedAt: null }
    case "done":
      return { running: false, finalizing: false, runId: null, startedAt: null }
    default:
      return {}
  }
}

/** Reduz um evento do agent sobre o estado de UMA conversa (Linear). */
function reduceEvent(c: ConvState, e: AgentEvent): Partial<ConvState> {
  return {
    ...reduceItems(c, e, { agent: c.agent, reqModel: c.reqModel }),
    ...controlFlow(c, e),
  }
}

export const useChat = create<ChatState>((set, get) => {
  // Sugestões: estado de orquestração por convId (espelha byId). Vive no closure
  // do creator, a store é singleton, então a sugestão sobrevive a remount do
  // painel. suggestTimer = debounce; suggestGen = token de invalidação.
  const suggestTimer: Record<string, ReturnType<typeof setTimeout>> = {}
  const suggestGen: Record<string, number> = {}

  // Token de geração do openProject (M1): um openProject(A) LENTO em voo não
  // pode clobrar um clique posterior (openProject(B) ou switchConversation).
  // Cada openProject captura ++openGen; após cada await, se o token mudou,
  // aborta sem aplicar set. switchConversation também invalida ao trocar o
  // projeto ativo (o guard keepActive só cobria o caso mesmo-projeto).
  let openGen = 0

  // Persistência incremental durante o run: sem isso o único persist era no
  // finally do turno (ChatPanel), então QUALQUER interrupção mid-run (restart do
  // dev, crash, fechar a janela) perdia a resposta inteira E o session_id (o run
  // nem era resumível). schedulePersist é um throttle trailing: o 1º evento de um
  // burst agenda um snapshot ~1.2s depois, e re-arma no próximo → grava a cada
  // ~1.2s enquanto streama, sem martelar o disco a cada text_delta.
  const persistTimer: Record<string, ReturnType<typeof setTimeout>> = {}
  const schedulePersist = (convId: string) => {
    if (persistTimer[convId]) return // já agendado neste burst → coalesce
    persistTimer[convId] = setTimeout(() => {
      delete persistTimer[convId]
      void get().persist(convId)
    }, 1200)
  }
  const cancelPersist = (convId: string) => {
    if (persistTimer[convId]) {
      clearTimeout(persistTimer[convId])
      delete persistTimer[convId]
    }
  }

  /** Aplica um patch parcial em UMA conversa (no-op se ela não existe mais). */
  const patch = (convId: string, p: Partial<ConvState>) =>
    set((s) => {
      const cur = s.byId[convId]
      if (!cur) return {}
      return { byId: { ...s.byId, [convId]: { ...cur, ...p } } }
    })

  /** Garante que a conversa está carregada em byId (do disco se preciso). */
  const ensureLoaded = async (projectId: string, convId: string) => {
    if (get().byId[convId]) return
    const conv = await dbLoad(convId)
    // linha corrompida: estado read-only com aviso (persist/envio bloqueados),
    // nunca "conversa vazia" que o próximo persist gravaria por cima.
    const state: ConvState =
      conv === "corrupt"
        ? {
            ...emptyConv(projectId),
            corrupt: true,
            items: [
              {
                kind: "notice",
                id: uid(),
                message:
                  "Histórico desta conversa está corrompido no banco. Envio bloqueado pra não sobrescrever (a linha segue recuperável via SQLite).",
              },
            ],
          }
        : {
            ...emptyConv(projectId),
            items: conv?.items ?? [],
            sessionId: conv?.sessionId ?? null,
            suggestions: conv?.suggestions ?? [],
            agent: conv?.agent ?? "claude-code",
            // Conversas antigas guardavam o nome de exibição do agy. Normaliza
            // antes de qualquer composer/adapter poder reutilizar esse valor.
            reqModel:
              conv?.agent === "agy"
                ? normalizeAgyModel(conv.reqModel)
                : (conv?.reqModel ?? null),
            effort: conv?.effort ?? null,
            // modelo RESOLVIDO da última sessão: TitleBar/validação não
            // degradam pro rótulo do agent depois de um restart.
            model: conv?.model ?? null,
            worktreePath: conv?.worktreePath ?? null,
          }
    set((s) =>
      s.byId[convId] ? {} : { byId: { ...s.byId, [convId]: state } },
    )
  }

  return {
    projectId: null,
    activeId: null,
    conversations: [],
    conversationsByProject: {},
    byId: {},
    drafts: {},
    queuedPrompt: null,

    // a closure ensureLoaded exposta como action (mesma semântica, zero seleção)
    ensureConversationLoaded: ensureLoaded,

    queuePrompt: (queuedPrompt) => set({ queuedPrompt }),
    setSuggestions: (convId, suggestions) => patch(convId, { suggestions }),
    setSuggesting: (convId, suggesting) => patch(convId, { suggesting }),

    // novo run → invalida geração de sugestão pendente/em-voo desta conversa
    invalidateSuggestions: (convId) => {
      suggestGen[convId] = (suggestGen[convId] ?? 0) + 1
      clearTimeout(suggestTimer[convId])
    },

    // Debounce: agenda a geração ~700ms após o turno. Um novo run cancela o timer
    // (e bumpa o token via invalidateSuggestions), então rajadas de prompts não
    // geram sugestões intermediárias.
    scheduleSuggestions: (convId) => {
      clearTimeout(suggestTimer[convId])
      suggestTimer[convId] = setTimeout(() => {
        void get().generateSuggestions(convId)
      }, SUGGEST_DEBOUNCE_MS)
    },

    // Gera sugestões contextuais após o turno (fire-and-forget; degrada pros chips).
    generateSuggestions: async (convId) => {
      if (!isTauri()) return
      const c = get().byId[convId]
      if (!c || c.running || c.finalizing) return // run em andamento → não gera
      if (!c.items.some((it) => it.kind === "text")) return
      const proj = useApp.getState().projects.find((p) => p.id === c.projectId)
      if (!proj) {
        console.warn("[sugestões] projeto não encontrado p/ convId", convId, c.projectId)
        return
      }
      // modelo helper por projeto (.mycockpit/config.toml); default haiku, null = off
      const cfg = useApp.getState().mycockpit[c.projectId]
      // projeto define no config.toml → vence; senão, o default global (Settings).
      const helperModel = cfg ? cfg.helper : useApp.getState().settings.helperModel
      if (!helperModel) return
      // token desta geração: se um novo run começar enquanto geramos, descartamos.
      const myGen = suggestGen[convId] ?? 0
      get().setSuggesting(convId, true)
      try {
        const raw = await suggest(
          helperModel,
          proj.path,
          `${SUGGEST_PROMPT}\n\nConversa recente:\n${buildContext(c.items)}`,
        )
        // descarta se um novo run começou enquanto gerava (anti-concorrência)
        if ((suggestGen[convId] ?? 0) !== myGen) return
        const list = parseSuggestions(raw)
        if (!list.length) {
          console.warn("[sugestões] resposta sem JSON parseável:", raw)
        }
        const after = get().byId[convId]
        if (list.length && after && !after.running) {
          get().setSuggestions(convId, list)
          // persiste p/ as sugestões sobreviverem a fechar/minimizar/reabrir
          void get().persist(convId)
        }
      } catch (e) {
        console.warn("[sugestões] erro ao gerar:", e)
      } finally {
        // só limpa o "buscando…" se ainda formos a geração corrente
        if ((suggestGen[convId] ?? 0) === myGen) {
          get().setSuggesting(convId, false)
        }
      }
    },

    openProject: async (projectId) => {
      const gen = ++openGen
      if (!projectId) {
        set({ projectId: null, activeId: null, conversations: [] })
        return
      }
      let list = (await dbList(projectId)) ?? []
      // outro openProject/switchConversation venceu enquanto o dbList voava →
      // não clobra a escolha mais recente.
      if (gen !== openGen) return
      if (list.length === 0) {
        const id = uid()
        await dbCreate(projectId, id)
        if (gen !== openGen) return
        list = [{ id, title: null, updatedAt: Date.now(), color: null, worktreePath: null, agent: null }]
        set((s) => ({
          projectId,
          activeId: id,
          conversations: list,
          conversationsByProject: { ...s.conversationsByProject, [projectId]: list },
          byId: s.byId[id] ? s.byId : { ...s.byId, [id]: emptyConv(projectId) },
        }))
        return
      }
      // exibe em ordem de criação, mas abre a usada mais recentemente
      const mostRecent = list.reduce(
        (best, c) => (c.updatedAt > best.updatedAt ? c : best),
        list[0],
      ).id
      // Se já estamos neste projeto e o activeId atual é uma conversa dele (ex.:
      // o usuário acabou de clicar numa conversa de projeto não-ativo, que
      // trocou o projeto ativo E chamou switchConversation), preserva a escolha
      // — não pula pra "mais recente" e clobbra o clique. Senão, abre a recente.
      const prev = get()
      const keepActive =
        prev.projectId === projectId &&
        prev.activeId != null &&
        list.some((c) => c.id === prev.activeId)
      const activeId = keepActive ? prev.activeId! : mostRecent
      set((s) => ({
        projectId,
        activeId,
        conversations: list,
        conversationsByProject: { ...s.conversationsByProject, [projectId]: list },
      }))
      // ensureLoaded só ADICIONA em byId (guardado, não sobrescreve) → não há
      // set de navegação após este await pra proteger com o token.
      await ensureLoaded(projectId, activeId)
    },

    // Lazy: carrega as metas de um projeto no mapa quando ele é expandido no
    // sidebar. No-op se já carregadas (não remexe no que já está na tela).
    loadProjectConversations: async (projectId) => {
      if (get().conversationsByProject[projectId]) return
      const list = (await dbList(projectId)) ?? []
      set((s) =>
        s.conversationsByProject[projectId]
          ? {}
          : {
              conversationsByProject: {
                ...s.conversationsByProject,
                [projectId]: list,
              },
            },
      )
    },

    newConversation: async (projectId) => {
      const id = uid()
      await dbCreate(projectId, id)
      set((s) => {
        const meta: ConversationMeta = {
          id,
          title: null,
          updatedAt: Date.now(),
          color: null,
          worktreePath: null,
          agent: null,
        }
        // append na lista DAQUELE projeto (não do ativo antigo). Criar uma
        // conversa também torna o projeto o ativo (abre no painel). Fallback
        // `[]` (nunca s.conversations: o espelho pode ser a lista de OUTRO
        // projeto e poluiria o mapa com conversas de owner errado).
        const prev = s.conversationsByProject[projectId] ?? []
        const nextList = [...prev, meta]
        return {
          projectId,
          activeId: id,
          conversations: nextList,
          conversationsByProject: {
            ...s.conversationsByProject,
            [projectId]: nextList,
          },
          byId: { ...s.byId, [id]: emptyConv(projectId) },
        }
      })
    },

    registerConversation: async (projectId, id, title, agent) => {
      await dbCreate(projectId, id)
      await dbRename(id, title) // título fixo ("⏰ …") — o persist preserva
      // garante a lista do projeto carregada ANTES de anexar a meta: criar um
      // array só com esta conversa esconderia as demais (loadProjectConversations
      // é no-op quando a chave existe).
      await get().loadProjectConversations(projectId)
      set((s) => {
        const list = s.conversationsByProject[projectId] ?? []
        // o load acima pode já ter trazido a linha recém-criada do DB → dedupe.
        const nextList = list.some((c) => c.id === id)
          ? list.map((c) =>
              c.id === id ? { ...c, title, agent: agent ?? c.agent } : c,
            )
          : [
              ...list,
              {
                id,
                title,
                updatedAt: Date.now(),
                color: null,
                worktreePath: null,
                agent: agent ?? null,
              },
            ]
        return {
          conversationsByProject: {
            ...s.conversationsByProject,
            [projectId]: nextList,
          },
          conversations:
            projectId === s.projectId ? nextList : s.conversations,
          byId: s.byId[id]
            ? s.byId
            : {
                ...s.byId,
                [id]: agent
                  ? { ...emptyConv(projectId), agent }
                  : emptyConv(projectId),
              },
        }
      })
      // carimba o agent no BANCO na hora: o dbCreate insere sem a coluna (fica
      // o DEFAULT claude-code); o persist grava byId[id].agent na linha via
      // UPSERT — e preserva o título fixo (a meta acima já está carregada).
      if (agent) await get().persist(id)
    },

    switchConversation: async (id) => {
      const s = get()
      if (s.activeId === id) return
      // Descobre o projeto DONO desta conversa pelo id único. Se for outro
      // projeto (clique numa conversa de projeto não-ativo no sidebar), sincroniza
      // projectId + o espelho `conversations` na hora — não espera o openProject
      // (que roda via efeito do ChatPanel) e não deixa a UI num estado misto.
      const owner = projectOfConv(s.conversationsByProject, id) ?? s.projectId
      // invalida qualquer openProject em voo: o clique do usuário é a escolha
      // mais recente e não pode ser sobrescrito quando o dbList atrasado chegar.
      openGen++
      set((st) => ({
        activeId: id,
        projectId: owner,
        conversations:
          owner && st.conversationsByProject[owner]
            ? st.conversationsByProject[owner]
            : st.conversations,
      }))
      if (owner) await ensureLoaded(owner, id)
    },

    removeConversation: async (id) => {
      // Missão/disputa da conversa morrem JUNTO: sem a conversa elas seguiriam
      // rodando invisíveis (fora da sidebar e do snapshot da tray, que
      // subcontaria `running` e deixaria o "Sair" matar o trabalho sem
      // confirmação). Import dinâmico: mission/fusion importam este módulo.
      try {
        const [{ useMission }, { useFusion }] = await Promise.all([
          import("@/store/mission"),
          import("@/store/fusion"),
        ])
        useMission.getState().abort(id)
        useFusion.getState().abort(id) // no-op fora de running/judging
        useFusion.getState().discard(id) // limpa board + pending do DB
      } catch {
        // best-effort: a deleção da conversa segue mesmo assim
      }
      // Mira a conversa pelo id ÚNICO → deleta só a linha certa no DB e some do
      // array do projeto DONO dela (mesmo que seja um projeto NÃO-ativo). O
      // projeto ativo e as outras conversas ficam intactos.
      // Cancela o persist throttled pendente ANTES do DELETE: um snapshot
      // atrasado re-inseriria a linha deletada (UPSERT) = conversa-zumbi.
      cancelPersist(id)
      await dbDelete(id)
      void wipeAttachments(id) // apaga os blobs da conversa (privacidade imediata)
      const before = get()
      const wasActive = before.activeId === id
      // projeto DONO da conversa removida (pode não ser o ativo)
      const owner =
        projectOfConv(before.conversationsByProject, id) ?? before.projectId
      set((s) => {
        const rest = { ...s.byId }
        delete rest[id]
        const conversationsByProject = { ...s.conversationsByProject }
        if (owner && conversationsByProject[owner]) {
          conversationsByProject[owner] = conversationsByProject[owner].filter(
            (c) => c.id !== id,
          )
        }
        // Só recria o espelho se o DONO for o projeto ATIVO; owner ≠ ativo
        // mantém a REFERÊNCIA (um filter no-op criaria ref nova à toa e
        // re-renderizaria leitores do projeto ativo sem mudança real).
        const mirror =
          owner != null && owner === s.projectId
            ? (conversationsByProject[owner] ??
              s.conversations.filter((c) => c.id !== id))
            : s.conversations
        return { byId: rest, conversationsByProject, conversations: mirror }
      })
      // Se a removida não era a ATIVA (ex.: excluiu de um projeto não-ativo),
      // nada mais a fazer — o painel ativo segue como estava.
      if (!wasActive) return
      const remaining = get().conversations
      if (remaining.length > 0) {
        await get().switchConversation(remaining[0].id)
      } else if (owner) {
        await get().newConversation(owner)
      } else {
        set({ activeId: null })
      }
    },

    renameConversation: async (id, title) => {
      const t = title.trim()
      if (!t) return
      // dbRename mira o id ÚNICO no DB; patchConvMeta acha o projeto DONO por esse
      // mesmo id → renomeia a conversa exata (mesmo em projeto não-ativo), sem
      // tocar em nenhuma outra.
      await dbRename(id, t)
      set((s) => patchConvMeta(s, id, (c) => ({ ...c, title: t })))
    },

    setConversationColor: async (id, color) => {
      await dbSetColor(id, color)
      set((s) => patchConvMeta(s, id, (c) => ({ ...c, color })))
    },

    setWorktree: (convId, path) => {
      void dbSetWorktree(convId, path)
      set((s) => ({
        ...patchConvMeta(s, convId, (c) => ({ ...c, worktreePath: path })),
        byId: s.byId[convId]
          ? { ...s.byId, [convId]: { ...s.byId[convId], worktreePath: path } }
          : s.byId,
      }))
    },

    clearSession: (convId) => {
      set((s) =>
        s.byId[convId]
          ? { byId: { ...s.byId, [convId]: { ...s.byId[convId], sessionId: null } } }
          : s,
      )
    },

    duplicateConversation: async (id) => {
      // Duplica no MESMO projeto da conversa-fonte (acha pelo id único), não
      // necessariamente o ativo. A cópia entra no array daquele projeto.
      const before = get()
      const owner =
        projectOfConv(before.conversationsByProject, id) ?? before.projectId
      if (!owner) return
      const src = before.conversationsByProject[owner]?.find((c) => c.id === id)
      const loaded = await dbLoad(id)
      if (loaded === "corrupt") return // não duplica linha corrompida
      const items = loaded?.items ?? get().byId[id]?.items ?? []
      const agent = loaded?.agent ?? get().byId[id]?.agent ?? "claude-code"
      const rawReqModel = loaded?.reqModel ?? get().byId[id]?.reqModel ?? null
      const reqModel = agent === "agy" ? normalizeAgyModel(rawReqModel) : rawReqModel
      const effort = loaded?.effort ?? get().byId[id]?.effort ?? null
      const title = `${src?.title ?? loaded?.title ?? "Conversa"} (cópia)`
      const newId = uid()
      // sessão NULL de propósito: a cópia não herda a sessão do CLI (resume
      // conflitaria); os items viram histórico visível, o próximo turno é fresh.
      // model NULL idem: o resolvido pertence à sessão antiga.
      await dbSave(newId, owner, title, null, items, [], agent, reqModel, effort, null)
      if (src?.color != null) await dbSetColor(newId, src.color)
      set((s) => {
        const meta: ConversationMeta = {
          id: newId,
          title,
          updatedAt: Date.now(),
          color: src?.color ?? null,
          worktreePath: null,
          // a cópia já nasce gravada com este agent no DB (dbSave acima)
          agent,
        }
        const nextList = [...(s.conversationsByProject[owner] ?? []), meta]
        return {
          activeId: newId,
          projectId: owner,
          conversationsByProject: {
            ...s.conversationsByProject,
            [owner]: nextList,
          },
          conversations: owner === s.projectId ? nextList : s.conversations,
          byId: {
            ...s.byId,
            [newId]: {
              ...emptyConv(owner),
              items,
              agent,
              reqModel,
              effort,
              sessionId: null,
            },
          },
        }
      })
    },

    persist: async (convId) => {
      const c = get().byId[convId]
      if (!c) return
      if (c.corrupt) return // nunca grava por cima de uma linha corrompida
      // preserva o título atual (rename manual OU auto já fixado); só deriva se vazio.
      // A meta vem do array do projeto DONO (c.projectId), não só do ativo — assim
      // um run em background (projeto não-ativo) também atualiza sua própria lista.
      const ownerList = get().conversationsByProject[c.projectId]
      const meta = ownerList?.find((cv) => cv.id === convId)
      const title = meta?.title ?? deriveTitle(c.items)
      // S1: UPSERT de linha inteira (stringify da conversa TODA na main thread)
      // — span de PAREDE (inclui o await do SQLite); no-op sem mc.office.perf.
      const endSpan = perfSpan("persist")
      await dbSave(
        convId,
        c.projectId,
        title,
        c.sessionId,
        c.items,
        c.suggestions,
        c.agent,
        c.reqModel,
        c.effort,
        c.model,
      )
      endSpan()
      const now = Date.now()
      // atualiza no lugar, sem reordenar (ordem de criação é estável)
      set((st) => {
        const list = st.conversationsByProject[c.projectId]
        if (!list) return {}
        // espelha o agent gravado (dbSave acima escreve c.agent na linha) — a
        // meta em memória não pode divergir do banco (office lê meta.agent).
        const nextList = list.map((cv) =>
          cv.id === convId ? { ...cv, title, updatedAt: now, agent: c.agent } : cv,
        )
        return {
          conversationsByProject: {
            ...st.conversationsByProject,
            [c.projectId]: nextList,
          },
          conversations:
            c.projectId === st.projectId ? nextList : st.conversations,
        }
      })
    },

    appendItems: async (convId, items) => {
      if (items.length === 0) return
      const cur = get().byId[convId]
      if (!cur) {
        // sem estado carregado NÃO fabricamos conversa vazia (o persist é UPSERT
        // de linha inteira e apagaria o histórico do disco) — mesmo guard do start.
        console.warn(
          "[chat] appendItems: conversa não carregada em byId — itens descartados",
          convId,
        )
        return
      }
      if (cur.corrupt) return // linha corrompida: persist bloqueado, nada a anexar
      // metas do projeto carregadas ANTES do persist: sem elas o persist não acha
      // meta.title e re-derivaria o título do 1º prompt (clobraria o título fixo
      // "Missão · …") — mesmo padrão do ensureDeskConversation (bridge/send.ts).
      await get().loadProjectConversations(cur.projectId)
      const endSpan = perfSpan("appendItems") // S1 (no-op sem mc.office.perf)
      set((s) => {
        const c = s.byId[convId]
        if (!c) return {}
        return {
          byId: { ...s.byId, [convId]: { ...c, items: [...c.items, ...items] } },
        }
      })
      endSpan()
      await get().persist(convId)
    },

    start: (convId, text, runId, agent, model, effort, attachments) =>
      set((s) => {
        // conversa ainda não carregada do disco: NUNCA fabrica um estado vazio,
        // o persist (UPSERT de linha inteira) sobrescreveria o histórico.
        const cur = s.byId[convId]
        if (!cur) return {}
        const items = [
          ...cur.items,
          {
            kind: "user" as const,
            id: uid(),
            text,
            attachments: attachments.length ? attachments : undefined,
          },
        ]
        // deriva o título na lista do projeto DONO (via id único), espelha no ativo
        const titled = patchConvMeta(s, convId, (c) =>
          c.title ? c : { ...c, title: deriveTitle(items) },
        )
        return {
          ...titled,
          byId: {
            ...s.byId,
            [convId]: {
              ...cur,
              agent,
              reqModel: model,
              effort,
              items,
              streamingTextId: null,
              running: true,
              finalizing: false,
              runId,
              startedAt: Date.now(),
              suggestions: [],
              suggesting: false,
              blockedDir: null, // novo turno zera o aviso de pasta bloqueada
              pendingPlan: undefined, // e o plano pendente (envio manual supersede)
              limitHitThisTurn: false, // e o sinal de limite do turno anterior
              resetHint: null,
              stalledSince: undefined, // e o episódio de turno mudo
            },
          },
        }
      }),

    handleEvent: (convId, e) => {
      // efeitos GLOBAIS: limite marca o agent como limitado (cross-conversa,
      // o seletor avisa); um result ok do mesmo agent cura a marca.
      if (e.type === "limit_reached") {
        const agent = get().byId[convId]?.agent
        if (agent) useApp.getState().setAgentLimited(agent, e.reset_hint ?? null)
        // marca o sinal FORTE p/ o auto-resume ler no fim do turno (+ guarda o hint)
        patch(convId, { limitHitThisTurn: true, resetHint: e.reset_hint ?? null })
      } else if (e.type === "result" && e.ok) {
        const agent = get().byId[convId]?.agent
        if (agent) useApp.getState().clearAgentLimited(agent)
      }
      // Ledger de custo por turno (F: "hoje/7d" só via missões). Grava CADA
      // result com custo — chat linear é caminho disjunto de missão/disputa, sem
      // dupla contagem. REPLACE por run_id colapsa os parciais no total final.
      if (e.type === "result" && e.cost_usd != null) {
        const cur = get().byId[convId]
        if (cur?.runId) {
          void recordTurnCost({
            runId: cur.runId,
            projectId: cur.projectId,
            convId,
            agent: cur.agent,
            model: cur.model,
            costUsd: e.cost_usd,
            costSource: e.cost_source ?? null,
            input: e.input_tokens ?? 0,
            output: e.output_tokens ?? 0,
            cache: (e.cache_read ?? 0) + (e.cache_creation ?? 0),
          })
        }
      }
      set((s) => {
        const cur = s.byId[convId]
        if (!cur) return {}
        return { byId: { ...s.byId, [convId]: { ...cur, ...reduceEvent(cur, e) } } }
      })
      // Phase 3 do extra_dirs: tool_result FALHO citando pasta fora da raiz →
      // marca blockedDir p/ o banner "Liberar e reenviar". Best-effort (heurístico).
      if (e.type === "tool_result" && !e.ok) {
        const cur = get().byId[convId]
        const proj = cur
          ? useApp.getState().projects.find((p) => p.id === cur.projectId)
          : undefined
        if (cur && proj && !cur.blockedDir) {
          const allowed = useApp.getState().mycockpit[cur.projectId]?.extraDirs ?? []
          const dir = detectBlockedDir(e.text, proj.path, allowed)
          if (dir) {
            set((s) => {
              const c = s.byId[convId]
              if (!c) return {}
              return { byId: { ...s.byId, [convId]: { ...c, blockedDir: dir } } }
            })
          }
        }
      }
      // Persistência incremental (sobrevive a interrupção mid-run):
      if (e.type === "session") {
        // Ledger de resoluções observadas (P2): o app aprende o que o CLI
        // resolve pra cada pedido a cada run real. Quando um ALIAS muda de
        // resolução entre sessões (ex.: opus 4.7→4.8), injeta um notice —
        // o momento exato em que preço/comportamento derivariam em silêncio.
        const cur = get().byId[convId]
        if (cur) {
          const prev = useApp
            .getState()
            .recordResolution(cur.agent, cur.reqModel, e.model)
          if (
            prev &&
            e.model &&
            prev !== e.model &&
            isAliasRequest(cur.agent, cur.reqModel)
          ) {
            const msg = aliasShiftNotice(cur.reqModel!, prev, e.model)
            set((s) => {
              const c = s.byId[convId]
              if (
                !c ||
                c.items.some((it) => it.kind === "notice" && it.message === msg)
              )
                return {}
              return {
                byId: {
                  ...s.byId,
                  [convId]: {
                    ...c,
                    items: [
                      ...c.items,
                      { kind: "notice", id: uid(), message: msg },
                    ],
                  },
                },
              }
            })
          }
        }
        // session_id é barato e torna o run RESUMÍVEL → grava na hora.
        cancelPersist(convId)
        void get().persist(convId)
      } else if (e.type === "done" || e.type === "error" || e.type === "cancelled") {
        // terminais: o finally do ChatPanel faz o persist final; só limpa o timer
        // pendente pra não gravar um snapshot atrasado por cima.
        cancelPersist(convId)
      } else {
        // texto/tool/result em streaming → snapshot throttled a cada ~1.2s.
        schedulePersist(convId)
      }
    },

    clearBlockedDir: (convId) =>
      set((s) => {
        const cur = s.byId[convId]
        if (!cur || !cur.blockedDir) return {}
        return { byId: { ...s.byId, [convId]: { ...cur, blockedDir: null } } }
      }),

    setPlanFirst: (convId, v) =>
      set((s) => {
        const cur = s.byId[convId]
        if (!cur || !!cur.planFirst === v) return {}
        return { byId: { ...s.byId, [convId]: { ...cur, planFirst: v } } }
      }),

    setPendingPlan: (convId, text) =>
      patch(convId, { pendingPlan: { text } }),

    clearPendingPlan: (convId) =>
      set((s) => {
        const cur = s.byId[convId]
        if (!cur || !cur.pendingPlan) return {}
        return { byId: { ...s.byId, [convId]: { ...cur, pendingPlan: undefined } } }
      }),

    setAutoResume: (convId, autoResume) => patch(convId, { autoResume }),

    cancelAutoResume: (convId) =>
      set((s) => {
        const cur = s.byId[convId]
        if (!cur?.autoResume) return {}
        clearTimeout(cur.autoResume.timer)
        return { byId: { ...s.byId, [convId]: { ...cur, autoResume: undefined } } }
      }),

    markStalled: (convId, since) => patch(convId, { stalledSince: since }),

    clearStalled: (convId) =>
      set((s) => {
        const cur = s.byId[convId]
        if (cur?.stalledSince == null) return {}
        return {
          byId: { ...s.byId, [convId]: { ...cur, stalledSince: undefined } },
        }
      }),

    beginTransplant: (convId, runId, agent) =>
      set((s) => {
        const cur = s.byId[convId]
        if (!cur) return {}
        return {
          byId: {
            ...s.byId,
            [convId]: {
              ...cur,
              agent,
              reqModel: null,
              effort: null,
              sessionId: null, // a sessão do agent anterior não serve pro novo
              contextTokens: undefined,
              streamingTextId: null,
              running: true,
              finalizing: false,
              runId,
              startedAt: Date.now(),
              suggestions: [],
              suggesting: false,
              pendingPlan: undefined,
              limitHitThisTurn: false,
              resetHint: null,
            },
          },
        }
      }),

    finish: (convId) =>
      patch(convId, {
        running: false,
        finalizing: false,
        streamingTextId: null,
        runId: null,
      }),

    setDraft: (convId, text) =>
      set((s) => ({ drafts: { ...s.drafts, [convId]: text } })),

    enqueue: (convId, text, attachments = []) =>
      set((s) => {
        const cur = s.byId[convId]
        if (!cur) return {}
        return {
          byId: {
            ...s.byId,
            [convId]: {
              ...cur,
              queued: [...(cur.queued ?? []), { text, attachments }],
            },
          },
        }
      }),

    dequeueQueued: (convId) => {
      const cur = get().byId[convId]
      const pending = cur?.queued ?? []
      if (pending.length === 0) return []
      set((s) => {
        const c = s.byId[convId]
        if (!c) return {}
        return { byId: { ...s.byId, [convId]: { ...c, queued: [] } } }
      })
      return pending
    },

    removeQueued: (convId, index) => {
      const removed = get().byId[convId]?.queued?.[index]
      set((s) => {
        const cur = s.byId[convId]
        if (!cur?.queued) return {}
        return {
          byId: {
            ...s.byId,
            [convId]: { ...cur, queued: cur.queued.filter((_, i) => i !== index) },
          },
        }
      })
      // Blobs do item removido: mesmo ciclo de vida do X do composer (URL +
      // arquivo), poupando os ainda referenciados por outro item da fila
      // (dedup por hash → paths iguais).
      if (!removed) return
      const kept = new Set(
        (get().byId[convId]?.queued ?? []).flatMap((q) =>
          q.attachments.map((a) => a.path),
        ),
      )
      for (const a of removed.attachments) {
        if (kept.has(a.path)) continue
        revokeAttachmentUrl(a.path)
        void deleteAttachment(a.path)
      }
    },

    beginFusion: (convId, text, attachments) =>
      set((s) => {
        // mesmo guard do start: sem estado carregado, não fabrica conversa vazia.
        const cur = s.byId[convId]
        if (!cur) return {}
        const items = [
          ...cur.items,
          {
            kind: "user" as const,
            id: uid(),
            text,
            attachments: attachments.length ? attachments : undefined,
          },
        ]
        const titled = patchConvMeta(s, convId, (c) =>
          c.title ? c : { ...c, title: deriveTitle(items) },
        )
        return {
          ...titled,
          byId: {
            ...s.byId,
            [convId]: {
              ...cur,
              items,
              running: true,
              finalizing: false,
              pendingPlan: undefined,
            },
          },
        }
      }),

    promoteFusion: async (convId, winner, notice) => {
      set((s) => {
        const cur = s.byId[convId]
        if (!cur) return {}
        // marca a vitória da disputa no transcript (senão vira turno comum sem rastro)
        const lead = notice
          ? [{ kind: "notice" as const, id: uid(), message: notice }]
          : []
        return {
          byId: {
            ...s.byId,
            [convId]: {
              ...cur,
              items: [...cur.items, ...lead, ...winner.items],
              sessionId: winner.sessionId,
              agent: winner.agent,
              reqModel: winner.reqModel,
              effort: winner.effort,
              model: winner.model,
              running: false,
              finalizing: false,
            },
          },
        }
      })
      await get().persist(convId)
    },
  }
})

/** A conversa ativa (ou um estado vazio estável se nenhuma). */
export function useActiveConv(): ConvState {
  return useChat((s) => (s.activeId ? s.byId[s.activeId] : undefined) ?? EMPTY_CONV)
}
