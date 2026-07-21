// office/bridge/send.ts — coreografia COMPLETA de envio da mesa (§5.6 e §9 do
// docs/agent-office.md, decisão O7). Compõe as APIs exportadas do app —
// ChatPanel intocado — replicando a paridade do handleSend: guardas, lições
// injetadas, peças de continuidade por agent e o finally (finish + persist +
// fila + auto-resume + notify + sugestões). A duplicação é um risco ACEITO
// (§10), coberta pela lista fechada de testes de paridade em send.test.ts.

import { toast } from "sonner"
import { agentLabel, cancelAgent, runAgent } from "@/lib/agent"
import type { Attachment } from "@/lib/attachments"
import { wantsAutoResume } from "@/lib/autoResume"
import { isTauri, listConversations, type ConversationMeta } from "@/lib/db"
import { buildHandoff } from "@/lib/handoff"
import {
  buildLearningBlocks,
  markLessonsUsed,
  recordInjectedLessons,
} from "@/lib/learning"
import { notifyTurnEnd } from "@/lib/notify"
import { extractPlanText, turnEndedOk } from "@/lib/planMode"
import {
  buildMemoryPrompt,
  buildResumeFallback,
  exportConvContext,
  renderTranscript,
  shouldAttachResumeFallback,
} from "@/lib/transcript"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useFusion } from "@/store/fusion"
import { useMission } from "@/store/mission"
import type { OfficeAgentId } from "@/office/engine/types"

/** Argumentos do envio da mesa. `attachments` é interno à drenagem da fila
 *  (mensagens enfileiradas pela OUTRA superfície podem carregar anexos — não
 *  podemos descartá-los em silêncio); o composer da mesa não anexa na O-1. */
export interface DeskSendArgs {
  convId: string
  projectId: string
  projectPath: string
  agent: OfficeAgentId
  text: string
  attachments?: Attachment[]
  /** Modelo escolhido no cabeçalho do dock (value do registry) para o PRÓXIMO
   *  envio. Só vale enquanto a conversa está destravada (1º run); depois a
   *  conversa trava no modelo do 1º run. undefined/null = default do agent. */
  model?: string | null
  /** Esforço do próximo envio destravado. "default" deve chegar normalizado
   *  como null pelo chamador, igual ao composer principal. */
  effort?: string | null
  /** Confirma que o pedido foi aceito antes do trabalho assíncrono longo. A UI
   *  só limpa o rascunho e mostra a fala depois deste sinal. */
  onAccepted?: (outcome: "started" | "queued") => void
  /** true = este envio É o disparo do auto-resume agendado: não cancela o
   *  loop (o estado autoResume com o contador de tentativas fica) e nunca
   *  planeja (é continuação de execução) — mesma semântica do ChatPanel. */
  fromAutoResume?: boolean
}

/** A meta mais recente (updatedAt) do conjunto, ou null se vazio. */
function newest(list: ConversationMeta[]): ConversationMeta | null {
  return list.reduce<ConversationMeta | null>(
    (best, c) => (best == null || c.updatedAt > best.updatedAt ? c : best),
    null,
  )
}

/** Prefixo do título fixo das conversas criadas pela mesa (o menu-balão usa
 *  pra reconhecer "conversa da mesa" nas metas — linha "Continuar · …"). */
export const DESK_TITLE_PREFIX = "Mesa · "

/** Resoluções em voo por `projectId::agent`: duas chamadas concorrentes de
 *  ensureDeskConversation compartilham a MESMA promessa (o check-then-act sem
 *  o mapa criava DUAS conversas). Limpo no settle. */
const ensureInFlight = new Map<string, Promise<string>>()

/** Conversa da mesa (§5.3): a mesa reusa apenas conversas DELA — meta.agent
 *  igual ao agent da mesa E título começando com "Mesa · " — e senão registra
 *  uma nova em background já carimbada com o agent, SEM roubar a seleção da UI
 *  principal. NUNCA adota threads do usuário: a coluna `agent` é NOT NULL
 *  DEFAULT claude-code (migração v10), então "agent null = livre" não existe —
 *  uma conversa em branco pareceria livre e a mesa a sequestraria.
 *  Sempre garante metas do projeto + conversa carregadas antes de retornar. */
