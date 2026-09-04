import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type SetStateAction,
} from "react"
import { ComposerShell } from "@/components/chat/ComposerShell"
import { ContextRing } from "@/components/chat/ContextRing"
import { IdentityDoor } from "@/components/chat/ComposerExecutionControls"
import { resumoDaIdentidade, identidadeEfetiva } from "@/components/chat/composerIdentity"
import {
  SlashPopover,
  AttachmentChips,
  QueuedChips,
  ComposerActions,
  IdentityControls,
  SuggestionChips,
  NO_PRESET,
} from "@/components/chat/ComposerParts"
import { ExecutionRow } from "@/components/chat/ExecutionRow"
import { resolvePermission, setProjectPermissionEverywhere } from "@/lib/permission"
import { destinoDoComposer, podeEnviar, type EstadoDoComposer } from "@/components/chat/composerSend"
import { useSlashCommands } from "@/hooks/useSlashCommands"
import { slashEmptyHint } from "@/lib/slashCommands"
import { useAtMentions } from "@/hooks/useAtMentions"
import { useStickyNotes, selectNotesFor } from "@/store/stickyNotes"
import { itensDeNota } from "@/components/notes/noteMention"
import { arquivosTocados } from "@/lib/mentionRank"
import { usePromptHistory } from "@/hooks/usePromptHistory"
import { useAttachments } from "@/hooks/useAttachments"
import {
  useActiveConv,
  useChat,
  deferredStopWarning,
  hasExecutorTurn,
  pendingDeferred,
} from "@/store/chat"
import { ModeSelect } from "@/components/chat/ModeSelect"
import { lerConfinamento, SEM_CONFINAMENTO } from "@/lib/confinamento"
import { textoDoEnvio } from "@/lib/textoDoEnvio"
import { modosOferecidos, wireDoModo } from "@/lib/agentModes"
import { useAgentModes } from "@/store/agentModes"
import { useApp, useActiveProject } from "@/store/app"
import type { Attachment } from "@/lib/attachments"
import { DESTINATIONS, defaultModelFor, agentCaps, normalizeModelValue } from "@/lib/agents"
import { FusionLauncher } from "@/components/fusion/FusionLauncher"
import { MissionLauncher } from "@/components/mission/MissionLauncher"
import type { AgentRunConfig } from "@/lib/types"
import { usePresets } from "@/store/presets"
import { isTauri } from "@/lib/db"
import { useComposerDrafts } from "@/store/composerDrafts"
import { forceSendDraft, forceSendQueued, pullQueued } from "@/components/chat/filaComposer"

// O editor Lexical (+lexical +beautiful-mentions, ~82 kB gzip) segue LAZY
// mesmo sendo o único composer: o chunk baixa em paralelo ao boot e o main
// fica enxuto. Nada além deste arquivo importa o LexicalComposer, então o
// grafo do Lexical inteiro sai do chunk main.
const LexicalComposer = lazy(() =>
  import("@/components/chat/LexicalComposer").then((m) => ({
    default: m.LexicalComposer,
  })),
)

// Box do input do console (dimensões/tipografia herdadas do antigo textarea —
// o cartão não mudou de pele no cutover).
const CONSOLE_INPUT_CLASS =
  "max-h-[240px] min-h-[56px] resize-none border-0 bg-transparent! px-4 pt-3.5 text-[14px] leading-relaxed text-foreground shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0"

