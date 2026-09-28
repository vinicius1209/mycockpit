// Envio da mesa: a coreografia completa, em paridade com o handleSend do
// ChatPanel (guardas, lições, continuidade por agent e o finally com persist,
// fila, auto-resume, notify e sugestões). A duplicação é risco aceito,
// coberto pelos testes de paridade em send.test.ts.

import { avisar } from "@/lib/avisos"
import { agentLabel, runAgent } from "@/lib/agent"
import { agentDef as engineDef, dispatchBlockReason } from "@/lib/agents"
import type { Attachment } from "@/lib/attachments"
import { wantsAutoResume } from "@/lib/autoResume"
import { dispararRetomada } from "@/lib/autoResumeDisparo"
import { comporCascata, juntarAnexos } from "@/lib/fleet/promptCascade"
import { isTauri } from "@/lib/db"
import { listConversations } from "@/lib/db/conversations"
import { prepareHybridHandoff } from "@/lib/handoff"
import { blocoDaDoutrina, decideDoctrine, readDoctrine } from "@/lib/doctrine"
import {
  buildLearningBlocks,
  recordInjectedLessons,
} from "@/lib/learning"
import { notifyTurnEnd } from "@/lib/notify"
import { retidoPorTurnoEmVoo } from "@/lib/sendGate"
import { AUTO_RESUME, HUMANO, type OrigemDoEnvio } from "@/lib/sendOrigin"
import { extractPlanText, turnEndedOk } from "@/lib/planMode"
import {
  hasAssistantReply,
  personaHandoffBlock,
  resolveFirstTurnPersona,
  warnPresetDrift,
} from "@/lib/presets"
import {
  expandQueuedForJoin,
  findAppCommand,
  parseSlashInvocation,
  splitQueueForAppCommand,
} from "@/lib/slashCommands"
import { expandDraftWithSources, expandEmbeddedDraft } from "@/lib/slashDispatch"
import { runCompactTurn } from "@/lib/compact"
import { readProjectCommands } from "@/lib/sources"
import {
  buildMemoryPrompt,
  shouldInlineMemory,
  buildResumeFallback,
  exportConvContext,
  renderTranscript,
  shouldAttachResumeFallback,
} from "@/lib/transcript"
import { useApp } from "@/store/app"
import {
  useChat,
  hasExecutorTurn,
  needsPersonaReinject,
  type ChatItem,
} from "@/store/chat"
import { useMission } from "@/store/mission"
import type { OfficeAgentId } from "@/lib/fleet/types"
import {
  acceptChatTurn,
  createRunAcceptance,
  recordDispatchError,
} from "@/lib/chatRunAcceptance"
import { continueConversationWith } from "@/lib/chatHandoff"
import { newestConversation, runDeskPreparation } from "@/lib/fleet/deskPreparation"

export { cancelDeskTurn } from "@/lib/fleet/cancel"

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

/** Prefixo do título fixo das conversas criadas pela mesa (o menu-balão usa
 *  pra reconhecer "conversa da mesa" nas metas — linha "Continuar · …"). */
export const DESK_TITLE_PREFIX = "Mesa · "

/** Resoluções em voo por `projectId::agent`: duas chamadas concorrentes de
 *  ensureDeskConversation compartilham a MESMA promessa (o check-then-act sem
 *  o mapa criava DUAS conversas). Limpo no settle. */
const ensureInFlight = new Map<string, Promise<string>>()

