import { create } from "zustand"
import { avisar } from "@/lib/avisos"
import type { AgentEvent } from "@/lib/agent"
import {
  beginPreparationState,
  blockPreparationState,
  clearPreparationState,
  turnControl,
} from "@/store/chat/runLifecycle"
import type { Attachment } from "@/lib/attachments"
import { deleteAttachment, revokeAttachmentUrl } from "@/lib/attachments"
import { deriveTitle } from "@/lib/convTitle"
import { detectBlockedDir } from "@/lib/blockedDir"
import { useApp } from "@/store/app"
import { aplicarSinalDeCota } from "@/store/chat/quotaSignals"
import type { FusionCandidate } from "@/store/fusion"
import {
  aliasShiftNotice,
  isAliasRequest,
} from "@/lib/modelResolution"
import { recordTurnCost } from "@/lib/db"
import {
  createConversation as dbCreate,
  saveConversation as dbSave,
  renameConversation as dbRename,
  setConversationColor as dbSetColor,
  setConversationWorktree as dbSetWorktree,
  setConversationPreset as dbSetPreset,
  type ConversationMeta,
} from "@/lib/db/conversations"
import { changedItemPositions } from "@/lib/db/conversationItems"
import type { EstadoDaRetomada } from "@/lib/autoResume"
import { createItemPersistence } from "@/store/chat/itemPersistence"
import { createChatNavigation } from "@/store/chat/navigation"
import { unseenBoundary } from "@/lib/unseen"
import {
  applyRunStatusToLiveness, createInitialRunLiveness,
  selectRunLiveness, type RunLiveness,
} from "@/store/chat/runLiveness"
export { selectRunLiveness, type RunLiveness } from "@/store/chat/runLiveness"
import {
  deferredLabel, deferredLiveLine, deferredStopWarning,
  deferredResumePrompt, deferredRetryTitle, progressTokens, type LiveWorkLine,
} from "@/store/chat/deferredLive"
export {
  deferredLabel, deferredLiveLine, deferredStopWarning,
  deferredResumePrompt, deferredRetryTitle, progressTokens, type LiveWorkLine,
}
import { warnPresetDrift } from "@/lib/presets"
import { perfSpan } from "@/lib/fleet/perf"
import type { Enfileirar } from "@/lib/sendOrigin"
import type { WorkEvent } from "@/lib/work"
import { duplicateConversationImpl, forkConversationAtImpl } from "@/store/chat/clone"
import { argsDaSessao, commitTransplantState, stageAgentImpl } from "@/store/chat/revezamento"
import { comResumeFalhado } from "@/store/chat/retomada"
import {
  removeAdviceImpl,
} from "@/store/chat/advice"
import { markNotesSentImpl } from "@/store/chat/notes"
import { settleOrphanedTool } from "@/store/chat/terminalTools"
import { tomarCausaDoCorte } from "@/lib/corte"
export { pendingDeferred } from "@/store/chat/terminalTools"
import { reduceRunManifest } from "@/store/chat/runManifest"
import { removeConversationImpl } from "@/store/chat/remove"
import { setSessionModeImpl } from "@/store/chat/sessionMode"
import {
  generateSuggestionsImpl,
  invalidateSuggestionsImpl,
  scheduleSuggestionsImpl,
} from "@/store/chat/suggestions"
import { deFundo } from "@/lib/deFundo"
import {
  moveConversationImpl,
  reorderConversationsImpl,
} from "@/store/chat/ordem"
import { decidePlanGateImpl, pushPlanGateImpl } from "@/store/chat/planGate"
import {
  EMPTY_CONTEXT_SNAPSHOT,
  contextSnapshotArgs,
  type ContextSnapshotState,
} from "@/lib/contextSnapshot"

export type { ChatItem, ParecerLevado } from "@/store/chat/itens"
import { reduceItems, type ItemReducible, type ReduceCtx } from "@/store/chat/reduceItems"
export { reduceItems, type ItemReducible, type ReduceCtx }
import { uid } from "@/store/chat/uid"
export { uid }
import type { ChatItem, FaseDaFala } from "@/store/chat/itens"
import type { Consultado } from "@/lib/parecerAoVivo"

/** Processo marcado vivo no snapshot anterior não é desta instância: vira
 * órfão (PID e tail preservados), nunca "rodando". O mesmo com o trabalho
 * DIFERIDO do provider, que morreu junto com o CLI: `running` do disco vira
 * `interrupted` (deferred-work-plan D1.5). */
export const markOrphanedProcesses = (items: ChatItem[]): ChatItem[] =>
  items.map((item) => settleOrphanedTool(item, Date.now()))

/** Itens de EXECUTOR: exclui a consulta a um especialista (o parecer e a fala
 *  que o pediu). Fonte única de "1º turno / já iniciada / identidade travada":
 *  sem isto, uma consulta antes do 1º envio travaria agent e persona e
 *  roubaria a injeção inicial. Use em todo lugar que derivaria de items.length. */
export const executorItems = (items: ChatItem[]): ChatItem[] =>
  items.filter((it) => it.kind !== "advice" && !(it.kind === "user" && it.advisorTo))

/** A conversa já teve algum turno de EXECUTOR? (ignora a consulta ao conselheiro
 *  inteira: o parecer e a fala endereçada a ele) */
export const hasExecutorTurn = (items: ChatItem[]): boolean => executorItems(items).length > 0


export {
  conversationPresence,
  needsPersonaReinject,
  type ConversationPresence,
} from "@/store/chat/presence"

/** Custo da sessão: mudou de casa (lib/sessionCost), re-exportado aqui porque
 *  a fonte única do strip de custo sempre foi importada do store. */
export { sessionCost } from "@/lib/sessionCost"

/** Mensagem enfileirada durante o turno: texto + anexos do momento do Enter. */
export interface QueuedMsg {
  text: string
  attachments: Attachment[]
}

