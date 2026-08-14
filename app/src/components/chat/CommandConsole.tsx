import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react"
import { ComposerShell } from "@/components/chat/ComposerShell"
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
import { useSlashCommands } from "@/hooks/useSlashCommands"
import { slashEmptyHint } from "@/lib/slashCommands"
import { useAtMentions } from "@/hooks/useAtMentions"
import { usePromptHistory } from "@/hooks/usePromptHistory"
import { useAttachments } from "@/hooks/useAttachments"
import {
  useActiveConv,
  useChat,
  deferredStopWarning,
  hasExecutorTurn,
  pendingDeferred,
} from "@/store/chat"
import { useApp, useActiveProject } from "@/store/app"
import type { Attachment } from "@/lib/attachments"
import {
  DESTINATIONS,
  defaultModelFor,
  agentCaps,
  agentModels,
  normalizeModelValue,
} from "@/lib/agents"
import { FusionLauncher } from "@/components/fusion/FusionLauncher"
import { MissionLauncher } from "@/components/mission/MissionLauncher"
import type { AgentRunConfig } from "@/lib/types"
import { usePresets } from "@/store/presets"
import { isTauri } from "@/lib/db"

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
  missionRunning,
  onStop,
  onOpenEspecialistas,
}: {
  onSend: (
    text: string,
    cfg: AgentRunConfig,
    attachments: Attachment[],
  ) => void
  disabled?: boolean
  running?: boolean
  finalizing?: boolean
  /** Missão rodando nesta conversa → composer travado (envio manual bloqueado). */
  missionRunning?: boolean
  onStop?: () => void
  /** Atalho ✦ do composer: abre o marketplace de Especialistas sobre a conversa. */
  onOpenEspecialistas?: () => void
}) {
  // Rascunho por-conversa na store → sobrevive a trocar de modo/conversa (não some
  // no desmonte do componente). Isolado por seletor: escrever não re-renderiza quem
  // mais escuta o useChat.
  const value = useChat((s) => (s.activeId ? (s.drafts[s.activeId] ?? "") : ""))
  // assina igual ao setter do useState (aceita string OU updater) p/ os hooks.
  const setValue = useCallback((v: SetStateAction<string>) => {
    const id = useChat.getState().activeId
    if (!id) return
    const next =
      typeof v === "function"
        ? v(useChat.getState().drafts[id] ?? "")
        : v
    useChat.getState().setDraft(id, next)
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
  const activeId = useChat((s) => s.activeId)

  // conversa estabelecida trava no agent/modelo/effort dela; o seletor reflete.
  // Pareceres de conselheiro (advice) NÃO travam a identidade (Especialistas E1).
  // (Computado ANTES dos hooks: o popover "/" descobre comandos POR AGENT.)
  const locked = hasExecutorTurn(conv.items)
  const effectiveDest = locked ? conv.agent : destination
  const effectiveModel = locked ? (conv.reqModel ?? "default") : model
  const effectiveEffort = locked ? (conv.effort ?? "default") : effort

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
  const history = usePromptHistory({ conv, activeId, value, setValue })
  const att = useAttachments({ activeId, setValue, focus: focusComposer })

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
  // Resumo colapsado da identidade na linha de execução: os 4 seletores viraram
  // UMA legenda clicável (eles travam no 1º envio — são estado, não controle).
  // "default" não vira texto: dizer "default" não informa nada a mais que o
  // nome do agent já diz.
  const identityLabel = [
    dest.label,
    effectiveModel !== "default"
      ? (agentModels(effectiveDest).find((m) => m.value === effectiveModel)?.pill ??
        agentModels(effectiveDest).find((m) => m.value === effectiveModel)?.label ??
        effectiveModel)
      : null,
    effectiveEffort !== "default" ? effectiveEffort : null,
  ]
    .filter(Boolean)
    .join(" · ")
  // agent EFETIVO da conversa — a nota honesta por agent (permissionNote) precisa
  // saber QUEM vai obedecer (ou ignorar) o modo de permissão do projeto.
  const convAgent = hasExecutorTurn(conv.items) ? conv.agent : effectiveDest
  // trava de capacidade: o agent-alvo precisa suportar cada anexo (espelha o trait)
  const caps = agentCaps(effectiveDest)
  const allSupported = attachments.every((a) =>
    a.kind === "image" ? caps.image : a.kind === "pdf" ? caps.pdf : false,
  )
  // aceita um texto explícito porque o submit do editor chega com o texto
  // recém-serializado (que pode estar 1 tick à frente do draft).
  const canSendWith = (text: string) =>
    (text.length > 0 || attachments.length > 0) &&
    !disabled &&
    !running &&
    !finalizing &&
    !missionRunning &&
    allSupported
  const canSend = canSendWith(value.trim())

  // "Planejar primeiro" (por conversa, na store): NÃO trava com a conversa — é
  // um modo do PRÓXIMO envio, não config fixa do 1º run. Fica ligado até o
  // usuário desligar (ou até aprovar um plano, que desliga sozinho).
  const planFirst = !!conv.planFirst

  // config EFETIVO (numa conv travada = o do 1º run, exibido nos pills), nunca o
  // estado local cru, que sobra de outra conv e não reseta na troca.
  const effCfg = {
    agent: effectiveDest,
    model: effectiveModel === "default" ? null : effectiveModel,
    effort: effectiveEffort === "default" ? null : effectiveEffort,
    planFirst,
  }

  /** Foca o editor do console (FocusBridgePlugin do Lexical). */
  function focusComposer() {
    lexicalFocus.current?.()
  }

  /** Envio único: o botão chama sem argumento (lê o draft); o Enter do editor
   *  passa o texto que acabou de serializar (MESMA string `@nome`). */
  function submit(overrideText?: string) {
    const text = (overrideText ?? value).trim()
    // Turno em andamento: Enter ENFILEIRA (texto + anexos — deixar o anexo pra
    // trás fazia a imagem "enviada" ficar órfã no composer e nunca ir junto).
    // O handleSend detecta o running e empilha na fila.
    if (running || finalizing) {
      if ((!text && attachments.length === 0) || disabled || !allSupported)
        return
      onSend(text, effCfg, attachments)
      setValue("")
      setAttachments([])
      resetHistory()
      focusComposer()
      return
    }
    if (!canSendWith(text)) return
    onSend(text, effCfg, attachments)
    setValue("")
    setAttachments([])
    resetHistory()
    focusComposer()
  }

  // Placeholder por estado. A dica de "/" sai só quando o projeto tem comandos
  // de fato (senão seria teatro).
  const placeholder = missionRunning
    ? "Missão em andamento; pare a missão para enviar manualmente…"
    : running || finalizing
      ? "Enfileirar próxima mensagem…"
      : commands.length > 0
        ? "Peça algo…  ou / para comandos"
        : "Peça algo ao seu time de agents…"

  // Comandos "/", paste → anexo e histórico ↑/↓ estilo shell: o LexicalComposer
  // recebe pontes pros hooks (a lógica mora aqui fora, os gestos de teclado nos
  // plugins do editor). O menu "/" é o próprio SlashPopover (renderizado
  // abaixo, gateado só por showSlash). O "@" de arquivos vai por prop
  // (mentionFiles, listagem do useAtMentions).
  // popover "/" efetivo: o showSlash do hook, suprimido com pill presente.
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
        placeholder={placeholder}
        mentionNames={presets.map((p) => p.name)}
        mentionFiles={projectFiles}
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
            project={project}
            convAgent={convAgent}
            planFirst={planFirst}
            onTogglePlanFirst={() => {
              const id = useChat.getState().activeId
              if (id) useChat.getState().setPlanFirst(id, !planFirst)
            }}
            running={running}
            identityLabel={identityLabel}
            identityLocked={locked}
            identity={
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
                onModelChange={(v) => {
                  setModel(v)
                  clearPresetOnManualChange()
                }}
                effectiveEffort={effectiveEffort}
                onEffortChange={(v) => {
                  setEffort(v)
                  clearPresetOnManualChange()
                }}
              />
            }
          />
        }
        footer={
          <ComposerActions
            stopTitle={deferredStopWarning(pendingDeferred(conv.items))}
            onFusion={() => setFusionOpen(true)}
            fusionDisabled={
              !activeId || disabled || running || finalizing || missionRunning
            }
            fusionTitle={
              activeId
                ? "Disputar entre agents (candidatos read-only); o vencedor continua nesta conversa"
                : "Sem conversa ativa; a disputa precisa de uma conversa de destino"
            }
            onMission={() => setMissionOpen(true)}
            missionDisabled={disabled || running || finalizing || missionRunning}
            onAttach={attach}
            onEspecialistas={onOpenEspecialistas}
            running={running}
            onStop={onStop}
            onSubmit={submit}
            canSend={canSend}
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