/** Conversa da mesa: reusa só conversas DELA (mesmo agent e título "Mesa · "),
 *  senão cria uma em background já carimbada, sem roubar a seleção. Nunca
 *  adota conversa sua: `agent` nasce claude-code, então "sem agent = livre" não
 *  existe. Retorna com metas e conversa carregadas. */
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
  const found = newestConversation(
    list.filter(
      (c) => c.agent === agent && c.title?.startsWith(DESK_TITLE_PREFIX),
    ),
  )
  if (found) {
    // Metas antes do 1º persist, senão ele re-deriva o título do prompt e o
    // "Mesa · …" some.
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

/** Envio da mesa, na lista fechada de paridade com o handleSend: guardas,
 *  cancelAutoResume, invalidateSuggestions, start, lições no prompt, runAgent,
 *  handleEvent e o finally (finish, persist, fila, auto-resume, notify,
 *  sugestões). */
export async function sendFromDesk(args: DeskSendArgs): Promise<void> {
  await runDeskPreparation(args, sendFromDeskPrepared)
}

async function sendFromDeskPrepared(
  args: DeskSendArgs,
  runId: string,
): Promise<void> {
  const { convId, projectId, projectPath, text } = args
  const attachments = args.attachments ?? []
  if (!isTauri()) {
    avisar.nota("O dispatch dos agents roda no app (bun run tauri dev)")
    return
  }
  const appCommand = findAppCommand(text)
  const known = useChat.getState().byId[convId]
  if (known?.preparing) {
    avisar.nota("As capacidades deste envio ainda estão sendo verificadas.")
    return
  }
  // Quando a Mesa já conhece a conversa, o primeiro quadro fica marcado antes
  // de qualquer I/O. Conversa fria recebe o mesmo carimbo assim que hidrata.
  if (!appCommand) useChat.getState().beginPreparation(convId, runId)
  await useChat.getState().ensureConversationLoaded(projectId, convId)
  if (!appCommand) useChat.getState().beginPreparation(convId, runId)
  const conv = useChat.getState().byId[convId]
  // Conversa carregando: enviar criaria estado vazio, e o persist apagaria o
  // histórico.
  if (!conv) {
    avisar.nota("Conversa ainda carregando. Tenta de novo.")
    return
  }
  if (conv.preparing && conv.preparing.runId !== runId) {
    avisar.nota("As capacidades deste envio ainda estão sendo verificadas.")
    return
  }
  if (conv.corrupt) {
    avisar.erro("Histórico corrompido no banco. Envio bloqueado nesta conversa.")
    return
  }
  // Missão rodando NESTA conversa: as fases compartilham o worktree; um run
  // manual em paralelo embolaria o diff/handoff.
  if (useMission.getState().byConv[convId]?.status === "running") {
    avisar.nota("Missão em andamento. Pare a missão para enviar manualmente.")
    return
  }
  // Rodando/finalizando: mensagem SUA vai pra fila (o finally drena e coalesce);
  // retomada automática NÃO, que a fila é do humano. Gate único, o mesmo do
  // ChatPanel (ADR-046), e "queued" só é aceite do que foi mesmo enfileirado.
  const origem: OrigemDoEnvio = args.fromAutoResume ? AUTO_RESUME : HUMANO
  if (retidoPorTurnoEmVoo(convId, text, attachments, origem)) {
    if (!args.fromAutoResume) args.onAccepted?.("queued")
    return
  }
  // envio manual supersede um auto-resume agendado nesta conversa; se ESTE
  // send É o próprio resume, não cancela (o loop precisa do contador de tries)
  if (!args.fromAutoResume) useChat.getState().cancelAutoResume(convId)
  // novo run → invalida geração de sugestão pendente/em-voo
  useChat.getState().invalidateSuggestions(convId)
  // Comando builtin do app é ação, interceptada antes da expansão de .md
  // (decisão por capability em lib/compact).
  if (appCommand) {
    await runCompactTurn({
      convId,
      projectId,
      projectPath,
      commandText: text,
      onStarted: () => args.onAccepted?.("started"),
      drainQueue: () => {
        void drainDeskQueued(args)
      },
    })
    return
  }
  // Conversa estabelecida trava no agent do 1º run, que vence o da mesa;
  // destravada, o modelo vem do seletor do dock ou do default. Pareceres de
  // especialista não travam.
  const locked = hasExecutorTurn(conv.items)
  let agent: string = locked ? conv.agent : args.agent
  let model = locked ? conv.reqModel : (args.model ?? null)
  let effort = locked ? conv.effort : (args.effort ?? null)
  // Persona só no 1º turno. Fail-closed: preset quebrado aborta antes do start.
  let personaBlock: string | null = null
  let personaStamp: { presetId: string; digest: string; name: string } | null =
    null
  // régua do "1º prompt chegou no CLI", compartilhada com a doutrina.
  const hasReply = hasAssistantReply(conv.items)
  // Passar o volante força a re-injeção neste turno (derivado de estado
  // persistido, sobrevive a restart).
  const reinject = needsPersonaReinject(conv)
  const persona = await resolveFirstTurnPersona({
    locked,
    presetId: conv.presetId ?? null,
    // Travada sem resposta de assistant: o 1º run morreu antes da doutrina.
    hasReply,
    projectPath,
    forceReinject: reinject,
  })
  if (persona.status === "blocked") {
    avisar.erro(persona.error)
    return
  }
  if (persona.status === "ready") {
    agent = persona.agent
    model = persona.model
    effort = persona.effort
    personaBlock = persona.block
    personaStamp = {
      presetId: persona.presetId,
      digest: persona.digest,
      name: persona.name,
    }
  }
  // troca de volante com backend novo: sessão fresca + o fio viaja no preâmbulo
  // (mesma disciplina do revezamento); mesmo backend mantém o resume nativo.
  const wheelSwitch =
    reinject &&
    persona.status === "ready" &&
    agent !== conv.agent &&
    conv.sessionId != null
  // S3.4 — resume com preset carimbado: verifica drift do digest (aviso
  // obrigatório; o turno segue). Só quando NÃO re-injetamos (re-injeção
  // re-carimba a versão atual).
  if (persona.status === "none" && locked && conv.presetId && conv.presetDigest) {
    void warnPresetDrift(convId, conv.presetId, conv.presetDigest, projectPath)
  }
  // Motor ausente ou deslogado barra antes do start (vale o agent efetivo;
  // auth incerta segue). onAccepted não dispara: o rascunho fica.
  const dispatchBlock = dispatchBlockReason(
    agent,
    useApp.getState().settings.detected ?? {},
  )
  if (dispatchBlock) {
    avisar.erro(dispatchBlock)
    return
  }
  // D2 — corrida do await acima: outro envio pode ter iniciado um run durante o
  // preflight. Re-checa FRESCO pelo MESMO gate de cima, nunca run concorrente.
  if (retidoPorTurnoEmVoo(convId, text, attachments, origem)) {
    if (!args.fromAutoResume) args.onAccepted?.("queued")
    return
  }
  // "Planejar primeiro" da CONVERSA (toggle ligado por qualquer superfície);
  // auto-resume nunca planeja (é continuação de execução)
  const planFirst = !args.fromAutoResume && !!conv.planFirst
  // sessão fresca quando o volante trocou de backend (resume do agent anterior
  // não vale pro novo); senão o resume normal da conversa.
  const sessionId = wheelSwitch ? null : (conv.sessionId ?? null)
  // cwd = worktree isolado da conversa, senão a pasta compartilhada do projeto
  const cwd = conv.worktreePath ?? projectPath
  const permission =
    useApp.getState().projects.find((p) => p.id === projectId)
      ?.permissionMode ?? "padrao"
  // A mensagem fica no rascunho da mesa até o run_manifest aceitar o envio.
  // Lições no prompt, nunca na bolha; os ids vão para recordInjectedLessons.
  // Comandos "/": só claude-code com fonte claude viaja cru, o resto expande
  // aqui; a bolha mostra o que você digitou.
  const slashExpansion = await expandDraftWithSources(text, projectPath, agent)
  const sendText = slashExpansion.text
  let lessonsBlock: string | null = null
  let acceptedLessonIds: string[] = []
  try {
    const blocks = await buildLearningBlocks(projectId, sendText, false)
    if (blocks.lessons) {
      lessonsBlock = blocks.lessons
    }
    acceptedLessonIds = blocks.lessonIds
  } catch {
    acceptedLessonIds = []
  }
  // H1 (prompt-hygiene-plan) — canal por capability, paridade com o handleSend
  // do ChatPanel: motor com `systemChannel` recebe persona+doutrina pelo canal
  // SYSTEM do CLI (re-enviadas a cada spawn); sem canal, blocos no corpo.
  const sysChannel = engineDef(agent)?.systemChannel ?? false
  // DOUTRINA do projeto (.frota/instructions.md): paridade com o
  // handleSend do ChatPanel — a mesa e o celular mandam sob as MESMAS regras
  // (1º turno + frescor H4 pra motor sem canal; todo spawn no canal system).
  const doctrine = decideDoctrine({
    agent,
    block: blocoDaDoutrina(await readDoctrine(projectPath)),
    locked,
    hasReply,
    // S3.2 wheel-switch: sessão FRESCA no backend novo → a doutrina sempre
    // viaja no envelope (paridade com o ChatPanel e com o revezamento).
    freshSession: wheelSwitch,
    lastFingerprint: useChat.getState().byId[convId]?.injected?.doctrine,
  })
  const doctrineBlock = doctrine.body
  // Persona pro canal system (mesma regra do ChatPanel): a resolvida do 1º
  // turno quando há; nos turnos seguintes de conversa carimbada, re-deriva do
  // preset (best-effort — o drift do S3.4 segue cobrindo divergência).
  let systemPersona: string | null = null
  if (sysChannel) {
    if (personaBlock) {
      systemPersona = personaBlock
      personaBlock = null
    } else if (locked && conv.presetId && conv.presetDigest) {
      systemPersona = await personaHandoffBlock(
        conv.presetId,
        conv.presetDigest,
        projectPath,
      )
    }
  }
  // identidade primeiro, depois as regras — mesma ordem da cascata do corpo.
  const systemPrompt =
    [systemPersona, doctrine.system].filter(Boolean).join("\n\n") || null
  // Ordem das camadas e re-expansão do comando nativo: `promptCascade.ts`.
  const preparedPrompt = await comporCascata({
    convId,
    projectId,
    projectPath,
    agent,
    items: conv.items,
    slashExpansion,
    text,
    personaBlock,
    lessonsBlock,
    doctrineBlock,
  })
  let promptText = preparedPrompt.text
  let instructionSources = preparedPrompt.instructionSources
  // S3.2 — troca de volante com sessão fresca (backend novo): o fio até aqui
  // viaja no envelope híbrido (mesma memória/pointers do revezamento).
  if (wheelSwitch) {
    const wheelExpansion = await expandEmbeddedDraft(text, projectPath, agent)
    instructionSources = wheelExpansion.instructionSources
    const wheelItems: ChatItem[] = [
      ...conv.items,
      // o novo agent recebe o pedido já EXPANDIDO (o /comando cru não
      // significaria nada pra ele). Embutido no envelope de handoff, nem o
      // comando nativo pode viajar cru (G2.3) — re-expande com embedded.
      {
        kind: "user",
        id: `wheel-request-${runId}`,
        text: wheelExpansion.text,
      },
    ]
    const prepared = await prepareHybridHandoff({
      projectId,
      cwd,
      convId,
      sourceAgent: conv.agent,
      targetAgent: agent,
      items: wheelItems,
      pendingUserIndex: wheelItems.length - 1,
      personaBlock,
      doctrineBlock,
      lessonsBlock,
    })
    promptText = prepared.prompt
  } else if (personaBlock) {
    // Persona primeiro no prompt, depois doutrina, lições e o pedido.
    promptText = `${personaBlock}\n\n${promptText}`
  }
  // Motor sem resume nativo (capability `sessionResume`): todo turno é sessão
  // fresca, então a memória da conversa vai no prompt (recap, transcript,
  // ponteiro). Falha no export deixa só o recap. Regra em lib/transcript.
  if (
    shouldInlineMemory({ agent, items: conv.items, sessionId, hasReply, wheelSwitch })
  ) {
    let pointer: string | null = null
    try {
      const md = renderTranscript(conv.items, { agent: conv.agent })
      pointer = await exportConvContext(cwd, convId, md)
    } catch {
      pointer = null
    }
    promptText = buildMemoryPrompt(conv.items, pointer, promptText)
  }
  // Frota resume (claude/codex com sessão): monta o fallback de memória que
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
  const acceptance = createRunAcceptance({
    convId,
    onAccept: () =>
      acceptChatTurn({
        convId,
        runId,
        agent,
        model,
        effort,
        text,
        attachments: juntarAnexos(attachments, preparedPrompt.anexosDeNota),
        wheelSwitch,
        lessonIds: acceptedLessonIds,
        recordLessons: (ids) => recordInjectedLessons(convId, ids),
        doctrineFingerprint: doctrine.fingerprint,
        personaStamp,
        onAccepted: () => args.onAccepted?.("started"),
      }),
    onBlocked: (gate) => useChat.getState().blockPreparation(convId, runId, gate),
    onEvent: (event) => useChat.getState().handleEvent(convId, event),
  })

  try {
    await useChat.getState().flushItems?.(convId)
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
      juntarAnexos(attachments, preparedPrompt.anexosDeNota),
      acceptance.handler,
      planFirst,
      memoryFallback,
      systemPrompt,
      // H2: último plano de MCPs anunciado nesta conversa (ledger efêmero).
      useChat.getState().byId[convId]?.injected?.mcp ?? null,
      instructionSources,
    )
    if (!acceptance.accepted() && !useChat.getState().byId[convId]?.preflightGate) {
      avisar.erro("O turno não começou. O pedido continua no rascunho.")
    }
  } catch (e) {
    if (acceptance.accepted()) {
      recordDispatchError(convId, e, "Falha ao executar o agent")
    }
    else avisar.erro("Não consegui verificar as capacidades deste envio.")
  } finally {
    if (!acceptance.accepted()) {
      useChat.getState().clearPreparation(convId, runId)
    } else {
      useChat.getState().finish(convId)
      void useChat.getState().persist(convId)
    }
    // Turno plan_first terminou bem: grava o plano no fio esperando decisão
    // (sobrevive ao restart e renderiza em qualquer superfície do fio).
    if (acceptance.accepted() && planFirst) {
      const after = useChat.getState().byId[convId]
      const planText =
        after && turnEndedOk(after.items) ? extractPlanText(after.items) : null
      if (planText) useChat.getState().pushPlanGate(convId, planText)
    }
    // A fila vira um reenvio só, em lotes (builtin no meio quebra). Sem fila,
    // auto-resume em rate limit; senão, notifica e agenda as sugestões.
    if (!acceptance.accepted()) {
      // Nenhum turno nasceu, portanto não há conclusão para encadear.
    } else if (await drainDeskQueued(args, agent)) {
      // fila drenada: o próximo lote já está em voo (ou de volta na fila).
    } else if (maybeScheduleDeskAutoResume(args, agent)) {
      // turno bateu num rate limit / "vou tentar depois" e o auto-resume está
      // ligado: reenvio agendado (banner/notify saem do scheduler). Segura as
      // sugestões — o loop ainda não terminou de verdade.
    } else {
      void notifyTurnEnd(convId, agent)
      useChat.getState().scheduleSuggestions(convId)
    }
  }
}