export function CommandConsole({
  onSend,
  disabled,
  running,
  finalizing,
  preparing,
  missionRunning,
  onStop,
  onDispatchQueue,
  onOpenEspecialistas,
}: {
  onSend: (
    text: string,
    cfg: AgentRunConfig,
    attachments: Attachment[],
    onAccepted: () => void,
  ) => void
  disabled?: boolean
  running?: boolean
  finalizing?: boolean
  preparing?: boolean
  /** Missão rodando nesta conversa → composer travado (envio manual bloqueado). */
  missionRunning?: boolean
  onStop?: () => void
  /** Interrompe, se preciso, e despacha a fila da conversa indicada. */
  onDispatchQueue: (convId: string) => Promise<unknown>
  /** Atalho ✦ do composer: abre o marketplace de Especialistas sobre a conversa. */
  onOpenEspecialistas?: () => void
}) {
  const activeId = useChat((s) => s.activeId)
  // Texto + anexos são uma entidade durável por conversa. A store própria
  // isola a digitação do estado operacional do chat e da telemetria da Frota.
  const value = useComposerDrafts((s) =>
    activeId ? (s.byConv[activeId]?.text ?? "") : "",
  )
  // assina igual ao setter do useState (aceita string OU updater) p/ os hooks.
  const setValue = useCallback((v: SetStateAction<string>) => {
    const id = useChat.getState().activeId
    if (!id) return
    const next =
      typeof v === "function"
        ? v(useComposerDrafts.getState().byConv[id]?.text ?? "")
        : v
    useComposerDrafts.getState().setText(id, next)
  }, [])
  // defaults de novas conversas vêm das configurações globais (Settings).
  const settings = useApp((s) => s.settings)
  // (o selo de "liberado" saiu daqui: a permissão agora é um controle de 3
  // posições na ExecutionRow, que mostra o modo ATUAL em vez de só alertar
  // depois que você já liberou.)
  const [destination, setDestination] = useState(settings.defaultAgent)
  // normaliza o default persistido: um id que saiu do CLI (gpt-5.3-codex, o3)
  // não pode virar 400 em todo envio novo com a UI fingindo normalidade.
  const [model, setModel] = useState(
    normalizeModelValue(settings.defaultAgent, settings.defaultModel) ??
      "default",
  )
  const [effort, setEffort] = useState(settings.defaultEffort ?? "default")
  // Mission (beta): dialog do launcher, acionado pelo Rocket do composer.
  const [missionOpen, setMissionOpen] = useState(false)
  // Fusion (F3): dialog do launcher da disputa, acionado pelo ⚔️ do composer.
  const [fusionOpen, setFusionOpen] = useState(false)
  // Launchpad pede a abertura dos launchers via contador (padrão do
  // sddCreateRequested): skip do valor inicial, abre a cada bump.
  const missionReq = useApp((s) => s.missionLaunchRequested)
  const fusionReq = useApp((s) => s.fusionLaunchRequested)
  // S4 — o que o sandbox do Frota garante NESTA máquina. Lido uma vez: a
  // resposta depende do sistema, não do turno.
  const [confinamento, setConfinamento] = useState(SEM_CONFINAMENTO)
  useEffect(() => {
    void lerConfinamento().then(setConfinamento)
  }, [])
  const missionReqSeen = useRef(missionReq)
  const fusionReqSeen = useRef(fusionReq)
  useEffect(() => {
    if (missionReq !== missionReqSeen.current) {
      missionReqSeen.current = missionReq
      setMissionOpen(true)
    }
  }, [missionReq])
  useEffect(() => {
    if (fusionReq !== fusionReqSeen.current) {
      fusionReqSeen.current = fusionReq
      setFusionOpen(true)
    }
  }, [fusionReq])
  // foco programático do editor Lexical (preenchido pelo FocusBridgePlugin).
  const lexicalFocus = useRef<(() => void) | null>(null)
  // pill de comando "/" presente no editor (SlashPillPresencePlugin): com ele,
  // o popover de comandos não reabre — a gramática é UM comando por mensagem,
  // e o pill já é ele. (Digitar "/" no meio nunca abriu o popover; isto cobre
  // a borda em que o texto serializado volta a ser só "/nome".)
  const [hasCommandPill, setHasCommandPill] = useState(false)
  const conv = useActiveConv()
  const suggestions = conv.suggestions
  const suggesting = conv.suggesting
  const project = useActiveProject()
  // A PERMISSÃO é do projeto DONO do fio, não do que está em foco — mesma regra
  // que o despacho já segue (`resolveSendTarget`: "cwd, permissão e lições são
  // os do fio, não os da tela"). O resto do composer (comandos "/", arquivos
  // "@", personas) continua no foco, que é o inventário que você está olhando.
  // Sem conversa hidratada, o foco é a melhor aproximação que existe.
  const permProjectId = useChat((s) =>
    s.activeId ? (s.byId[s.activeId]?.projectId ?? null) : null,
  )
  const permProject =
    useApp((s) => s.projects.find((p) => p.id === permProjectId)) ?? project
  const permissionMode = useApp((s) =>
    permProject
      ? resolvePermission(
          s.mycockpit[permProject.id]?.permission,
          s.projects.find((p) => p.id === permProject.id)?.permissionMode,
        )
      : "padrao",
  )

  // conversa estabelecida trava no agent/modelo/effort dela; o seletor reflete.
  // Pareceres de conselheiro (advice) NÃO travam a identidade (Especialistas E1).
  // (Computado ANTES dos hooks: o popover "/" descobre comandos POR AGENT.)
  const locked = hasExecutorTurn(conv.items)
  // O MODELO destrava sempre que a conversa não está em voo. Trocar de modelo
  // dentro do mesmo agent PRESERVA a sessão (o `--resume` segue valendo), e é o
  // que os três motores permitem no meio da conversa (`/model`). O que não
  // destrava é o AGENT: ali a troca é handoff, não seletor.
  //
  // `!running && !finalizing` porque o modelo é flag de SPAWN, igual à
  // permissão: o processo já subiu com ela. Vale do próximo envio.
  const modelUnlocked = !conv.running && !conv.finalizing
  // A escolha de emergência tem estado PRÓPRIO (o `model` cru sobra de outra
  // conversa). Zera ao trocar de conversa ou de agent: modelo de um motor não
  // vale no outro.
  const [retryModel, setRetryModel] = useState<string | null>(null)
  useEffect(() => setRetryModel(null), [activeId, conv.agent])
  // A regra (o que vale numa conversa nova, o que vale numa travada, e a saída
  // de emergência) é pura e mora em composerIdentity.
  const identidade = identidadeEfetiva({
    travada: locked,
    modeloDestravado: modelUnlocked,
    escolhaDeEmergencia: retryModel,
    conversa: { agent: conv.agent, reqModel: conv.reqModel, effort: conv.effort },
    seletores: { agent: destination, model, effort },
  })
  const effectiveDest = identidade.agent
  const effectiveModel = identidade.model
  const effectiveEffort = identidade.effort

  // Carimbo do agent numa conversa que ainda NÃO tem um. O destino é estado
  // deste componente e SOBREVIVE à troca de conversa: escolher Antigravity e
  // depois criar uma conversa nova deixava a linha sem carimbo, e a sidebar
  // caía no default GLOBAL (ícone do Claude Code numa conversa que ia rodar,
  // e rodava, Antigravity). O `onDestChange` só cobria a troca explícita.
  // Preenche o VAZIO e nada além: conversa já carimbada (escolha anterior,
  // mesa de um agent, linha vinda do banco) e conversa com turno de executor
  // ficam intocadas — o carimbo diz quem VAI rodar, não um padrão.
  const convStamp = useChat((s) =>
    s.activeId
      ? (s.conversations.find((c) => c.id === s.activeId)?.agent ?? null)
      : null,
  )
  useEffect(() => {
    if (!activeId || locked || convStamp !== null) return
    useChat.getState().setConversationAgent(activeId, destination)
  }, [activeId, locked, convStamp, destination])

  // Popover "/" (comandos), arquivos do "@", histórico ↑/↓ e anexos, cada
  // feature num hook. O teclado chega pelos plugins do editor (slashBridge/
  // historyBridge/PASTE_COMMAND); a lógica mora aqui fora.
  const slash = useSlashCommands({
    project,
    agent: effectiveDest,
    value,
    setValue,
    focus: focusComposer,
  })
  // arquivos do projeto prontos na montagem (cache por projeto) — o menu "@"
  // do editor precisa deles quando abrir.
  const at = useAtMentions({ project })
  // N5 — as notas do escopo visível viram endereço `@nota/slug`. A leitura é
  // por seletor (só o array de notas), então mudar o rascunho não re-renderiza
  // por causa daqui.
  const notasDaStore = useStickyNotes((s) => s.notes)
  const notasVisiveis = useMemo(
    () => selectNotesFor(notasDaStore, { projectId: project?.id, convId: activeId ?? undefined }),
    [notasDaStore, project?.id, activeId],
  )
  const history = usePromptHistory({ conv, activeId, value, setValue })
  const att = useAttachments({
    activeId,
    setValue,
    focus: focusComposer,
    conversationDraft: true,
  })

  const {
    commands,
    slashMatches,
    showSlash,
    slashIdx,
    setSlashIdx,
    setSlashDismissed,
    insertCommand,
  } = slash
  const { files: projectFiles } = at
  const { histIdx, setHistIdx, resetHistory, userPrompts, recallPrev, recallNext } =
    history
  const { attachments, setAttachments, removeAttachment, addFiles, attach } = att

  // S3.6 — presets (personas): a seleção mora na CONVERSA (conv.presetId), não
  // em estado local — o handleSend e a mesa leem de lá. Escolher um preset
  // seta agent/modelo/esforço de uma vez; mexer na camada crua desfaz a
  // seleção (o preset é o trio inteiro, não um item avulso).
  const presets = usePresets((s) => s.list)
  // As personas viraram ARQUIVO e ganharam escopo: recarrega ao trocar de
  // projeto, senão a lista mostraria as personas do projeto anterior.
  const presetProjectPath = project?.path ?? null
  useEffect(() => {
    if (isTauri()) void usePresets.getState().load(presetProjectPath)
  }, [presetProjectPath])
  const effectivePreset = conv.presetId ?? NO_PRESET
  const presetOptions = presets.map((p) => ({
    value: p.id,
    label: p.name,
    description: `${p.backend}${p.model ? ` · ${p.model}` : ""}`,
    badge: `v${p.version}`,
  }))
  function handlePresetChange(v: string) {
    const id = activeId
    if (!id) return
    if (v === NO_PRESET) {
      void useChat.getState().setConversationPreset(id, null)
      return
    }
    const p = presets.find((x) => x.id === v)
    if (!p) return
    setDestination(p.backend)
    setModel(normalizeModelValue(p.backend, p.model) ?? "default")
    setEffort(p.effort ?? "default")
    void useChat.getState().setConversationPreset(id, { id: p.id, name: p.name })
  }
  /** Mexeu manualmente em agent/modelo/esforço com preset marcado (conversa
   *  ainda destravada) → volta pra camada crua (a persona é o trio fechado). */
  function clearPresetOnManualChange() {
    if (activeId && !locked && conv.presetId) {
      void useChat.getState().setConversationPreset(activeId, null)
    }
  }
  const dest =
    DESTINATIONS.find((d) => d.id === effectiveDest) ?? DESTINATIONS[0]
  // agent EFETIVO da conversa — a nota honesta por agent (permissionNote) precisa
  // saber QUEM vai obedecer (ou ignorar) o modo de permissão do projeto.
  const convAgent = hasExecutorTurn(conv.items) ? conv.agent : effectiveDest
  // trava de capacidade: o agent-alvo precisa suportar cada anexo (espelha o trait)
  const caps = agentCaps(effectiveDest)
  const allSupported = attachments.every((a) =>
    a.kind === "image" ? caps.image : a.kind === "pdf" ? caps.pdf : false,
  )
  // aceita um texto explícito porque o submit do editor chega com o texto
  // recém-serializado (que pode estar 1 tick à frente do draft). A REGRA mora
  // em composerSend (pura, testada); aqui só se junta o estado.
  const estadoDoComposer = (text: string): EstadoDoComposer => ({
    texto: text,
    anexos: attachments.length,
    anexosSuportados: allSupported,
    disabled: !!disabled || !!preparing,
    running: !!running,
    finalizing: !!finalizing,
    missionRunning: !!missionRunning,
  })
  const canSend = podeEnviar(estadoDoComposer(value.trim()))

  // "Planejar primeiro" (por conversa, na store): NÃO trava com a conversa — é
  // um modo do PRÓXIMO envio, não config fixa do 1º run. Fica ligado até o
  // usuário desligar (ou até aprovar um plano, que desliga sozinho).
  // M3: o modo é da CONVERSA; o projeto dá o default de quem não decidiu.
  const modoDaConversa = conv.sessionMode ?? null
  const modoAtual = modoDaConversa ?? permissionMode
  const planFirst = modoAtual === "plan"
  // Modos que o motor ATIVO anuncia E o app sabe explicar. A sonda tem dono
  // único (store/agentModes) e é pedida uma vez por sessão.
  const modosSondados = useAgentModes((s) => s.byAgent[effectiveDest])
  const ensureModos = useAgentModes((s) => s.ensure)
  useEffect(() => {
    ensureModos([effectiveDest])
  }, [ensureModos, effectiveDest])
  const modosDoMotor = useMemo(
    // `null` quando a sonda não respondeu: cai na lista curada em vez de sumir
    // com o controle de permissão (ver `modosOferecidos`).
    () => modosOferecidos(effectiveDest, modosSondados?.known ? modosSondados.ids : null),
    [effectiveDest, modosSondados],
  )

  // config EFETIVO (numa conv travada = o do 1º run, exibido nos pills), nunca o
  // estado local cru, que sobra de outra conv e não reseta na troca.
  const effCfg = {
    agent: effectiveDest,
    model: effectiveModel === "default" ? null : effectiveModel,
    effort: effectiveEffort === "default" ? null : effectiveEffort,
    planFirst,
    // Só é true quando o humano ESCOLHEU outro modelo numa conversa travada
    // cuja última tentativa falhou. Sem a flag o despacho segue usando o modelo
    // do 1º run, como sempre (ver AgentRunConfig).
    modelSwitched: identidade.trocouDeModelo,
  }

  /** Foca o editor do console (FocusBridgePlugin do Lexical). */
  function focusComposer() {
    lexicalFocus.current?.()
  }

  /** Envio único: o botão chama sem argumento (lê o draft); o Enter do editor
   *  passa o texto que acabou de serializar (MESMA string `@nome`). */
  // `unknown` de propósito: o botão é `onClick={onSubmit}`, então o React passa
  // o MouseEvent aqui. Quem separa string de evento é `textoDoEnvio` (ADR-092),
  // e não a memória de quem escreve o próximo call site.
  function submit(overrideText?: unknown) {
    const text = textoDoEnvio(overrideText, value)
    if (destinoDoComposer(estadoDoComposer(text)) === "barrado") return
    // UM caminho só para enviar e para ENFILEIRAR (turno em andamento): texto e
    // anexos viajam sempre juntos, e o handleSend é quem detecta o turno em voo
    // e empilha na fila. Eram dois ramos gêmeos aqui — e ramo gêmeo é como o
    // anexo ficava pra trás, órfão no composer depois de a mensagem "sair".
    const submittedId = activeId
    onSend(text, effCfg, attachments, () => {
      if (submittedId) useComposerDrafts.getState().clear(submittedId)
      resetHistory()
      if (submittedId === useChat.getState().activeId) focusComposer()
    })
  }

  function handleEditQueued(index: number) {
    if (!activeId) return
    const item = pullQueued(activeId, index)
    if (!item) return
    setValue(item.text)
    if (item.attachments.length > 0) {
      setAttachments((prev) => [...prev, ...item.attachments])
    }
    focusComposer()
  }

  function handleForceSendQueued(index: number) {
    if (!activeId) return
    forceSendQueued(activeId, index, onDispatchQueue)
  }

  function handleForceSendDraft(overrideText?: unknown) {
    if (!activeId) return
    const text = textoDoEnvio(overrideText, value)
    forceSendDraft(
      activeId,
      text,
      attachments,
      () => {
        useComposerDrafts.getState().clear(activeId)
        resetHistory()
        if (activeId === useChat.getState().activeId) focusComposer()
      },
      onDispatchQueue,
    )
  }

  const canEnqueue = (running || finalizing) && (value.trim().length > 0 || attachments.length > 0)

  // Placeholder por estado. A dica de "/" sai só quando o projeto tem comandos
  // de fato (senão seria teatro).
  const placeholder = missionRunning
    ? "Missão em andamento; pare a missão para enviar manualmente…"
    : preparing
      ? "Verificando capacidades…"
      : running
        ? "Enter corrige agora · Tab envia no próximo turno…"
        : finalizing
          ? "Turno terminando · Tab envia assim que fechar…"
      : commands.length > 0
        ? "Peça algo…  ou / para comandos"
        : "Peça algo ao seu time de agents…"

  // Comandos "/", paste → anexo e histórico ↑/↓ estilo shell: o LexicalComposer
  // recebe pontes pros hooks (a lógica mora aqui fora, os gestos de teclado nos
  // plugins do editor). O menu "/" é o próprio SlashPopover (renderizado
  // abaixo, gateado só por showSlash). O "@" de arquivos vai por prop
  // (mentionFiles, listagem do useAtMentions).
  // popover "/" efetivo: o showSlash do hook, suprimido com pill presente.
  // N5 — endereços mencionáveis das notas do escopo visível. `itensDeNota` é
  // puro e a lista é pequena (dezenas), então o memo aqui é sobre a store, não
  // sobre trabalho pesado: o que ele evita é remontar array a cada tecla.
  // N7 — o que ESTA conversa tocou. A dep é o TAMANHO do fio, não o array: uma
  // tool call é sempre um item novo, então o conjunto só pode mudar quando o
  // fio cresce. Com o array como dep, cada token do streaming remontaria o Set
  // varrendo a conversa inteira.
  const arquivosDaConversa = useMemo(
    () => arquivosTocados(conv?.items ?? [], project?.path ?? ""),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conv?.items.length, project?.path],
  )

  const enderecosDeNota = useMemo(
    () => itensDeNota(notasVisiveis).map((i) => i.value),
    [notasVisiveis],
  )

  const slashOpen = showSlash && !hasCommandPill
  const slashBridge = {
    active: slashOpen,
    move: (delta: 1 | -1) =>
      setSlashIdx((i) => (i + delta + slashMatches.length) % slashMatches.length),
    pick: () => {
      const m = slashMatches[slashIdx]
      if (m) insertCommand(m.name)
    },
    dismiss: () => setSlashDismissed(true),
  }
  const historyBridge = {
    canPrev: userPrompts.length > 0,
    navigating: histIdx !== null,
    recallPrev,
    recallNext,
  }
  const lexicalInput = (
    // Suspense do chunk lazy: o fallback segura a MESMA altura mínima do
    // input (min-h do CONSOLE_INPUT_CLASS) pra carga não pular o layout.
    <Suspense fallback={<div aria-hidden className="min-h-[56px]" />}>
      <LexicalComposer
        value={value}
        onChangeText={(t) => {
          setValue(t)
          // edição REAL do usuário (mudanças externas são suprimidas pelo
          // lastText do editor): reabre o "/" dispensado com Esc e sai da
          // navegação do histórico — mesma disciplina do antigo onChange.
          setSlashDismissed(false)
          setHistIdx(null)
        }}
        onSubmit={(text) => submit(text)}
        onForceSubmit={running && canEnqueue ? (text) => handleForceSendDraft(text) : undefined}
        onQueueSubmit={canEnqueue ? (text) => submit(text) : undefined}
        placeholder={placeholder}
        mentionNames={presets.map((p) => p.name)}
        mentionFiles={projectFiles}
        mentionNotes={enderecosDeNota}
        mentionTouched={arquivosDaConversa}
        className={CONSOLE_INPUT_CLASS}
        registerFocus={(fn) => {
          lexicalFocus.current = fn
        }}
        slash={slashBridge}
        history={historyBridge}
        onPasteFiles={addFiles}
        slashCommands={commands}
        onSlashPill={setHasCommandPill}
      />
    </Suspense>
  )

  return (
    <div className="relative flex w-full flex-col gap-3">
      {/* Menu "/" — o teclado chega via slashBridge (SlashMenuKeysPlugin);
          aqui é só a lista (clique inclusive). */}
      {slashOpen && (
        <SlashPopover
          project={project}
          matches={slashMatches}
          idx={slashIdx}
          setIdx={setSlashIdx}
          onPick={insertCommand}
        />
      )}
      {/* "/" digitado num projeto SEM comandos: dica no lugar do silêncio (que
          parece bug — caso real: skills globais viraram symlinks quebrados).
          Copy POR AGENT: a casa (.mycockpit/commands) sempre; a convenção
          nativa só quando o motor da conversa a entende. */}
      {!showSlash &&
        /^\/[\w:-]*$/.test(value) &&
        commands.length === 0 && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-full rounded-xl border bg-popover px-3 py-2.5 shadow-[var(--shadow-pop)]">
          <p className="text-[12px] text-muted-foreground">
            {slashEmptyHint(effectiveDest)}
          </p>
        </div>
      )}
      {activeId && (
        <QueuedChips
          queued={conv.queued ?? []}
          onRemove={(i) => useChat.getState().removeQueued(activeId, i)}
          onEdit={handleEditQueued}
          onForceSend={finalizing ? undefined : handleForceSendQueued}
          turnState={running ? "running" : finalizing ? "finalizing" : "idle"}
        />
      )}
      <ComposerShell
        focusRing
        input={lexicalInput}
        onCardClick={focusComposer}
        footerClassName="p-2.5 pt-1"
        chips={
          <AttachmentChips
            attachments={attachments}
            caps={caps}
            destLabel={dest.label}
            onRemove={removeAttachment}
          />
        }
        header={
          <ExecutionRow
            running={running}
            convAgent={convAgent}
            mode={permissionMode}
          />
        }
        footer={
          <ComposerActions
            stopTitle={deferredStopWarning(pendingDeferred(conv.items))}
            onFusion={() => setFusionOpen(true)}
            fusionDisabled={
              !activeId || disabled || preparing || running || finalizing || missionRunning
            }
            fusionTitle={
              activeId
                ? "Disputar entre agents (candidatos read-only); o vencedor continua nesta conversa"
                : "Sem conversa ativa; a disputa precisa de uma conversa de destino"
            }
            onMission={() => setMissionOpen(true)}
            missionDisabled={disabled || preparing || running || finalizing || missionRunning}
            onAttach={attach}
            onEspecialistas={onOpenEspecialistas}
            running={running}
            finalizing={finalizing}
            onStop={onStop}
            onSubmit={submit}
            canSend={canSend}
            canEnqueue={canEnqueue}
            onForceSendDraft={canEnqueue ? () => handleForceSendDraft() : undefined}
            contextRing={<ContextRing />}
            // M3: escolher o modo mexe NESTA conversa. O projeto virou o
            // DEFAULT de quem nasce, e definir esse default é um gesto próprio
            // dentro do mesmo menu — os dois escopos existiam antes, escondidos
            // atrás de um controle que mudava o projeto sem dizer.
            permissionControls={
              <ModeSelect
                modes={modosDoMotor}
                value={modoAtual}
                confinamento={confinamento}
                disabled={!permProject}
                onChange={(def) => {
                  const id = useChat.getState().activeId
                  if (id) useChat.getState().setSessionMode(id, def.canonico)
                }}
                onDefinirPadrao={
                  permProject
                    ? () => {
                        const w = wireDoModo(modoAtual, permissionMode)
                        setProjectPermissionEverywhere(permProject, w.permission)
                      }
                    : undefined
                }
              />
            }
            identityControls={
              <IdentityDoor label={resumoDaIdentidade(identidade)} locked={locked}>
                <IdentityControls
                  presetValue={effectivePreset}
                  presetOptions={presetOptions}
                  onPresetChange={handlePresetChange}
                  effectiveDest={effectiveDest}
                  locked={locked}
                  onDestChange={(v) => {
                    setDestination(v)
                    setModel(defaultModelFor(v))
                    setEffort("default")
                    clearPresetOnManualChange()
                    // carimba na conversa VAZIA: sem isto a escolha ficava só
                    // neste estado local até o 1º envio, e a sidebar mostrava o
                    // logo do default. No-op se já tem itens (agent travado).
                    if (activeId) useChat.getState().setConversationAgent(activeId, v)
                  }}
                  effectiveModel={effectiveModel}
                  modelLocked={locked && !modelUnlocked}
                  onModelChange={(v) => {
                    if (locked) setRetryModel(v)
                    else setModel(v)
                    clearPresetOnManualChange()
                  }}
                  effectiveEffort={effectiveEffort}
                  onEffortChange={(v) => {
                    setEffort(v)
                    clearPresetOnManualChange()
                  }}
                />
              </IdentityDoor>
            }
          />
        }
      />

      <SuggestionChips
        suggesting={suggesting}
        suggestions={suggestions}
        onPick={(text) => {
          setValue(text)
          focusComposer()
        }}
      />

      <MissionLauncher
        open={missionOpen}
        onOpenChange={setMissionOpen}
        initialTask={value.trim()}
        onLaunched={() => {
          // o rascunho virou a tarefa da missão → limpa o composer
          setValue("")
          resetHistory()
        }}
      />

      <FusionLauncher
        open={fusionOpen}
        onOpenChange={setFusionOpen}
        initialTask={value.trim()}
        seed={effCfg}
        onLaunched={() => {
          // o rascunho virou a tarefa da disputa → limpa o composer
          setValue("")
          resetHistory()
        }}
      />
    </div>
  )
}
