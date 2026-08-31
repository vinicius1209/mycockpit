import { create } from "zustand"
import { toast } from "sonner"
import type { AgentEvent, CostSource } from "@/lib/agent"
import type { Attachment } from "@/lib/attachments"
import { deleteAttachment, revokeAttachmentUrl } from "@/lib/attachments"
import { deriveTitle } from "@/lib/convTitle"
import { detectBlockedDir } from "@/lib/blockedDir"
import { getAgentDef } from "@/lib/agentDefs"
import { useApp } from "@/store/app"
import type { FusionCandidate } from "@/store/fusion"
import { normalizeModelValue } from "@/lib/agents"
import {
  aliasShiftNotice,
  isAliasRequest,
  resolutionNotice,
} from "@/lib/modelResolution"
import { recordTurnCost } from "@/lib/db"
import {
  listConversations as dbList,
  loadConversation as dbLoad,
  createConversation as dbCreate,
  saveConversation as dbSave,
  renameConversation as dbRename,
  setConversationColor as dbSetColor,
  setConversationWorktree as dbSetWorktree,
  setConversationPreset as dbSetPreset,
  type ConversationMeta,
} from "@/lib/db/conversations"
import { unseenBoundary } from "@/lib/unseen"
import { warnPresetDrift } from "@/lib/presets"
import { perfSpan } from "@/lib/fleet/perf"
import type { Enfileirar } from "@/lib/sendOrigin"
import type { DeferredWork, WorkEvent, ManagedProcess } from "@/lib/work"
import { duplicateConversationImpl, forkConversationAtImpl } from "@/store/chat/clone"
import { markNotesSentImpl } from "@/store/chat/notes"
import { settleOrphanedTool, settleTerminalTools } from "@/store/chat/terminalTools"
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
  hydrateContextSnapshot,
  reduceContextSnapshot,
  type ContextSnapshotState,
} from "@/lib/contextSnapshot"

type ChatItemBody =
  | {
      kind: "user"
      id: string
      text: string
      attachments?: Attachment[]
      /** Fala ENDEREÇADA a um conselheiro (`@aline …`, Especialistas E1), não ao
       *  executor. O pedido é seu e aparece no fio como seu — mas não é turno de
       *  executor: não trava agent/preset e não rouba a injeção de
       *  persona/doutrina do turno-1 (ver `executorItems`). Ausente = fala com
       *  quem pilota, o caso normal. */
      advisorTo?: { id: string; name: string }
    }
  | { kind: "text"; id: string; text: string }
  | {
      kind: "tool"
      id: string
      name: string
      input: unknown
      /** tool_use_id do CLI (liga o tool_result à linha). */
      toolId?: string
      /** Tool `Task`/agent que originou esta ação. Preservado do provider para
       *  reconstruir a árvore do Fio Vivo após restart. */
      parentToolId?: string
      /** Síntese final do subagente, mantida dentro do nó que o criou em vez de
       *  virar uma fala solta do executor principal. */
      agentSummary?: string
      /** Processo externo cujo ciclo de vida pertence ao MyCockpit. */
      managedProcess?: ManagedProcess
      /** Trabalho DIFERIDO do provider (tool Workflow/background task): nó com
       *  ciclo de vida PRÓPRIO, assíncrono ao turno (deferred-work-plan D1.2). */
      deferred?: DeferredWork
      /** Último evento observável desta ação (resultado/retorno do subagente).
       * `ts` continua sendo o nascimento, usado na cronologia do transcript. */
      activityAt?: number
      /** Resumo do resultado (texto truncado + nº de linhas do output). */
      result?: { ok: boolean; text: string; lines: number }
      /** Evidência VISUAL do resultado (browser-plan B1): paths relativos ao
       *  app_data_dir ("evidence/<convId>/<toolId>-<idx>.<ext>"). Persistem no
       *  snapshot (replay-safe); arquivo sumido do disco vira placeholder na
       *  UI, nunca imagem quebrada. */
      images?: string[]
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
      /** Reações do usuário ao RESULTADO consolidado deste turno. Persistem no
       *  próprio transcript e são agnósticas ao provider que o executou. */
      reactions?: string[]
    }
  | { kind: "error"; id: string; message: string }
  /** Nota do HUMANO ancorada num item (`anchorId`). Modelo A: viaja SEMPRE —
   *  recap + transcript (docs/notas-no-fio-plan.md), senão é decoração. */
  | { kind: "note"; id: string; text: string; anchorId: string; sent?: boolean }
  /** Plano proposto num turno `plan_first`. `decision` ausente = ainda na mesa.
   *  Por que é item e não campo: store/chat/planGate.ts. */
  | { kind: "planGate"; id: string; text: string; decision?: "approved" | "discarded" | "superseded" }
  | { kind: "cancelled"; id: string }
  | { kind: "notice"; id: string; message: string }
  /** Limite de uso/cota do agent atingido: cartão acionável (revezamento). */
  | { kind: "limit"; id: string; message: string; resetHint?: string }
  /** Parecer de um CONSELHEIRO (Especialistas E1): uma persona chamada inline
   *  (`@aline`) opinou sobre o contexto atual, read-only. Item ADITIVO — não é
   *  turno de executor. Carimba persona id+version+digest (auditoria/drift). */
  | {
      kind: "advice"
      id: string
      personaId: string
      personaName: string
      personaVersion: number
      digest: string
      /** A pergunta que originou o parecer (rastro). */
      question: string
      text: string
    }

