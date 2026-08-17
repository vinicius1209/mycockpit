// lib/fleet/send.ts (ex-office/bridge/send.ts, movido no R1 do
// office-removal-plan) — coreografia COMPLETA de envio da mesa (§5.6 e §9 do
// docs/agent-office.md, decisão O7). Compõe as APIs exportadas do app —
// ChatPanel intocado — replicando a paridade do handleSend: guardas, lições
// injetadas, peças de continuidade por agent e o finally (finish + persist +
// fila + auto-resume + notify + sugestões). A duplicação é um risco ACEITO
// (§10), coberta pela lista fechada de testes de paridade em send.test.ts.

import { toast } from "sonner"
import { agentLabel, cancelAgent, runAgent } from "@/lib/agent"
import { agentDef as engineDef, dispatchBlockReason } from "@/lib/agents"
import type { Attachment } from "@/lib/attachments"
import { resumePrompt, wantsAutoResume } from "@/lib/autoResume"
import { isTauri, listConversations, type ConversationMeta } from "@/lib/db"
import { prepareHybridHandoff } from "@/lib/handoff"
import {
  buildDoctrineBlock,
  decideDoctrine,
  doctrineFingerprint,
  readDoctrine,
} from "@/lib/doctrine"
import {
  buildLearningBlocks,
  markLessonsUsed,
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
  expandDraftForAgent,
  expandPendingForTarget,
  expandQueuedForJoin,
  findAppCommand,
  parseSlashInvocation,
  reexpandIfEmbedded,
  splitQueueForAppCommand,
} from "@/lib/slashCommands"
import { runCompactTurn } from "@/lib/compact"
import { readProjectCommands } from "@/lib/sources"
import {
  buildMemoryPrompt,
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
import { useFusion } from "@/store/fusion"
import { useMission } from "@/store/mission"
import type { OfficeAgentId } from "@/lib/fleet/types"

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

function recordDispatchError(convId: string, error: unknown, fallback: string) {
  const message = typeof error === "string" ? error : fallback
  const conv = useChat.getState().byId[convId]
  const last = conv?.items[conv.items.length - 1]
  if (!last || last.kind !== "error" || last.message !== message) {
    useChat.getState().handleEvent(convId, { type: "error", message })
  }
  toast.error(message)
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
  // Comando BUILTIN do app — MESMA interceptação do handleSend do ChatPanel:
  // AÇÃO de primeira classe, antes da expansão de .md. O /compactar nunca vira
  // texto pro fluxo normal (decisão por capability em lib/compact).
  if (findAppCommand(text)) {
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
  // conversa estabelecida trava no agent/modelo/effort do 1º run: o agent
  // TRAVADO da conversa vence o da mesa. Destravada (1º run), o modelo vem do
  // seletor do cabeçalho do dock (args.model), senão o default do agent.
  // pareceres de conselheiro (advice) NÃO travam o 1º turno (Especialistas E1).
  const locked = hasExecutorTurn(conv.items)
  let agent: string = locked ? conv.agent : args.agent
  let model = locked ? conv.reqModel : (args.model ?? null)
  let effort = locked ? conv.effort : (args.effort ?? null)
  // S3.3 — persona do preset SÓ no 1º turno (!locked), MESMO padrão do
  // handleSend do ChatPanel. FAIL-CLOSED: preset quebrado aborta ANTES do
  // start/onAccepted — o run não inicia.
  let personaBlock: string | null = null
  let personaStamp: { presetId: string; digest: string; name: string } | null =
    null
  // régua do "1º prompt chegou no CLI", compartilhada com a doutrina.
  const hasReply = hasAssistantReply(conv.items)
  // S3.2 — passar o volante: força a re-injeção da nova doutrina NESTE turno
  // (paridade com o handleSend). DERIVADO de estado persistido
  // (needsPersonaReinject), então re-injeta mesmo se o próximo turno sair da
  // mesa depois de um restart.
  const reinject = needsPersonaReinject(conv)
  const persona = await resolveFirstTurnPersona({
    locked,
    presetId: conv.presetId ?? null,
    // D1: travada SEM resposta de assistant = 1º run morreu antes da doutrina
    // chegar → re-injeta e re-carimba.
    hasReply,
    projectPath,
    forceReinject: reinject,
  })
  if (persona.status === "blocked") {
    toast.error(persona.error)
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
  // F-A (follow-up S0) — guarda de availability ANTES do start: CLI ausente/
  // deslogada só renderia erro cru no fim do run. Guarda o agent EFETIVO (o
  // travado da conversa ou o do preset vence o da mesa). Auth incerta segue
  // (degradação honesta). onAccepted NÃO dispara: a UI preserva o rascunho.
  const dispatchBlock = dispatchBlockReason(
    agent,
    useApp.getState().settings.detected ?? {},
  )
  if (dispatchBlock) {
    toast.error(dispatchBlock)
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
  const runId = crypto.randomUUID()
  // sessão fresca quando o volante trocou de backend (resume do agent anterior
  // não vale pro novo); senão o resume normal da conversa.
  const sessionId = wheelSwitch ? null : (conv.sessionId ?? null)
  // cwd = worktree isolado da conversa, senão a pasta compartilhada do projeto
  const cwd = conv.worktreePath ?? projectPath
  const permission =
    useApp.getState().projects.find((p) => p.id === projectId)
      ?.permissionMode ?? "padrao"
  // Troca de piloto entre backends também é um transplante em duas fases: o
  // pedido entra no fio, mas agent/sessão/modelo da origem só mudam em
  // `session`. Falha de startup deixa a origem retomável.
  if (wheelSwitch) {
    useChat.getState().beginTransplant(convId, runId, agent, {
      model,
      effort,
      user: { text, attachments },
    })
  } else {
    useChat.getState().start(convId, text, runId, agent, model, effort, attachments)
  }
  // S3.3 — persona injetada NESTE run: carimba preset_id + digest da versão
  // exata (base do drift do S3.4). AWAIT (D4): falha do write avisa, não some
  // em silêncio.
  if (personaStamp) {
    await useChat
      .getState()
      .stampPreset(
        convId,
        personaStamp.presetId,
        personaStamp.digest,
        personaStamp.name,
      )
  }
  args.onAccepted?.("started")
  // M2: injeta as lições relevantes (projeto + globais) no PROMPT, não na
  // bolha visível — mesma injeção do handleSend no Linear. Best-effort:
  // qualquer falha envia sem o bloco. Os ids injetados vão pro registro por
  // conversa (recordInjectedLessons) — o 👍 do dock/companion (P6) reforça
  // pelo MESMO caminho do ChatPanel (feedbackLesson → reinforceLessons).
  // Comandos "/" honestos por fonte×motor — MESMA regra do handleSend do
  // ChatPanel: só conversa claude-code com comando de fonte claude viaja cru;
  // o resto expande aqui (codex/agy ignoram o /nome literal). A bolha mostra
  // o que você digitou; a expansão entra só no prompt.
  const sendText = await expandDraftForAgent(text, projectPath, agent)
  let lessonsBlock: string | null = null
  try {
    const blocks = await buildLearningBlocks(projectId, sendText, false)
    if (blocks.lessons) {
      lessonsBlock = blocks.lessons
      void markLessonsUsed(blocks.lessonIds)
    }
    recordInjectedLessons(convId, blocks.lessonIds)
  } catch {
    // sem lições — o envio segue normal (e zera o registro: 👍 deste turno
    // não pode reforçar ids de um turno anterior)
    recordInjectedLessons(convId, [])
  }
  // H1 (prompt-hygiene-plan) — canal por capability, paridade com o handleSend
  // do ChatPanel: motor com `systemChannel` recebe persona+doutrina pelo canal
  // SYSTEM do CLI (re-enviadas a cada spawn); sem canal, blocos no corpo.
  const sysChannel = engineDef(agent)?.systemChannel ?? false
  // DOUTRINA do projeto (.mycockpit/instructions.md): paridade com o
  // handleSend do ChatPanel — a mesa e o celular mandam sob as MESMAS regras
  // (1º turno + frescor H4 pra motor sem canal; todo spawn no canal system).
  const doctrine = decideDoctrine({
    agent,
    block: buildDoctrineBlock((await readDoctrine(projectPath)).content),
    locked,
    hasReply,
    // S3.2 wheel-switch: sessão FRESCA no backend novo → a doutrina sempre
    // viaja no envelope (paridade com o ChatPanel e com o revezamento).
    freshSession: wheelSwitch,
    lastFingerprint: useChat.getState().byId[convId]?.injected?.doctrine,
  })
  const doctrineBlock = doctrine.body
  if (doctrine.fingerprint) {
    useChat
      .getState()
      .recordInjectedFingerprint(convId, "doctrine", doctrine.fingerprint)
  }
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
  // Review gate G2 — MESMA correção do ChatPanel: com bloco a prepender
  // (doutrina/lições/persona), o pedido deixa de ser o prompt inteiro e o
  // comando nativo cru viraria barra morta atrás do bloco. Re-expande com
  // `embedded` só nesse caso; sem blocos, o cru nativo segue valendo.
  let promptText = await reexpandIfEmbedded(
    sendText,
    text,
    projectPath,
    agent,
    !!lessonsBlock || !!doctrineBlock || !!personaBlock,
  )
  // cascata (de dentro pra fora): lições → doutrina → persona.
  if (lessonsBlock) promptText = `${lessonsBlock}\n\n---\n\n${promptText}`
  if (doctrineBlock) promptText = `${doctrineBlock}\n\n${promptText}`
  // S3.2 — troca de volante com sessão fresca (backend novo): o fio até aqui
  // viaja no envelope híbrido (mesma memória/pointers do revezamento).
  if (wheelSwitch) {
    const wheelItems: ChatItem[] = [
      ...conv.items,
      // o novo agent recebe o pedido já EXPANDIDO (o /comando cru não
      // significaria nada pra ele). Embutido no envelope de handoff, nem o
      // comando nativo pode viajar cru (G2.3) — re-expande com embedded.
      {
        kind: "user",
        id: `wheel-request-${runId}`,
        text: await expandDraftForAgent(text, projectPath, agent, {
          embedded: true,
        }),
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
    // persona vem ANTES de tudo no prompt (identidade primeiro, depois a doutrina,
    // as lições e o pedido) — paridade com o handleSend do ChatPanel.
    promptText = `${personaBlock}\n\n${promptText}`
  }
  // Motor SEM resume nativo (capability `sessionResume` false — H5, nunca por
  // nome): todo turno é sessão fresca → injeta a memória da conversa no prompt
  // (recap + export do transcript pleno + ponteiro). Best-effort de ponta a
  // ponta: falha no export → só o recap.
  if (
    !wheelSwitch &&
    !(engineDef(agent)?.sessionResume ?? false) &&
    hasExecutorTurn(conv.items)
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
      systemPrompt,
      // H2: último plano de MCPs anunciado nesta conversa (ledger efêmero).
      useChat.getState().byId[convId]?.injected?.mcp ?? null,
    )
  } catch (e) {
    recordDispatchError(convId, e, "Falha ao executar o agent")
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
    // Fila: junta as mensagens digitadas durante o turno num ÚNICO reenvio —
    // em LOTES (drainDeskQueued): um builtin do app no meio quebra o
    // coalescimento. Se há fila, o próximo turno já começa; senão, auto-resume
    // em rate limit; senão notifica + agenda as sugestões.
    if (await drainDeskQueued(args, agent)) {
      // fila drenada: o próximo lote já está em voo (ou de volta na fila).
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

/** Drena a fila da conversa da mesa em LOTES — paridade com o drainQueued do
 *  ChatPanel: um builtin do app (ex.: /compactar) no meio da fila quebra o
 *  coalescimento (é AÇÃO — no join "\n\n" viraria texto morto que a
 *  interceptação nunca alcança). O lote vai até o builtin (ou é o builtin
 *  sozinho); o resto VOLTA pra fila, drenada de novo no próximo fim de turno.
 *  true = despachou algo. `agent` default = o agent atual da conversa. */
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
  // G2.2 — mesma disciplina do ChatPanel: expande CADA pendente ANTES do
  // join (`/comando` no meio do coalescido era barra morta). Com 1 item o
  // reenvio normal expande com a semântica plena. Fail-open.
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
  // F-A — mesma guarda de availability do sendFromDesk: revezar pra CLI
  // ausente/deslogada só transplanta a conversa pra um erro cru.
  const dispatchBlock = dispatchBlockReason(
    targetAgent,
    useApp.getState().settings.detected ?? {},
  )
  if (dispatchBlock) {
    toast.error(dispatchBlock)
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
  // A ação manual vence o revive agendado antes de preparar o handoff; o timer
  // não pode iniciar outro turno enquanto o destino está sendo montado.
  useChat.getState().cancelAutoResume(convId)
  // G2.3 — mesma disciplina do ChatPanel: `/comando` pendente expande pro
  // motor de DESTINO (embutido no preâmbulo do handoff); sem match no
  // inventário do destino, nota honesta em vez de barra crua morta.
  const pendingForTarget = await expandPendingForTarget(
    pending,
    projectPath,
    targetAgent,
  )
  const pendingText = pendingForTarget.note
    ? `${pendingForTarget.text}\n\n(${pendingForTarget.note})`
    : pendingForTarget.text
  const handoffItems =
    pendingText === pending
      ? conv.items
      : conv.items.map((it, i) =>
          i === lastUserIdx && it.kind === "user"
            ? { ...it, text: pendingText }
            : it,
        )
  // D3 — conversa carimbada: a doutrina viaja no transplant (sessão fresca no
  // novo agent), paridade com o handleContinueWith do ChatPanel.
  let personaBlock = await personaHandoffBlock(
    conv.presetId,
    conv.presetDigest,
    projectPath,
  )
  // A doutrina do projeto também viaja: o transplante é uma sessão FRESCA,
  // muitas vezes numa CLI diferente da que começou a conversa — sem o bloco,
  // o agent que assume seria o único do fio a trabalhar sem as regras.
  const doctrineRaw = buildDoctrineBlock((await readDoctrine(projectPath)).content)
  let doctrine = doctrineRaw
  // H1 — destino com canal system: persona+doutrina vão pelo canal do CLI
  // (re-enviadas a cada spawn), fora do preâmbulo de handoff.
  let systemPrompt: string | null = null
  if (engineDef(targetAgent)?.systemChannel) {
    systemPrompt = [personaBlock, doctrine].filter(Boolean).join("\n\n") || null
    personaBlock = null
    doctrine = null
  }
  let lessonsBlock: string | null = null
  try {
    const blocks = await buildLearningBlocks(projectId, pending, false)
    lessonsBlock = blocks.lessons
    recordInjectedLessons(convId, blocks.lessonIds)
    void markLessonsUsed(blocks.lessonIds)
  } catch {
    recordInjectedLessons(convId, [])
  }
  const cwd = conv.worktreePath ?? projectPath
  const prepared = await prepareHybridHandoff({
    projectId,
    cwd,
    convId,
    sourceAgent: conv.agent,
    targetAgent,
    items: handoffItems,
    pendingUserIndex: lastUserIdx,
    personaBlock,
    doctrineBlock: doctrine,
    lessonsBlock,
  })
  // corrida do await (mesma classe do D2): re-checa antes de transplantar.
  const fresh = useChat.getState().byId[convId]
  if (!fresh || fresh.running || fresh.finalizing) {
    toast("Turno em andamento. Espere terminar para revezar.")
    return
  }
  const runId = crypto.randomUUID()
  // revezamento é intenção explícita: auto-resume já foi derrubado antes dos
  // awaits; agora invalida sugestões pendentes.
  useChat.getState().invalidateSuggestions(convId)
  useChat.getState().handleEvent(convId, {
    type: "notice",
    message: prepared.paths
      ? `revezamento: memória híbrida pronta · preparando ${agentLabel(targetAgent)}`
      : `revezamento: contexto compacto · preparando ${agentLabel(targetAgent)} (export indisponível)`,
  })
  useChat.getState().beginTransplant(convId, runId, targetAgent)
  // H4 — a doutrina chegou fresca ao destino (corpo ou canal): carimba o
  // fingerprint pro frescor mid-conversa valer também pós-transplante.
  if (doctrineRaw) {
    useChat
      .getState()
      .recordInjectedFingerprint(convId, "doctrine", doctrineFingerprint(doctrineRaw))
  }
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
      prepared.prompt,
      cwd,
      null, // sessão FRESCA: a do agent anterior não serve pro novo
      permission,
      [],
      (e) => useChat.getState().handleEvent(convId, e),
      false,
      null,
      systemPrompt,
      useChat.getState().byId[convId]?.injected?.mcp ?? null,
    )
  } catch (e) {
    recordDispatchError(convId, e, "Falha no revezamento")
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
    // Prompt mínimo: resume nativo leva a memória; se expirou, o fallback do
    // motor usa recap + ponteiro. Não duplica dezenas de milhares de chars.
    // mesma fonte única do ChatPanel: o texto do reenvio segue o gatilho real.
    const prompt = resumePrompt(verdict.reason)
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
