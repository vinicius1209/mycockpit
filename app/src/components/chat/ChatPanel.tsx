import { useEffect, useRef } from "react"
import { modoEfetivoDoSpawn, permissaoDoSpawn } from "@/lib/sessionMode"
import { dispatchQueuedNow, drainQueued } from "@/components/chat/drenarFila"
import { stopActiveConversation } from "@/components/chat/filaComposer"
import { identidadeDoDespacho } from "@/components/chat/composerIdentity"
import { maybeScheduleAutoResume } from "@/components/chat/autoResumeAgendar"
import { ArrowDown } from "lucide-react"
import { avisar, mensagemDe } from "@/lib/avisos"
import { withNotasDoTurno } from "@/lib/fleet/promptCascade"
import { CommandConsole } from "@/components/chat/CommandConsole"
import { Especialistas } from "@/components/settings/Especialistas"
import { useEspecialistas } from "@/store/especialistas"
import { ScaledMessageList } from "@/components/chat/ScaledMessageList"
import { TurnScrubber } from "@/components/chat/TurnScrubber"
import { useChatScroll } from "@/components/chat/useChatScroll"
import { vistaDaConversa } from "@/components/chat/vistaDaConversa"
import { useFeedbackDoFio } from "@/components/chat/feedbackDoFio"
import { PresenceBar } from "@/components/chat/PresenceBar"
import { Reticle } from "@/components/common/Wordmark"
import { useActiveProject, useApp } from "@/store/app"
import {
  useChat,
  useActiveConv,
  executorItems,
  needsPersonaReinject,
} from "@/store/chat"
import { pareceresDoRascunho } from "@/lib/parecerTrazido"
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
import { dispatchBlockReason } from "@/lib/agents"
import { avisoDeMotorAusente } from "@/lib/detect"
import { BannersDoComposer } from "@/components/chat/BannersDoComposer"
import { assemblePromptCascade, prepareTurnTransplant, sessaoDeVolta } from "@/lib/turnHandoff"
import { decidePlanGateAndSend } from "@/lib/planGate"
import { extractPlanText, turnEndedOk } from "@/lib/planMode"
import {
  comMemoriaNoCorpo,
  fallbackDeResume,
} from "@/components/chat/memoriaDoTurno"
import { resolverCanalDoTurno } from "@/components/chat/canalDoTurno"
import { comRedeDePreparo } from "@/components/chat/redeDePreparo"
import { resolveSendTarget } from "@/lib/sendTarget"
import { notifyTurnEnd } from "@/lib/notify"
import type { Attachment } from "@/lib/attachments"
import { useAttachmentGc } from "@/hooks/useAttachmentGc"
import type { AgentRunConfig } from "@/lib/types"
import type { McpRecoveryKind, McpRunOverride } from "@/lib/tooling"
import { isTauri } from "@/lib/db"
import { buildLearningBlocks } from "@/lib/learning"
import { repetirEtapa } from "@/components/chat/repetirEtapa"
import {
  stopManagedProcess,
} from "@/lib/work"
import {
  hasAssistantReply,
  resolveFirstTurnPersona,
  warnPresetDrift,
} from "@/lib/presets"
import { findAppCommand } from "@/lib/slashCommands"
import {
  expandDraftWithSources,
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
import { consultarMencionados } from "@/components/chat/consultAdvisor"
import { greetingFor } from "@/components/chat/greeting"

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
  const transcriptReveal = useApp((s) => s.transcriptReveal)
  // Lições injetadas no ÚLTIMO turno desta conversa (p/ o 👍 reforçar — bump).
  // Ref keyed por convId; efêmero, não persiste (é só o alvo do reforço leve).
  const injectedLessonsRef = useRef<Record<string, string[]>>({})
  const preflightRetryRef = useRef<Record<string, PreflightRetryRequest>>({})

  const items = conv.items
  const running = conv.running
  const finalizing = conv.finalizing
  const activeId = useChat((s) => s.activeId)
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
  // Missão interrompida por restart: o boot da conversa acha o run-state
  // `running` no cwd da missão (com ou sem worktree) e oferece a retomada. O
  // ponteiro é por conversa, então não há oferta cruzada no mesmo cwd; a
  // retomada re-roda no cwd verdadeiro, sem criar worktree novo.
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

  // Libera a pasta detectada (config.toml e memória) e, só com a conversa
  // parada, reenvia o último pedido: o `--add-dir` é fixo no spawn. A decisão
  // e o prazo de cada metade moram em `lib/dirGate` (ADR-046).
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
      avisar.feito(
        result === "sent"
          ? `Navegador do ${project?.name ?? "projeto"} ligado. Enviando seu pedido.`
          : `Navegador do ${project?.name ?? "projeto"} ligado. Seu pedido continua pronto para enviar.`,
      )
    } catch (error) {
      avisar.erro(`Não consegui ligar o navegador do ${project?.name ?? "projeto"}.`, {
        origem: { conversa: activeId },
        detalhe: mensagemDe(error),
      })
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

  /** O envio de verdade; `handleSend`, abaixo, é a rede do carimbo de preparo. */
  async function despacharEnvio(
    /** Id DESTE turno. Nasce no invólucro, e não aqui, porque é ele quem
     *  precisa saber o que apagar se este preparo estourar no meio. */
    runId: string,
    text: string,
    cfg: AgentRunConfig | undefined,
    attachments: Attachment[],
    /** QUEM pediu este envio (ADR-046). Obrigatório: um caminho que não se
     *  declarava pôs retomada do app na fila do humano. */
    origem: OrigemDoEnvio,
    /** Conversa de ORIGEM. Quem re-entra tempo depois (drenagem da fila,
     *  auto-resume) passa o convId do turno que terminou, senão o envio cairia
     *  na conversa em foco. Sem alvo = envio manual, vale a de agora. */
    originConvId?: string,
    /** O composer só limpa texto e anexos quando o backend aceita o envio. */
    onAccepted?: () => void,
    mcpRecoveries: McpRunOverride[] = [],
  ) {
    if (origem.autor === "humano") followLatest()
    if (!isTauri()) {
      avisar.nota("O dispatch dos agents roda no app (bun run tauri dev)")
      return
    }
    // Alvo: conversa + projeto DONO; cwd, permissão e lições são do fio.
    // `conv`/`project` daqui SOMBREIAM os do componente de propósito.
    const target = resolveSendTarget(
      originConvId ?? useChat.getState().activeId,
      useChat.getState().byId,
      useApp.getState().projects,
    )
    // Conversa ainda carregando do disco: enviar criaria estado vazio, e o
    // persist apagaria o histórico.
    if (target.status === "loading") {
      avisar.nota("Conversa ainda carregando. Tenta de novo.")
      return
    }
    if (target.status !== "ok") return
    const { convId, conv, project } = target
    if (conv.preparing) {
      avisar.nota("As capacidades deste envio ainda estão sendo verificadas.")
      return
    }
    // Missão rodando nesta conversa: as fases compartilham o worktree; um envio
    // manual em paralelo embolaria o diff/handoff. Bloqueia (M2).
    if (useMission.getState().byConv[convId]?.status === "running") {
      avisar.nota("Missão em andamento. Pare a missão para enviar manualmente.")
      return
    }
    if (conv.corrupt) {
      avisar.erro("Histórico corrompido no banco. Envio bloqueado nesta conversa.")
      return
    }
    // Especialistas E1 — `@persona` no envio dispara parecer lateral read-only,
    // NÃO turno de executor. A regra inteira mora em `consultAdvisor.ts`.
    if (/(?:^|\s)@\S/.test(text)) {
      const consultou = await consultarMencionados({
        convId,
        project,
        sent: { text, attachments },
        aoAceitar: () => onAccepted?.(),
      })
      if (consultou) return
    }
    // Turno em voo: a mensagem SUA vai para a fila (o CLI precisa sair antes do
    // próximo run, e o fim do turno junta as pendentes num envio só). Retomada
    // de sistema não entra na fila do humano (`lib/sendGate`, ADR-046).
    if (retidoPorTurnoEmVoo(convId, text, attachments, origem)) {
      onAccepted?.()
      return
    }
    // Envio manual cancela o auto-resume agendado, que viraria resume
    // redundante; o próprio resume não se cancela.
    const fromAutoResume = ehAutoResume(origem)
    if (!fromAutoResume) useChat.getState().cancelAutoResume(convId)
    // novo run → invalida geração de sugestão pendente/em-voo desta conversa
    useChat.getState().invalidateSuggestions(convId)
    // Comando builtin do app é AÇÃO, interceptada antes da expansão de .md:
    // `/compactar` nunca segue como texto. Nativo ou recap é decisão por
    // capability em lib/compact.
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
    // ── Daqui para baixo este envio é um turno desta conversa ──
    // O `runId` e o carimbo de preparo nascem aqui (ADR-169): sem ele, os
    // segundos de persona, doutrina, lições e preflight passavam com a tela
    // imóvel, que lê como travamento. Não antes: acima o texto ainda pode virar
    // parecer, fila ou builtin, que não são turno. Toda saída daqui que não
    // nasce turno chama `clearPreparation`; o `finally` do `runAgent` cobre o
    // resto.
    useChat.getState().beginPreparation(convId, runId)
    // Conversa estabelecida trava no agent/modelo/esforço do 1º run. Pareceres
    // de especialista não contam como turno de executor: senão uma consulta
    // antes do 1º envio roubaria a injeção de persona e doutrina.
    const execItems = executorItems(conv.items)
    const locked = execItems.length > 0
    // agent/modelo/esforço do turno e as linhas de troca no fio: regra pura em
    // `identidadeDoDespacho` (composerIdentity).
    const despacho = identidadeDoDespacho({ locked, conv, cfg })
    const { isAgentSwitch, agentChangeNotice, modelChangeNotice, effortChangeNotice } = despacho
    let { agent, model, effort } = despacho
    // Persona do preset só no 1º turno. Fail-closed: preset quebrado aborta
    // antes do start, sem gastar turno.
    let personaBlock: string | null = null
    let personaStamp: { presetId: string; digest: string; name: string } | null =
      null
    // "o 1º prompt CHEGOU no CLI" — régua compartilhada pela persona e pela
    // doutrina (as duas só entram no turno inicial).
    const hasReply = hasAssistantReply(execItems)
    // Passar o volante força a re-injeção neste turno. Derivado de estado
    // persistido (needsPersonaReinject), então sobrevive a restart.
    const reinject = needsPersonaReinject(conv)
    const persona = await resolveFirstTurnPersona({
      locked,
      presetId: conv.presetId ?? null,
      // Travada sem resposta de assistant: o 1º run morreu antes da doutrina
      // chegar. Re-injeta em vez de perder a persona.
      hasReply,
      projectPath: project.path,
      forceReinject: reinject,
    })
    if (persona.status === "blocked") {
      useChat.getState().clearPreparation(convId, runId)
      avisar.erro(persona.error)
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
    // O volante passou para outro backend: a sessão nativa anterior não serve,
    // então sessão fresca com o contexto no envelope do revezamento. Mesmo
    // backend mantém o resume e só prepende a nova doutrina.
    const wheelSwitch =
      (reinject &&
        persona.status === "ready" &&
        agent !== conv.agent &&
        conv.sessionId != null) ||
      isAgentSwitch
    // Resume com preset carimbado: avisa o drift do digest (o turno segue).
    // Não se aplica na re-injeção, que re-carimba a versão atual.
    if (persona.status === "none" && locked && conv.presetId && conv.presetDigest) {
      void warnPresetDrift(convId, conv.presetId, conv.presetDigest, project.path)
    }
    // Motor ausente ou deslogado barra antes do start, em vez de erro cru no
    // fim. Vale o agent efetivo; auth incerta segue.
    const dispatchBlock = dispatchBlockReason(
      agent,
      useApp.getState().settings.detected ?? {},
    )
    if (dispatchBlock) {
      useChat.getState().clearPreparation(convId, runId)
      avisar.erro(dispatchBlock)
      return
    }
    // Outro envio pode ter começado um run durante o preflight: re-checa com
    // estado fresco pelo mesmo gate lá de cima. Nunca dois runs concorrentes.
    if (retidoPorTurnoEmVoo(convId, text, attachments, origem)) {
      useChat.getState().clearPreparation(convId, runId)
      onAccepted?.()
      return
    }
    // M3: modo é da CONVERSA (persistido); o `cfg` do composer vence quando
    // existe. Auto-resume nunca planeja (é continuação de execução).
    const planFirst =
      !fromAutoResume && (cfg?.planFirst ?? conv.sessionMode === "plan")
    // O modo da CONVERSA tem que chegar ao processo, e o sandbox decide pelo
    // mesmo valor (não o `project.permissionMode`).
    const permissaoDoTurno = permissaoDoSpawn(
      modoEfetivoDoSpawn(conv.sessionMode, project.permissionMode),
    )
    // sessão fresca quando o volante trocou de backend (o resume nativo do agent
    // anterior não vale pro novo); senão o resume normal da conversa.
    const sessionId = wheelSwitch ? sessaoDeVolta(conv, agent) : (conv.sessionId ?? null)
    // cwd = worktree isolado da conversa (v2.5), senão a pasta compartilhada do projeto.
    const cwd = conv.worktreePath ?? project.path
    // A mensagem só entra no fio quando o backend emitir run_manifest (o aceite
    // deste envio). Lições vão no PROMPT, nunca na bolha, sem depender de
    // `viewMode` (o turno pode terminar em outra superfície).
    // Comandos "/" por fonte e motor: só claude-code com comando de fonte claude
    // viaja cru; o resto expande aqui. A bolha mostra o que você digitou; sem
    // match, segue texto.
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
    // "Trazer pro Executor": o parecer entra como contexto do turno (bloco no
    // prompt, acima do pedido). Vem do rascunho, onde é visível e removível, e
    // só é consumido quando o envio é aceito.
    const broughtAdvice = pareceresDoRascunho(convId)
    // Por qual CANAL a instrução viaja (capability `systemChannel`). A regra e
    // o porquê moram em `canalDoTurno.ts`.
    const canal = await resolverCanalDoTurno({
      agent,
      projectPath: project.path,
      locked,
      hasReply,
      wheelSwitch,
      lastFingerprint: useChat.getState().byId[convId]?.injected?.doctrine,
      presetId: conv.presetId ?? null,
      presetDigest: conv.presetDigest ?? null,
      personaBlock,
    })
    personaBlock = canal.personaBlock
    const doctrineBlock = canal.doctrineBlock
    const systemPrompt = canal.systemPrompt
    // Os blocos se decidem ANTES da composição: se algum vai prepender, o
    // comando nativo cru ficaria morto atrás dele (doutrina + /review), então
    // o pedido re-expande com `embedded`.
    const hasPromptEnvelope = !!lessonsBlock || !!broughtAdvice || !!doctrineBlock || !!personaBlock
    const embeddedExpansion = await finalizeSlashExpansion(slashExpansion, text, project.path, agent, hasPromptEnvelope)
    let promptText = embeddedExpansion.text
    let instructionSources = embeddedExpansion.instructionSources
    ;({ prompt: promptText, attachments } = withNotasDoTurno(convId, project.id, conv.items, promptText, attachments))
    if (wheelSwitch) {
      const transplant = await prepareTurnTransplant({
        conv,
        convId,
        projectId: project.id,
        cwd,
        sourceAgent: conv.agent,
        targetAgent: agent,
        text,
        projectPath: project.path,
        runId,
        broughtAdvice,
        personaBlock,
        doctrineBlock,
        lessonsBlock,
      })
      promptText = transplant.promptText
      instructionSources = transplant.instructionSources
    } else {
      promptText = assemblePromptCascade({
        promptText,
        lessonsBlock,
        broughtAdvice,
        doctrineBlock,
        personaBlock,
      })
    }
    // A memória que viaja neste turno (corpo ou fallback, decidido por
    // CAPABILITY). A regra e o porquê moram em `memoriaDoTurno.ts`.
    const alvoDaMemoria = {
      convId,
      items: conv.items,
      agent,
      agentDoFio: conv.agent,
      cwd,
      sessionId,
      hasReply,
      wheelSwitch,
      modelo: conv.model ?? conv.reqModel,
    }
    promptText = await comMemoriaNoCorpo(promptText, alvoDaMemoria)
    const memoryFallback = await fallbackDeResume(alvoDaMemoria)
    const acceptance = createRunAcceptance({
      convId,
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
          agentChangeNotice,
          modelChangeNotice,
          effortChangeNotice,
          broughtAdvice,
          lessonIds: acceptedLessonIds,
          recordLessons: (ids) => {
            injectedLessonsRef.current[convId] = ids
          },
          doctrineFingerprint: canal.doctrineFingerprint,
          personaStamp,
          onAccepted,
        })
        if (conv.stagedAgent) {
          useChat.getState().stageAgent(convId, null)
        }
        if (convId === useChat.getState().activeId) setAtBottom(true)
      },
      onBlocked: (gate) => {
        preflightRetryRef.current[convId] = { text, cfg, attachments, onAccepted }
        useChat.getState().blockPreparation(convId, runId, gate)
      },
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
        avisar.erro("O turno não começou. O pedido continua no composer.")
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
      // Gate de plano: o turno plan_first terminou BEM → captura o texto final
      // do assistente (o plano) e arma o card "Aprovar e executar / Descartar".
      // Um envio manual posterior limpa o estado (start zera pendingPlan).
      if (acceptance.accepted() && planFirst) {
        const after = useChat.getState().byId[convId]
        const planText =
          after && turnEndedOk(after.items) ? extractPlanText(after.items) : null
        if (planText) useChat.getState().pushPlanGate(convId, planText)
      }
      // A fila deste turno vira um envio só (em lotes: builtin no meio quebra o
      // coalescimento). `convId` explícito porque o turno pode terminar com
      // você em outro projeto. Sem fila, agenda as sugestões.
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

  /** Invólucro do envio: cria o `runId` e passa pela rede que garante que
   *  nenhum carimbo de preparo sobrevive a uma exceção (ADR-169). */
  async function handleSend(
    text: string,
    cfg: AgentRunConfig | undefined,
    attachments: Attachment[],
    origem: OrigemDoEnvio,
    originConvId?: string,
    onAccepted?: () => void,
    mcpRecoveries: McpRunOverride[] = [],
  ) {
    const ok = await comRedeDePreparo(
      crypto.randomUUID(),
      {
        conversas: () => Object.keys(useChat.getState().byId),
        limpar: (id, run) => useChat.getState().clearPreparation(id, run),
      },
      (runId) =>
        despacharEnvio(
          runId,
          text,
          cfg,
          attachments,
          origem,
          originConvId,
          onAccepted,
          mcpRecoveries,
        ),
    )
    if (!ok) {
      avisar.erro("Não consegui preparar este envio. O pedido segue no composer.")
    }
  }

  /** Drena a fila em lotes. Builtin no meio é AÇÃO, e no join viraria texto
   *  morto: o lote vai até ele, o resto volta para a fila e drena no próximo
   *  fim de turno, na ordem. Sem builtin, um lote só com os anexos de todos
   *  (dedup por path). `true` = despachou algo. */

  // Revezamento imediato: continua a mesma conversa em outro agent e reenvia o
  // último pedido, sem exigir que você o redigite.
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

  // Plano aprovado dispara o turno de execução (sem plan_first). claude/codex
  // seguem por resume; agy não tem resume, então o prompt leva o plano. A regra
  // do gate mora em lib/planGate; daqui vai só o envio.
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
    <section data-coluna-da-conversa="" data-arrasto-alvo="conversa" className="relative flex h-full w-full min-w-0 flex-col bg-background">
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
          <TurnScrubber items={items} vivo={running || finalizing} scrollRef={scrollRef} />
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
                    avisar.erro("Não consegui parar o processo.", {
                      detalhe: String(error),
                    }),
                  )
                  return
                }
                void stopActiveConversation()
              }}
              onRetry={(tool) => void repetirEtapa(tool, handleSend)}
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
            onContinueNow={(agent) => void handleContinueWith(agent)}
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
            onOpenEspecialistas={() => useEspecialistas.getState().abrir()}
          />
        </div>
      </div>

      <Especialistas />
    </section>
  )
}

/** Card do "Planejar primeiro": aprovar dispara o turno de execução,
 *  descartar só limpa o estado. */
