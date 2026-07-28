import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowDown,
  ChevronDown,
  ClipboardList,
  FolderGit2,
  ListChecks,
  Loader2,
  Timer,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { deriveTasks } from "@/lib/tasks"
import { TaskChecklist } from "@/components/chat/TaskChecklist"
import { CommandConsole } from "@/components/chat/CommandConsole"
import { MessageList } from "@/components/chat/MessageList"
import { PresenceBar } from "@/components/chat/PresenceBar"
import { Reticle } from "@/components/common/Wordmark"
import { useActiveProject, useApp } from "@/store/app"
import {
  useChat,
  useActiveConv,
  executorItems,
  hasExecutorTurn,
  needsPersonaReinject,
} from "@/store/chat"
import { writeMycockpitConfig } from "@/lib/mycockpit"
import { useFusion } from "@/store/fusion"
import { FusionBoard } from "@/components/fusion/FusionBoard"
import { useMission } from "@/store/mission"
import {
  MissionResumeCard,
  MissionTimeline,
  missionHostsInline,
} from "@/components/mission/MissionTimeline"
import { InlineInteractions } from "@/components/chat/InteractionHost"
import { runAgent, cancelAgent, agentLabel } from "@/lib/agent"
import { dispatchBlockReason } from "@/lib/agents"
import { buildHandoff } from "@/lib/handoff"
import { buildExecutionPrompt, extractPlanText, turnEndedOk } from "@/lib/planMode"
import {
  renderTranscript,
  exportConvContext,
  buildMemoryPrompt,
  buildResumeFallback,
  shouldAttachResumeFallback,
} from "@/lib/transcript"
import { wantsAutoResume } from "@/lib/autoResume"
import { resolveSendTarget } from "@/lib/sendTarget"
import { notifyTurnEnd } from "@/lib/notify"
import type { Attachment } from "@/lib/attachments"
import { gcAttachments } from "@/lib/attachments"
import { BYTES_PER_MB } from "@/lib/format"
import type { AgentRunConfig } from "@/lib/types"
import { isTauri, listConvRefs } from "@/lib/db"
import {
  buildLearningBlocks,
  markLessonsUsed,
  reinforceLessons,
  distillCandidate,
  saveLesson,
} from "@/lib/learning"
import {
  hasAssistantReply,
  personaHandoffBlock,
  resolveFirstTurnPersona,
  warnPresetDrift,
} from "@/lib/presets"
import {
  buildDoctrineBlock,
  readDoctrine,
  shouldInjectDoctrine,
} from "@/lib/doctrine"
import { serializeContext } from "@/lib/fusion"
import { listAgentDefs, type AgentDef } from "@/lib/agentDefs"
import {
  buildAdviceItem,
  buildAdvisorPrompt,
  detectAdvisorMention,
  resolveAdvisor,
  runAdvisor,
} from "@/lib/advisor"

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
  const scrollRef = useRef<HTMLDivElement>(null)
  // Lições injetadas no ÚLTIMO turno desta conversa (p/ o 👍 reforçar — bump).
  // Ref keyed por convId; efêmero, não persiste (é só o alvo do reforço leve).
  const injectedLessonsRef = useRef<Record<string, string[]>>({})
  // segue o fim só quando você já está lá; se subiu pra ler, não puxa de volta.
  const [atBottom, setAtBottom] = useState(true)

  function onScroll() {
    const el = scrollRef.current
    if (!el) return
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }
  function scrollToBottom() {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
    setAtBottom(true)
  }

  const items = conv.items
  const running = conv.running
  const finalizing = conv.finalizing
  const activeId = useChat((s) => s.activeId)
  const fusionActive = useFusion((s) => (activeId ? !!s.byConv[activeId] : false))
  const missionActive = useMission((s) =>
    activeId ? !!s.byConv[activeId] : false,
  )
  // Missão RODANDO nesta conversa: trava o envio manual (as fases rodam no mesmo
  // worktree; um run paralelo embolaria o diff/handoff — aresta do M2).
  const missionRunning = useMission((s) =>
    activeId ? s.byConv[activeId]?.status === "running" : false,
  )
  // Aprovações contextuais: a MissionTimeline hospeda o card inline enquanto o
  // bloco da fase corrente está na tela; fora disso (linear/gate/done) o card
  // entra aqui, acima do composer. Nunca os dois — mesma régua nos dois lados.
  const missionInline = useMission((s) =>
    missionHostsInline(activeId ? s.byConv[activeId] : null),
  )
  // P1 confiabilidade: missão interrompida por restart — o boot da conversa
  // detecta o run-state.json `running` no worktree e oferece o card de
  // retomada (só conversas com worktree: o disco da missão é o worktree).
  const missionInterrupted = useMission((s) =>
    activeId ? !!s.interrupted[activeId] : false,
  )
  const detectInterrupted = useMission((s) => s.detectInterrupted)
  const worktreePath = conv?.worktreePath ?? null
  useEffect(() => {
    if (!activeId || !worktreePath) return
    void detectInterrupted(activeId, worktreePath)
  }, [activeId, worktreePath, missionActive, detectInterrupted])

  // Checklist viva (P2): faixa fixa acima do composer enquanto o plano anda,
  // o olho já mora aqui embaixo durante o run. Colapsada mostra a task atual.
  const tasks = useMemo(() => deriveTasks(items), [items])
  const doneTasks = tasks.filter((t) => t.status === "completed").length
  const openTasks = tasks.length - doneTasks
  const currentTask =
    tasks.find((t) => t.status === "in_progress") ??
    tasks.find((t) => t.status === "pending")
  const [planOpen, setPlanOpen] = useState(false)
  const showPlan = tasks.length > 0 && (running || openTasks > 0)

  // Abre o projeto ao trocar: carrega as conversas e a mais recente (Sprint 2).
  const projectId = project?.id ?? null
  useEffect(() => {
    void openProject(projectId)
  }, [projectId, openProject])

  // Autoscroll conforme a conversa cresce, MAS só se você já está no fim (senão
  // ler mensagens antigas seria interrompido a cada evento). O "tick" do
  // streaming entra nas deps: items.length não muda a cada text_delta, sem ele
  // o follow morria em respostas longas (achado do aval).
  const last = items[items.length - 1]
  const streamTick = last && last.kind === "text" ? last.text.length : 0
  useEffect(() => {
    const el = scrollRef.current
    if (el && atBottom) el.scrollTo({ top: el.scrollHeight, behavior: "auto" })
  }, [items.length, streamTick, running, atBottom])

  // Ao trocar de conversa, volta a seguir o fim (a nova abre no rodapé).
  useEffect(() => {
    setAtBottom(true)
  }, [activeId])

  // ⌘K (ou outra UI) pode enfileirar um prompt → dispara aqui.
  const queuedPrompt = useChat((s) => s.queuedPrompt)
  useEffect(() => {
    if (!queuedPrompt) return
    const text = queuedPrompt
    useChat.getState().queuePrompt(null)
    void handleSend(text)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedPrompt])

  // GC dos anexos no boot (throttled 1×/24h no backend). F1: só roda se as refs
  // vierem não-null (null = falha → não arrisca o orphan-sweep com lista vazia).
  useEffect(() => {
    if (!isTauri()) return
    void (async () => {
      const refs = await listConvRefs()
      if (!refs) return
      try {
        const r = await gcAttachments(refs)
        if (r.freed_bytes > 0) {
          toast(
            `Cache de anexos: ${(r.freed_bytes / BYTES_PER_MB).toFixed(1)} MB liberados`,
          )
        }
      } catch {
        // GC é best-effort
      }
    })()
  }, [])

  // Caso 2, restaura uma disputa de Fusion PENDENTE (esperando decisão) ao abrir
  // a conversa, pra não perder o que já rodou + foi pago.
  useEffect(() => {
    if (!activeId || !isTauri()) return
    void useFusion.getState().restorePending(activeId)
  }, [activeId])

  // destinationId = o agent escolhido no seletor (v0.2-α: o seam que descartava
  // o destino agora é threadado até o runAgent). Default 'claude-code'.
  // Phase 3 do extra_dirs: libera a pasta detectada (persiste no config.toml +
  // memória) e REENVIA o último pedido do usuário — o novo turno nasce com
  // --add-dir (o gate de diretório é fixo no spawn). Só resolve entre turnos.
  async function allowBlockedDir(dir: string) {
    if (!project) return
    const app = useApp.getState()
    const cur = app.mycockpit[project.id]
    if (cur?.extraDirs?.includes(dir)) {
      // já liberado (corrida) → só limpa o aviso.
      if (activeId) useChat.getState().clearBlockedDir(activeId)
      return
    }
    const next = [...(cur?.extraDirs ?? []), dir]
    try {
      await writeMycockpitConfig(project.path, { extraDirs: next })
    } catch {
      toast.error("Não consegui salvar a pasta permitida no config.")
      return
    }
    app.setMycockpit(project.id, {
      exists: true,
      permission: cur?.permission ?? project.permissionMode ?? "padrao",
      helper: cur?.helper ?? "haiku",
      mode: cur?.mode ?? "linear",
      extraDirs: next,
    })
    if (activeId) useChat.getState().clearBlockedDir(activeId)
    // reenvia o último pedido do usuário (novo turno, agora com acesso à pasta).
    const items = useChat.getState().byId[activeId ?? ""]?.items ?? []
    let lastUser = ""
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i]
      if (it.kind === "user") {
        lastUser = it.text
        break
      }
    }
    toast.success("Pasta liberada. Reenviando o pedido…")
    if (lastUser) void handleSend(lastUser)
  }

  async function handleSend(
    text: string,
    cfg?: AgentRunConfig,
    attachments: Attachment[] = [],
    fromAutoResume = false,
    /** Conversa de ORIGEM. Quem RE-ENTRA (drenagem da fila, auto-resume) passa o
     *  convId do turno que terminou: esses envios disparam tempo depois e, lendo
     *  o foco, a fila digitada no projeto X ia parar na conversa aberta do
     *  projeto Y. Sem alvo = envio manual, vale a conversa em foco AGORA. */
    originConvId?: string,
  ) {
    if (!isTauri()) {
      toast("O dispatch dos agents roda no app (bun run tauri dev)")
      return
    }
    // Alvo do envio: conversa + o projeto DONO dela (conv.projectId), nunca o
    // projeto em foco — cwd, permissão e lições são os do fio, não os da tela.
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
        await handleConsult(convId, resolved.def, mention.question, project)
        return
      }
    }
    // Rodando/finalizando: em vez de descartar, ENFILEIRA. O CLI precisa sair de
    // fato (flush da sessão) antes do próximo run; ao terminar, o finally junta as
    // pendentes num único envio (resume). Coalescer evita N resumes em sequência.
    if (conv.running || conv.finalizing) {
      useChat.getState().enqueue(convId, text, attachments)
      return
    }
    // Um envio MANUAL (digitado/⌘K/fila) supersede um auto-resume agendado: cancela
    // o timer pra não disparar um resume redundante em cima do run que começa agora.
    // Se ESTE send É o próprio resume, não cancela (o loop já limpou/regravou o estado).
    if (!fromAutoResume) useChat.getState().cancelAutoResume(convId)
    // novo run → invalida geração de sugestão pendente/em-voo desta conversa
    useChat.getState().invalidateSuggestions(convId)
    // conversa estabelecida trava no agent/modelo/effort do 1º run; nova usa o
    // seletor. Pareceres de conselheiro (advice) são laterais e NÃO contam como
    // turno de executor — senão uma consulta antes do 1º envio "travaria" a
    // conversa e roubaria a injeção de persona/doutrina do turno inicial (E1).
    const execItems = executorItems(conv.items)
    const locked = execItems.length > 0
    let agent = locked ? conv.agent : (cfg?.agent ?? "claude-code")
    let model = locked ? conv.reqModel : (cfg?.model ?? null)
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
    // sessão fresca + o contexto do fio viaja no preâmbulo (mesma disciplina do
    // revezamento, buildHandoff). Piloto de MESMO backend mantém o resume nativo:
    // só a nova doutrina é prependida na sessão que continua.
    const wheelSwitch =
      reinject &&
      persona.status === "ready" &&
      agent !== conv.agent &&
      conv.sessionId != null
    const wheelHandoff = wheelSwitch ? buildHandoff(execItems) : null
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
    // FRESCO; run em andamento → ENFILEIRA (mesmo destino da guarda lá em
    // cima), nunca um segundo run concorrente.
    const fresh = useChat.getState().byId[convId]
    if (fresh?.running || fresh?.finalizing) {
      useChat.getState().enqueue(convId, text, attachments)
      return
    }
    // "Planejar primeiro" é POR TURNO (não trava com a conv): o cfg do composer
    // carrega o toggle; envios sem cfg (⌘K, fila coalescida) leem o toggle da
    // conversa. Auto-resume nunca planeja (é continuação de execução).
    const planFirst = !fromAutoResume && (cfg?.planFirst ?? !!conv.planFirst)
    const runId = crypto.randomUUID()
    // sessão fresca quando o volante trocou de backend (o resume nativo do agent
    // anterior não vale pro novo); senão o resume normal da conversa.
    const sessionId = wheelSwitch ? null : (conv.sessionId ?? null)
    // cwd = worktree isolado da conversa (v2.5), senão a pasta compartilhada do projeto.
    const cwd = conv.worktreePath ?? project.path
    // Sprint 4, o run escreve em byId[convId] mesmo se o usuário trocar de aba.
    useChat.getState().start(convId, text, runId, agent, model, effort, attachments)
    // S3.2 — troca de volante entre backends: zera sessão + resolvido + anel do
    // agent anterior DO STORE (o start os preserva) — mesma higiene do
    // beginTransplant (achado #3), senão um run que falhe antes do novo
    // `session` deixa o modelo/sessão do backend antigo colado no novo.
    if (wheelSwitch) useChat.getState().dropNativeSession(convId)
    // S3.3 — persona injetada NESTE run: carimba preset_id + digest da versão
    // exata (a base do drift do S3.4). AWAIT (D4): falha do write avisa, não
    // some em silêncio.
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
    // ao enviar, pula pro fim (ver a própria mensagem) — só se o fio ALVO é o
    // que está na tela (envio em background não mexe na rolagem de quem olha).
    if (convId === useChat.getState().activeId) setAtBottom(true)
    // M2: injeta as lições relevantes (projeto + globais) no PROMPT, não na
    // bolha visível. Best-effort: qualquer falha envia sem o bloco.
    //
    // NÃO condicionar a `viewMode`: este handleSend É o turno linear (Fusion e
    // Mission têm dispatchers próprios e nunca passam por aqui), então o
    // viewMode era só um proxy — e um proxy ERRADO, porque é valor de TELA
    // capturado no closure da render. Enfileirar na conversa A, ir pro
    // Escritório e deixar o turno terminar drenava a fila no alvo certo (a
    // frente do sendTarget consertou isso) mas SEM as lições, só porque a tela
    // tinha mudado. O `sendFromDesk` do office já injetava sem condição — agora
    // os dois caminhos concordam.
    let promptText = text
    {
      try {
        const blocks = await buildLearningBlocks(project.id, text, false)
        if (blocks.lessons) {
          promptText = `${blocks.lessons}\n\n---\n\n${text}`
          injectedLessonsRef.current[convId] = blocks.lessonIds
          void markLessonsUsed(blocks.lessonIds)
        } else {
          injectedLessonsRef.current[convId] = []
        }
      } catch {
        injectedLessonsRef.current[convId] = []
      }
    }
    // Especialistas E1 — "Trazer pro Executor": o parecer que você trouxe entra
    // como CONTEXTO deste turno (bloco no prompt, não bolha), acima do pedido.
    // Consumido uma vez (takePendingAdvice limpa).
    const broughtAdvice = useChat.getState().takePendingAdvice(convId)
    if (broughtAdvice) {
      promptText = `${broughtAdvice}\n\n---\n\n${promptText}`
    }
    // DOUTRINA do projeto (.mycockpit/instructions.md) — a instrução agnóstica:
    // o app injeta, então vale igual em claude, codex e agy. Entra DEPOIS da
    // persona e ANTES das lições na cascata final do prompt: quem você é → as
    // regras deste projeto → o que já aprendemos → o pedido. Best-effort: sem
    // arquivo, ou com falha de disco, o envio segue sem o bloco.
    if (shouldInjectDoctrine(agent, locked, hasReply)) {
      const block = buildDoctrineBlock((await readDoctrine(project.path)).content)
      if (block) promptText = `${block}\n\n${promptText}`
    }
    // S3.2 — troca de volante com sessão fresca (backend novo): o fio até aqui
    // viaja como preâmbulo, senão a nova persona assumiria sem memória do que já
    // foi conversado (mesmo cano do revezamento).
    if (wheelHandoff) {
      promptText = `${wheelHandoff}\n\n---\n\n${promptText}`
    }
    // persona vem ANTES de tudo no prompt (identidade primeiro, depois a
    // doutrina, as lições e o pedido) — mesmo cano do bloco de lições.
    if (personaBlock) {
      promptText = `${personaBlock}\n\n${promptText}`
    }
    // agy NÃO tem resume (todo turno é sessão fresca): injeta a memória da
    // conversa no prompt — recap curto (~4k) + exporta o transcript pleno pro
    // arquivo do projeto e aponta o caminho (o agent PUXA se precisar de mais).
    // claude/codex não ganham isso em turno normal (resume nativo já resolve).
    // Best-effort de ponta a ponta: falha no export → só o recap.
    if (agent === "agy" && hasExecutorTurn(conv.items)) {
      let pointer: string | null = null
      try {
        // exporta relativo ao cwd EFETIVO (worktree ou projeto), pro caminho
        // relativo resolver de onde o agent roda.
        const md = renderTranscript(conv.items, { agent: conv.agent })
        pointer = await exportConvContext(cwd, convId, md)
      } catch {
        pointer = null
      }
      promptText = buildMemoryPrompt(conv.items, pointer, promptText)
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
        project.permissionMode ?? "padrao",
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
      // Gate de plano: o turno plan_first terminou BEM → captura o texto final
      // do assistente (o plano) e arma o card "Aprovar e executar / Descartar".
      // Um envio manual posterior limpa o estado (start zera pendingPlan).
      if (planFirst) {
        const after = useChat.getState().byId[convId]
        const planText =
          after && turnEndedOk(after.items) ? extractPlanText(after.items) : null
        if (planText) useChat.getState().setPendingPlan(convId, planText)
      }
      // Fila: junta as mensagens digitadas durante o turno num ÚNICO envio (resume),
      // textos coalescidos + anexos de todos os itens (dedup por path — o dedup
      // por hash do backend pode repetir o mesmo blob em itens diferentes).
      // Se há fila, o próximo turno já começa; senão, agenda as sugestões.
      // `convId` explícito: a fila é DESTA conversa e o turno pode terminar com
      // o usuário já noutro projeto — sem o alvo, o envio caía no fio em foco.
      const pending = useChat.getState().dequeueQueued(convId)
      if (pending.length > 0) {
        const texts = pending.map((q) => q.text).filter(Boolean)
        const atts = [
          ...new Map(
            pending.flatMap((q) => q.attachments).map((a) => [a.path, a]),
          ).values(),
        ]
        void handleSend(texts.join("\n\n"), undefined, atts, false, convId)
      } else if (maybeScheduleAutoResume(convId, agent)) {
        // turno bateu num rate limit / "vou tentar depois" e o auto-resume está
        // ligado: agendamos um reenvio automático (banner mostra o countdown).
        // Não notifica/sugere ainda — o loop ainda não terminou de verdade.
      } else {
        // turno (e a fila) concluídos → notifica + sugestões.
        notifyTurnEnd(convId, agent)
        useChat.getState().scheduleSuggestions(convId)
      }
    }
  }

  // Especialistas E1 — consulta de conselheiro: monta o prompt (persona +
  // contexto serializado da conversa ATUAL + pergunta), dispara pelo runAgent no
  // modo LEITURA (read-only, nada tocado no disco) e anexa UM item de parecer,
  // carimbado com persona id+version+digest. NÃO passa pelo reducer do executor.
  async function handleConsult(
    convId: string,
    def: AgentDef,
    question: string,
    proj: { path: string },
  ) {
    useChat.getState().setAdvising(convId, { id: def.id, name: def.name })
    try {
      const conv = useChat.getState().byId[convId]
      const cwd = conv?.worktreePath ?? proj.path
      // contexto serializado da conversa atual (reusa o serializeContext do
      // Fusion — o mesmo preâmbulo enriquecido, não reimplementa).
      const context = serializeContext(conv?.items ?? [])
      const prompt = buildAdvisorPrompt({ def, context, question })
      const res = await runAdvisor({ def, prompt, cwd })
      if (!res.text) {
        toast.error(
          res.error
            ? `O parecer de ${def.name} falhou: ${res.error}`
            : `O parecer de ${def.name} veio vazio.`,
        )
        return
      }
      await useChat
        .getState()
        .appendItems(convId, [buildAdviceItem(def, question, res.text)])
    } catch (e) {
      toast.error(
        typeof e === "string" ? e : `Não consegui consultar ${def.name}.`,
      )
    } finally {
      useChat.getState().setAdvising(convId, null)
    }
  }

  // Auto-revive: se o turno recém-encerrado pede resume (limite da CLI OU o texto
  // final combina padrões de retry/espera) E a opção está ligada, agenda um
  // reenvio automático via setTimeout. O prompt reusa buildHandoff (achata o fio)
  // + um "continue a tarefa pendente". Cada resume é um run PAGO → o cap
  // (autoResumeMaxTries) protege; o banner mostra quantas tentativas restam.
  // Retorna true se agendou (o caller pula notify/sugestões).
  function maybeScheduleAutoResume(convId: string, agent: string): boolean {
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
      // alvo explícito: o timer dispara minutos depois, o foco já pode ser outro.
      void handleSend(prompt, undefined, [], true, convId)
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

  // Revezamento: continua a MESMA conversa em OUTRO agent (limite/erro do
  // atual). O contexto vai por preâmbulo determinístico (handoff, tail-biased);
  // o disco (cwd/worktree) o novo agent herda de graça; o pedido pendente (o
  // último prompt do usuário) é reenviado sem redigitar.
  async function handleContinueWith(target: string) {
    if (!project || !isTauri()) return
    const convId = useChat.getState().activeId
    if (!convId) return
    const conv = useChat.getState().byId[convId]
    if (!conv || conv.running || conv.finalizing || conv.corrupt) return
    // F-A — mesma guarda de availability do handleSend: revezar pra CLI
    // ausente/deslogada só transplanta a conversa pra um erro cru.
    const dispatchBlock = dispatchBlockReason(
      target,
      useApp.getState().settings.detected ?? {},
    )
    if (dispatchBlock) {
      toast.error(dispatchBlock)
      return
    }
    let lastUserIdx = -1
    for (let i = conv.items.length - 1; i >= 0; i--) {
      if (conv.items[i].kind === "user") {
        lastUserIdx = i
        break
      }
    }
    const lastUser = lastUserIdx >= 0 ? conv.items[lastUserIdx] : null
    const pending = lastUser && lastUser.kind === "user" ? lastUser.text : ""
    if (!pending) return
    // o handoff exclui o pedido pendente (ele volta destacado no fim do prompt)
    const preamble = buildHandoff(conv.items.slice(0, lastUserIdx))
    // D3 — conversa carimbada: a doutrina viaja no transplant (sessão fresca
    // no novo agent = a persona do 1º turno NÃO está lá; sem isso o agent
    // assume "pelado" com a mesa ainda dizendo "como X").
    const personaBlock = await personaHandoffBlock(
      conv.presetId,
      conv.presetDigest,
      project.path,
    )
    // A doutrina do projeto também viaja: o transplante é uma sessão FRESCA,
    // muitas vezes numa CLI diferente da que começou a conversa — sem o bloco,
    // o agent que assume seria o único do fio a trabalhar sem as regras.
    const doctrine = buildDoctrineBlock((await readDoctrine(project.path)).content)
    // corrida do await (mesma classe do D2): re-checa antes de transplantar.
    const fresh = useChat.getState().byId[convId]
    if (!fresh || fresh.running || fresh.finalizing) return
    const prompt = `${personaBlock ? `${personaBlock}\n\n` : ""}${doctrine ? `${doctrine}\n\n` : ""}${preamble}\n\n---\n\nPedido pendente (responda a ele agora):\n${pending}`
    const runId = crypto.randomUUID()
    useChat.getState().invalidateSuggestions(convId)
    useChat.getState().handleEvent(convId, {
      type: "notice",
      message: `revezamento: continuando no ${agentLabel(target)}`,
    })
    useChat.getState().beginTransplant(convId, runId, target)
    setAtBottom(true)
    const cwd = conv.worktreePath ?? project.path
    try {
      await runAgent(
        runId,
        convId,
        target,
        null,
        null,
        prompt,
        cwd,
        null, // sessão fresca no novo agent
        project.permissionMode ?? "padrao",
        [],
        (e) => useChat.getState().handleEvent(convId, e),
      )
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha no revezamento")
    } finally {
      useChat.getState().finish(convId)
      void useChat.getState().persist(convId)
      notifyTurnEnd(convId, target)
      useChat.getState().scheduleSuggestions(convId)
    }
  }

  // "Planejar primeiro": plano aprovado → dispara o turno de EXECUÇÃO (turno
  // normal, SEM plan_first; o toggle da conversa desliga sozinho). claude/codex
  // continuam via resume (o contexto do plano já está na sessão); agy não tem
  // resume → o prompt embute o texto do plano aprovado.
  function handleApprovePlan() {
    const convId = useChat.getState().activeId
    if (!convId) return
    const c = useChat.getState().byId[convId]
    if (!c?.pendingPlan || c.running || c.finalizing) return
    const prompt = buildExecutionPrompt(c.agent, c.pendingPlan.text)
    useChat.getState().clearPendingPlan(convId)
    useChat.getState().setPlanFirst(convId, false)
    void handleSend(prompt)
  }

  function handleStop() {
    const convId = useChat.getState().activeId
    if (!convId) return
    // parar o run também cancela qualquer auto-resume agendado (intenção explícita).
    useChat.getState().cancelAutoResume(convId)
    // Disputa Fusion em voo: o Stop era no-op silencioso (runId null) enquanto
    // N candidatos queimavam dinheiro. Agora aborta a disputa de verdade.
    const fusion = useFusion.getState().byConv[convId]
    if (fusion && (fusion.phase === "running" || fusion.phase === "judging")) {
      useFusion.getState().abort(convId)
      toast("Disputa cancelada")
      return
    }
    const runId = useChat.getState().byId[convId]?.runId
    if (runId) void cancelAgent(runId)
  }

  const hasConversation = items.length > 0
  const greeting = greetingFor(new Date())

  // Loop de feedback do Linear (M2): só no modo Linear e com projeto ativo.
  // Resolve o helper (Haiku) na mesma regra das sugestões: cfg do projeto vence,
  // senão o default global; null = destilação desligada (grava o texto cru).
  const feedback = useMemo(() => {
    if (viewMode !== "linear" || !project) return null
    const cfg = useApp.getState().mycockpit[project.id]
    const helperModel = cfg
      ? cfg.helper
      : useApp.getState().settings.helperModel
    const cwd = conv?.worktreePath ?? project.path
    return {
      onThumbUp: async () => {
        const convId = useChat.getState().activeId
        if (!convId) return
        const ids = injectedLessonsRef.current[convId] ?? []
        // 👍 = REFORÇO (bumpa `reinforced`, o sinal que o curador lê). O `uses`
        // já foi bumpado na INJEÇÃO (acima) — bumpar de novo aqui era o bug que
        // acelerava o rebaixamento da lição boa (uses subia sem reinforced).
        if (ids.length) await reinforceLessons(ids)
      },
      distill: (agentTurn: string, userNote: string) =>
        distillCandidate({ cwd, helperModel, agentTurn, userNote }),
      save: (rule: string, scope: "global" | "project") =>
        saveLesson({ projectId: project.id, rule, scope }),
    }
    // conv.worktreePath entra p/ o cwd acompanhar o worktree da conversa ativa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, project?.id, project?.path, conv?.worktreePath])

  return (
    <section className="relative flex h-full w-full min-w-0 flex-col bg-background">
      {!hasConversation && !missionActive && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-96 bg-[radial-gradient(62%_80%_at_50%_100%,var(--brass-soft),transparent_72%)] opacity-70" />
      )}

      {/* S3.3 — barra de presença: participantes + quem pilota. Só aparece com
          conversa aberta e fora da missão (que toma a tela). Derivada, some
          sozinha em conversa crua sem preset nem convidados. */}
      {hasConversation && !missionActive && <PresenceBar />}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="relative flex-1 overflow-x-hidden overflow-y-auto"
      >
        {/* Missão TOMA a tela: renderiza primeiro e suprime o empty state (antes
            ela flutuava como card sobre o "Boa tarde"). Com run em MEMÓRIA a
            timeline cobre a missão inteira — os marcos persistidos no fio
            (recordHistory do store/mission.ts) só aparecem SEM run (restart),
            senão o resumo sairia duplicado na mesma tela. */}
        {activeId && missionActive && <MissionTimeline convId={activeId} />}
        {/* Retomada (P1): card acima do fio quando o restart engoliu a missão —
            "Missão interrompida na fase X/N — Retomar · Descartar". */}
        {activeId && !missionActive && missionInterrupted && (
          <MissionResumeCard convId={activeId} />
        )}
        {hasConversation && !missionActive ? (
          // key no activeId → o fade só replica ao TROCAR de conversa (não a cada
          // token do streaming, que mantém o mesmo activeId).
          <div
            key={activeId ?? "none"}
            className="animate-in fade-in-0 duration-300 ease-out"
          >
            <MessageList
              items={items}
              running={running}
              finalizing={finalizing}
              startedAt={conv.startedAt}
              agent={conv.agent}
              advising={conv.advising}
              onContinueWith={(a) => void handleContinueWith(a)}
              feedback={feedback}
            />
          </div>
        ) : missionActive ? null : (
          <div className="mx-auto flex min-h-full max-w-[760px] flex-col items-center justify-center px-6 py-10">
            <div className="animate-cockpit-rise text-center">
              <Reticle className="mx-auto mb-6 size-8" />
              <h1 className="text-[38px] font-medium leading-[1.1] tracking-[-0.025em] text-foreground">
                {greeting}, Vinícius.
              </h1>
              <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
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
        {showPlan && (
          <div className="mx-auto mb-2 max-w-[760px] px-8">
            <div className="overflow-hidden rounded-lg border bg-card/95 shadow-[var(--shadow-pop)]">
              <button
                onClick={() => setPlanOpen((o) => !o)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px]"
              >
                {openTasks > 0 && running ? (
                  <Loader2 className="size-3.5 shrink-0 animate-spin text-brass" />
                ) : (
                  <ListChecks className="size-3.5 shrink-0 text-brass" />
                )}
                <span className="truncate text-foreground/85">
                  {currentTask
                    ? currentTask.status === "in_progress" && currentTask.active
                      ? currentTask.active
                      : currentTask.title
                    : "Plano concluído"}
                </span>
                <span className="ml-auto shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {doneTasks}/{tasks.length}
                </span>
                <ChevronDown
                  className={cn(
                    "size-3.5 shrink-0 text-muted-foreground transition-transform",
                    planOpen && "rotate-180",
                  )}
                />
              </button>
              {planOpen && (
                <div className="max-h-56 overflow-y-auto border-t px-3 py-2">
                  <TaskChecklist tasks={tasks} dense />
                </div>
              )}
            </div>
          </div>
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
          {conv?.pendingPlan && !running && !finalizing && (
            <PlanPendingCard
              onApprove={handleApprovePlan}
              onDiscard={() =>
                activeId && useChat.getState().clearPendingPlan(activeId)
              }
            />
          )}
          {conv?.autoResume && (
            <AutoResumeBanner
              nextAt={conv.autoResume.nextAt}
              tries={conv.autoResume.tries}
              maxTries={conv.autoResume.maxTries}
              onCancel={() =>
                activeId && useChat.getState().cancelAutoResume(activeId)
              }
              onResumeNow={() => {
                if (!activeId) return
                const c = useChat.getState().byId[activeId]
                if (!c?.autoResume) return
                clearTimeout(c.autoResume.timer)
                // dispara imediatamente reprogramando p/ agora (0ms).
                useChat.getState().setAutoResume(activeId, {
                  ...c.autoResume,
                  nextAt: Date.now(),
                })
                const preamble = buildHandoff(c.items)
                const prompt = `${preamble}\n\n---\n\nO turno anterior parou num limite de uso/espera. Continue a tarefa pendente de onde parou (não repita o que já foi feito).`
                void handleSend(prompt, undefined, [], true, activeId)
              }}
            />
          )}
          {conv?.blockedDir && project && (
            <BlockedDirBanner
              dir={conv.blockedDir}
              onAllow={() => void allowBlockedDir(conv.blockedDir!)}
              onDismiss={() =>
                activeId && useChat.getState().clearBlockedDir(activeId)
              }
            />
          )}
          <CommandConsole
            onSend={handleSend}
            disabled={!project}
            running={running}
            finalizing={finalizing}
            missionRunning={missionRunning}
            onStop={handleStop}
          />
        </div>
      </div>
    </section>
  )
}

/** Card do "Planejar primeiro" (abaixo do último turno, acima do composer):
 *  o turno plan_first terminou e o plano proposto está logo acima no fio.
 *  Aprovar dispara o turno de execução; Descartar só limpa o estado (a conversa
 *  segue normal). Visual no padrão dos cards de decisão (InteractionHost). */
function PlanPendingCard({
  onApprove,
  onDiscard,
}: {
  onApprove: () => void
  onDiscard: () => void
}) {
  return (
    <div className="mb-2 rounded-lg border border-brass/40 bg-brass/[0.07] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <ClipboardList className="size-4 shrink-0 text-brass" />
        <p className="min-w-0 flex-1 text-[12.5px] text-foreground">
          📋 <span className="font-medium">Plano proposto</span> — revise acima:
          o agent só executa depois da{" "}
          <span className="font-medium text-brass">sua aprovação</span>.
        </p>
      </div>
      <div className="mt-2.5 flex items-center justify-end gap-2">
        <button
          onClick={onDiscard}
          className="rounded-md border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-accent"
        >
          Descartar
        </button>
        <button
          onClick={onApprove}
          className="rounded-md bg-brass px-2.5 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
        >
          Aprovar e executar
        </button>
      </div>
    </div>
  )
}

/** Banner (acima do composer) quando um auto-resume está agendado: countdown ao
 *  vivo até o próximo reenvio, quantas tentativas restam, e as saídas (Cancelar /
 *  Retomar agora). Reusa o estilo st-warning do BlockedDirBanner. Um envio manual
 *  (ou o Stop) cancela o agendamento por fora deste componente. */
function AutoResumeBanner({
  nextAt,
  tries,
  maxTries,
  onCancel,
  onResumeNow,
}: {
  nextAt: number
  tries: number
  maxTries: number
  onCancel: () => void
  onResumeNow: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = Math.max(0, Math.ceil((nextAt - now) / 1000))
  const remaining = Math.max(0, maxTries - tries)
  return (
    <div className="mb-2 flex items-center gap-2.5 rounded-lg border border-st-warning/40 bg-st-warning/10 px-3 py-2">
      <Timer className="size-4 shrink-0 animate-pulse text-st-warning" />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] text-foreground">
          Aguardando reset do limite — retomando automaticamente em{" "}
          <span className="font-mono tabular-nums">{secs}s</span>{" "}
          <span className="text-muted-foreground">
            (tentativa {tries}/{maxTries}
            {remaining > 0 ? `, ${remaining} restante${remaining > 1 ? "s" : ""}` : ""})
          </span>
        </p>
      </div>
      <button
        onClick={onResumeNow}
        className="shrink-0 rounded-md bg-brass px-2.5 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
      >
        Retomar agora
      </button>
      <button
        onClick={onCancel}
        title="Cancelar auto-resume"
        aria-label="Cancelar auto-resume"
        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}

/** Banner (acima do composer) quando o agent bateu no gate de diretório: um
 *  clique libera a pasta (--add-dir) e reenvia o pedido. Heurístico → dispensável. */
function BlockedDirBanner({
  dir,
  onAllow,
  onDismiss,
}: {
  dir: string
  onAllow: () => void
  onDismiss: () => void
}) {
  return (
    <div className="mb-2 flex items-center gap-2.5 rounded-lg border border-st-warning/40 bg-st-warning/10 px-3 py-2">
      <FolderGit2 className="size-4 shrink-0 text-st-warning" />
      <div className="min-w-0 flex-1">
        <p className="text-[12.5px] text-foreground">
          O agente parece ter sido barrado ao acessar uma pasta fora do projeto.
        </p>
        <p className="truncate font-mono text-[11px] text-muted-foreground" title={dir}>
          {dir}
        </p>
      </div>
      <button
        onClick={onAllow}
        className="shrink-0 rounded-md bg-brass px-2.5 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
      >
        Liberar e reenviar
      </button>
      <button
        onClick={onDismiss}
        title="Dispensar"
        aria-label="Dispensar aviso"
        className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>
    </div>
  )
}