export function ensureDeskConversation(
  projectId: string,
  agent: OfficeAgentId,
): Promise<string> {
  const key = `${projectId}::${agent}`
  const inFlight = ensureInFlight.get(key)
  if (inFlight) return inFlight
  const p = resolveDeskConversation(projectId, agent).finally(() => {
    ensureInFlight.delete(key)
  })
  ensureInFlight.set(key, p)
  return p
}

async function resolveDeskConversation(
  projectId: string,
  agent: OfficeAgentId,
): Promise<string> {
  const chat = useChat.getState()
  // metas frescas do DB (têm a coluna agent); fora do Tauri (vite dev, O8) cai
  // no espelho da store — o persist mantém meta.agent em dia.
  const list =
    (await listConversations(projectId)) ??
    chat.conversationsByProject[projectId] ??
    []
  const found = newest(
    list.filter(
      (c) => c.agent === agent && c.title?.startsWith(DESK_TITLE_PREFIX),
    ),
  )
  if (found) {
    // metas do projeto carregadas ANTES do 1º persist: sem elas o persist não
    // acha meta.title e re-deriva do 1º prompt — o título fixo "Mesa · …"
    // sumiria (loadProjectConversations não rouba seleção; no-op se carregado).
    await chat.loadProjectConversations(projectId)
    await chat.ensureConversationLoaded(projectId, found.id)
    return found.id
  }
  const id = crypto.randomUUID()
  // agent carimbado JÁ na criação: sem o carimbo a linha nasce com o DEFAULT
  // do banco (claude-code) e a mesa do claude-code adotaria a conversa recém-
  // criada por outra mesa.
  await chat.registerConversation(
    projectId,
    id,
    `${DESK_TITLE_PREFIX}${agentLabel(agent)}`,
    agent,
  )
  await chat.ensureConversationLoaded(projectId, id)
  return id
}

/** Envio da mesa — paridade com o handleSend do ChatPanel (lista fechada §9):
 *  guardas (corrupt/missão/fila/agent travado) → cancelAutoResume →
 *  invalidateSuggestions → start → lições injetadas no prompt → runAgent
 *  (sessionId, planFirst, permissão do projeto, continuidade por agent) →
 *  handleEvent por evento → finally com finish + persist + drenagem coalescida
 *  da fila + auto-resume em rate limit + notify + sugestões. */