/** Drena a fila da mesa em lotes, como o drainQueued do ChatPanel: builtin no
 *  meio é ação, o lote vai até ele e o resto volta para a fila. `true` =
 *  despachou algo. `agent` padrão = o da conversa. */
async function drainDeskQueued(
  args: DeskSendArgs,
  agent?: string,
): Promise<boolean> {
  const { convId, projectPath } = args
  const effAgent =
    agent ?? useChat.getState().byId[convId]?.agent ?? args.agent
  const all = useChat.getState().dequeueQueued(convId)
  if (all.length === 0) return false
  const { batch, rest } = splitQueueForAppCommand(all)
  for (const m of rest) {
    useChat.getState().enqueue(convId, m.text, m.attachments, HUMANO)
  }
  // Expande cada pendente antes do join: `/comando` no meio do coalescido
  // ficaria morto. Com um item só, o reenvio normal expande.
  let texts = batch.map((q) => q.text).filter(Boolean)
  if (texts.length > 1 && texts.some((t) => parseSlashInvocation(t.trim()))) {
    try {
      const commands = await readProjectCommands(projectPath, effAgent)
      texts = expandQueuedForJoin(texts, commands, effAgent)
    } catch (e) {
      console.warn(
        "inventário de comandos indisponível; fila segue como texto",
        e,
      )
    }
  }
  const atts = [
    ...new Map(
      batch.flatMap((q) => q.attachments).map((a) => [a.path, a]),
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
  return true
}

/** Revezamento da mesa (espelha handleContinueWith): a mesma conversa em outro
 *  agent, com o contexto num preâmbulo determinístico e o último pedido
 *  destacado. O disco o novo agent herda. Sessão fresca; guardas iguais às do
 *  sendFromDesk. */
export async function continueInAgent(
  args: DeskSendArgs,
  targetAgent: string,
): Promise<void> {
  const { convId, projectId, projectPath } = args
  if (!isTauri()) {
    avisar.nota("O dispatch dos agents roda no app (bun run tauri dev)")
    return
  }
  await useChat.getState().ensureConversationLoaded(projectId, convId)
  const conv = useChat.getState().byId[convId]
  if (!conv) {
    avisar.nota("Conversa ainda carregando. Tenta de novo.")
    return
  }
  if (conv.corrupt) {
    avisar.erro("Histórico corrompido no banco. Envio bloqueado nesta conversa.")
    return
  }
  // missão rodando nesta conversa: as fases mandam no worktree — revezar por
  // fora embolaria o diff/handoff (mesma guarda do sendFromDesk).
  if (useMission.getState().byConv[convId]?.status === "running") {
    avisar.nota("Missão em andamento. Pare a missão para revezar.")
    return
  }
  // Turno em andamento: revezar atropelaria o run. Você para primeiro.
  if (conv.running || conv.finalizing) {
    avisar.nota("Turno em andamento. Espere terminar para revezar.")
    return
  }
  const permission =
    useApp.getState().projects.find((p) => p.id === projectId)
      ?.permissionMode ?? "padrao"
  await continueConversationWith({
    convId,
    projectId,
    projectPath,
    permissionMode: permission,
    target: targetAgent,
    recordLessons: (ids) => recordInjectedLessons(convId, ids),
    onPrepared: () => {},
  })
}

/** Auto-revive da mesa, com a política do maybeScheduleAutoResume: turno que
 *  pede resume e opção ligada agenda um reenvio (handoff e "continue"), com o
 *  teto de tentativas. `true` se agendou; a notificação sai daqui. */
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
    // Prompt mínimo: o resume nativo leva a memória; se expirou, o fallback
    // do motor usa recap + ponteiro (lib/autoResumeDisparo).
    const prompt = dispararRetomada(convId, tries, settings.autoResumeMaxTries, verdict.reason)
    if (!prompt) return
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
  void notifyTurnEnd(convId, agent)
  return true
}