/** Todo item do fio carrega o instante em que NASCEU (epoch ms), carimbado na
 *  criação com Date.now() (estilo Slack: a hora vira cabeçalho do grupo).
 *  Opcional: itens gravados antes deste campo não têm carimbo — a UI tolera
 *  `undefined` e omite a hora nesses casos (sem "undefined" fantasma). A
 *  intersecção sobre a união preserva o discriminante `kind` (narrowing e
 *  Extract<> seguem funcionando) sem repetir o campo em cada variante. */
export type ChatItem = ChatItemBody & { ts?: number }

/** Um processo marcado como vivo no snapshot anterior não pertence ao registry
 * desta nova instância. Não finge "rodando": preserva PID/tail e marca órfão,
 * deixando repetição explícita como caminho de recuperação. O mesmo vale pro
 * trabalho DIFERIDO do provider (deferred-work-plan D1.5): ele vivia DENTRO do
 * processo do CLI que morreu junto com a instância anterior — `running` vindo
 * do disco vira `interrupted`, nunca "rodando" falso após restart. */
export function markOrphanedProcesses(items: ChatItem[]): ChatItem[] {
  const now = Date.now()
  return items.map((item) => settleOrphanedTool(item, now))
}

/** `task_type` do provider → palavra que um humano usa (background-status B2.3:
 *  `local_agent` cru vazava pra tela). Tipo desconhecido segue cru: traduzir o
 *  que não se conhece seria inventar. */
const DEFERRED_KIND_LABEL: Record<string, string> = {
  local_workflow: "workflow",
  local_agent: "subagente",
}

/** Nome humano de um trabalho diferido pro copy da UI (nunca id cru quando há
 *  alternativa melhor). */
export function deferredLabel(d: DeferredWork): string {
  if (d.name) return d.name
  if (d.kind) return DEFERRED_KIND_LABEL[d.kind] ?? d.kind
  return d.id
}

/** Rótulo cortado pro tamanho que cabe na linha viva sem empurrar o cronômetro
 *  (background-status B2.1: quem cede é o NOME, nunca o tempo). O corte é do
 *  texto, além do `truncate` do CSS — a linha viva também vira `title` e
 *  notificação, onde não existe elipse de layout. */