export async function sendFromDesk(args: DeskSendArgs): Promise<void> {
  const { convId, projectId, projectPath, text } = args
  const attachments = args.attachments ?? []
  if (!isTauri()) {
    toast("O dispatch dos agents roda no app (bun run tauri dev)")
    return
  }
  await useChat.getState().ensureConversationLoaded(projectId, convId)
  const conv = useChat.getState().byId[convId]
  // janela do load: enviar agora criaria estado vazio e o persist (UPSERT de
  // linha inteira) apagaria o histórico — mesma guarda do ChatPanel.
  if (!conv) {
    toast("Conversa ainda carregando. Tenta de novo.")
    return
  }
  if (conv.corrupt) {
    toast.error("Histórico corrompido no banco. Envio bloqueado nesta conversa.")
    return
  }
  // Missão rodando NESTA conversa: as fases compartilham o worktree; um run
  // manual em paralelo embolaria o diff/handoff.
  if (useMission.getState().byConv[convId]?.status === "running") {
    toast("Missão em andamento. Pare a missão para enviar manualmente.")
    return
  }
  // Rodando/finalizando: ENFILEIRA (o finally do turno corrente drena e
  // coalesce — inclusive o turno disparado pela outra superfície).
  if (conv.running || conv.finalizing) {
    useChat.getState().enqueue(convId, text, attachments)
    args.onAccepted?.("queued")
    return
  }
  // envio manual supersede um auto-resume agendado nesta conversa; se ESTE
  // send É o próprio resume, não cancela (o loop precisa do contador de tries)
  if (!args.fromAutoResume) useChat.getState().cancelAutoResume(convId)
  // novo run → invalida geração de sugestão pendente/em-voo
  useChat.getState().invalidateSuggestions(convId)
  // conversa estabelecida trava no agent/modelo/effort do 1º run: o agent
  // TRAVADO da conversa vence o da mesa. Destravada (1º run), o modelo vem do
  // seletor do cabeçalho do dock (args.model), senão o default do agent.
  const locked = conv.items.length > 0
  const agent = locked ? conv.agent : args.agent
  const model = locked ? conv.reqModel : (args.model ?? null)
  const effort = locked ? conv.effort : (args.effort ?? null)
  // "Planejar primeiro" da CONVERSA (toggle ligado por qualquer superfície);
  // auto-resume nunca planeja (é continuação de execução)
  const planFirst = !args.fromAutoResume && !!conv.planFirst
  const runId = crypto.randomUUID()
  const sessionId = conv.sessionId ?? null
  // cwd = worktree isolado da conversa, senão a pasta compartilhada do projeto
  const cwd = conv.worktreePath ?? projectPath
  const permission =
    useApp.getState().projects.find((p) => p.id === projectId)
      ?.permissionMode ?? "padrao"
  useChat.getState().start(convId, text, runId, agent, model, effort, attachments)
  args.onAccepted?.("started")
  // M2: injeta as lições relevantes (projeto + globais) no PROMPT, não na
  // bolha visível — mesma injeção do handleSend no Linear. Best-effort:
  // qualquer falha envia sem o bloco. Os ids injetados vão pro registro por
  // conversa (recordInjectedLessons) — o 👍 do dock/companion (P6) reforça
  // pelo MESMO caminho do ChatPanel (feedbackLesson → reinforceLessons).
  let promptText = text
  try {
    const blocks = await buildLearningBlocks(projectId, text, false)
    if (blocks.lessons) {
      promptText = `${blocks.lessons}\n\n---\n\n${text}`
      void markLessonsUsed(blocks.lessonIds)
    }
    recordInjectedLessons(convId, blocks.lessonIds)
  } catch {
    // sem lições — o envio segue normal (e zera o registro: 👍 deste turno
    // não pode reforçar ids de um turno anterior)
    recordInjectedLessons(convId, [])
  }
  // agy NÃO tem resume (todo turno é sessão fresca): injeta a memória da
  // conversa no prompt (recap + export do transcript pleno + ponteiro).
  // Best-effort de ponta a ponta: falha no export → só o recap.
  if (agent === "agy" && conv.items.length > 0) {
    let pointer: string | null = null
    try {
      const md = renderTranscript(conv.items, { agent: conv.agent })
      pointer = await exportConvContext(cwd, convId, md)
    } catch {
      pointer = null
    }
    promptText = buildMemoryPrompt(conv.items, pointer, promptText)
  }
  // MyCockpit resume (claude/codex com sessão): monta o fallback de memória que
  // o MOTOR só usa se o resume nativo falhar — o prompt normal NÃO muda.
  let memoryFallback: string | null = null
  if (shouldAttachResumeFallback(agent, conv.items, sessionId)) {
    try {
      let pointer: string | null = null
      try {
        const md = renderTranscript(conv.items, { agent: conv.agent })
        pointer = await exportConvContext(cwd, convId, md)
      } catch {
        pointer = null
      }
      memoryFallback = buildResumeFallback(conv.items, pointer)
    } catch {
      memoryFallback = null
    }
  }
  try {
    await runAgent(
      runId,
      convId,
      agent,
      model,
      effort,
      promptText,
      cwd,
      sessionId,
      permission,
      attachments,
      (e) => useChat.getState().handleEvent(convId, e),
      planFirst,
      memoryFallback,
    )
  } catch (e) {
    toast.error(typeof e === "string" ? e : "Falha ao executar o agent")
  } finally {
    useChat.getState().finish(convId)
    void useChat.getState().persist(convId)
    // Gate de plano: turno plan_first terminou BEM → arma o card "Aprovar e
    // executar" (mesma captura do ChatPanel; o card renderiza em qualquer
    // superfície que leia pendingPlan).
    if (planFirst) {
      const after = useChat.getState().byId[convId]
      const planText =
        after && turnEndedOk(after.items) ? extractPlanText(after.items) : null
      if (planText) useChat.getState().setPendingPlan(convId, planText)
    }
    // Fila: junta as mensagens digitadas durante o turno num ÚNICO reenvio
    // (textos coalescidos + anexos dedupados por path). Se há fila, o próximo
    // turno já começa; senão, auto-resume em rate limit; senão notifica +
    // agenda as sugestões.
    const pending = useChat.getState().dequeueQueued(convId)
    if (pending.length > 0) {
      const texts = pending.map((q) => q.text).filter(Boolean)
      const atts = [
        ...new Map(
          pending.flatMap((q) => q.attachments).map((a) => [a.path, a]),
        ).values(),
      ]
      // mensagens da fila são envios MANUAIS: nunca herdam fromAutoResume
      void sendFromDesk({
        ...args,
        text: texts.join("\n\n"),
        attachments: atts,
        fromAutoResume: false,
        onAccepted: undefined,
      })
    } else if (maybeScheduleDeskAutoResume(args, agent)) {
      // turno bateu num rate limit / "vou tentar depois" e o auto-resume está
      // ligado: reenvio agendado (banner/notify saem do scheduler). Segura as
      // sugestões — o loop ainda não terminou de verdade.
    } else {
      notifyTurnEnd(convId, agent)
      useChat.getState().scheduleSuggestions(convId)
    }
  }
}

