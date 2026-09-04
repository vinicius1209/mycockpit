import { useEffect, useRef, useState } from "react"
import { modoEfetivoDoSpawn, permissaoDoSpawn } from "@/lib/sessionMode"
import { contextWindowFor } from "@/lib/contextWindow"
import { dispatchQueuedNow, drainQueued } from "@/components/chat/drenarFila"
import { stopActiveConversation } from "@/components/chat/filaComposer"
import { notaDeTrocaDeModelo } from "@/components/chat/composerIdentity"
import { maybeScheduleAutoResume } from "@/components/chat/autoResumeAgendar"
import { ArrowDown } from "lucide-react"
import { toast } from "sonner"
import { withNotes } from "@/lib/notes"
import { RunStatusStack } from "@/components/chat/RunStatusStack"
import { CommandConsole } from "@/components/chat/CommandConsole"
import { Especialistas } from "@/components/settings/Especialistas"
import { ScaledMessageList } from "@/components/chat/ScaledMessageList"
import { TurnScrubber } from "@/components/chat/TurnScrubber"
import { useChatScroll } from "@/components/chat/useChatScroll"
import { vistaDaConversa } from "@/components/chat/vistaDaConversa"
import { useFeedbackDoFio } from "@/components/chat/feedbackDoFio"
import { PresenceBar } from "@/components/chat/PresenceBar"
import { Reticle } from "@/components/common/Wordmark"
import { useActiveProject, useApp } from "@/store/app"
import { useConversationMapRefresh } from "@/components/chat/useConversationMapRefresh"
import {
  useChat,
  useActiveConv,
  deferredLabel,
  deferredResumePrompt,
  executorItems,
  needsPersonaReinject,
  type ChatItem,
} from "@/store/chat"
import { allowBlockedDir } from "@/lib/dirGate"
import { retidoPorTurnoEmVoo } from "@/lib/sendGate"
import {
  AUTO_RESUME,
  ehAutoResume,
  HUMANO,
  PASTA_LIBERADA,
  type OrigemDoEnvio,
} from "@/lib/sendOrigin"
import { useFusion } from "@/store/fusion"
import { FusionBoard } from "@/components/fusion/FusionBoard"
import { useMission } from "@/store/mission"
import {
  MissionResumeCard,
  MissionTimeline,
  missionHostsInline,
} from "@/components/mission/MissionTimeline"
import { InlineInteractions } from "@/components/chat/InteractionHost"
import { runAgent } from "@/lib/agent"
import { agentDef as engineDef, dispatchBlockReason } from "@/lib/agents"
import { avisoDeMotorAusente } from "@/lib/detect"
import { BannersDoComposer } from "@/components/chat/BannersDoComposer"
import { prepareHybridHandoff } from "@/lib/handoff"
import { decidePlanGateAndSend } from "@/lib/planGate"
import { extractPlanText, turnEndedOk } from "@/lib/planMode"
import {
  renderTranscript,
  exportConvContext,
  buildMemoryPrompt,
  shouldInlineMemory,
  buildResumeFallback,
  shouldAttachResumeFallback,
} from "@/lib/transcript"
import { resolveSendTarget } from "@/lib/sendTarget"
import { notifyTurnEnd } from "@/lib/notify"
import type { Attachment } from "@/lib/attachments"
import { useAttachmentGc } from "@/hooks/useAttachmentGc"
import type { AgentRunConfig } from "@/lib/types"
import type { McpRecoveryKind, McpRunOverride } from "@/lib/tooling"
import { isTauri } from "@/lib/db"
import { buildLearningBlocks } from "@/lib/learning"
import { presentTool } from "@/lib/toolview"
import {
  listenWorkEvents,
  retryManagedProcess,
  startManagedProcess,
  stopManagedProcess,
} from "@/lib/work"
import {
  hasAssistantReply,
  personaHandoffBlock,
  resolveFirstTurnPersona,
  warnPresetDrift,
} from "@/lib/presets"
import {
  buildDoctrineBlock,
  decideDoctrine,
  readDoctrine,
} from "@/lib/doctrine"
import { findAppCommand } from "@/lib/slashCommands"
import {
  expandDraftWithSources,
  expandEmbeddedDraft,
  finalizeSlashExpansion,
} from "@/lib/slashDispatch"
import { runCompactTurn } from "@/lib/compact"
import {
  acceptChatTurn,
  createRunAcceptance,
  recordDispatchError,
} from "@/lib/chatRunAcceptance"
import {
  recoveryForConversation,
  startBrowserAndResumePreflight,
  type PreflightRetryRequest,
} from "@/lib/mcpPreflightRetry"
import { continueConversationWith } from "@/lib/chatHandoff"
import { listAgentDefs } from "@/lib/agentDefs"
import {
  detectAdvisorMention,
  resolveAdvisor,
} from "@/lib/advisor"
import { consultAdvisor } from "@/components/chat/consultAdvisor"

function greetingFor(date: Date): string {
  const h = date.getHours()
  if (h < 12) return "Bom dia"
  if (h < 18) return "Boa tarde"
  return "Boa noite"
}

