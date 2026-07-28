import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type SetStateAction,
} from "react"
import { ComposerShell } from "@/components/chat/ComposerShell"
import {
  SlashPopover,
  AtPopover,
  AttachmentChips,
  QueuedChips,
  ComposerActions,
  IdentityControls,
  SuggestionChips,
  NO_PRESET,
} from "@/components/chat/ComposerParts"
import { ExecutionRow } from "@/components/chat/ExecutionRow"
import { useSlashCommands } from "@/hooks/useSlashCommands"
import { useAtMentions } from "@/hooks/useAtMentions"
import { usePromptHistory } from "@/hooks/usePromptHistory"
import { useAttachments } from "@/hooks/useAttachments"
import { useActiveConv, useChat } from "@/store/chat"
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

export function CommandConsole({
  onSend,
  disabled,
  running,
  finalizing,
  missionRunning,
  onStop,
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
  const ref = useRef<HTMLTextAreaElement>(null)
  const conv = useActiveConv()
  const suggestions = conv.suggestions
  const suggesting = conv.suggesting
  const project = useActiveProject()
  const activeId = useChat((s) => s.activeId)

  // Popover "/" (comandos), popover "@" (referências), histórico ↑/↓ e anexos,
  // cada feature num hook. A precedência das teclas (slash > at > histórico >
  // Enter) continua montada no onKeyDown abaixo, intacta.
  const slash = useSlashCommands({ project, value, setValue, textareaRef: ref })
  const at = useAtMentions({ project, value, setValue, textareaRef: ref })
  const history = usePromptHistory({
    conv,
    activeId,
    value,
    setValue,
    textareaRef: ref,
  })
  const att = useAttachments({ activeId, setValue, textareaRef: ref })

  const {
    commands,
    slashMatches,
    showSlash,
    slashIdx,
    setSlashIdx,
    setSlashDismissed,
    insertCommand,
  } = slash
  const {
    atItems,
    showAt,
    atIdx,
    setAtIdx,
    setAtDismissed,
    setCursor,
    insertMention,
  } = at
  const { histIdx, setHistIdx, resetHistory, userPrompts, recallPrev, recallNext } =
    history
  const { attachments, setAttachments, removeAttachment, onPaste, attach } = att

  // conversa estabelecida trava no agent/modelo/effort dela; o seletor reflete
  const locked = conv.items.length > 0
  const effectiveDest = locked ? conv.agent : destination
  const effectiveModel = locked ? (conv.reqModel ?? "default") : model
  const effectiveEffort = locked ? (conv.effort ?? "default") : effort

  // S3.6 — presets (personas): a seleção mora na CONVERSA (conv.presetId), não
  // em estado local — o handleSend e a mesa leem de lá. Escolher um preset
  // seta agent/modelo/esforço de uma vez; mexer na camada crua desfaz a
  // seleção (o preset é o trio inteiro, não um item avulso).
  const presets = usePresets((s) => s.list)
  useEffect(() => {
    if (isTauri()) void usePresets.getState().load()
  }, [])
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
  const convAgent = conv.items.length > 0 ? conv.agent : effectiveDest
  // trava de capacidade: o agent-alvo precisa suportar cada anexo (espelha o trait)
  const caps = agentCaps(effectiveDest)
  const allSupported = attachments.every((a) =>
    a.kind === "image" ? caps.image : a.kind === "pdf" ? caps.pdf : false,
  )
  const canSend =
    (value.trim().length > 0 || attachments.length > 0) &&
    !disabled &&
    !running &&
    !finalizing &&
    !missionRunning &&
    allSupported

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

  function submit() {
    const text = value.trim()
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
      ref.current?.focus()
      return
    }
    if (!canSend) return
    onSend(text, effCfg, attachments)
    setValue("")
    setAttachments([])
    resetHistory()
    ref.current?.focus()
  }

  return (
    <div className="relative flex w-full flex-col gap-3">
      {showSlash && (
        <SlashPopover
          project={project}
          matches={slashMatches}
          idx={slashIdx}
          setIdx={setSlashIdx}
          onPick={insertCommand}
        />
      )}
      {/* "/" digitado num projeto SEM comandos: dica no lugar do silêncio (que
          parece bug — caso real: skills globais viraram symlinks quebrados). */}
      {!showSlash && /^\/[\w:-]*$/.test(value) && commands.length === 0 && (
        <div className="absolute bottom-full left-0 z-20 mb-2 w-full rounded-xl border bg-popover px-3 py-2.5 shadow-[var(--shadow-pop)]">
          <p className="text-[12px] text-muted-foreground">
            Nenhum comando ou skill neste projeto — crie arquivos .md em{" "}
            <span className="font-mono">.claude/commands</span> ou skills em{" "}
            <span className="font-mono">.claude/skills</span>.
          </p>
        </div>
      )}
      {showAt && !showSlash && (
        <AtPopover
          project={project}
          items={atItems}
          idx={atIdx}
          setIdx={setAtIdx}
          onPick={insertMention}
        />
      )}
      {activeId && (
        <QueuedChips
          queued={conv.queued ?? []}
          onRemove={(i) => useChat.getState().removeQueued(activeId, i)}
        />
      )}
      <ComposerShell
        textareaRef={ref}
        focusRing
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setCursor(e.target.selectionStart ?? e.target.value.length)
          setSlashDismissed(false)
          setAtDismissed(false)
          setHistIdx(null)
        }}
        onSelect={(e) => setCursor(e.currentTarget.selectionStart ?? 0)}
        onPaste={onPaste}
        onKeyDown={(e) => {
          if (showSlash) {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setSlashIdx((i) => (i + 1) % slashMatches.length)
              return
            }
            if (e.key === "ArrowUp") {
              e.preventDefault()
              setSlashIdx(
                (i) => (i - 1 + slashMatches.length) % slashMatches.length,
              )
              return
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault()
              insertCommand(slashMatches[slashIdx].name)
              return
            }
            if (e.key === "Escape") {
              e.preventDefault()
              setSlashDismissed(true)
              return
            }
          }
          if (showAt && !showSlash) {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setAtIdx((i) => (i + 1) % atItems.length)
              return
            }
            if (e.key === "ArrowUp") {
              e.preventDefault()
              setAtIdx((i) => (i - 1 + atItems.length) % atItems.length)
              return
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault()
              insertMention(atItems[atIdx].value)
              return
            }
            if (e.key === "Escape") {
              e.preventDefault()
              setAtDismissed(true)
              return
            }
          }
          // histórico tipo shell: ↑ recupera prompts (cursor na 1ª linha),
          // ↓ avança; só fora dos popovers de / e @.
          if (!showSlash && !showAt) {
            const ta = e.currentTarget
            const before = value.slice(0, ta.selectionStart ?? 0)
            const after = value.slice(ta.selectionEnd ?? value.length)
            if (
              e.key === "ArrowUp" &&
              !before.includes("\n") &&
              userPrompts.length > 0
            ) {
              e.preventDefault()
              recallPrev()
              return
            }
            if (
              e.key === "ArrowDown" &&
              histIdx !== null &&
              !after.includes("\n")
            ) {
              e.preventDefault()
              recallNext()
              return
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault()
            submit()
          }
        }}
        placeholder={
          missionRunning
            ? "Missão em andamento — pare a missão para enviar manualmente…"
            : running || finalizing
              ? "Enfileirar próxima mensagem…"
              : commands.length > 0
                ? "Peça algo…  ou / para comandos"
                : "Peça algo ao seu time de agents…"
        }
        rows={1}
        textareaClassName="max-h-[240px] min-h-[56px] resize-none border-0 bg-transparent! px-4 pt-3.5 text-[15px] leading-relaxed text-foreground shadow-none outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
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
            onFusion={() => setFusionOpen(true)}
            fusionDisabled={
              !activeId || disabled || running || finalizing || missionRunning
            }
            fusionTitle={
              activeId
                ? "Disputar entre agents — candidatos read-only; o vencedor continua nesta conversa"
                : "Sem conversa ativa — a disputa precisa de uma conversa de destino"
            }
            onMission={() => setMissionOpen(true)}
            missionDisabled={disabled || running || finalizing || missionRunning}
            onAttach={attach}
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
          ref.current?.focus()
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