/** Revezamento da mesa (espelha ChatPanel.handleContinueWith): continua a MESMA
 *  conversa em OUTRO agent (limite/erro do atual). O contexto viaja por preâmbulo
 *  determinístico (handoff, tail-biased); o disco (cwd/worktree) o novo agent
 *  herda de graça; o pedido pendente (o último prompt do usuário) volta destacado
 *  sem redigitar. Guardas iguais ao sendFromDesk (não-Tauri / load / corrupt /
 *  missão rodando / turno em andamento). Sessão FRESCA no novo agent (null). */
export async function continueInAgent(
  args: DeskSendArgs,
  targetAgent: string,
): Promise<void> {
  const { convId, projectId, projectPath } = args
  if (!isTauri()) {
    toast("O dispatch dos agents roda no app (bun run tauri dev)")
    return
  }
  await useChat.getState().ensureConversationLoaded(projectId, convId)
  const conv = useChat.getState().byId[convId]
  if (!conv) {
    toast("Conversa ainda carregando. Tenta de novo.")
    return
  }
  if (conv.corrupt) {
    toast.error("Histórico corrompido no banco. Envio bloqueado nesta conversa.")
    return
  }
  // missão rodando nesta conversa: as fases mandam no worktree — revezar por
  // fora embolaria o diff/handoff (mesma guarda do sendFromDesk).
  if (useMission.getState().byConv[convId]?.status === "running") {
    toast("Missão em andamento. Pare a missão para revezar.")
    return
  }
  // turno em andamento: revezar agora atropelaria o run corrente (o transplante
  // reinicia running/runId). Bloqueia — o usuário para primeiro.
  if (conv.running || conv.finalizing) {
    toast("Turno em andamento. Espere terminar para revezar.")
    return
  }
  // último pedido do usuário → volta destacado no fim do prompt (o handoff
  // exclui ele: entra separado como "pedido pendente").
  let lastUserIdx = -1
  for (let i = conv.items.length - 1; i >= 0; i--) {
    if (conv.items[i].kind === "user") {
      lastUserIdx = i
      break
    }
  }
  const lastUser = lastUserIdx >= 0 ? conv.items[lastUserIdx] : null
  const pending = lastUser && lastUser.kind === "user" ? lastUser.text : ""
  if (!pending) {
    toast("Nada pendente para revezar nesta conversa.")
    return
  }
  const preamble = buildHandoff(conv.items.slice(0, lastUserIdx))
  const prompt = `${preamble}\n\n---\n\nPedido pendente (responda a ele agora):\n${pending}`
  const runId = crypto.randomUUID()
  // revezamento é intenção explícita: derruba auto-resume agendado e invalida
  // sugestões pendentes (mesma coreografia do handleContinueWith).
  useChat.getState().cancelAutoResume(convId)
  useChat.getState().invalidateSuggestions(convId)
  useChat.getState().handleEvent(convId, {
    type: "notice",
    message: `revezamento: continuando no ${agentLabel(targetAgent)}`,
  })
  useChat.getState().beginTransplant(convId, runId, targetAgent)
  const cwd = conv.worktreePath ?? projectPath
  const permission =
    useApp.getState().projects.find((p) => p.id === projectId)
      ?.permissionMode ?? "padrao"
  try {
    await runAgent(
      runId,
      convId,
      targetAgent,
      null, // modelo default do novo agent (transplante zera o lock)
      null,
      prompt,
      cwd,
      null, // sessão FRESCA: a do agent anterior não serve pro novo
      permission,
      [],
      (e) => useChat.getState().handleEvent(convId, e),
    )
  } catch (e) {
    toast.error(typeof e === "string" ? e : "Falha no revezamento")
  } finally {
    useChat.getState().finish(convId)
    void useChat.getState().persist(convId)
    notifyTurnEnd(convId, targetAgent)
    useChat.getState().scheduleSuggestions(convId)
  }
}