export function ChatPanel() {
  const project = useActiveProject()
  const conv = useActiveConv()
  const openProject = useChat((s) => s.openProject)
  const viewMode = useApp((s) => s.viewMode)
  const { detected: detectados, userProfile, userPreferences } = useApp((s) => s.settings)
  // `null` enquanto a detecção não rodou: aviso que depende de probe só
  // aparece depois da leitura terminar (§5 camada 3). A regra mora em
  // `avisoDeMotorAusente`, não aqui.
  const motorAusente = conv ? avisoDeMotorAusente(conv.agent, detectados) : null
  const planDetailedInSidebar = useApp(
    (s) => s.contextOpen && s.contextPanelTab === "conversa",
  )
  const transcriptReveal = useApp((s) => s.transcriptReveal)
  // Lições injetadas no ÚLTIMO turno desta conversa (p/ o 👍 reforçar — bump).
  // Ref keyed por convId; efêmero, não persiste (é só o alvo do reforço leve).
  const injectedLessonsRef = useRef<Record<string, string[]>>({})
  const preflightRetryRef = useRef<Record<string, PreflightRetryRequest>>({})
  useEffect(() => {
    if (!isTauri()) return
    let disposed = false
    let unlisten: (() => void) | null = null
    void listenWorkEvents((event) => useChat.getState().handleWorkEvent(event)).then(
      (off) => {
        if (disposed) off()
        else unlisten = off
      },
    )
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [])
  const [especialistasOpen, setEspecialistasOpen] = useState(false)

  const items = conv.items
  const running = conv.running
  const finalizing = conv.finalizing
  const activeId = useChat((s) => s.activeId)
  useConversationMapRefresh({
    conversationId: activeId,
    projectId: project?.id ?? null,
    items,
    running,
    finalizing,
  })

  const { scrollRef, contentRef, atBottom, onScroll, scrollToBottom, followLatest, setAtBottom } = useChatScroll({
    activeId,
    items,
    running,
  })

  const fusionActive = useFusion((s) => (activeId ? !!s.byConv[activeId] : false))
  // O STATUS, não um booleano (ADR-088; o porquê em `vistaDaConversa`).
  const missionStatus = useMission((s) =>
    activeId ? (s.byConv[activeId]?.status ?? null) : null,
  )
  // Missão RODANDO nesta conversa: trava o envio manual (as fases rodam no mesmo
  // worktree; um run paralelo embolaria o diff/handoff — aresta do M2).
  const missionRunning = missionStatus === "running"
  // Aprovações contextuais: a MissionTimeline hospeda o card inline enquanto o
  // bloco da fase corrente está na tela; fora disso (linear/gate/done) o card
  // entra aqui, acima do composer. Nunca os dois — mesma régua nos dois lados.
  const missionInline = useMission((s) =>
    missionHostsInline(activeId ? s.byConv[activeId] : null),
  )
  // P1 confiabilidade: missão interrompida por restart — o boot da conversa
  // detecta o run-state.json `running` no cwd da missão e oferece o card de
  // retomada. MH4.3: também SEM worktree — o caso residual é missão antiga
  // rodada na pasta do projeto (pré-MH1.4, ou fallback confirmado); o ponteiro
  // por conversa mora lá e o readInterruptedFor já filtra pelo convId (sem
  // oferta cruzada entre conversas do mesmo cwd). A retomada re-roda no cwd
  // verdadeiro (ensureMissionCwd com resume nunca cria worktree novo).
  const missionInterrupted = useMission((s) =>
    activeId ? !!s.interrupted[activeId] : false,
  )
  const detectInterrupted = useMission((s) => s.detectInterrupted)
  const worktreePath = conv?.worktreePath ?? null
  const missionBootCwd = worktreePath ?? project?.path ?? null
  useEffect(() => {
    if (!activeId || !missionBootCwd) return
    void detectInterrupted(activeId, missionBootCwd)
  }, [activeId, missionBootCwd, missionStatus, detectInterrupted])

  // Abre o projeto ao trocar: carrega as conversas e a mais recente (Sprint 2).
  const projectId = project?.id ?? null
  useEffect(() => {
    void openProject(projectId)
  }, [projectId, openProject])

  // ⌘K (ou outra UI) pode enfileirar um prompt → dispara aqui.
  const queuedPrompt = useChat((s) => s.queuedPrompt)
  useEffect(() => {
    if (!queuedPrompt) return
    const text = queuedPrompt
    useChat.getState().queuePrompt(null)
    // ⌘K é gesto SEU: o prompt entra como mensagem do humano.
    void handleSend(text, undefined, [], HUMANO)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedPrompt])

  // GC do cache de blobs no boot (conversas + notas): hooks/useAttachmentGc.
  useAttachmentGc()

  // Caso 2, restaura uma disputa de Fusion PENDENTE (esperando decisão) ao abrir
  // a conversa, pra não perder o que já rodou + foi pago.
  useEffect(() => {
    if (!activeId || !isTauri()) return
    void useFusion.getState().restorePending(activeId)
  }, [activeId])

  // destinationId = o agent escolhido no seletor (v0.2-α: o seam que descartava
  // o destino agora é threadado até o runAgent). Default 'claude-code'.
  // Phase 3 do extra_dirs: libera a pasta detectada (persiste no config.toml +
  // memória) e, SÓ com a conversa parada, reenvia o último pedido — o novo
  // turno nasce com --add-dir (o gate de diretório é fixo no spawn). A decisão
  // inteira, com o prazo de cada metade, mora em `lib/dirGate` (ADR-046).
  function handleAllowBlockedDir(dir: string) {
    if (!project) return
    void allowBlockedDir({
      convId: activeId,
      project,
      dir,
      // Reenvio é MECANISMO: entra com origem de SISTEMA e, por isso, jamais
      // pode virar mensagem na fila do humano.
      reenviar: (texto) => void handleSend(texto, undefined, [], PASTA_LIBERADA),
    })
  }

  async function handleStartRequiredBrowser() {
    if (!activeId) return
    const retry = preflightRetryRef.current[activeId]
    try {
      const result = await startBrowserAndResumePreflight(
        activeId,
        retry,
        resendPreflight,
      )
      if (result === "missing-project") return
      toast.success(
        result === "sent"
          ? "Navegador ligado. Enviando seu pedido."
          : "Navegador ligado. Seu pedido continua pronto para enviar.",
      )
    } catch (error) {
      toast.error(
        typeof error === "string"
          ? error
          : "Não consegui ligar o navegador deste projeto.",
      )
    }
  }

  function handlePreflightRecovery(
    kind: Extract<McpRecoveryKind, "omit-for-this-run" | "retry-readonly">,
  ) {
    if (!activeId) return
    const retry = preflightRetryRef.current[activeId]
    const override = recoveryForConversation(activeId, kind)
    if (!retry || !override) return
    resendPreflight(retry, [override])
  }

  function resendPreflight(
    retry: PreflightRetryRequest,
    recoveries: McpRunOverride[] = [],
  ) {
    void handleSend(
      retry.text,
      retry.cfg,
      retry.attachments,
      HUMANO,
      activeId ?? undefined,
      retry.onAccepted,
      recoveries,
    )
  }

  async function handleSend(
    text: string,
    cfg: AgentRunConfig | undefined,
    attachments: Attachment[],
    /** QUEM pediu este envio (ADR-046). Obrigatório de propósito, e por isso os
     *  dois anteriores perderam o default: era um `fromAutoResume` booleano, e
     *  o caminho que não se declarava (o botão de liberar pasta) enfileirou uma
     *  retomada do app na fila do humano. Quem envia agora diz quem é. */
    origem: OrigemDoEnvio,
    /** Conversa de ORIGEM. Quem RE-ENTRA (drenagem da fila, auto-resume) passa o
     *  convId do turno que terminou: esses envios disparam tempo depois e, lendo
     *  o foco, a fila digitada no projeto X ia parar na conversa aberta do
     *  projeto Y. Sem alvo = envio manual, vale a conversa em foco AGORA. */
    originConvId?: string,
    /** O composer só limpa texto e anexos quando o backend aceita o envio. */
    onAccepted?: () => void,
    mcpRecoveries: McpRunOverride[] = [],
  ) {
    if (origem.autor === "humano") followLatest()
    if (!isTauri()) {
      toast("O dispatch dos agents roda no app (bun run tauri dev)")
      return
    }
    // Alvo: conversa + projeto DONO; cwd, permissão e lições são do fio.
    // `conv`/`project` daqui SOMBREIAM os do componente de propósito.
    const target = resolveSendTarget(
      originConvId ?? useChat.getState().activeId,
      useChat.getState().byId,
      useApp.getState().projects,
    )
    // conversa ainda carregando do disco (janela do switch): enviar agora
    // criaria um estado vazio e o persist apagaria o histórico (achado 1 do aval).
    if (target.status === "loading") {
      toast("Conversa ainda carregando. Tenta de novo.")
      return
    }
    if (target.status !== "ok") return
    const { convId, conv, project } = target
    if (conv.preparing) {
      toast("As capacidades deste envio ainda estão sendo verificadas.")
      return
    }
    // Missão rodando nesta conversa: as fases compartilham o worktree; um envio
    // manual em paralelo embolaria o diff/handoff. Bloqueia (M2).
    if (useMission.getState().byConv[convId]?.status === "running") {
      toast("Missão em andamento. Pare a missão para enviar manualmente.")
      return
    }
    if (conv.corrupt) {
      toast.error("Histórico corrompido no banco. Envio bloqueado nesta conversa.")
      return
    }
    // Especialistas E1 — CONSULTA de conselheiro: `@persona` conhecida no envio
    // dispara um parecer lateral read-only, NÃO um turno de executor. Só custa
    // uma leitura das personas quando há um `@token` (envio comum: zero). Persona
    // não casa → segue o fluxo normal (o `@` pode ser arquivo/texto literal).
    if (/(?:^|\s)@\S/.test(text)) {
      const defs = await listAgentDefs(project.path)
      const mention = detectAdvisorMention(text, defs)
      if (mention) {
        // estado FRESCO (o await de listAgentDefs pode ter deixado o snapshot
        // `conv` velho): um turno pode ter começado nesse meio-tempo.
        const fresh = useChat.getState().byId[convId]
        if (fresh?.running || fresh?.finalizing || fresh?.advising) {
          toast("Termine o turno atual antes de pedir um parecer.")
          return
        }
        // fail-closed: re-resolve pelo id (getAgentDef distingue "não existe" de
        // "não consegui ler" — arquivo intacto vs leitura quebrada).
        const resolved = await resolveAdvisor(project.path, mention.def.id)
        if (resolved.status === "unreadable") {
          toast.error(
            `Não consegui ler a persona "${mention.def.name}" do disco. Tente de novo.`,
          )
          return
        }
        if (resolved.status === "missing") {
          toast.error(`A persona "${mention.def.name}" não existe mais.`)
          return
        }
        await consultAdvisor(convId, resolved.def, mention.question, project, {
          text,
          attachments,
        })
        onAccepted?.()
        return
      }
    }
    // Rodando/finalizando: mensagem SUA vai pra fila (o CLI precisa sair de fato
    // antes do próximo run; ao terminar, o finally junta as pendentes num envio
    // só). Retomada de SISTEMA não entra na fila do humano — a decisão e o porquê
    // moram em `lib/sendGate` (ADR-046).
    if (retidoPorTurnoEmVoo(convId, text, attachments, origem)) {
      onAccepted?.()
      return
    }
    // Um envio MANUAL (digitado/⌘K/fila) supersede um auto-resume agendado: cancela
    // o timer pra não disparar um resume redundante em cima do run que começa agora.
    // Se ESTE send É o próprio resume, não cancela (o loop já limpou/regravou o estado).
    const fromAutoResume = ehAutoResume(origem)
    if (!fromAutoResume) useChat.getState().cancelAutoResume(convId)
    // novo run → invalida geração de sugestão pendente/em-voo desta conversa
    useChat.getState().invalidateSuggestions(convId)
    // Comando BUILTIN do app (source "app", lib/slashCommands): AÇÃO de
    // primeira classe, interceptada ANTES da expansão de .md — o /compactar
    // nunca segue como texto pro fluxo normal (em motor com nativeCompact o
    // que viaja é o literal "/compact"; sem, a sessão renova com recap — a
    // decisão por capability mora em lib/compact).
    if (findAppCommand(text)) {
      await runCompactTurn({
        convId,
        projectId: project.id,
        projectPath: project.path,
        commandText: text,
        onStarted: onAccepted,
        drainQueue: () => {
          void drainQueued(convId, conv.agent, project.path, handleSend)
        },
      })
      return
    }
    // conversa estabelecida trava no agent/modelo/effort do 1º run; nova usa o
    // seletor. Pareceres de conselheiro (advice) são laterais e NÃO contam como
    // turno de executor — senão uma consulta antes do 1º envio "travaria" a
    // conversa e roubaria a injeção de persona/doutrina do turno inicial (E1).
    const execItems = executorItems(conv.items)
    const locked = execItems.length > 0
    let agent = locked ? conv.agent : (cfg?.agent ?? "claude-code")
    let model = locked && !cfg?.modelSwitched ? conv.reqModel : (cfg?.model ?? null)
    // Trocar de modelo no meio é permitido (a sessão do CLI sobrevive), mas não
    // pode ser MUDO: sem esta linha o histórico passa a dizer que a conversa
    // rodou inteira num modelo só, e o custo por token muda sem aviso.
    const modelChangeNotice = locked
      ? notaDeTrocaDeModelo(conv.reqModel, model)
      : null
    let effort = locked ? conv.effort : (cfg?.effort ?? null)
    // S3.3 — persona do preset SÓ no 1º turno (!locked). FAIL-CLOSED: preset
    // quebrado (apagado, sem personality, skill fora do inventário do projeto)
    // ABORTA aqui, ANTES do start — o run não inicia nem gasta turno.
    let personaBlock: string | null = null
    let personaStamp: { presetId: string; digest: string; name: string } | null =
      null
    // "o 1º prompt CHEGOU no CLI" — régua compartilhada pela persona e pela
    // doutrina (as duas só entram no turno inicial).
    const hasReply = hasAssistantReply(execItems)
    // S3.2 — passar o volante: força a re-injeção NESTE turno (mesma máquina do
    // turno-1, sem duplicar a lógica). DERIVADO de estado persistido
    // (needsPersonaReinject: persona carimbada + digest zerado + turno de
    // executor), então sobrevive a restart entre a troca e o envio.
    const reinject = needsPersonaReinject(conv)
    const persona = await resolveFirstTurnPersona({
      locked,
      presetId: conv.presetId ?? null,
      // D1: conversa travada SEM resposta de assistant = o 1º run morreu antes
      // da doutrina chegar → re-injeta e re-carimba em vez de perder a persona.
      hasReply,
      projectPath: project.path,
      forceReinject: reinject,
    })
    if (persona.status === "blocked") {
      toast.error(persona.error)
      return
    }
    if (persona.status === "ready") {
      // o preset define o trio de uma vez (a camada crua fica pra conversas
      // sem preset)
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
    // S3.2 — passar o volante trocou o BACKEND junto (a nova persona roda noutro
    // agent que o do fio): a sessão nativa do agent anterior não serve pro novo →
    // sessão fresca + o contexto do fio viaja no envelope híbrido do
    // revezamento. Piloto de MESMO backend mantém o resume nativo:
    // só a nova doutrina é prependida na sessão que continua.
    const wheelSwitch =
      reinject &&
      persona.status === "ready" &&
      agent !== conv.agent &&
      conv.sessionId != null
    // S3.4 — resume de conversa com preset carimbado: verifica o drift do
    // digest (aviso obrigatório; o turno segue — recusa dura é maturação).
    // Só quando NÃO estamos re-injetando (a re-injeção re-carimba a versão
    // atual, drift não se aplica).
    if (persona.status === "none" && locked && conv.presetId && conv.presetDigest) {
      void warnPresetDrift(convId, conv.presetId, conv.presetDigest, project.path)
    }
    // F-A (follow-up S0) — guarda de availability ANTES do start: mandar turno
    // pra CLI ausente/deslogada só rende erro cru no fim do run. Guarda o agent
    // EFETIVO (o travado da conversa ou o do preset vence o do seletor); auth
    // incerta segue (degradação honesta).
    const dispatchBlock = dispatchBlockReason(
      agent,
      useApp.getState().settings.detected ?? {},
    )
    if (dispatchBlock) {
      toast.error(dispatchBlock)
      return
    }
    // D2 — corrida do await acima: outro envio pode ter passado pelas guardas
    // e iniciado um run enquanto o preflight rodava. Re-checa com estado
    // FRESCO pelo MESMO gate da guarda lá em cima (era código gêmeo, e o gêmeo
    // enfileirava retomada de sistema), nunca um segundo run concorrente.
    if (retidoPorTurnoEmVoo(convId, text, attachments, origem)) {
      onAccepted?.()
      return
    }
    // M3: modo é da CONVERSA (persistido); o `cfg` do composer vence quando
    // existe. Auto-resume nunca planeja (é continuação de execução).
    const planFirst =
      !fromAutoResume && (cfg?.planFirst ?? conv.sessionMode === "plan")
    // M3, o ÚLTIMO METRO: o modo da conversa tem que chegar no PROCESSO.
    // Até 23/08/2026 daqui saía `project.permissionMode` e o chip da conversa
    // não alcançava o spawn — conversa nova em "Liberado" pedia permissão, e
    // "Só lê" não confinava (o sandbox decide pelo mesmo valor).
    const permissaoDoTurno = permissaoDoSpawn(
      modoEfetivoDoSpawn(conv.sessionMode, project.permissionMode),
    )
    const runId = crypto.randomUUID()
    // sessão fresca quando o volante trocou de backend (o resume nativo do agent
    // anterior não vale pro novo); senão o resume normal da conversa.
    const sessionId = wheelSwitch ? null : (conv.sessionId ?? null)
    // cwd = worktree isolado da conversa (v2.5), senão a pasta compartilhada do projeto.
    const cwd = conv.worktreePath ?? project.path
    // A mensagem ainda não pertence ao fio. Ela só entra quando o backend
    // emitir run_manifest, a fronteira de aceite deste envio.
    // M2: injeta as lições relevantes (projeto + globais) no PROMPT, não na
    // bolha visível. Best-effort: qualquer falha envia sem o bloco.
    //
    // NÃO condicionar a `viewMode`: este handleSend É o turno linear, então o
    // viewMode era proxy ERRADO (valor de TELA capturado no closure) — deixar
    // o turno terminar em outra superfície drenava a fila SEM as lições. O
    // `sendFromDesk` já injetava sem condição; agora os dois concordam.
    // Comandos "/" honestos por fonte×motor: só conversa claude-code com
    // comando de fonte claude viaja CRU (o CLI interpreta nativamente); o
    // resto expande AQUI — em codex/agy o /nome literal era texto que o motor
    // ignorava. A BOLHA mostra o que você digitou (text, já gravado no start);
    // a expansão entra só no prompt. Sem match → segue como texto (fail-open).
    const slashExpansion = await expandDraftWithSources(text, project.path, agent)
    const sendText = slashExpansion.text
    let lessonsBlock: string | null = null
    let acceptedLessonIds: string[] = []
    {
      try {
        const blocks = await buildLearningBlocks(project.id, sendText, false)
        if (blocks.lessons) {
          lessonsBlock = blocks.lessons
          acceptedLessonIds = blocks.lessonIds
        }
      } catch {}
    }
    // Especialistas E1 — "Trazer pro Executor": o parecer que você trouxe entra
    // como CONTEXTO deste turno (bloco no prompt, não bolha), acima do pedido.
    // Só é consumido quando o envio é aceito; gate de preflight preserva tudo.
    const broughtAdvice = conv.pendingAdvice ?? null
    // H1 (prompt-hygiene-plan) — canal por capability: motor com `systemChannel`
    // recebe persona+doutrina pelo canal SYSTEM do CLI, re-enviadas a cada
    // spawn (frescor de graça, zero inchaço de histórico); motor sem canal
    // segue com blocos no corpo (1º turno + frescor H4 pela doutrina).
    const sysChannel = engineDef(agent)?.systemChannel ?? false
    // DOUTRINA do projeto (.mycockpit/instructions.md) — a instrução agnóstica:
    // o app injeta, então vale igual em claude, codex e agy. No corpo, entra
    // DEPOIS da persona e ANTES das lições na cascata: quem você é → as regras
    // deste projeto → o que já aprendemos → o pedido. Best-effort: sem arquivo,
    // ou com falha de disco, o envio segue sem o bloco.
    const doctrine = decideDoctrine({
      agent,
      block: buildDoctrineBlock((await readDoctrine(project.path)).content),
      locked,
      hasReply,
      // S3.2 wheel-switch: sessão FRESCA no backend novo → a doutrina sempre
      // viaja no envelope (mesma régua do revezamento explícito).
      freshSession: wheelSwitch,
      lastFingerprint: useChat.getState().byId[convId]?.injected?.doctrine,
    })
    const doctrineBlock = doctrine.body
    // Persona pro canal system: a resolvida do 1º turno/reinjeção quando há;
    // nos turnos seguintes de conversa carimbada, re-deriva do preset (best-
    // effort — o aviso de drift do S3.4 continua cobrindo divergência).
    let systemPersona: string | null = null
    if (sysChannel) {
      if (personaBlock) {
        systemPersona = personaBlock
        personaBlock = null
      } else if (locked && conv.presetId && conv.presetDigest) {
        systemPersona = await personaHandoffBlock(
          conv.presetId,
          conv.presetDigest,
          project.path,
        )
      }
    }
    // identidade primeiro, depois as regras — mesma ordem da cascata do corpo.
    const systemPrompt =
      [systemPersona, doctrine.system].filter(Boolean).join("\n\n") || null
    // Review gate G2 — os blocos são decididos ANTES da composição: se
    // qualquer um vai prepender, o pedido deixa de ser o prompt INTEIRO e um
    // comando nativo que sobreviveu CRU acima viraria barra morta atrás do
    // bloco (ex.: doutrina + /review em conversa claude). Nesse caso o pedido
    // re-expande com `embedded`; sem blocos, o cru nativo segue valendo.
    const hasPromptEnvelope = !!lessonsBlock || !!broughtAdvice || !!doctrineBlock || !!personaBlock
    const embeddedExpansion = await finalizeSlashExpansion(slashExpansion, text, project.path, agent, hasPromptEnvelope)
    let promptText = embeddedExpansion.text
    let instructionSources = embeddedExpansion.instructionSources
    // cascata (de dentro pra fora): lições → parecer → doutrina → persona.
    promptText = withNotes(convId, conv.items, promptText)
    if (lessonsBlock) promptText = `${lessonsBlock}\n\n---\n\n${promptText}`
    if (broughtAdvice) promptText = `${broughtAdvice}\n\n---\n\n${promptText}`
    if (doctrineBlock) promptText = `${doctrineBlock}\n\n${promptText}`
    // S3.2 — troca de volante com sessão fresca (backend novo): o fio até aqui
    // viaja pelo MESMO envelope híbrido do revezamento. O pedido atual ainda
    // não estava em conv.items no preflight, então entra como item sintético
    // somente no artefato de handoff (a store já o gravou em start()).
    if (wheelSwitch) {
      const wheelItems: ChatItem[] = [...conv.items]
      if (broughtAdvice) {
        wheelItems.push({
          kind: "text",
          id: `wheel-advice-${runId}`,
          text: `Parecer trazido para o executor:\n${broughtAdvice}`,
        })
      }
      const wheelExpansion = await expandEmbeddedDraft(text, project.path, agent)
      instructionSources = wheelExpansion.instructionSources
      wheelItems.push({
        kind: "user",
        id: `wheel-request-${runId}`,
        // o novo agent recebe o pedido já EXPANDIDO (o /comando cru não
        // significaria nada pra ele). Embutido no envelope de handoff, nem o
        // comando nativo pode viajar cru (G2.3) — re-expande com embedded.
        text: wheelExpansion.text,
      })
      const prepared = await prepareHybridHandoff({
        projectId: project.id,
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
      // persona vem ANTES de tudo no prompt (identidade primeiro, depois a
      // doutrina, as lições e o pedido) — mesmo cano do bloco de lições.
      promptText = `${personaBlock}\n\n${promptText}`
    }
    // Motor SEM resume nativo (capability `sessionResume` false — H5, nunca
    // por nome): todo turno é sessão fresca → injeta a memória da conversa no
    // prompt — recap curto (~4k) + exporta o transcript pleno pro arquivo do
    // projeto e aponta o caminho (o agent PUXA se precisar de mais). Motores
    // com resume não ganham isso em turno normal (o resume já resolve).
    // Best-effort de ponta a ponta: falha no export → só o recap.
    // Regra única em lib/transcript (vivia duplicada aqui e no fleet/send).
    if (
      shouldInlineMemory({ agent, items: conv.items, sessionId, hasReply, wheelSwitch })
    ) {
      let pointer: string | null = null
      try {
        // exporta relativo ao cwd EFETIVO (worktree ou projeto), pro caminho
        // relativo resolver de onde o agent roda.
        const md = renderTranscript(conv.items, { agent: conv.agent })
        pointer = await exportConvContext(cwd, convId, md)
      } catch {
        pointer = null
      }
      promptText = buildMemoryPrompt(
        conv.items,
        pointer,
        promptText,
        // Orçamento derivado da janela DESTE modelo (G1). O modelo resolvido
        // vence o pedido: é o que o CLI de fato abriu.
        contextWindowFor(conv.model ?? conv.reqModel),
      )
    }
    // MyCockpit resume (claude/codex): a conversa pertence ao cockpit, não à
    // CLI. Quando o envio VAI tentar resume nativo (conv com itens + sessionId),
    // exporta o transcript pleno (mesmo caminho do agy) e monta o fallback de
    // memória (recap ~3k + ponteiro + linha de continuidade). O motor SÓ usa
    // se o resume nativo falhar — o prompt normal NÃO muda. Best-effort de
    // ponta a ponta: export falhou → só recap; tudo falhou → envia sem fallback.
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
        memoryFallback = buildResumeFallback(
          conv.items,
          pointer,
          contextWindowFor(conv.model ?? conv.reqModel),
        )
      } catch {
        memoryFallback = null
      }
    }
    const acceptance = createRunAcceptance({
      onAccept: () => {
        delete preflightRetryRef.current[convId]
        acceptChatTurn({
          convId,
          runId,
          agent,
          model,
          effort,
          text,
          attachments,
          wheelSwitch,
          modelChangeNotice,
          broughtAdvice,
          lessonIds: acceptedLessonIds,
          recordLessons: (ids) => {
            injectedLessonsRef.current[convId] = ids
          },
          doctrineFingerprint: doctrine.fingerprint,
          personaStamp,
          onAccepted,
        })
        if (convId === useChat.getState().activeId) setAtBottom(true)
      },
      onBlocked: (gate) => {
        preflightRetryRef.current[convId] = {
          text,
          cfg,
          attachments,
          onAccepted,
        }
        useChat.getState().blockPreparation(convId, runId, gate)
      },
      onEvent: (event) => useChat.getState().handleEvent(convId, event),
    })

    useChat.getState().beginPreparation(convId, runId)
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
        permissaoDoTurno,
        attachments,
        acceptance.handler,
        planFirst,
        memoryFallback,
        systemPrompt,
        // H2: último plano de MCPs anunciado nesta conversa (ledger efêmero).
        useChat.getState().byId[convId]?.injected?.mcp ?? null,
        instructionSources,
        mcpRecoveries,
      )
      if (!acceptance.accepted() && !useChat.getState().byId[convId]?.preflightGate) {
        toast.error("O turno não começou. O pedido continua no composer.")
      }
    } catch (e) {
      if (acceptance.accepted()) {
        recordDispatchError(convId, e, "Falha ao executar o agent")
      }
      else toast.error("Não consegui verificar as capacidades deste envio.")
    } finally {
      if (!acceptance.accepted()) {
        useChat.getState().clearPreparation(convId, runId)
      } else {
        useChat.getState().finish(convId)
        void useChat.getState().persist(convId)
      }
      // Gate de plano: o turno plan_first terminou BEM → captura o texto final
      // do assistente (o plano) e arma o card "Aprovar e executar / Descartar".
      // Um envio manual posterior limpa o estado (start zera pendingPlan).
      if (acceptance.accepted() && planFirst) {
        const after = useChat.getState().byId[convId]
        const planText =
          after && turnEndedOk(after.items) ? extractPlanText(after.items) : null
        if (planText) useChat.getState().pushPlanGate(convId, planText)
      }
      // Fila: junta as mensagens digitadas durante o turno num ÚNICO envio
      // (resume) — em LOTES: um builtin do app no meio quebra o coalescimento
      // (drainQueued). Se há fila, o próximo turno já começa; senão, agenda as
      // sugestões. `convId` explícito: a fila é DESTA conversa e o turno pode
      // terminar com o usuário já noutro projeto — sem o alvo, o envio caía no
      // fio em foco.
      if (!acceptance.accepted()) {
        // Nenhum turno nasceu: não drena fila, não agenda retomada, não
        // notifica conclusão e não fabrica sugestões.
      } else if (await drainQueued(convId, agent, project.path, handleSend)) {
        // fila drenada: o próximo lote já está em voo (ou de volta na fila).
      } else if (maybeScheduleAutoResume(convId, agent, handleSend)) {
        // turno bateu num rate limit / "vou tentar depois" e o auto-resume está
        // ligado: agendamos um reenvio automático (banner mostra o countdown).
        // Não notifica/sugere ainda — o loop ainda não terminou de verdade.
      } else {
        // turno (e a fila) concluídos → notifica + sugestões.
        void notifyTurnEnd(convId, agent)
        useChat.getState().scheduleSuggestions(convId)
      }
    }
  }

  /** Drena a fila da conversa em LOTES. Um builtin do app (ex.: /compactar) no
   *  meio da fila quebra o coalescimento: ele é AÇÃO — no join "\n\n" viraria
   *  texto morto que a interceptação nunca alcança. O lote vai até o builtin
   *  (ou é o builtin sozinho); o resto VOLTA pra fila e o próximo fim de turno
   *  drena de novo, na ordem digitada. Sem builtin: um lote só, com anexos de
   *  todos os itens (dedup por path — o dedup por hash do backend pode repetir
   *  o mesmo blob). true = despachou algo. */

  // Revezamento: continua a MESMA conversa em OUTRO agent (limite/erro do
  // atual). O contexto vai por preâmbulo determinístico (handoff, tail-biased);
  // o disco (cwd/worktree) o novo agent herda de graça; o pedido pendente (o
  // último prompt do usuário) é reenviado sem redigitar.
  async function handleContinueWith(target: string) {
    if (!project || !isTauri()) return
    const convId = useChat.getState().activeId
    if (!convId) return
    await continueConversationWith({
      convId,
      projectId: project.id,
      projectPath: project.path,
      permissionMode: project.permissionMode,
      target,
      recordLessons: (ids) => {
        injectedLessonsRef.current[convId] = ids
      },
      onPrepared: () => setAtBottom(true),
    })
  }

  // "Planejar primeiro": plano aprovado → dispara o turno de EXECUÇÃO (turno
  // normal, SEM plan_first; o toggle da conversa desliga sozinho). claude/codex
  // continuam via resume (o contexto do plano já está na sessão); agy não tem
  // resume → o prompt embute o texto do plano aprovado.
  // As duas decisões do gate de plano: a regra mora em lib/planGate (carimbar,
  // tirar da fila, sair ou não do modo plano); daqui vai só o envio.
  function decidirPlano(id: string, decision: "approve" | "keepPlanning") {
    const convId = useChat.getState().activeId
    if (!convId) return
    decidePlanGateAndSend(convId, id, decision, (prompt) => {
      void handleSend(prompt, undefined, [], HUMANO)
    })
  }

  const hasConversation = items.length > 0
  const greeting = greetingFor(new Date())

  // Loop de feedback do Linear (M2): só no modo Linear e com projeto ativo.
  // Resolve o helper (Haiku) na mesma regra das sugestões: cfg do projeto vence,
  // senão o default global; null = destilação desligada (grava o texto cru).
  const feedback = useFeedbackDoFio(
    viewMode,
    project,
    conv,
    injectedLessonsRef,
  )
  const vista = vistaDaConversa({ temConversa: hasConversation, missao: missionStatus })

  return (
    <section className="relative flex h-full w-full min-w-0 flex-col bg-background">
      {vista.boasVindas && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-96 bg-[radial-gradient(62%_80%_at_50%_100%,var(--brass-soft),transparent_72%)] opacity-70" />
      )}

      {/* S3.3 — barra de presença: participantes + quem pilota. Recua enquanto
          a missão RODA (ela toma a tela) e volta quando ela termina. */}
      {vista.presenca && <PresenceBar />}

      {/* `@container`: a régua de turnos cabe pela largura do FIO, não da janela. */}
      <div
        ref={scrollRef} onScroll={onScroll}
        data-chat-scroll
        className="@container relative flex-1 overflow-x-hidden overflow-y-auto"
      >
        {/* Missão TOMA a tela: renderiza primeiro e suprime o empty state (antes
            ela flutuava como card sobre o "Boa tarde"). Com run em MEMÓRIA a
            timeline cobre a missão inteira — os marcos persistidos no fio
            (recordHistory do store/mission.ts) só aparecem SEM run (restart),
            senão o resumo sairia duplicado na mesma tela. */}
        {activeId && vista.timeline && <MissionTimeline convId={activeId} />}
        {/* Retomada (P1): card acima do fio quando o restart engoliu a missão —
            "Missão interrompida na fase X/N — Retomar · Descartar". */}
        {activeId && !vista.timeline && missionInterrupted && (
          <MissionResumeCard convId={activeId} />
        )}
        {/* Régua de turnos: ela mesma se ancora no gutter, FORA do fluxo. */}
        {vista.fio && hasConversation && (
          <TurnScrubber items={items} scrollRef={scrollRef} />
        )}
        {vista.fio ? (
          // key no activeId → fade só ao TROCAR de conversa, não a cada token.
          <div
            ref={contentRef}
            key={activeId ?? "none"}
            className="animate-in fade-in-0 duration-75 ease-out"
          >
            <ScaledMessageList
              items={items}
              running={running}
              finalizing={finalizing}
              startedAt={conv.startedAt}
              agent={conv.agent}
              presetId={conv.presetId}
              advising={conv.advising}
              stalledSince={conv.stalledSince}
              unseenDividerId={conv.unseenDividerId}
              // Só oferece o gesto quando ele funcionaria: com turno em voo o
              // envio da aprovação seria enfileirado e o cartão mentiria.
              onApprovePlan={
                running || finalizing ? undefined : (id) => decidirPlano(id, "approve")
              }
              onKeepPlanning={
                running || finalizing
                  ? undefined
                  : (id) => decidirPlano(id, "keepPlanning")
              }
              onStop={(tool) => {
                if (tool.managedProcess) {
                  void stopManagedProcess(tool.managedProcess.id).catch((error) =>
                    toast.error("Não consegui parar o processo.", {
                      description: String(error),
                    }),
                  )
                  return
                }
                void stopActiveConversation()
              }}
              onRetry={(tool) => {
                const label = presentTool(tool.name, tool.input).label
                // Retomar ≠ repetir (decisão 3 do deferred-work-plan): trabalho
                // diferido interrompido RETOMA de onde parou (cache do
                // workflow); relançar do zero pagaria os subagentes de novo.
                // running/completed não têm ação (o botão nem aparece).
                if (tool.deferred) {
                  const prompt = deferredResumePrompt(tool.deferred)
                  if (!prompt) return
                  const ok = window.confirm(
                    `Retomar “${deferredLabel(tool.deferred)}” de onde parou? O que já foi executado volta do cache, sem pagar de novo.`,
                  )
                  if (!ok) return
                  void handleSend(prompt, undefined, [], HUMANO)
                  return
                }
                if (tool.managedProcess) {
                  const ok = window.confirm(
                    `Repetir “${label}” como um novo processo gerenciado?`,
                  )
                  if (!ok) return
                  const restart =
                    tool.managedProcess.status === "orphaned"
                      ? startManagedProcess(tool.managedProcess)
                      : retryManagedProcess(tool.managedProcess.id)
                  void restart.catch((error) =>
                    toast.error("Não consegui repetir o processo.", {
                      description: String(error),
                    }),
                  )
                  return
                }
                const ok = window.confirm(
                  `Repetir “${label}” em um novo turno? A etapa pode produzir efeitos novamente.`,
                )
                if (!ok) return
                void handleSend(
                  `Repita somente a etapa “${label}” do turno anterior. Reavalie o estado atual antes de executar para não duplicar efeitos já aplicados.`,
                  undefined,
                  [],
                  HUMANO,
                )
              }}
              onContinueWith={(a) => void handleContinueWith(a)}
              feedback={feedback}
              reveal={
                transcriptReveal?.conversationId === activeId
                  ? transcriptReveal
                  : null
              }
            />
          </div>
        ) : !vista.boasVindas ? null : (
          <div className="mx-auto flex min-h-full max-w-[760px] flex-col items-center justify-center px-6 py-10">
            <div className="animate-cockpit-rise text-center">
              <Reticle className="mx-auto mb-6 size-8" />
              <h1 className="text-[38px] font-medium leading-[1.1] tracking-[-0.025em] text-foreground">
                {greeting}{userPreferences?.greetingWithName !== false && userProfile?.name.trim() ? `, ${userProfile.name.trim()}` : ""}.
              </h1>
              <p className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed text-muted-foreground">
                {project
                  ? `Descreva uma tarefa para seu time de agents em ${project.name}.`
                  : "Selecione ou adicione um projeto na barra lateral para começar."}
              </p>
              <p className="mt-4 text-[12px] text-muted-foreground/70">
                <kbd className="rounded border bg-secondary/50 px-1.5 py-0.5 font-mono text-[11px]">⌘K</kbd>{" "}
                para comandos e navegação
              </p>
            </div>
          </div>
        )}
        {activeId && fusionActive && <FusionBoard convId={activeId} />}
      </div>

      <div className="relative z-10 shrink-0 pb-7">
        {hasConversation && !atBottom && (
          <button
            onClick={scrollToBottom}
            className="absolute -top-2 left-1/2 z-20 flex -translate-x-1/2 -translate-y-full items-center gap-1.5 rounded-full border bg-card/95 px-3 py-1.5 text-[12px] text-foreground shadow-[var(--shadow-pop)] backdrop-blur transition-colors hover:bg-accent"
          >
            <ArrowDown className="size-3.5" /> Rolar pro fim
          </button>
        )}
        <RunStatusStack
          conversation={conv}
          detailInSidebar={planDetailedInSidebar}
        />
        {/* px-8 casa a borda do composer com o texto do transcript (que usa
            max-w-[760px] + px-8) — sem isso o composer estoura ~64px pras laterais. */}
        <div className="mx-auto max-w-[760px] px-8">
          {/* Interação pendente (aprovação/pergunta) CONTEXTUAL: pedidos da
              conversa VISÍVEL renderizam aqui, no fluxo (o toast global os
              suprime); os demais seguem no GlobalInteractionHost do App.tsx.
              Com a missão rodando o card mora na MissionTimeline (fase
              corrente) — não duplica aqui. */}
          {activeId && !missionInline && <InlineInteractions convId={activeId} />}
          <BannersDoComposer
            conv={conv}
            activeId={activeId}
            temProjeto={!!project}
            busy={running || finalizing || !!conv?.preparing}
            motorAusente={motorAusente}
            onReenviar={(prompt) =>
              void handleSend(prompt, undefined, [], AUTO_RESUME, activeId ?? undefined)
            }
            onLiberarPasta={handleAllowBlockedDir}
            onLigarNavegador={() => void handleStartRequiredBrowser()}
            ligarNavegadorEnvia={
              !!activeId && !!preflightRetryRef.current[activeId]
            }
            onRevisarMcp={() =>
              useApp.getState().setSettingsOpen(true, "integrations")
            }
            onContinuarSemMcp={
              activeId && preflightRetryRef.current[activeId]
                ? () => handlePreflightRecovery("omit-for-this-run")
                : undefined
            }
            onContinuarSoLendo={
              activeId && preflightRetryRef.current[activeId]
                ? () => handlePreflightRecovery("retry-readonly")
                : undefined
            }
          />
          <CommandConsole
            onSend={(text, cfg, attachments, onAccepted) =>
              void handleSend(
                text,
                cfg,
                attachments,
                HUMANO,
                undefined,
                onAccepted,
              )
            }
            disabled={!project}
            running={running}
            finalizing={finalizing}
            preparing={!!conv?.preparing}
            missionRunning={missionRunning}
            onStop={stopActiveConversation}
            onDispatchQueue={(id) => dispatchQueuedNow(id, project?.path, handleSend)}
            onOpenEspecialistas={() => setEspecialistasOpen(true)}
          />
        </div>
      </div>

      <Especialistas
        open={especialistasOpen}
        onOpenChange={setEspecialistasOpen}
      />
    </section>
  )
}

/** Card do "Planejar primeiro" (abaixo do último turno, acima do composer):
 *  o turno plan_first terminou e o plano proposto está logo acima no fio.
 *  Aprovar dispara o turno de execução; Descartar só limpa o estado (a conversa
 *  segue normal). Visual no padrão dos cards de decisão (InteractionHost). */