function clipWorkName(name: string, max: number): string {
  const clean = name.replace(/\s+/g, " ").trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/** O que a LINHA VIVA (rodapé do fio, junto do composer) diz sobre o trabalho em
 *  background (background-status B2.2/B2.5). Um lugar canônico pro "agora":
 *  nada vivo → null (não mente); um → "trabalho em background · <nome>";
 *  N → "N trabalhos em background · <mais recente>" (nome atrás de nome
 *  empilhado quebrou a linha nos builds 181/182).
 *  `since` é o instante do trabalho NOMEADO: o cronômetro pertence ao que está
 *  escrito, e o turno perde o `startedAt` no `result`.
 *  `detail` lista os nomes pro tooltip (o detalhe abre no Fio Vivo). Puro. */
export interface LiveWorkLine {
  text: string
  since: number
  count: number
  detail: string
}

export function deferredLiveLine(
  works: DeferredWork[],
  nameMax = 28,
): LiveWorkLine | null {
  if (works.length === 0) return null
  // "mais recente" = o que nasceu por último; empate no nascimento desempata
  // pela última atividade observada, e depois pela ordem do fio.
  const latest = works.reduce((a, b) =>
    b.startedAt > a.startedAt ||
    (b.startedAt === a.startedAt && b.updatedAt >= a.updatedAt)
      ? b
      : a,
  )
  const name = clipWorkName(deferredLabel(latest), nameMax)
  return {
    text:
      works.length === 1
        ? `trabalho em background · ${name}`
        : `${works.length} trabalhos em background · ${name}`,
    since: latest.startedAt,
    count: works.length,
    detail: works.map(deferredLabel).join(", "),
  }
}

/** Aviso do botão de PARAR, na superfície do turno (deferred-work-plan D1.4 ×
 *  background-status B2.4): interromper o turno mata junto o trabalho em
 *  background. É a única superfície com essa ação, então a copy diz o preço, no
 *  plural certo. Sem trabalho vivo → undefined (o Parar comum não precisa de
 *  aviso). */
export function deferredStopWarning(works: DeferredWork[]): string | undefined {
  if (works.length === 0) return undefined
  if (works.length === 1)
    return "Parar (o trabalho em background do agent morre junto e fica marcado como interrompido)"
  return `Parar (os ${works.length} trabalhos em background do agent morrem junto e ficam marcados como interrompidos)`
}

/** Decisão travada 3 do deferred-work-plan: Retomar ≠ repetir. Num nó de
 *  trabalho diferido, a ÚNICA ação de repetição permitida é retomar um
 *  INTERROMPIDO reaproveitando o cache do workflow (a task-notification
 *  injetada no resume traz o resumeFromRunId) — relançar do zero paga os
 *  subagentes todos de novo. `running`/`completed` → nenhuma ação (null). */
export function deferredResumePrompt(d: DeferredWork): string | null {
  if (d.status !== "interrupted") return null
  return `Retome o trabalho em background "${deferredLabel(d)}" de onde parou, reaproveitando o que já foi executado: use a tool Workflow com o resumeFromRunId indicado na task-notification desta conversa (chamadas agent() concluídas voltam do cache). NÃO relance do zero.`
}

/** Extrai o contador de progresso (usage.total_tokens) do `progress` cru do
 *  task_progress. Tolerante: payload sem usage/total_tokens → null. */
export function progressTokens(progress: unknown): number | null {
  if (progress == null || typeof progress !== "object") return null
  const usage = (progress as Record<string, unknown>).usage
  if (usage == null || typeof usage !== "object") return null
  const t = (usage as Record<string, unknown>).total_tokens
  return typeof t === "number" ? t : null
}

/** Itens de EXECUTOR de uma conversa: exclui a CONSULTA a um conselheiro — o
 *  parecer (kind "advice") E a fala que o pediu (`user` com `advisorTo`) —, que
 *  são laterais e NÃO contam como turno do executor (Especialistas E1). FONTE
 *  ÚNICA do "1º turno / já iniciada / travar identidade": sem isto, uma consulta
 *  ANTES do 1º envio travaria a escolha de agent/preset e roubaria a injeção de
 *  persona/doutrina do turno inicial. Usar em TODO lugar que hoje deriva
 *  "locked" de items.length. */
export function executorItems(items: ChatItem[]): ChatItem[] {
  return items.filter(
    (it) => it.kind !== "advice" && !(it.kind === "user" && it.advisorTo),
  )
}

/** A conversa já teve algum turno de EXECUTOR? (ignora a consulta ao conselheiro
 *  inteira: o parecer e a fala endereçada a ele) */
export function hasExecutorTurn(items: ChatItem[]): boolean {
  return executorItems(items).length > 0
}

/** Presença de uma conversa (Especialistas E3, S3.1). DERIVADA, sem estado novo:
 *  o PILOTO é o preset-executor já carimbado (`presetId`) e os CONVIDADOS são as
 *  personas distintas que já opinaram (itens `advice`), dedupe por id, o piloto
 *  fora da lista (ele pilota, não é convidado). Puro e testável. */
export interface ConversationPresence {
  pilotId: string | null
  guests: { id: string; name: string }[]
}

export function conversationPresence(
  conv: Pick<ConvState, "presetId" | "items">,
): ConversationPresence {
  const pilotId = conv.presetId ?? null
  const guests = new Map<string, string>()
  for (const it of conv.items) {
    if (it.kind !== "advice") continue
    if (it.personaId === pilotId) continue // o piloto não é convidado de si mesmo
    if (!guests.has(it.personaId)) guests.set(it.personaId, it.personaName)
  }
  return {
    pilotId,
    guests: [...guests].map(([id, name]) => ({ id, name })),
  }
}

/** Custo da sessão: mudou de casa (lib/sessionCost), re-exportado aqui porque
 *  a fonte única do strip de custo sempre foi importada do store. */
export { sessionCost } from "@/lib/sessionCost"

/** Especialistas E3 (S3.2) — o próximo turno precisa RE-INJETAR a persona?
 *  DERIVADO de estado PERSISTIDO (sobrevive a restart), não de flag efêmera:
 *  há persona carimbada (`presetId`), o digest foi ZERADO (o gesto de passar o
 *  volante limpa) e a conversa JÁ tem turno de executor (distingue do 1º turno
 *  real, onde o digest também é null mas ainda não há executor → o turno-1
 *  injeta pelo caminho `!locked`). `presetId`/`presetDigest`/`items` são todos
 *  persistidos, então A→B + reload + próximo envio ainda re-injeta B. Puro. */
export function needsPersonaReinject(
  conv: Pick<ConvState, "presetId" | "presetDigest" | "items">,
): boolean {
  return (
    conv.presetId != null &&
    (conv.presetDigest == null || conv.presetDigest === "") &&
    hasExecutorTurn(conv.items)
  )
}

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
  /** Preset (persona) da conversa (S3): escolhido no composer antes do 1º run;
   *  o digest é carimbado NO 1º run (persona injetada). Opcionais p/ não
   *  quebrar factories — ausente = sem preset (camada crua). */
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
  running: boolean
  /** Turno terminou (Result) mas o processo do CLI ainda finaliza, ex. flush da
   *  sessão do Codex. Bloqueia o próximo send p/ o resume não cair em "session
   *  not found" (corrida: liberar no Result dispara o resume antes do flush). */
  finalizing: boolean
  /** runId do run em andamento (p/ cancelar). */
  runId: string | null
  runManifest?: import("@/lib/tooling").EffectiveRunManifest
  /** Revezamento em duas fases: o target está iniciando, mas ainda NÃO assumiu
   *  a conversa. O agent/sessão de origem só são trocados quando o novo CLI
   *  emite `session`; falha antes disso deixa a origem integralmente retomável.
   *  Efêmero (não persiste). */
  pendingTransplant?: {
    runId: string
    targetAgent: string
    /** Pedido de modelo/effort do destino. Ficam em quarentena até `session`. */
    targetModel?: string | null
    targetEffort?: string | null
  }
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
  /** Modo desta conversa (store/chat/sessionMode). `null` = herda o projeto. */
  sessionMode?: import("@/lib/sessionMode").SessionMode | null
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
  /** Turno TERMINOU e você não viu (o fio não estava na sua frente). Vira o
   *  selo de concluído/falhou na linha da conversa no sidebar — o spinner some
   *  quando acaba e, sem isto, o fim do turno não deixava sinal NENHUM na
   *  navegação. Limpo ao abrir a conversa. Efêmero (não persiste). */
  finishedUnseen?: "ok" | "error"
  /** S1.1 — id do PRIMEIRO item não-visto, capturado ao ABRIR uma conversa que
   *  estava com finishedUnseen: vira o divisor "novas mensagens" no fio. Vive
   *  durante a visita; sai ao trocar de conversa ou enviar um turno novo.
   *  Efêmero (não persiste). */
  unseenDividerId?: string
  /** Turno MUDO (watchdog P2): epoch ms da ÚLTIMA atividade quando o episódio
   *  foi notificado. Presente = já avisado neste episódio (1 aviso por
   *  episódio); atividade nova/fim do turno limpa. Efêmero (não persiste). */
  stalledSince?: number
  /** Especialistas E1: um conselheiro está sendo consultado nesta conversa
   *  (id + nome da persona) — a "linha de chegada" no fim do fio enquanto o
   *  parecer não chega resolve o AgentDef por esse id (fallback: nome). NÃO é
   *  `running` (não trava o envio nem finge turno de executor). Efêmero. */
  advising?: { id: string; name: string } | null
  /** Especialistas E1: pareceres "trazidos pro Executor" e ainda não enviados —
   *  bloco(s) que o próximo turno do executor prepende ao prompt (mesmo cano da
   *  doutrina/lições). Efêmero (não persiste). */
  pendingAdvice?: string
  /** Higiene de injeção (H2/H4 do prompt-hygiene-plan) — ledger POR CONVERSA
   *  do último fingerprint injetado, por chave: `doctrine` = hash do bloco de
   *  doutrina considerado no envio (H4, re-injeta só quando o arquivo muda);
   *  `mcp` = fingerprint do plano de MCPs anunciado pelo Rust (H2, evento
   *  `mcp://announced`; volta como `mcpFingerprint` no próximo run pra
   *  re-anunciar só quando o plano muda). Efêmero (não persiste), padrão
   *  unseenDividerId: após restart o custo é UM re-anúncio de MCP e UMA
   *  re-injeção de doutrina com "(doutrina atualizada)" por conversa (edição
   *  offline nunca se perde) — nunca migração na tabela `conversations` (que
   *  só evolui via Migration no Rust). */
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
  /** F6 — cria uma conversa em BACKGROUND (automação agendada): grava no DB com
   *  título fixo e registra no store SEM roubar a seleção do usuário (não mexe
   *  em activeId/projectId ativo). O run escreve nela via start/handleEvent.
   *  `agent` (opcional) carimba o agent já na criação — meta,
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
   *  promovida a action p/ superfícies fora do ChatPanel (ex.: companion). */
  ensureConversationLoaded: (projectId: string, convId: string) => Promise<void>
  removeConversation: (id: string) => Promise<void>
  /** Renomeia manualmente (o título passa a ser fixo, não mais auto-derivado). */
  renameConversation: (id: string, title: string) => Promise<void>
  /** Define/limpa (null) a cor-rótulo da conversa. */
  setConversationColor: (id: string, color: string | null) => Promise<void>
  /** Agent escolhido antes do 1º envio (conversa vazia). No-op se já tem itens. */
  setConversationAgent: (convId: string, agent: string) => void
  /** Isola a conversa num worktree (path) ou volta pra pasta compartilhada (null). */
  setWorktree: (convId: string, path: string | null) => void
  /** S1.2 — drag & drop: move a conversa `dragId` pra posição da `overId`
   *  DENTRO do projeto (mover entre projetos fica fora de escopo) e persiste a
   *  ordem manual (sort_order). */
  reorderConversations: (projectId: string, dragId: string, overId: string) => void
  /** S1.2 — teclado/context menu: move a conversa uma posição (cima/baixo). */
  moveConversation: (projectId: string, id: string, delta: -1 | 1) => void
  /** S3.6 — marca a conversa com um preset (seleção no composer, ANTES do 1º
   *  run; null = volta pra camada crua). O digest fica null até o 1º run. */
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
  /** S3.2 — "passar o volante": troca o preset-executor da conversa por outra
   *  persona (ex.: a de um parecer) por GESTO HUMANO. Re-carimba presetId e
   *  ZERA o digest — o próximo turno re-injeta a doutrina e re-carimba a versão
   *  atual (a necessidade de re-injeção é DERIVADA de needsPersonaReinject, que
   *  sobrevive a restart). NÃO dispara run — só muda quem pilota o PRÓXIMO
   *  turno. Um piloto por vez. Retorna `true` se a troca foi aplicada, `false`
   *  no no-op (turno em voo, já pilota, conversa sumiu) — o caller só anuncia
   *  quando efetivou. */
  passWheel: (
    convId: string,
    personaId: string,
    name: string,
  ) => Promise<boolean>
  /** Especialistas E3 — "retomar o volante": devolve a direção ao EXECUTOR-BASE
   *  (o code agent, sem persona-piloto). Zera presetId/presetName/presetDigest e
   *  persiste via dbSetPreset(convId, null, null), mesma disciplina do passWheel
   *  mas pra null. Os próximos turnos rodam o agent base; NÃO precisa re-injeção
   *  (needsPersonaReinject volta false com presetId null). Não mexe em sessão.
   *  Retorna `true` se aplicou, `false` no no-op (já sem piloto, turno em voo,
   *  conversa sumiu) — o caller só anuncia quando efetivou. */
  returnWheel: (convId: string) => Promise<boolean>
  /** Zera a sessão nativa da conversa (resume falhou → a sessão antiga está
   *  morta; o run em fallback vai emitir `session` e gravar a nova). */
  clearSession: (convId: string) => void
  /** S3.2 — higiene de transplante (achado #3): zera sessão nativa E o resolvido
   *  (model) E o anel (contextTokens) juntos. Sem zerar model/contextTokens, um
   *  transplante que falha antes do novo `session` deixa o modelo/anel do
   *  backend ANTIGO colado numa conversa cujo agent já é o novo. */
  dropNativeSession: (convId: string) => void
  /** Duplica a conversa (copia o histórico; sessão nova, sem resume). */
  duplicateConversation: (id: string) => Promise<void>
  /** Fork a partir de um turno: cópia CURADA (só até `uptoItemId`), sessão
   *  nova, sem resume. No-op se o item não estiver no fio carregado. */
  forkConversationAt: (id: string, uptoItemId: string) => Promise<void>
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
  /** Telemetria do MCP mc-work (fora do Channel do provider). */
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
  /** Revezamento: prepara OUTRO agent na MESMA conversa. A origem continua
   *  intacta até o primeiro `session`. No revezamento explícito o pedido já
   *  está no fio; na troca de piloto `user` registra o novo pedido sem assumir
   *  prematuramente o backend de destino. */
  beginTransplant: (
    convId: string,
    runId: string,
    agent: string,
    options?: {
      model: string | null
      effort: string | null
      user?: { text: string; attachments: Attachment[] }
    },
  ) => void
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
  /** Limpa o selo de "terminou e você não viu" (ao abrir a conversa). */
  markSeen: (convId: string) => void
  /** Especialistas E1: marca/limpa o conselheiro em consulta (id+nome ou null). */
  setAdvising: (
    convId: string,
    advising: { id: string; name: string } | null,
  ) => void
  /** Especialistas E1: "Trazer pro Executor" — enfileira o bloco do parecer p/
   *  o próximo turno do executor (acumula se houver mais de um). */
  bringAdviceToExecutor: (convId: string, block: string) => void
  /** Especialistas E1: consome e limpa os pareceres pendentes (no envio). */
  takePendingAdvice: (convId: string) => string | null
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

export function uid(): string {
  return crypto.randomUUID()
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

/** Campos que o reducer de itens usa no Linear e nas lanes do Fusion. */
export type ItemReducible = Pick<
  ConvState,
  "items" | "streamingTextId" | "model" | "sessionId" | "startedAt"
> & ContextSnapshotState

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
  /** Instante de nascimento dos itens criados neste reduce (epoch ms).
   *  Injetável nos testes; default Date.now() em produção. */
  now: number = Date.now(),
): Partial<ItemReducible> {
  const contextSnapshot = reduceContextSnapshot(e)
  if (contextSnapshot) return contextSnapshot
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
          ? {
              items: [
                ...c.items,
                { kind: "notice", id: uid(), message: warn, ts: now },
              ],
            }
          : {}),
      }
    }
    // H2, texto completo do assistant: se já veio por deltas, descarta (dedup).
    case "text":
      if (c.streamingTextId) return { streamingTextId: null }
      return {
        items: [...c.items, { kind: "text", id: uid(), text: e.text, ts: now }],
      }
    case "subagent_text":
      return {
        items: c.items.map((it) =>
          it.kind === "tool" && it.toolId === e.parent_tool_id
            ? {
                ...it,
                agentSummary: [it.agentSummary, e.text].filter(Boolean).join("\n"),
                activityAt: now,
              }
            : it,
        ),
        streamingTextId: null,
      }
    // Fim de UM bloco de texto: fecha a bolha corrente pro próximo bloco
    // começar limpo (sem colar no anterior nem no meio da palavra). Genérico.
    case "text_stop":
      return c.streamingTextId ? { streamingTextId: null } : {}
    // H2, delta em streaming: acumula na bolha corrente (cria se não houver).
    case "text_delta": {
      if (c.streamingTextId) {
        // Reducer mais quente do app (roda por token): o `items.map` de antes
        // varria o fio inteiro pra trocar UM item. Busca de trás pra frente
        // (acha na 1ª iteração no caso normal) e troca só o índice alvo.
        // Imutabilidade igual (array novo, item novo) e identidade dos OUTROS
        // itens preservada — vários memos a jusante dependem disso.
        let alvo = -1
        for (let i = c.items.length - 1; i >= 0; i--) {
          if (c.items[i].id === c.streamingTextId) {
            alvo = i
            break
          }
        }
        const it = alvo >= 0 ? c.items[alvo] : null
        // Bolha apontada mas ausente (ou de outro kind): nada a atualizar, e
        // devolver o fio intocado é exatamente o que o `map` já fazia — ele
        // reconstruía um array de conteúdo idêntico. Sem array novo, ninguém a
        // jusante recalcula à toa.
        if (!it || it.kind !== "text") return {}
        const items = c.items.slice()
        items[alvo] = { ...it, text: it.text + e.text }
        return { items }
      }
      const id = uid()
      return {
        items: [...c.items, { kind: "text", id, text: e.text, ts: now }],
        streamingTextId: id,
      }
    }
    case "tool":
      if (
        e.id &&
        c.items.some(
          (it) => it.kind === "tool" && it.toolId === e.id,
        )
      ) {
        return { streamingTextId: null }
      }
      return {
        items: [
          ...c.items,
          {
            kind: "tool",
            id: uid(),
            name: e.name,
            input: e.input,
            toolId: e.id,
            parentToolId: e.parent_tool_id ?? undefined,
            ts: now,
            activityAt: now,
          },
        ],
        streamingTextId: null,
      }
    // Trabalho DIFERIDO do provider (deferred-work-plan D1.2): vira/atualiza um
    // item tool sintético "DeferredWork" com ciclo de vida PRÓPRIO, pendurado
    // no tool_use `Workflow` de origem via parentToolId (Fio Vivo). O `stopped`
    // do provider vira `interrupted`; item terminal nunca é rebaixado a
    // "rodando" (o background_tasks_changed re-lista as tasks vivas).
    case "deferred_work": {
      const terminal = e.status === "completed" || e.status === "stopped"
      const status: DeferredWork["status"] =
        e.status === "completed"
          ? "completed"
          : e.status === "stopped"
            ? "interrupted"
            : "running"
      const existing = c.items.some(
        (it) => it.kind === "tool" && it.deferred?.id === e.id,
      )
      if (!existing) {
        const deferred: DeferredWork = {
          id: e.id,
          toolUseId: e.tool_use_id,
          kind: e.kind,
          name: e.name,
          status,
          summary: e.summary,
          outputFile: e.output_file,
          tokens: progressTokens(e.progress),
          startedAt: now,
          updatedAt: now,
        }
        return {
          items: [
            ...c.items,
            {
              kind: "tool",
              id: `deferred-${e.id}`,
              name: "DeferredWork",
              input: { name: e.name, kind: e.kind, description: e.summary },
              toolId: `deferred:${e.id}`,
              parentToolId: e.tool_use_id ?? undefined,
              deferred,
              ts: now,
              activityAt: now,
              ...(terminal
                ? {
                    result: {
                      ok: status === "completed",
                      text: e.summary ?? "",
                      lines: e.summary ? e.summary.split("\n").length : 0,
                    },
                  }
                : {}),
            },
          ],
        }
      }
      return {
        items: c.items.map((it) => {
          if (it.kind !== "tool" || it.deferred?.id !== e.id) return it
          // terminal é definitivo: um Running atrasado não ressuscita o nó
          if (it.deferred.status !== "running" && !terminal) return it
          const deferred: DeferredWork = {
            ...it.deferred,
            status,
            toolUseId: it.deferred.toolUseId ?? e.tool_use_id,
            kind: it.deferred.kind ?? e.kind,
            name: it.deferred.name ?? e.name,
            summary: e.summary ?? it.deferred.summary,
            outputFile: e.output_file ?? it.deferred.outputFile,
            tokens: progressTokens(e.progress) ?? it.deferred.tokens,
            updatedAt: now,
          }
          const text = deferred.summary ?? ""
          return {
            ...it,
            deferred,
            parentToolId: it.parentToolId ?? deferred.toolUseId ?? undefined,
            activityAt: now,
            ...(terminal
              ? {
                  result: {
                    ok: status === "completed",
                    text,
                    lines: text ? text.split("\n").length : 0,
                  },
                }
              : {}),
          }
        }),
      }
    }
    // resultado resumido de uma tool: anexa à linha correspondente (pelo toolId).
    case "tool_result":
      return {
        items: c.items.map((it) =>
          it.kind === "tool" && it.toolId === e.id && !it.result
            ? {
                ...it,
                result: { ok: e.ok, text: e.text, lines: e.lines },
                // evidência visual (B1): preserva os paths no item (persistem
                // no snapshot). Sem imagem → campo ausente, render idêntico.
                ...(e.images?.length ? { images: e.images } : {}),
                activityAt: now,
              }
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
            ts: now,
          },
        ],
        streamingTextId: null,
      }
    }
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
            ts: now,
          },
        ],
        streamingTextId: null,
      }
    // aviso não-fatal (anexo expirado/não-suportado), só adiciona a linha.
    case "notice":
      return {
        items: [
          ...c.items,
          { kind: "notice", id: uid(), message: e.message, ts: now },
        ],
      }
    case "error":
      return {
        items: [
          ...c.items,
          { kind: "error", id: uid(), message: e.message, ts: now },
        ],
        streamingTextId: null,
      }
    case "cancelled":
      return {
        items: [
          ...settleTerminalTools(c.items, "cancelled", now),
          { kind: "cancelled", id: uid(), ts: now },
        ],
        streamingTextId: null,
      }
    // EOF nunca deixa ferramenta ou trabalho diferido com spinner vivo.
    case "done": {
      const items = settleTerminalTools(c.items, "done", now)
      return items === c.items
        ? { streamingTextId: null }
        : { streamingTextId: null, items }
    }
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
    ...reduceRunManifest(c.runManifest, e),
  }
}