/** Auto-revive da mesa — MESMA política do maybeScheduleAutoResume do
 *  ChatPanel: o turno recém-encerrado pede resume (limite da CLI OU o texto
 *  final combina padrões de retry/espera) E a opção está ligada ⇒ agenda um
 *  reenvio automático via sendFromDesk (handoff do fio + "continue"), com o
 *  cap de tentativas (autoResumeMaxTries) protegendo o bolso. Retorna true se
 *  agendou — o caller pula as sugestões; a notificação sai daqui. */
function maybeScheduleDeskAutoResume(args: DeskSendArgs, agent: string): boolean {
  const { convId } = args
  const settings = useApp.getState().settings
  if (!settings.autoResume) return false
  const conv = useChat.getState().byId[convId]
  if (!conv || conv.corrupt) return false
  // já esgotou o cap num loop anterior deste turno → para.
  const prevTries = conv.autoResume?.tries ?? 0
  if (prevTries >= settings.autoResumeMaxTries) {
    useChat.getState().cancelAutoResume(convId)
    return false
  }
  const verdict = wantsAutoResume(
    conv.items,
    { hit: !!conv.limitHitThisTurn, resetHint: conv.resetHint },
    prevTries,
  )
  if (!verdict.resume) {
    // turno concluiu SEM sinal de resume → sucesso: encerra o loop.
    useChat.getState().cancelAutoResume(convId)
    return false
  }
  const tries = prevTries + 1
  const timer = setTimeout(() => {
    const c = useChat.getState().byId[convId]
    // corrida: usuário pode ter cancelado/enviado algo antes do disparo.
    if (!c?.autoResume) return
    if (c.running || c.finalizing) return
    // reusa o padrão do revezamento: handoff do fio + pedido de continuar.
    const preamble = buildHandoff(c.items)
    const prompt = `${preamble}\n\n---\n\nO turno anterior parou num limite de uso/espera. O limite já deve ter resetado: continue a tarefa pendente de onde parou (não repita o que já foi feito).`
    useChat.getState().handleEvent(convId, {
      type: "notice",
      message: `auto-resume: retomando (tentativa ${tries}/${settings.autoResumeMaxTries})`,
    })
    void sendFromDesk({
      ...args,
      text: prompt,
      attachments: [],
      fromAutoResume: true,
      onAccepted: undefined,
    })
  }, verdict.delayMs)
  useChat.getState().setAutoResume(convId, {
    tries,
    maxTries: settings.autoResumeMaxTries,
    nextAt: Date.now() + verdict.delayMs,
    reason: verdict.reason,
    timer,
  })
  notifyTurnEnd(convId, agent)
  return true
}

/** Cancela o turno corrente da conversa da mesa (Stop do dock). Também derruba
 *  um auto-resume agendado — parar é intenção explícita (mesmo gesto do app). */
export async function cancelDeskTurn(convId: string): Promise<void> {
  useChat.getState().cancelAutoResume(convId)
  // Disputa Fusion em voo: beginFusion marca running SEM runId — cancelar pelo
  // runId seria no-op silencioso enquanto N candidatos queimam dinheiro.
  // Mesmo gesto do Stop do ChatPanel: aborta a disputa de verdade.
  const fusion = useFusion.getState().byConv[convId]
  if (fusion && (fusion.phase === "running" || fusion.phase === "judging")) {
    useFusion.getState().abort(convId)
    toast("Disputa cancelada")
    return
  }
  const runId = useChat.getState().byId[convId]?.runId
  if (runId) await cancelAgent(runId)
}
