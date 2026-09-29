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
import { avisar } from "@/lib/avisos"
import { ComposerShell } from "@/components/chat/ComposerShell"
import { ContextRing } from "@/components/chat/ContextRing"
import { IdentityDoor } from "@/components/chat/ComposerExecutionControls"
import { resumoDaIdentidade, identidadeEfetiva } from "@/components/chat/composerIdentity"
import { composerPlaceholder } from "@/components/chat/composerPlaceholder"
import { avisoDeRevezamento } from "@/store/chat/revezamento"
import { SlashPopover } from "@/components/chat/SlashPopover"
import {
  AttachmentChips,
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
import { useStickyNotes, selectNotesFor } from "@/store/stickyNotes"
import { itensDeNota } from "@/components/notes/noteMention"
import { arquivosTocados } from "@/lib/mentionRank"
import { usePromptHistory } from "@/hooks/usePromptHistory"
import { useAttachments } from "@/hooks/useAttachments"
import { useConvDoComposer } from "@/components/chat/convDoComposer"
import {
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
import { DESTINATIONS, agentDef, defaultModelFor, agentCaps, normalizeModelValue } from "@/lib/agents"
import { ComposerLaunchers } from "@/components/chat/ComposerLaunchers"
import type { AgentRunConfig } from "@/lib/types"
import { usePresets } from "@/store/presets"
import { isTauri } from "@/lib/db"
import { useComposerDrafts } from "@/store/composerDrafts"
import { imagensCitadas, imagensDoEnvio } from "@/lib/imagemNoTexto"
import { forceSendDraft, forceSendQueued, pullQueued } from "@/components/chat/filaComposer"
import { BaseDoComposer } from "@/components/chat/BaseDoComposer"

// O Lexical (~82 kB gzip) segue lazy: baixa em paralelo ao boot, e como só
// este arquivo o importa, o grafo inteiro fica fora do chunk main.
const LexicalComposer = lazy(() =>
  import("@/components/chat/LexicalComposer").then((m) => ({
    default: m.LexicalComposer,
  })),
)

// Box do input do console (dimensões/tipografia herdadas do antigo textarea —
// o cartão não mudou de pele no cutover).
const CONSOLE_INPUT_CLASS =
  "max-h-[240px] min-h-[56px] resize-none border-0 bg-transparent! px-4 pt-3.5 text-[14px] leading-relaxed text-foreground shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
const EMPTY_MENTION_VALUES: string[] = []

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
  const persistedMentions = useComposerDrafts((s) =>
    activeId
      ? (s.byConv[activeId]?.mentionValues ?? EMPTY_MENTION_VALUES)
      : EMPTY_MENTION_VALUES,
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
  const [destination, setDestination] = useState(settings.defaultAgent)
  // normaliza o default persistido: um id que saiu do CLI (gpt-5.3-codex, o3)
  // não pode virar 400 em todo envio novo com a UI fingindo normalidade.
  const [model, setModel] = useState(
    normalizeModelValue(settings.defaultAgent, settings.defaultModel) ??
      "default",
  )
  const [effort, setEffort] = useState(settings.defaultEffort ?? "default")
  // S4 — o que o sandbox do Frota garante NESTA máquina. Lido uma vez: a
  // resposta depende do sistema, não do turno.
  const [confinamento, setConfinamento] = useState(SEM_CONFINAMENTO)
  // foco programático do editor Lexical (preenchido pelo FocusBridgePlugin).
  const lexicalFocus = useRef<(() => void) | null>(null)
  // Pill de comando "/" no editor: com ele o popover não reabre, porque a
  // gramática é um comando por mensagem e o pill já é ele.
  const [hasCommandPill, setHasCommandPill] = useState(false)
  const conv = useConvDoComposer()
  const suggestions = conv.suggestions
  const suggesting = conv.suggesting
  const project = useActiveProject()
  // A permissão é do projeto DONO do fio, não do que está em foco (a mesma
  // regra do `resolveSendTarget`). Comandos, arquivos e personas seguem o
  // foco. Sem conversa hidratada, o foco é a melhor aproximação.
  const permProjectId = useChat((s) =>
    s.activeId ? (s.byId[s.activeId]?.projectId ?? null) : null,
  )
  const permProject =
    useApp((s) => s.projects.find((p) => p.id === permProjectId)) ?? project
  const permissionMode = useApp((s) =>
    permProject
      ? resolvePermission(
          s.projectConfigs[permProject.id]?.permission,
          s.projects.find((p) => p.id === permProject.id)?.permissionMode,
        )
      : "padrao",
  )

  // Conversa estabelecida trava no agent/modelo/esforço dela; pareceres de
  // especialista não travam. Calculado antes dos hooks: o "/" descobre
  // comandos por agent.
  const locked = hasExecutorTurn(conv.items)
  // O modelo destrava fora de voo: trocá-lo no mesmo agent preserva a sessão
  // (é o `/model` dos três motores). O agent não destrava: ali é handoff.
  // Fora de voo porque o modelo é flag de spawn e vale do próximo envio.
  const modelUnlocked = !conv.running && !conv.finalizing
  // A escolha de emergência tem estado próprio e zera ao trocar de conversa ou
  // de agent: modelo de um motor não vale no outro.
  const [retryModel, setRetryModel] = useState<string | null>(null)
  // O esforço segue a mesma regra do modelo.
  const [retryEffort, setRetryEffort] = useState<string | null>(null)
  useEffect(() => {
    setRetryModel(null)
    setRetryEffort(null)
  }, [activeId, conv.agent, conv.stagedAgent])
  // A regra (o que vale numa conversa nova, o que vale numa travada, e a saída
  // de emergência) é pura e mora em composerIdentity.
  const identidade = identidadeEfetiva({
    travada: locked,
    modeloDestravado: modelUnlocked,
    escolhaDeEmergencia: retryModel,
    escolhaDeEsforco: retryEffort,
    stagedAgent: conv.stagedAgent,
    conversa: { agent: conv.agent, reqModel: conv.reqModel, effort: conv.effort },
    seletores: { agent: destination, model, effort },
  })
  const effectiveDest = identidade.agent
  const effectiveModel = identidade.model
  const effectiveEffort = identidade.effort

  // O selo depende do motor: quem confina sozinho não recebe o envelope da
  // Frota, e o selo não pode descrever um perfil que não foi aplicado. O
  // `lerConfinamento` cacheia por motor.
  useEffect(() => {
    let vivo = true
    void lerConfinamento(effectiveDest).then((v) => {
      if (vivo) setConfinamento(v)
    })
    return () => {
      vivo = false
    }
  }, [effectiveDest])

  // Carimba o agent na conversa que ainda não tem um: o destino é estado deste
  // componente e sobrevive à troca de conversa, e sem carimbo a sidebar cai no
  // default global. Só preenche o vazio: conversa já carimbada ou com turno de
  // executor fica intocada.
  const convStamp = useChat((s) =>
    s.activeId
      ? (s.conversations.find((c) => c.id === s.activeId)?.agent ?? null)
      : null,
  )
  useEffect(() => {
    if (!activeId || locked || convStamp !== null) return
    useChat.getState().setConversationAgent(activeId, destination)
  }, [activeId, locked, convStamp, destination])

  // "/", "@", histórico ↑/↓ e anexos: cada um num hook; o teclado chega pelos
  // plugins do editor.
  const slash = useSlashCommands({
    project,
    agent: effectiveDest,
    value,
    setValue,
    focus: focusComposer,
  })
  // As notas do escopo visível viram endereço `@nota/slug`.
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
  const { histIdx, setHistIdx, resetHistory, userPrompts, recallPrev, recallNext } =
    history
  const { attachments, setAttachments, removeAttachment, addFiles, attach } = att
  const imagensDoRascunho = useMemo(() => imagensDoEnvio(attachments), [attachments])

  // A persona mora na conversa (conv.presetId), que é de onde o envio lê. Ela
  // é o trio agent/modelo/esforço fechado: mexer num item desfaz a seleção.
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
  const convAgent = effectiveDest
  // trava de capacidade: o agent-alvo precisa suportar cada anexo (espelha o trait)
  const caps = agentCaps(effectiveDest)
  // Imagem citada no texto mora no texto (ficha); a fileira mostra o resto.
  // Motor que não lê imagem: tudo fica na fileira, onde o aviso dele mora.
  const anexosDaFileira = useMemo(() => {
    const citadas = caps.image ? imagensCitadas(value, attachments) : new Set<string>()
    return citadas.size ? attachments.filter((a) => !citadas.has(a.path)) : attachments
  }, [value, attachments, caps.image])
  const allSupported = attachments.every((a) =>
    a.kind === "image" ? caps.image : a.kind === "pdf" ? caps.pdf : false,
  )
  // Aceita texto explícito porque o Enter do editor chega com o recém-
  // serializado, um tique à frente do draft. A regra é pura, em composerSend.
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

  // "Planejar primeiro" é modo do próximo envio, não config do 1º run: fica
  // até você desligar ou aprovar um plano. O modo é da conversa; o projeto dá
  // o default.
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
    // Só é true quando você escolheu outro modelo numa conversa travada cuja
    // última tentativa falhou (ver AgentRunConfig).
    modelSwitched: identidade.trocouDeModelo,
    effortSwitched: identidade.trocouDeEsforco ?? false,
  }

  /** Foca o editor do console (FocusBridgePlugin do Lexical). */
  function focusComposer() {
    lexicalFocus.current?.()
  }

  /** Envio único: o botão chama sem argumento (lê o draft); o Enter passa o
   *  texto recém-serializado. `unknown` porque o botão recebe o MouseEvent, e
   *  quem separa string de evento é `textoDoEnvio` (ADR-092). */
  function submit(overrideText?: unknown) {
    const text = textoDoEnvio(overrideText, value, useComposerDrafts.getState().byConv[activeId ?? ""]?.blocos)
    if (destinoDoComposer(estadoDoComposer(text)) === "barrado") return
    // Um caminho só para enviar e enfileirar: texto e anexos viajam juntos, e o
    // handleSend decide se empilha na fila. Dois ramos deixavam anexo órfão.
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
    const text = textoDoEnvio(overrideText, value, useComposerDrafts.getState().byConv[activeId ?? ""]?.blocos)
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

  // Placeholder por estado, extraído em helper puro para controle de tamanho.
  const placeholder = composerPlaceholder({
    missionRunning,
    preparing,
    running,
    finalizing,
    hasCommands: commands.length > 0,
  })

  // A dep é o TAMANHO do fio: tool call é sempre item novo, e com o array como
  // dep cada token do streaming refaria o Set varrendo a conversa.
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
          // Edição real (as externas o editor suprime): reabre o "/"
          // dispensado com Esc e sai do histórico.
          setSlashDismissed(false)
          setHistIdx(null)
        }}
        onSubmit={(text) => submit(text)}
        onForceSubmit={running && canEnqueue ? (text) => handleForceSendDraft(text) : undefined}
        onQueueSubmit={canEnqueue ? (text) => submit(text) : undefined}
        placeholder={placeholder}
        mentionNames={presets.map((p) => p.name)}
        mentionPersisted={persistedMentions}
        mentionProjectRoot={project?.path}
        mentionNotes={enderecosDeNota}
        mentionTouched={arquivosDaConversa}
        onMentionValuesChange={(values) => {
          const id = useChat.getState().activeId
          if (id) useComposerDrafts.getState().setMentionValues(id, values)
        }}
        className={CONSOLE_INPUT_CLASS}
        registerFocus={(fn) => {
          lexicalFocus.current = fn
        }}
        slash={slashBridge}
        history={historyBridge}
        onPasteFiles={addFiles}
        imagens={imagensDoRascunho}
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
          agent={effectiveDest}
          sections={slash.slashSectionList}
          inventory={slash.inventory}
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
      {/* Plano, fila e avisos do turno numa tira presa ao composer (ADR-247). */}
      <BaseDoComposer
        conv={conv}
        convId={activeId}
        onEdit={handleEditQueued}
        onForceSend={finalizing ? undefined : handleForceSendQueued}
      />
      <ComposerShell
        focusRing
        input={lexicalInput}
        onCardClick={focusComposer}
        footerClassName="p-2.5 pt-1"
        chips={
          <AttachmentChips
            attachments={anexosDaFileira}
            caps={caps}
            destLabel={dest.label}
            onRemove={removeAttachment}
          />
        }
        header={
          <ExecutionRow
            convAgent={convAgent}
            mode={permissionMode}
          />
        }
        footer={
          <ComposerActions
            stopTitle={deferredStopWarning(pendingDeferred(conv.items))}
            onFusion={() => useApp.getState().requestFusionLaunch()}
            fusionDisabled={
              !activeId || disabled || preparing || running || finalizing || missionRunning
            }
            fusionTitle={
              activeId
                ? "Disputar entre agents (candidatos read-only); o vencedor continua nesta conversa"
                : "Sem conversa ativa; a disputa precisa de uma conversa de destino"
            }
            onMission={() => useApp.getState().requestMissionLaunch()}
            missionDisabled={disabled || preparing || running || finalizing || missionRunning}
            onAttach={attach}
            onEspecialistas={onOpenEspecialistas}
            running={running}
            finalizing={finalizing}
            preparing={preparing}
            onStop={onStop}
            onSubmit={submit}
            canSend={canSend}
            canEnqueue={canEnqueue}
            onForceSendDraft={canEnqueue ? () => handleForceSendDraft() : undefined}
            contextRing={<ContextRing />}
            // O modo mexe nesta conversa; definir o default do projeto é um
            // gesto próprio no mesmo menu.
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
              <IdentityDoor
                label={agentDef(identidade.agent)?.label ?? identidade.agent}
                agent={identidade.agent}
                detalhe={resumoDaIdentidade(identidade)}
                locked={locked}
                staged={identidade.revezando}
              >
                <IdentityControls
                  presetValue={effectivePreset}
                  presetOptions={presetOptions}
                  onPresetChange={handlePresetChange}
                  effectiveDest={effectiveDest}
                  locked={locked}
                  onDestChange={(v) => {
                    if (locked && activeId) {
                      const nextStaged = v === conv.agent ? null : v
                      useChat.getState().stageAgent(activeId, nextStaged)
                      clearPresetOnManualChange()
                      avisar.nota(avisoDeRevezamento(nextStaged, conv.agent))
                      return
                    }
                    setDestination(v)
                    setModel(defaultModelFor(v))
                    setEffort("default")
                    clearPresetOnManualChange()
                    // Carimba a conversa vazia para a sidebar mostrar o motor
                    // certo antes do 1º envio. No-op com agent travado.
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
                  effortLocked={locked && !modelUnlocked}
                  onEffortChange={(v) => {
                    if (locked) setRetryEffort(v)
                    else setEffort(v)
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

      <ComposerLaunchers
        task={value.trim()}
        seed={effCfg}
        onLaunched={() => {
          setValue("")
          resetHistory()
        }}
      />
    </div>
  )
}