export const useChat = create<ChatState>((set, get) => {
  // Sugestões: estado de orquestração por convId (espelha byId). Vive no closure
  // do creator, a store é singleton, então a sugestão sobrevive a remount do
  // painel. O debounce e o token de invalidação vivem em store/chat/suggestions.

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
    // S3: resolve o NOME do preset carimbado (rótulo da mesa/composer). Best-
    // effort: preset apagado → name null (o drift do S3.4 dá o aviso formal).
    let presetName: string | null = null
    if (conv !== "corrupt" && conv?.presetId) {
      try {
        // personas moram em arquivo (projeto + global) desde jul/2026 — sem o
        // caminho do projeto, uma persona local ficaria sem nome na mesa.
        const path =
          useApp.getState().projects.find((p) => p.id === projectId)?.path ??
          null
        presetName = (await getAgentDef(path, conv.presetId))?.name ?? null
      } catch {
        presetName = null
      }
    }
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
            items: markOrphanedProcesses(conv?.items ?? []),
            sessionId: conv?.sessionId ?? null,
            suggestions: conv?.suggestions ?? [],
            agent: conv?.agent ?? "claude-code",
            // Valores persistidos podem ter saído do CLI (display names do agy,
            // modelos removidos do codex). Normaliza antes de qualquer
            // composer/adapter poder reutilizar esse valor.
            reqModel: normalizeModelValue(
              conv?.agent ?? "claude-code",
              conv?.reqModel ?? null,
            ),
            effort: conv?.effort ?? null,
            // modelo RESOLVIDO da última sessão: TitleBar/validação não
            // degradam pro rótulo do agent depois de um restart.
            model: conv?.model ?? null,
            worktreePath: conv?.worktreePath ?? null,
            presetId: conv?.presetId ?? null,
            presetDigest: conv?.presetDigest ?? null,
            presetName,
            ...hydrateContextSnapshot(conv || null),
            sessionMode: (conv?.sessionMode as ConvState["sessionMode"]) ?? null,
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
    queuedPrompt: null,

    // a closure ensureLoaded exposta como action (mesma semântica, zero seleção)
    ensureConversationLoaded: ensureLoaded,

    queuePrompt: (queuedPrompt) => set({ queuedPrompt }),
    setSuggestions: (convId, suggestions) => patch(convId, { suggestions }),
    setSuggesting: (convId, suggesting) => patch(convId, { suggesting }),

    // Debounce, token de invalidação e geração em store/chat/suggestions.
    invalidateSuggestions: (convId) => invalidateSuggestionsImpl(convId),
    scheduleSuggestions: (convId) => scheduleSuggestionsImpl(get, convId),
    generateSuggestions: (convId) => generateSuggestionsImpl(get, convId),

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
      return id
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
      // S1.1 — a conversa estava marcada "terminou e você não viu"? Captura a
      // fronteira ANTES do markSeen apagar o selo: ela vira o divisor "novas
      // mensagens" desta visita. Derivada dos items já carregados (o selo só
      // existe em conversa carregada — o turno rodou nela).
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
      if (owner) await ensureLoaded(owner, id)
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

    /** Agent escolhido no composer de uma conversa AINDA VAZIA. Sem isto, o
     *  seletor era estado local do CommandConsole até o 1º envio, e a sidebar
     *  mostrava o logo do default (Claude Code) mesmo com Antigravity escolhido
     *  — você via uma coisa e a linha dizia outra. Também faz a mesa certa
     *  adotar a conversa desde já (lib/fleet/derive usa conv.agent).
     *
     *  NO-OP em conversa com itens: aí o agent está TRAVADO no 1º run e mexer
     *  aqui mentiria sobre quem produziu o histórico. */
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

    // S3.3 — carimbo do 1º run: a persona foi injetada NESTA versão do preset.
    // D4: AWAIT + tratamento (padrão setConversationColor). Se o write falha,
    // o restart perderia o digest e o drift check morreria em silêncio — avisa.
    // A memória fica carimbada mesmo assim (o turno corrente segue correto) e
    // a re-injeção do D1 cobre o caso "sem resposta" após restart.
    stampPreset: async (convId, presetId, digest, name) => {
      patch(convId, { presetId, presetDigest: digest, presetName: name })
      try {
        await dbSetPreset(convId, presetId, digest)
      } catch (e) {
        console.warn("[presets] falha ao gravar o carimbo da persona:", e)
        toast(
          "Não consegui gravar o carimbo da persona no banco. Após reiniciar, o aviso de mudança de persona pode não funcionar nesta conversa.",
        )
      }
    },

    // S3.2 — passar o volante: gesto humano que troca o piloto. Reusa o mesmo
    // par presetId/presetDigest do carimbo; a INJEÇÃO da nova doutrina é
    // reaproveitada de resolveFirstTurnPersona no próximo envio (a condição
    // forceReinject é DERIVADA de needsPersonaReinject, que lê estado
    // persistido). Zera o digest → o próximo turno re-carimba a versão ATUAL da
    // nova persona (drift honesto: não avisa erro, reflete a troca). Retorna
    // `false` no no-op pra o caller não anunciar um gesto sem efeito.
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

    // S3 (E3) — retomar o volante: devolve a direção ao executor-base (sem
    // persona). Zera presetId/presetName/presetDigest e persiste pra null (mesma
    // disciplina do passWheel). needsPersonaReinject volta false com presetId
    // null → nenhuma re-injeção; não toca em sessão. No-op (false) se já não há
    // piloto, turno em voo, ou a conversa sumiu.
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
      set((s) =>
        s.byId[convId]
          ? { byId: { ...s.byId, [convId]: { ...s.byId[convId], sessionId: null } } }
          : s,
      )
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
    forkConversationAt: (id, uptoItemId) =>
      forkConversationAtImpl(get, set, id, uptoItemId),

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
        ...contextSnapshotArgs(c),
        c.sessionMode ?? null,
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
      // "Missão · …") — mesmo padrão do ensureDeskConversation (lib/fleet/send.ts).
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
        // título + carimbo do agent na lista do projeto DONO (id único), espelhados
        // no ativo. O agent vai JUNTO: o ícone da linha é de quem ESTÁ rodando, e
        // antes só o persist (FIM do turno) espelhava.
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
              startedAt: Date.now(),
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
            },
          },
        }
      })
    },

    handleEvent: (convId, e) => {
      const beforeEvent = get().byId[convId]
      const pending = beforeEvent?.pendingTransplant
      const pendingTarget = pending?.targetAgent
      // Durante o preflight/startup do revezamento, a conversa ainda pertence
      // ao source, mas telemetria/limites do processo em voo pertencem ao target.
      const eventAgent = pendingTarget ?? beforeEvent?.agent
      // efeitos GLOBAIS: limite marca o agent como limitado (cross-conversa,
      // o seletor avisa); um result ok do mesmo agent cura a marca.
      if (e.type === "limit_reached") {
        if (eventAgent)
          useApp.getState().setAgentLimited(eventAgent, e.reset_hint ?? null)
        // marca o sinal FORTE p/ o auto-resume ler no fim do turno (+ guarda o hint)
        patch(convId, { limitHitThisTurn: true, resetHint: e.reset_hint ?? null })
      } else if (e.type === "result" && e.ok) {
        if (eventAgent) useApp.getState().clearAgentLimited(eventAgent)
      }
      // Ledger de custo por turno (F: "hoje/7d" só via missões). Grava CADA
      // result que CONSUMIU, com preço ou sem (ADR-047: quem decide é o
      // recordTurnCost) — chat linear é caminho disjunto de missão/disputa, sem
      // dupla contagem. REPLACE por run_id colapsa os parciais no total final.
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
      // Modelo resolvido ANTERIOR da conversa (PRÉ-reduce): testemunha do
      // alias-shift desta conversa. O ledger global não basta — outra conversa
      // (ou lane do Fusion) pode já ter "aprendido" a resolução nova e
      // mascarar o aviso exatamente na conversa retomada que mais precisa dele.
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
          ? {
              ...cur,
              agent: pendingTarget,
              reqModel: pending?.targetModel ?? null,
              effort: pending?.targetEffort ?? null,
              ...TRANSPLANT_SESSION_RESET,
              pendingTransplant: undefined,
            }
          : cur
        // Result/telemetria pode chegar antes do `session` (por exemplo, um
        // limite no startup). O item deve refletir o pedido do destino — ou
        // modelo desconhecido — sem contaminar o modelo resolvido da origem.
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
          const allowed = useApp.getState().mycockpit[cur.projectId]?.extraDirs ?? []
          const dir = detectBlockedDir(e.text, proj.path, allowed)
          if (dir) patch(convId, { blockedDir: dir })
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
        // texto/tool/result em streaming → snapshot throttled a cada ~1.2s.
        schedulePersist(convId)
      }
    },

    handleWorkEvent: (event) => {
      const process = event.data.process
      const convId = process?.convId ?? event.data.convId
      if (!convId) return
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
          process &&
          (event.kind === "process_output" ||
            event.kind === "process_stopping" ||
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
                toolId: `mc-work:create:${taskId}`,
                ts: Date.now(),
              })
            }
            if (task.status && task.status !== "pending") {
              additions.push({
                kind: "tool",
                id: uid(),
                name: "TaskUpdate",
                input: { taskId, status: task.status },
                toolId: `mc-work:update:${taskId}:${task.status}`,
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
            toolId: `mc-work:update:${taskId}:${Date.now()}`,
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
      schedulePersist(convId)
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
                    }
                  : {}),
              },
              items,
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
              // revezar também É agir na conversa: a visita "novas mensagens"
              // acaba aqui, igual ao start (S1.1).
              unseenDividerId: undefined,
            },
          },
        }
      })
    },

    finish: (convId) => {
      // Marca SEMPRE que o turno termina — inclusive na conversa que você está
      // olhando. A 1ª versão suprimia esse caso ("o conteúdo é o feedback"), e a
      // teoria tem furo: o texto chega em STREAMING, sem momento nítido de fim.
      // O spinner desaparecendo é sinal por AUSÊNCIA, que é justamente o que
      // faltava. O selo sai quando você age na conversa (abre ou envia de novo).
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

    bringAdviceToExecutor: (convId, block) => {
      const cur = get().byId[convId]
      if (!cur) return
      const next = cur.pendingAdvice ? `${cur.pendingAdvice}\n\n${block}` : block
      patch(convId, { pendingAdvice: next })
    },

    takePendingAdvice: (convId) => {
      const cur = get().byId[convId]
      const block = cur?.pendingAdvice ?? null
      if (block) patch(convId, { pendingAdvice: undefined })
      return block
    },

    markNotesSent: (convId, ids) => markNotesSentImpl(get, set, convId, ids),

    removeThreadItem: (convId, id) => {
      const cur = get().byId[convId]
      if (!cur) return
      patch(convId, { items: cur.items.filter((it) => it.id !== id) })
      void get().persist(convId)
    },

    // S3 (E3) — tirar da conversa: remove TODOS os pareceres daquela persona (a
    // presença é derivada, então some da barra). Mesma escrita do removeThreadItem,
    // filtrando por personaId em vez de por id do item.
    removeAdvice: (convId, personaId) => {
      const cur = get().byId[convId]
      if (!cur) return
      patch(convId, {
        items: cur.items.filter(
          (it) => !(it.kind === "advice" && it.personaId === personaId),
        ),
      })
      void get().persist(convId)
    },

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