/** Estado de UMA conversa, vive em byId[convId]; runs em background escrevem aqui. */
export interface ConvState extends ContextSnapshotState {
  projectId: string
  /** Agent que roda esta conversa (claude-code|codex|…), trava no 1º run. */
  agent: string
  /** Modelo + effort escolhidos (null = default do CLI), travam no 1º run. */
  reqModel: string | null
  effort: string | null
  /** Worktree isolado desta conversa (null = compartilha a pasta do projeto). */
  worktreePath: string | null
  /** Persona da conversa: escolhida antes do 1º run, digest carimbado nele.
   *  Ausente = sem persona. */
  presetId?: string | null
  presetDigest?: string | null
  /** Nome do preset resolvido na hidratação (rótulo da mesa no snapshot da
   *  frota, S3.5). null com presetId presente = preset apagado (o drift avisa). */
  presetName?: string | null
  /** Linha corrompida no banco (JSON não parseou): envio e persist BLOQUEADOS
   *  pra não sobrescrever dados ainda recuperáveis via SQLite. */
  corrupt?: boolean
  items: ChatItem[]
  sessionId: string | null
  model: string | null
  /** Id da bolha de texto em streaming (H2). null = nenhuma aberta. */
  streamingTextId: string | null
  /** Fase anunciada para a próxima fala (`text_phase`), até ela nascer. */
  faseDaFala?: FaseDaFala | null
  running: boolean
  /** O turno terminou mas o CLI ainda finaliza (flush da sessão do Codex).
   *  Bloqueia o próximo envio, senão o resume cai em "session not found". */
  finalizing: boolean
  /** runId do run em andamento (p/ cancelar). */
  runId: string | null
  runManifest?: import("@/lib/tooling").EffectiveRunManifest
  /** Pedido ainda no composer enquanto o backend calcula as capabilities. */
  preparing?: { runId: string; startedAt: number }
  /** Exigência não atendida antes do turno. Não pertence ao transcript. */
  preflightGate?: {
    runId: string
    gate: import("@/lib/tooling").McpPreflightGate
  }
  /** Revezamento em duas fases: o target inicia sem assumir a conversa. A
   *  origem só é trocada quando o novo CLI emite `session`; falha antes disso
   *  deixa a origem retomável. Efêmero. */
  pendingTransplant?: {
    runId: string
    targetAgent: string
    /** Pedido de modelo/effort do destino. Ficam em quarentena até `session`. */
    targetModel?: string | null
    targetEffort?: string | null
    /** Linha auditável que só entra no fio junto do commit da sessão nova. */
    commitNotice?: string
  }
  /** Revezamento de motor engatilhado para o próximo envio deste fio. */
  stagedAgent?: string | null
  /** Sessão que cada motor deixou nesta conversa ao sair (R5). */
  sessoesAnteriores?: import("@/lib/retomadaDeMotor").SessoesAnteriores
  /** Timestamp (ms) de início do run atual, p/ cronômetro ao vivo. */
  startedAt: number | null
  /** Vida do processo e relógios técnicos do run corrente. Não persiste. */
  runLiveness?: RunLiveness
  /** Sugestões dinâmicas pós-turno (Sprint 3). */
  suggestions: string[]
  suggesting: boolean
  /** Mensagens digitadas durante o turno, cada uma com os anexos do momento;
   *  viram um envio só quando o turno termina. Efêmero. */
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
  /** Modo desta conversa (store/chat/sessionMode). `null` = herda o projeto. */
  sessionMode?: import("@/lib/sessionMode").SessionMode | null
  /** true se um `limit_reached` bateu no turno CORRENTE (limite da CLI). Alimenta
   *  a detecção FORTE do auto-resume no fim do turno. Zerado a cada novo run. */
  limitHitThisTurn?: boolean
  /** Hint textual de quando o limite reseta (do último limit_reached do turno). */
  resetHint?: string | null
  /** Auto-revive em andamento nesta conversa (efêmero, NÃO persiste). Ver
   *  `EstadoDaRetomada`: existir NÃO quer dizer agendada (`retomadaAgendada`). */
  autoResume?: EstadoDaRetomada
  /** O turno terminou fora da sua vista: vira o selo de concluído/falhou na
   *  linha da conversa, que some ao abri-la. Efêmero. */
  finishedUnseen?: "ok" | "error"
  /** Primeiro item não visto, capturado ao abrir uma conversa com
   *  finishedUnseen: vira o divisor "novas mensagens" durante a visita. */
  unseenDividerId?: string
  /** Turno MUDO (watchdog P2): epoch ms da ÚLTIMA atividade quando o episódio
   *  foi notificado. Presente = já avisado neste episódio (1 aviso por
   *  episódio); atividade nova/fim do turno limpa. Efêmero (não persiste). */
  stalledSince?: number
  /** Especialista sendo consultado (id e nome da persona) para a linha de
   *  chegada no fim do fio. Não é `running`: não trava envio nem finge turno. */
  advising?: Consultado | null
  /** Último fingerprint injetado por chave: `doctrine` (re-injeta só quando o
   *  arquivo muda) e `mcp` (volta como `mcpFingerprint` para re-anunciar só
   *  quando o plano muda). Efêmero de propósito: depois de um restart custa um
   *  re-anúncio e uma re-injeção por conversa, e dispensa migração. */
  injected?: Record<string, string>
}

export interface ChatState {
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
  /** Diagnóstico efêmero de processo por conversa (ADR-183).
   *  Isolado de byId para que a telemetria a cada 5s não cause re-render geral de ChatPanel. */
  runLivenessByConv: Record<string, RunLiveness>
  /** Prompt enfileirado por outra UI (ex.: ⌘K) p/ o ChatPanel disparar. */
  queuedPrompt: string | null

  openProject: (projectId: string | null) => Promise<void>
  /** Carrega (lazy) as metas de um projeto no mapa; no-op se já carregadas.
   *  Chamada quando um projeto é expandido no sidebar. */
  loadProjectConversations: (projectId: string) => Promise<void>
  /** Cria uma conversa vazia no projeto, abre-a (activeId) e RETORNA o id —
   *  callers que precisam do id (ex.: dispatch de card) usam o retorno, nunca
   *  inferem via activeId (corrida com outra navegação). */
  newConversation: (projectId: string) => Promise<string>
  /** Cria conversa em BACKGROUND (automação): grava no banco e registra no
   *  store sem roubar a seleção. `agent` carimba o motor já na criação (a
   *  coluna nasce com claude-code, e a mesa de outro agent adotaria a
   *  conversa). */
  registerConversation: (
    projectId: string,
    id: string,
    title: string,
    agent?: string,
  ) => Promise<void>
  switchConversation: (id: string) => Promise<void>
  /** Garante que a conversa está carregada em byId (do disco se preciso) SEM
   *  roubar a seleção — não toca em activeId/projectId. É a `ensureLoaded`
   *  promovida a action p/ superfícies fora do ChatPanel (ex.: companion). */
  ensureConversationLoaded: (projectId: string, convId: string) => Promise<void>
  removeConversation: (id: string) => Promise<void>
  /** Renomeia manualmente (o título passa a ser fixo, não mais auto-derivado). */
  renameConversation: (id: string, title: string) => Promise<void>
  /** Define/limpa (null) a cor-rótulo da conversa. */
  setConversationColor: (id: string, color: string | null) => Promise<void>
  /** Agent escolhido antes do 1º envio (conversa vazia). No-op se já tem itens. */
  setConversationAgent: (convId: string, agent: string) => void
  /** Engatilha o revezamento de motor para o próximo envio deste fio. */
  stageAgent: (convId: string, agent: string | null) => void
  /** Isola a conversa num worktree (path) ou volta pra pasta compartilhada (null). */
  setWorktree: (convId: string, path: string | null) => void
  /** S1.2 — drag & drop: move a conversa `dragId` pra posição da `overId`
   *  DENTRO do projeto (mover entre projetos fica fora de escopo) e persiste a
   *  ordem manual (sort_order). */
  reorderConversations: (projectId: string, dragId: string, overId: string) => void
  /** S1.2 — teclado/context menu: move a conversa uma posição (cima/baixo). */
  moveConversation: (projectId: string, id: string, delta: -1 | 1) => void
  /** Marca a persona escolhida antes do 1º run (null = sem persona). */
  setConversationPreset: (
    convId: string,
    preset: { id: string; name: string } | null,
  ) => Promise<void>
  /** S3.3 — carimbo do 1º run: a persona FOI injetada; grava preset_id +
   *  preset_digest (a versão exata usada) na conversa. AWAIT no write (D4): o
   *  carimbo é a fundação do drift check, falha não pode ser silenciosa. */
  stampPreset: (
    convId: string,
    presetId: string,
    digest: string,
    name: string,
  ) => Promise<void>
  /** Passar o volante: troca a persona que pilota por gesto humano. Zera o
   *  digest, então o próximo turno re-injeta a doutrina (derivado de
   *  needsPersonaReinject, que sobrevive a restart). Não dispara run. `false`
   *  no no-op (turno em voo, já pilota, conversa sumiu). */
  passWheel: (
    convId: string,
    personaId: string,
    name: string,
  ) => Promise<boolean>
  /** Retomar o volante: devolve a direção ao agent base, sem persona, e
   *  persiste null. Não re-injeta nem mexe em sessão. `false` no no-op. */
  returnWheel: (convId: string) => Promise<boolean>
  /** Resume falhou: zera a sessão morta (o run novo grava a dele), apaga a
   *  sessão guardada do motor que falhou e anota quando a volta virou
   *  transplante. */
  clearSession: (convId: string) => void
  /** Transplante: zera sessão, modelo e anel juntos, senão uma falha antes do
   *  novo `session` deixa o modelo do backend antigo colado no novo agent. */
  dropNativeSession: (convId: string) => void
  /** Duplica a conversa (copia o histórico; sessão nova, sem resume). */
  duplicateConversation: (id: string) => Promise<void>
  /** Fork CURADO até `uptoItemId`; false no no-op, sem anunciar gesto vazio. */
  forkConversationAt: (id: string, uptoItemId: string, targetAgent?: string) => Promise<boolean>
  persist: (convId: string) => Promise<void>
  /** Confirma somente a cauda incremental pendente antes de um novo envio. */
  flushItems: (convId: string) => Promise<void>
  /** Anexa itens prontos ao fio e persiste (marcos da missão). Exige a
   *  conversa carregada: sem ela é no-op com aviso, porque o persist grava a
   *  linha inteira e apagaria o histórico. Não mexe em running/runId. */
  appendItems: (convId: string, items: ChatItem[]) => Promise<void>
  beginPreparation: (convId: string, runId: string) => void
  blockPreparation: (
    convId: string,
    runId: string,
    gate: import("@/lib/tooling").McpPreflightGate,
  ) => void
  clearPreparation: (convId: string, runId: string) => void
  clearPreflightGate: (convId: string) => void
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
  /** Telemetria do MCP frota-work (fora do Channel do provider). */
  handleWorkEvent: (event: WorkEvent) => void
  /** Alterna uma reação no resultado terminal do turno e persiste a conversa. */
  toggleTurnReaction: (
    convId: string,
    resultId: string,
    reaction: string,
  ) => Promise<boolean>
  /** Dispensa o aviso de pasta bloqueada desta conversa. */
  clearBlockedDir: (convId: string) => void
  /** Liga/desliga o "Planejar primeiro" desta conversa (toggle do composer). */
  /** Define o modo desta conversa; `null` volta a herdar o projeto. */
  setSessionMode: (
    convId: string,
    mode: NonNullable<ConvState["sessionMode"]> | null,
  ) => void
  /** Higiene de injeção (H2/H4): carimba o fingerprint da última injeção de
   *  uma chave ("doctrine" | "mcp") no ledger efêmero da conversa. */
  recordInjectedFingerprint: (convId: string, key: string, fp: string) => void
  /** Grava o plano proposto no fio e carimba a decisão nele (store/chat/planGate). */
  pushPlanGate: (convId: string, text: string) => void
  decidePlanGate: (
    convId: string,
    id: string,
    decision: "approved" | "discarded" | "superseded",
  ) => void
  /** Registra um resume automático agendado (banner + timer). */
  setAutoResume: (convId: string, s: ConvState["autoResume"]) => void
  /** Cancela/limpa o auto-resume agendado (para o timer). Chamar ao enviar
   *  manual, parar o run, ou quando o loop termina/atinge o cap. */
  cancelAutoResume: (convId: string) => void
  /** Watchdog: marca o turno como mudo (since = epoch da última atividade). */
  markStalled: (convId: string, since: number) => void
  /** Watchdog: atividade voltou / turno acabou — fecha o episódio de mudez. */
  clearStalled: (convId: string) => void
  /** Revezamento: prepara outro agent na mesma conversa, com a origem intacta
   *  até o primeiro `session`. */
  beginTransplant: (
    convId: string,
    runId: string,
    agent: string,
    options?: {
      model: string | null
      effort: string | null
      commitNotice?: string | null
      user?: { text: string; attachments: Attachment[] }
    },
  ) => void
  finish: (convId: string) => void
  setSuggestions: (convId: string, s: string[]) => void
  setSuggesting: (convId: string, v: boolean) => void
  /** Invalida a sugestão pendente ou em voo. Chame antes de iniciar o run. */
  invalidateSuggestions: (convId: string) => void
  /** Agenda a geração ~700ms após o turno (debounce contra rajadas). */
  scheduleSuggestions: (convId: string) => void
  /** Gera sugestões contextuais (fire-and-forget; degrada pros chips estáticos). */
  generateSuggestions: (convId: string) => Promise<void>
  queuePrompt: (t: string | null) => void
  /** Fila da conversa: enfileira uma mensagem digitada durante o turno
   *  (com os anexos pendentes do composer, que viajam junto). */
  /** Limpa o selo de "terminou e você não viu" (ao abrir a conversa). */
  markSeen: (convId: string) => void
  /** Especialistas E1: marca/limpa o conselheiro em consulta (id+nome ou null). */
  setAdvising: (convId: string, advising: Consultado | null) => void
  /** Especialistas E1: consome e limpa os pareceres pendentes (no envio). */
  /** Especialistas E1: "Dispensar" — remove o item de parecer do fio + persiste. */
  /** Carimba notas como ENTREGUES ao agente (não repetir no próximo prompt). */
  markNotesSent: (convId: string, ids: string[]) => void
  /** Tira UM item do fio pelo id e persiste (parecer dispensado, nota tirada). */
  removeThreadItem: (convId: string, id: string) => void
  /** Especialistas E3 — "tirar da conversa": remove TODOS os pareceres (kind
   *  "advice") daquela persona do fio + persiste. A persona sai da presença, que
   *  é DERIVADA (conversationPresence deixa de listar o convidado). */
  removeAdvice: (convId: string, personaId: string) => void
  /** Empilha na fila do composer. Ela é DO HUMANO (ADR-046) e o 4º parâmetro é
   *  a prova: retomada de sistema não é atribuível a `OrigemHumana`. */
  enqueue: Enfileirar
  /** Esvazia a fila e devolve as mensagens pendentes (p/ coalescer no envio). */
  dequeueQueued: (convId: string) => QueuedMsg[]
  /** Remove UMA mensagem enfileirada (o X no chip da fila). */
  removeQueued: (convId: string, index: number) => void
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


/** Acha a chave (projectId) cujo array de metas contém `convId`. Como o id de
 *  conversa é ÚNICO globalmente, no máximo um projeto casa → miramos a conversa
 *  EXATA, sem risco de mexer no projeto errado. */
export function projectOfConv(
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

export function emptyConv(projectId: string): ConvState {
  return {
    projectId,
    agent: "claude-code",
    reqModel: null,
    effort: null,
    worktreePath: null,
    presetId: null,
    presetDigest: null,
    presetName: null,
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

/** Sessão, modelo e contexto são um snapshot indivisível no transplante/drop. */
const TRANSPLANT_SESSION_RESET = {
  sessionId: null,
  model: null,
  ...EMPTY_CONTEXT_SNAPSHOT,
} as const

/** Reduz um evento do agent sobre o estado de UMA conversa (Linear). */
function reduceEvent(c: ConvState, e: AgentEvent): Partial<ConvState> {
  const now = Date.now()
  const previous = c.runLiveness ?? {
    mainAlive: null,
    descendants: null,
    rssMb: null,
    lastByteAt: null,
    lastEventAt: null,
    observedAt: null,
  }
  const runLiveness: RunLiveness =
    e.type === "run_status"
      ? {
          ...previous,
          mainAlive: e.main_alive,
          descendants: e.descendants,
          rssMb: e.rss_mb,
          lastByteAt: e.last_byte_at,
          observedAt: e.observed_at,
        }
      : { ...previous, lastEventAt: now }
  return {
    ...reduceItems(c, e, { agent: c.agent, reqModel: c.reqModel }, now),
    ...turnControl(e),
    ...reduceRunManifest(c.runManifest, e),
    runLiveness,
  }
}

export const useChat = create<ChatState>((set, get) => {
  // Sugestões: estado de orquestração por convId (espelha byId). Vive no closure
  // do creator, a store é singleton, então a sugestão sobrevive a remount do
  // painel. O debounce e o token de invalidação vivem em store/chat/suggestions.

  const itemPersistence = createItemPersistence(get)
  const schedulePersist = itemPersistence.schedule
  const cancelPersist = itemPersistence.cancel

  /** Aplica um patch parcial em UMA conversa (no-op se ela não existe mais). */
  const patch = (convId: string, p: Partial<ConvState>) =>
    set((s) => {
      const cur = s.byId[convId]
      if (!cur) return {}
      return { byId: { ...s.byId, [convId]: { ...cur, ...p } } }
    })

  const navigation = createChatNavigation(get, set, {
    uid,
    emptyConversation: emptyConv,
    markOrphanedProcesses,
  })

  return {
    projectId: null,
    activeId: null,
    conversations: [],
    conversationsByProject: {},
    byId: {},
    runLivenessByConv: {},
    queuedPrompt: null,

    // a closure ensureLoaded exposta como action (mesma semântica, zero seleção)
    ensureConversationLoaded: navigation.ensureLoaded,

    queuePrompt: (queuedPrompt) => set({ queuedPrompt }),
    setSuggestions: (convId, suggestions) => patch(convId, { suggestions }),
    setSuggesting: (convId, suggesting) => patch(convId, { suggesting }),

    // Debounce, token de invalidação e geração em store/chat/suggestions.
    invalidateSuggestions: (convId) => invalidateSuggestionsImpl(convId),
    scheduleSuggestions: (convId) => scheduleSuggestionsImpl(get, convId),
    generateSuggestions: (convId) => generateSuggestionsImpl(get, convId),

    openProject: navigation.openProject,

    // Lazy: carrega as metas de um projeto no mapa quando ele é expandido no
    // sidebar. No-op se já carregadas (não remexe no que já está na tela).
    loadProjectConversations: async (projectId) => {
      if (get().conversationsByProject[projectId]) return
      const list = await navigation.loadMeta(projectId)
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
        // Anexa na lista do projeto DONO. O fallback é `[]`, nunca
        // s.conversations, que pode ser a lista de outro projeto.
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
      return id
    },

    registerConversation: async (projectId, id, title, agent) => {
      await dbCreate(projectId, id)
      await dbRename(id, title) // título fixo ("⏰ …") — o persist preserva
      // Carrega a lista do projeto antes de anexar: um array só com esta
      // conversa esconderia as demais (o load é no-op se a chave existe).
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
      // Conversa de outro projeto: sincroniza projectId e o espelho na hora,
      // sem esperar o openProject e sem deixar a UI num estado misto.
      const owner = projectOfConv(s.conversationsByProject, id) ?? s.projectId
      // Invalida openProject em voo: o clique é a escolha mais recente.
      navigation.invalidate()
      // Captura a fronteira do "não visto" antes do markSeen apagar o selo: ela
      // vira o divisor "novas mensagens".
      const opened = s.byId[id]
      const divider = opened?.finishedUnseen
        ? (unseenBoundary(opened.items) ?? undefined)
        : undefined
      // o divisor da conversa que você está DEIXANDO morre com a visita.
      if (s.activeId && s.byId[s.activeId]?.unseenDividerId)
        patch(s.activeId, { unseenDividerId: undefined })
      // abriu a conversa ⇒ o selo de "terminou e você não viu" cumpriu o papel
      get().markSeen(id)
      if (divider) patch(id, { unseenDividerId: divider })
      set((st) => ({
        activeId: id,
        projectId: owner,
        conversations:
          owner && st.conversationsByProject[owner]
            ? st.conversationsByProject[owner]
            : st.conversations,
      }))
      if (owner) await navigation.ensureLoaded(owner, id)
    },

    // Corpo em store/chat/remove.ts junto da lista inteira do que morre com a
    // conversa (missão, disputa, card, anexo, worktree). `cancelPersist` viaja
    // por parâmetro: é closure daqui, sobre o mapa de timers deste criador.
    removeConversation: (id) => removeConversationImpl(get, set, id, cancelPersist),

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

    /** Agent escolhido numa conversa ainda vazia, para a sidebar e a mesa
     *  certa refletirem a escolha antes do 1º envio. No-op com itens: o agent
     *  está travado no 1º run, e mudar mentiria sobre quem fez o histórico. */
    setConversationAgent: (convId, agent) => {
      const s0 = get()
      const cur = s0.byId[convId]
      // pareceres de conselheiro (advice) são laterais e NÃO travam o agent — o
      // executor ainda não rodou se só há pareceres no fio (Especialistas E1).
      if (!cur || hasExecutorTurn(cur.items)) return
      // "já é esse agent" olha os DOIS lados: o `byId` nasce no PADRÃO histórico
      // (claude-code) e engolia o carimbo na META, que é a que a sidebar lê — sem
      // ela a linha cai no default GLOBAL, que pode ser outro agent.
      const pid = projectOfConv(s0.conversationsByProject, convId)
      const meta = s0.conversationsByProject[pid ?? ""]?.find((c) => c.id === convId)
      if (cur.agent === agent && (!meta || meta.agent === agent)) return
      set((s) => ({
        ...patchConvMeta(s, convId, (c) => ({ ...c, agent })),
        byId: { ...s.byId, [convId]: { ...s.byId[convId], agent } },
      }))
      // persiste p/ sobreviver a restart (linha vazia: o UPSERT não tem
      // histórico a atropelar). Best-effort — a UI já refletiu.
      void get().persist(convId)
    },

    stageAgent: (convId, agent) => stageAgentImpl(get, set, convId, agent),

    setWorktree: (convId, path) => {
      void dbSetWorktree(convId, path)
      set((s) => ({
        ...patchConvMeta(s, convId, (c) => ({ ...c, worktreePath: path })),
        byId: s.byId[convId]
          ? { ...s.byId, [convId]: { ...s.byId[convId], worktreePath: path } }
          : s.byId,
      }))
    },

    // S1.2 — ordem manual das conversas de UM projeto. A lista exibida É a
    // persistida: no-op do helper (mesma referência) não grava nada; mudança
    // atualiza o mapa + o espelho do projeto ativo e renumera o sort_order.
    reorderConversations: (projectId, dragId, overId) =>
      reorderConversationsImpl(get, set, projectId, dragId, overId),

    moveConversation: (projectId, id, delta) =>
      moveConversationImpl(get, set, projectId, id, delta),

    // S3.6 — seleção de preset no composer (conversa ainda destravada). O
    // digest fica null até o 1º run: só a persona INJETADA carimba versão.
    setConversationPreset: async (convId, preset) => {
      patch(convId, {
        presetId: preset?.id ?? null,
        presetName: preset?.name ?? null,
        presetDigest: null,
      })
      await dbSetPreset(convId, preset?.id ?? null, null)
    },

    // Carimbo do 1º run: a persona foi injetada nesta versão. Espera a escrita
    // e avisa se falhar (sem o digest, o drift check morreria em silêncio).
    stampPreset: async (convId, presetId, digest, name) => {
      patch(convId, { presetId, presetDigest: digest, presetName: name })
      try {
        await dbSetPreset(convId, presetId, digest)
      } catch (e) {
        console.warn("[presets] falha ao gravar o carimbo da persona:", e)
        avisar.erro(
          "Não consegui gravar o carimbo da persona no banco. Após reiniciar, o aviso de mudança de persona pode não funcionar nesta conversa.",
        )
      }
    },

    // Passar o volante reusa o par presetId/presetDigest; a injeção vem de
    // resolveFirstTurnPersona no próximo envio. `false` no no-op, para o
    // caller não anunciar gesto sem efeito.
    passWheel: async (convId, personaId, name) => {
      const cur = get().byId[convId]
      if (!cur || cur.corrupt) return false
      if (cur.running || cur.finalizing) return false // turno em voo: espera
      if (cur.presetId === personaId) return false // já pilota → no-op
      patch(convId, {
        presetId: personaId,
        presetDigest: null,
        presetName: name,
      })
      try {
        await dbSetPreset(convId, personaId, null)
      } catch (e) {
        console.warn("[presets] falha ao gravar a troca de piloto:", e)
      }
      return true
    },

    // Retomar o volante: presetId, nome e digest para null, persistido. Sem
    // re-injeção e sem tocar em sessão.
    returnWheel: async (convId) => {
      const cur = get().byId[convId]
      if (!cur || cur.corrupt) return false
      if (cur.running || cur.finalizing) return false // turno em voo: espera
      if (cur.presetId == null) return false // já sem piloto → no-op
      patch(convId, {
        presetId: null,
        presetDigest: null,
        presetName: null,
      })
      try {
        await dbSetPreset(convId, null, null)
      } catch (e) {
        console.warn("[presets] falha ao devolver o volante ao base:", e)
      }
      return true
    },

    clearSession: (convId) => {
      set((s) => {
        const cur = s.byId[convId]
        if (!cur) return s
        // No revezamento a conversa ainda pertence à origem até o `session`:
        // quem tentou retomar é o destino em voo.
        const motor = cur.pendingTransplant?.targetAgent ?? cur.agent
        const proximo = comResumeFalhado(cur, motor)
        return { byId: { ...s.byId, [convId]: proximo } }
      })
    },

    dropNativeSession: (convId) => {
      set((s) =>
        s.byId[convId]
          ? {
              byId: {
                ...s.byId,
                [convId]: { ...s.byId[convId], ...TRANSPLANT_SESSION_RESET },
              },
            }
          : s,
      )
    },

    duplicateConversation: (id) => duplicateConversationImpl(get, set, id),
    forkConversationAt: (id, uptoItemId, targetAgent) =>
      forkConversationAtImpl(get, set, id, uptoItemId, targetAgent),

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
      // Os itens vão só para a fonte itemizada, e só os que mudaram desde o
      // último persist (ADR-230), na mesma fila serial das escritas de
      // streaming. A linha abaixo não carrega mais a conversa inteira.
      await itemPersistence.persistir(convId, c.items)
      await dbSave(
        convId,
        c.projectId,
        title,
        c.sessionId,
        c.suggestions,
        c.agent,
        c.reqModel,
        c.effort,
        c.model,
        ...contextSnapshotArgs(c),
        ...argsDaSessao(c),
      )
      endSpan()
      const now = Date.now()
      // atualiza no lugar, sem reordenar (ordem de criação é estável)
      set((st) => {
        const list = st.conversationsByProject[c.projectId]
        if (!list) return {}
        // espelha o agent gravado (dbSave acima escreve c.agent na linha) — a
        // meta em memória não pode divergir do banco (derive lê meta.agent).
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

    flushItems: async (convId) => {
      await itemPersistence.flush(convId)
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
      // Metas do projeto antes do persist: sem elas ele re-derivaria o título
      // do 1º prompt e apagaria o "Missão · …".
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

    beginPreparation: (convId, runId) =>
      set((state) => beginPreparationState(state, convId, runId)),

    blockPreparation: (convId, runId, gate) =>
      set((state) => blockPreparationState(state, convId, runId, gate)),

    clearPreparation: (convId, runId) =>
      set((state) => clearPreparationState(state, convId, runId)),

    clearPreflightGate: (convId) => patch(convId, { preflightGate: undefined }),

    start: (convId, text, runId, agent, model, effort, attachments) => {
      // E1 (S1.4): o turno resolve o agent da conversa → espelha no card
      // ligado (assignee_agent). Import dinâmico: cards importa este módulo.
      // Best-effort: falha do espelho não pode travar o turno.
      void deFundo(
        import("@/store/cards")
          .then((m) => m.useCards.getState().noteConversationAgent(convId, agent))
          .catch(() => {}),
      )
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
            ts: Date.now(),
          },
        ]
        // Título e agent na lista do projeto dono: o ícone da linha é de quem
        // está rodando.
        const titled = patchConvMeta(s, convId, (c) => ({ ...c, agent, title: c.title || deriveTitle(items) }))
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
              runManifest: undefined,
              preparing: undefined,
              preflightGate: undefined,
              startedAt: Date.now(),
              runLiveness: undefined,
              suggestions: [],
              suggesting: false,
              blockedDir: null, // novo turno zera o aviso de pasta bloqueada
              // enviar de novo É reconhecer o turno anterior: o selo de
              // concluído sai sozinho, sem exigir que você troque de conversa.
              finishedUnseen: undefined,
              unseenDividerId: undefined, // o turno novo encerra a visita "novas mensagens"
              limitHitThisTurn: false, // e o sinal de limite do turno anterior
              resetHint: null,
              stalledSince: undefined, // e o episódio de turno mudo
              stagedAgent: undefined,
            },
          },
          runLivenessByConv: {
            ...s.runLivenessByConv,
            [convId]: createInitialRunLiveness(),
          },
        }
      })
    },

    handleEvent: (convId, e) => {
      // O motor diz QUE parou; quem parou vem do gesto que carimbou (ADR-180).
      if (e.type === "cancelled" && !e.cause) e = { ...e, cause: tomarCausaDoCorte(convId) }
      // Telemetria efêmera de processo (ADR-183): isolada em runLivenessByConv
      // para não reconstruir ConvState nem disparar re-render de ChatPanel/MessageList a cada 5s.
      if (e.type === "run_status") {
        set((s) => ({
          runLivenessByConv: {
            ...s.runLivenessByConv,
            [convId]: applyRunStatusToLiveness(
              s.runLivenessByConv[convId] ?? s.byId[convId]?.runLiveness,
              e,
            ),
          },
        }))
        return
      }
      const beforeEvent = get().byId[convId]
      const pending = beforeEvent?.pendingTransplant
      const pendingTarget = pending?.targetAgent
      // Durante o preflight/startup do revezamento, a conversa ainda pertence
      // ao source, mas telemetria/limites do processo em voo pertencem ao target.
      const eventAgent = pendingTarget ?? beforeEvent?.agent
      // Cota do agent é efeito GLOBAL (cross-conversa): store/chat/quotaSignals.
      aplicarSinalDeCota(eventAgent, e)
      // …e o sinal FORTE p/ o auto-resume ler no fim do turno (+ guarda o hint).
      if (e.type === "limit_reached")
        patch(convId, { limitHitThisTurn: true, resetHint: e.reset_hint ?? null })
      // Ledger de custo por turno: grava todo result que consumiu (ADR-047).
      // Chat linear não se sobrepõe a missão e disputa; REPLACE por run_id
      // colapsa parciais no total.
      if (e.type === "result") {
        const cur = get().byId[convId]
        if (cur?.runId) {
          void recordTurnCost({
            runId: cur.runId,
            projectId: cur.projectId,
            convId,
            agent: eventAgent ?? cur.agent,
            // Antes de `session`, o modelo resolvido ainda pertence à origem.
            // Nunca combine agent do target com model do source no ledger.
            model: pending ? (pending.targetModel ?? null) : cur.model,
            costUsd: e.cost_usd,
            costSource: e.cost_source ?? null,
            input: e.input_tokens ?? 0,
            output: e.output_tokens ?? 0,
            cache: (e.cache_read ?? 0) + (e.cache_creation ?? 0),
          })
        }
      }
      // Modelo resolvido ANTERIOR desta conversa: é a testemunha do alias-shift
      // dela. O ledger global não basta, outra conversa pode já ter aprendido
      // a resolução nova e mascarar o aviso aqui.
      const committingTransplant = e.type === "session" && pendingTarget != null
      const prevModel =
        e.type === "session" && !committingTransplant
          ? (beforeEvent?.model ?? null)
          : null
      // O espelho do card e o drift da persona só acompanham um target que
      // realmente abriu sessão. Antes disso a conversa continua sob o source.
      if (committingTransplant && beforeEvent) {
        void deFundo(
          import("@/store/cards")
            .then((m) =>
              m.useCards
                .getState()
                .noteConversationAgent(convId, pendingTarget),
            )
            .catch(() => {}),
        )
        if (beforeEvent.presetId && beforeEvent.presetDigest) {
          const path =
            useApp
              .getState()
              .projects.find((p) => p.id === beforeEvent.projectId)?.path ?? null
          void warnPresetDrift(
            convId,
            beforeEvent.presetId,
            beforeEvent.presetDigest,
            path,
          )
        }
      }
      set((s) => {
        const cur = s.byId[convId]
        if (!cur) return {}
        const base = committingTransplant
          ? commitTransplantState(cur, pending!)
          : cur
        // Result pode chegar antes do `session` (limite no startup): o item
        // reflete o pedido do destino sem contaminar o modelo da origem.
        const eventView =
          !committingTransplant && pending && e.type === "result"
            ? { ...base, model: pending.targetModel ?? null }
            : base
        // Context usage pré-sessão também pertence ao processo candidato. Sem
        // uma sessão confirmada não há anel novo para comprometer; preserve o
        // footprint da origem para retry.
        const reduced =
          !committingTransplant &&
          pending &&
          (e.type === "context_usage" || e.type === "context_unavailable")
            ? {}
            : reduceEvent(eventView, e)
        return {
          byId: {
            ...s.byId,
            [convId]: { ...base, ...reduced },
          },
        }
      })
      // Phase 3 do extra_dirs: tool_result FALHO citando pasta fora da raiz →
      // marca blockedDir p/ o banner "Liberar e reenviar". Best-effort (heurístico).
      if (e.type === "tool_result" && !e.ok) {
        const cur = get().byId[convId]
        const proj = cur
          ? useApp.getState().projects.find((p) => p.id === cur.projectId)
          : undefined
        if (cur && proj && !cur.blockedDir) {
          const allowed = useApp.getState().projectConfigs[cur.projectId]?.extraDirs ?? []
          const dir = detectBlockedDir(e.text, proj.path, allowed)
          if (dir) patch(convId, { blockedDir: dir })
        }
      }
      const afterEvent = get().byId[convId]
      const changedPositions =
        beforeEvent && afterEvent
          ? changedItemPositions(beforeEvent.items, afterEvent.items)
          : afterEvent?.items.map((_, position) => position) ?? []
      const itemCountChanged = beforeEvent?.items.length !== afterEvent?.items.length
      // Persistência incremental (sobrevive a interrupção mid-run):
      if (e.type === "session") {
        // O app aprende o que o CLI resolve para cada pedido. Alias que muda de
        // resolução entre sessões vira notice: é quando preço e comportamento
        // derivariam em silêncio.
        const cur = get().byId[convId]
        if (cur) {
          const ledgerPrev = useApp
            .getState()
            .recordResolution(cur.agent, cur.reqModel, e.model)
          // A própria conversa vence o ledger global como referência do shift.
          const prev = prevModel ?? ledgerPrev
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
                      { kind: "notice", id: uid(), message: msg, ts: Date.now() },
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
        // Texto/tool em streaming → somente as posições alteradas, coalescidas
        // na mesma janela de recuperação que o snapshot antigo usava.
        if (afterEvent && (changedPositions.length || itemCountChanged)) {
          schedulePersist(convId, changedPositions, afterEvent.items.length)
        }
      }
    },

    handleWorkEvent: (event) => {
      const process = event.data.process
      const convId = process?.convId ?? event.data.convId
      if (!convId) return
      const beforeItems = get().byId[convId]?.items ?? []
      set((s) => {
        const cur = s.byId[convId]
        if (!cur) return {}
        if (event.kind === "process_started" && process) {
          const exists = cur.items.some(
            (it) =>
              it.kind === "tool" && it.managedProcess?.id === process.id,
          )
          if (exists) return {}
          const item: ChatItem = {
            kind: "tool",
            id: `work-${process.id}`,
            name: "ManagedProcess",
            input: {
              command: process.command,
              label: process.label,
              cwd: process.cwd,
            },
            toolId: `mc-process:${process.id}`,
            managedProcess: process,
            ts: process.startedAt,
          }
          return {
            byId: {
              ...s.byId,
              [convId]: { ...cur, items: [...cur.items, item] },
            },
          }
        }
        if (
          event.kind === "process_output" &&
          event.data.processId &&
          typeof event.data.seq === "number" &&
          typeof event.data.line === "string"
        ) {
          const items = cur.items.map((it) => {
            const managed = it.kind === "tool" ? it.managedProcess : undefined
            if (!managed || managed.id !== event.data.processId) return it
            if (event.data.seq! <= (managed.outputSeq ?? 0)) return it
            const lines = managed.output
              ? [...managed.output.split("\n"), event.data.line!]
              : [event.data.line!]
            const output = lines.slice(-240).join("\n")
            return {
              ...it,
              managedProcess: {
                ...managed,
                // O backend já limita linhas/bytes; este teto local protege
                // replay legado e impede que a redução cresça sem limite.
                output: output.slice(-256 * 1024),
                outputSeq: event.data.seq,
                updatedAt: event.data.updatedAt ?? managed.updatedAt,
              },
            }
          })
          return { byId: { ...s.byId, [convId]: { ...cur, items } } }
        }
        if (
          process &&
          (event.kind === "process_stopping" ||
            event.kind === "process_exited")
        ) {
          const terminal =
            process.status === "exited" ||
            process.status === "failed" ||
            process.status === "stopped" ||
            process.status === "orphaned"
          const items = cur.items.map((it) => {
            if (
              it.kind !== "tool" ||
              it.managedProcess?.id !== process.id
            )
              return it
            return {
              ...it,
              managedProcess: process,
              ...(terminal
                ? {
                    result: {
                      ok: process.status === "exited" && process.exitCode === 0,
                      text: process.output,
                      lines: process.output.trim()
                        ? process.output.split("\n").length
                        : 0,
                    },
                  }
                : {}),
            }
          })
          return { byId: { ...s.byId, [convId]: { ...cur, items } } }
        }
        if (event.kind === "work_plan" && event.data.tasks?.length) {
          const run = event.data.runId ?? "run"
          const additions: ChatItem[] = []
          const existing = new Set(
            cur.items
              .filter(
                (it): it is Extract<ChatItem, { kind: "tool" }> =>
                  it.kind === "tool" && it.name === "TaskCreate",
              )
              .map((it) => {
                const input = (it.input ?? {}) as Record<string, unknown>
                return typeof input.taskId === "string" ? input.taskId : null
              })
              .filter((id): id is string => id != null),
          )
          for (const task of event.data.tasks) {
            const taskId = `work:${run}:${task.id}`
            if (!existing.has(taskId)) {
              additions.push({
                kind: "tool",
                id: uid(),
                name: "TaskCreate",
                input: {
                  taskId,
                  subject: task.title,
                  description: task.description,
                  activeForm: task.title,
                },
                toolId: `frota-work:create:${taskId}`,
                ts: Date.now(),
              })
            }
            if (task.status && task.status !== "pending") {
              additions.push({
                kind: "tool",
                id: uid(),
                name: "TaskUpdate",
                input: { taskId, status: task.status },
                toolId: `frota-work:update:${taskId}:${task.status}`,
                ts: Date.now(),
              })
            }
          }
          return {
            byId: {
              ...s.byId,
              [convId]: { ...cur, items: [...cur.items, ...additions] },
            },
          }
        }
        if (event.kind === "work_update" && event.data.task) {
          const run = event.data.runId ?? "run"
          const task = event.data.task
          const taskId = `work:${run}:${task.id}`
          const update: ChatItem = {
            kind: "tool",
            id: uid(),
            name: "TaskUpdate",
            input: {
              taskId,
              status: task.status,
              subject: task.title,
              description: task.description,
            },
            toolId: `frota-work:update:${taskId}:${Date.now()}`,
            ts: Date.now(),
          }
          return {
            byId: {
              ...s.byId,
              [convId]: { ...cur, items: [...cur.items, update] },
            },
          }
        }
        return {}
      })
      const afterItems = get().byId[convId]?.items ?? []
      const changed = changedItemPositions(beforeItems, afterItems)
      if (changed.length || beforeItems.length !== afterItems.length) {
        schedulePersist(convId, changed, afterItems.length)
      }
    },

    toggleTurnReaction: async (convId, resultId, reaction) => {
      let added = false
      set((s) => {
        const cur = s.byId[convId]
        if (!cur) return {}
        const items = cur.items.map((it) => {
          if (it.kind !== "result" || it.id !== resultId) return it
          const reactions = it.reactions ?? []
          const present = reactions.includes(reaction)
          added = !present
          return {
            ...it,
            reactions: present
              ? reactions.filter((x) => x !== reaction)
              : [...reactions, reaction],
          }
        })
        return { byId: { ...s.byId, [convId]: { ...cur, items } } }
      })
      await get().persist(convId)
      return added
    },

    clearBlockedDir: (convId) =>
      set((s) => {
        const cur = s.byId[convId]
        if (!cur || !cur.blockedDir) return {}
        return { byId: { ...s.byId, [convId]: { ...cur, blockedDir: null } } }
      }),

    // Corpo em store/chat/sessionMode.ts, com o porquê do escopo.
    setSessionMode: (convId, mode) => setSessionModeImpl(get, set, convId, mode),

    recordInjectedFingerprint: (convId, key, fp) =>
      set((s) => {
        const cur = s.byId[convId]
        if (!cur || cur.injected?.[key] === fp) return {}
        return {
          byId: {
            ...s.byId,
            [convId]: { ...cur, injected: { ...cur.injected, [key]: fp } },
          },
        }
      }),

    // Corpo em store/chat/planGate.ts, junto do porquê de o gate ser ITEM.
    pushPlanGate: (convId, text) => pushPlanGateImpl(get, set, convId, text),
    decidePlanGate: (convId, id, decision) =>
      decidePlanGateImpl(get, set, convId, id, decision),

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

    beginTransplant: (convId, runId, agent, options) => {
      set((s) => {
        const cur = s.byId[convId]
        if (!cur) return {}
        const user = options?.user
        const items = user
          ? [
              ...cur.items,
              {
                kind: "user" as const,
                id: uid(),
                text: user.text,
                attachments: user.attachments.length
                  ? user.attachments
                  : undefined,
                ts: Date.now(),
              },
            ]
          : cur.items
        const titled = user
          ? patchConvMeta(s, convId, (c) =>
              c.title ? c : { ...c, title: deriveTitle(items) },
            )
          : {}
        return {
          ...titled,
          byId: {
            ...s.byId,
            [convId]: {
              ...cur,
              // Duas fases: por enquanto só registra a intenção/startup. O
              // source continua sendo a verdade até o target emitir `session`.
              pendingTransplant: {
                runId,
                targetAgent: agent,
                ...(options
                  ? {
                      targetModel: options.model,
                      targetEffort: options.effort,
                      ...(options.commitNotice
                        ? { commitNotice: options.commitNotice }
                        : {}),
                    }
                  : {}),
              },
              items,
              streamingTextId: null,
              running: true,
              finalizing: false,
              runId,
              preparing: undefined,
              preflightGate: undefined,
              startedAt: Date.now(),
              runLiveness: undefined,
              suggestions: [],
              suggesting: false,
              pendingPlan: undefined,
              limitHitThisTurn: false,
              resetHint: null,
              // revezar também É agir na conversa: a visita "novas mensagens"
              // acaba aqui, igual ao start (S1.1).
              unseenDividerId: undefined,
              stagedAgent: undefined,
            },
          },
          runLivenessByConv: {
            ...s.runLivenessByConv,
            [convId]: createInitialRunLiveness(),
          },
        }
      })
    },

    finish: (convId) => {
      // Marca sempre que o turno termina, inclusive na conversa à vista: o
      // texto chega em streaming, e sem o selo o fim só se nota pela ausência
      // do spinner. Sai quando você abre ou envia.
      const c = get().byId[convId]
      const last = c?.items[c.items.length - 1]
      const unseen: ConvState["finishedUnseen"] =
        last?.kind === "error" || last?.kind === "limit" ? "error" : "ok"
      patch(convId, {
        running: false,
        finalizing: false,
        streamingTextId: null,
        runId: null,
        // Startup falhou/cancelou antes de `session`: descarta apenas a intenção;
        // agent, sessionId, model e contextTokens do source nunca foram tocados.
        pendingTransplant: undefined,
        preparing: undefined,
        finishedUnseen: unseen,
      })
    },

    /** Você abriu a conversa ⇒ o selo de concluído cumpriu o papel e some. */
    markSeen: (convId) => {
      if (!get().byId[convId]?.finishedUnseen) return
      patch(convId, { finishedUnseen: undefined })
    },

    // Especialistas E1 — estado do conselheiro inline (patch no-op se a conversa
    // sumiu). advising é indicador visual, NÃO trava o envio nem finge turno.
    setAdvising: (convId, advising) => patch(convId, { advising }),



    markNotesSent: (convId, ids) => markNotesSentImpl(get, set, convId, ids),

    removeThreadItem: (convId, id) => {
      const cur = get().byId[convId]
      if (!cur) return
      patch(convId, { items: cur.items.filter((it) => it.id !== id) })
      void get().persist(convId)
    },

    removeAdvice: (convId, personaId) =>
      removeAdviceImpl(get, patch, convId, personaId),

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
            ts: Date.now(),
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
          ? [{ kind: "notice" as const, id: uid(), message: notice, ts: Date.now() }]
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


/** Diagnóstico efêmero do processo do run por conversa (ADR-183).
 *  Consumido exclusivamente por WorkingIndicator via seletor granular para evitar re-render geral de ChatPanel. */
export function useRunLiveness(convId?: string | null): RunLiveness | undefined {
  return useChat((s) => selectRunLiveness(s, convId))
}

