// Launcher da MISSÃO: dialog acionado do composer (Rocket). A TAREFA é a
// estrela (textarea grande, ditado, anexos); o time do preset vira rascunho
// editável fase-a-fase (agent+modelo inline → "Personalizado", lógica pura em
// lib/missionDraft), incluindo o TETO de custo (clique edita; vazio/0 = sem
// teto) — o launch passa o teto ao store via preset efetivo. Anexos reusam o pipeline do composer (useAttachments) com
// a MESMA trava de capacidade — valem p/ o agent da FASE 1 e vão no prompt
// dela pelo caminho existente do runAgent (nada muda no Rust). Clicar fora NÃO
// fecha (anti miss-click); Esc/X fecham, mas rascunho sujo pede confirmação.
import { useEffect, useMemo, useRef, useState } from "react"
import { Paperclip, Rocket, Zap } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { RichSelect } from "@/components/ui/RichSelect"
import { AttachmentChips } from "@/components/chat/ComposerParts"
import { MicButton } from "@/components/chat/MicButton"
import { useAttachments } from "@/hooks/useAttachments"
import { useApp, useActiveProject } from "@/store/app"
import { useChat } from "@/store/chat"
import { useMission } from "@/store/mission"
import type {
  MissionGatePolicy,
  MissionPhaseDef,
  MissionPreset,
} from "@/lib/missionTypes"
import {
  GATE_POLICY_OPTIONS,
  SAVE_PRESET_ERROR_COPY,
  attachmentsSupported,
  clonePhases,
  draftCustomized,
  draftDirty,
  editPhase,
  normalizeGatePolicy,
  parseCapInput,
  saveDraftAsPreset,
  teamAutonomy,
  toggleTeamAutonomyWithGate,
} from "@/lib/missionDraft"
import { MissionPhaseRow } from "@/components/mission/PhaseRow"
import { cn } from "@/lib/utils"
import { agentCaps, agentDef } from "@/lib/agents"
import { fmtCost } from "@/lib/format"
import { missionPlanMode, validateMissionPlan } from "@/lib/missionPlans"

// Sentinela do seletor de time quando as fases foram editadas inline. Nunca
// chega ao store — o launch monta o preset efetivo com as fases do rascunho.
const CUSTOM_PRESET = "__custom__"

export function MissionLauncher({
  open,
  onOpenChange,
  initialTask,
  onLaunched,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Texto já digitado no composer → vira a tarefa (editável aqui). */
  initialTask?: string
  /** Chamado após lançar (o composer limpa o rascunho, já virou a missão). */
  onLaunched?: () => void
}) {
  const presets = useApp((s) => s.settings.missionPresets)
  const project = useActiveProject()
  // Teto de permissão da missão (o launch usa isto por baixo). Alimenta a nota
  // de clamp: auto só "morde" no Padrão.
  const projectPermission = project?.permissionMode ?? "padrao"
  const activeId = useChat((s) => s.activeId)
  // uma missão por conversa: com uma rodando, o launch do store ignora — aqui
  // o botão já desabilita e explica (guarda anti-duplo-start visível).
  const missionRunning = useMission((s) =>
    activeId ? s.byConv[activeId]?.status === "running" : false,
  )

  const [presetId, setPresetId] = useState<string | null>(null)
  const [task, setTask] = useState("")
  // rascunho editável das fases (clone — editar aqui nunca muta o preset)
  const [phases, setPhases] = useState<MissionPhaseDef[]>([])
  // política de GATE editável (MH3.3; inicia do preset, reseta ao trocar)
  const [gatePolicy, setGatePolicy] = useState<MissionGatePolicy>("agente")
  // TETO de custo editável (null = sem teto; inicia do preset, reseta ao trocar)
  const [capUsd, setCapUsd] = useState<number | null>(null)
  const [capEditing, setCapEditing] = useState(false)
  const [capInput, setCapInput] = useState("")
  // "Salvar como time" (MH3.1): input inline do nome + erro honesto.
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveName, setSaveName] = useState("")
  const [saveError, setSaveError] = useState<string | null>(null)
  // Esc cancela a edição do teto; o blur do unmount NÃO deve commitar por cima.
  const capCancelRef = useRef(false)
  const taskRef = useRef<HTMLTextAreaElement>(null)

  const preset = presets.find((p) => p.id === presetId) ?? presets[0] ?? null

  // Anexos: MESMO pipeline do composer (paste de imagem/PDF + clipe → @path).
  // O estado é local do launcher; os do composer não se misturam.
  const att = useAttachments({ activeId, setValue: setTask, textareaRef: taskRef })
  const { attachments, setAttachments, removeAttachment, onPaste, attach } = att

  // ao abrir: tarefa parte do rascunho do composer (editar aqui não mexe lá) e
  // as fases partem do preset corrente (rascunho novo a cada abertura).
  useEffect(() => {
    if (!open) return
    setTask(initialTask ?? "")
    const p =
      useApp.getState().settings.missionPresets.find((x) => x.id === presetId) ??
      useApp.getState().settings.missionPresets[0] ??
      null
    setPhases(p ? clonePhases(p.phases) : [])
    setGatePolicy(normalizeGatePolicy(p?.gatePolicy))
    setCapUsd(p?.maxCostUsd ?? null)
    setCapEditing(false)
    setSaveOpen(false)
    setSaveName("")
    setSaveError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTask])

  // editar uma fase, a política de gate OU o teto → "Personalizado"
  // (régua ÚNICA compartilhada com o Dock: draftCustomized)
  const customized = preset
    ? draftCustomized({ preset, phases, gatePolicy, capUsd })
    : false

  // trava de capacidade: os anexos vão pro prompt da FASE 1 → valem as caps do
  // agent dela (mesma regra do composer, espelho do trait Rust).
  const firstAgent = phases[0]?.agent ?? null
  const caps = agentCaps(firstAgent ?? "")
  const firstAgentLabel = firstAgent
    ? (agentDef(firstAgent)?.label ?? firstAgent)
    : "o agent da fase 1"
  const allSupported = attachmentsSupported(attachments, caps)
  const effectiveDraft = preset
    ? { ...preset, phases, maxCostUsd: capUsd, gatePolicy }
    : null
  const planIssues = effectiveDraft ? validateMissionPlan(effectiveDraft) : []

  const canLaunch =
    !!preset &&
    phases.length > 0 &&
    task.trim().length > 0 &&
    !!project &&
    !!activeId &&
    !missionRunning &&
    allSupported &&
    planIssues.length === 0

  const presetOptions = useMemo(() => {
    const opts = presets.map((p) => ({
      value: p.id,
      label: p.name,
      description: `${missionPlanMode(p) === "graph" ? "Fluxo visual" : "Rota"} · ${p.phases.length} fases${
        p.maxCostUsd != null ? ` · teto ${fmtCost(p.maxCostUsd)}` : ""
      }`,
    }))
    if (customized && preset) {
      opts.push({
        value: CUSTOM_PRESET,
        label: "Personalizado",
        description: `baseado em ${preset.name} (editado aqui)`,
      })
    }
    return opts
  }, [presets, customized, preset])

  function pickPreset(id: string) {
    if (id === CUSTOM_PRESET) return // já é o rascunho corrente
    setPresetId(id)
    const p = presets.find((x) => x.id === id)
    setPhases(p ? clonePhases(p.phases) : [])
    // trocar de preset RESETA teto e política pros do preset (regra das fases)
    setGatePolicy(normalizeGatePolicy(p?.gatePolicy))
    setCapUsd(p?.maxCostUsd ?? null)
    setCapEditing(false)
    setSaveOpen(false)
    setSaveError(null)
  }

  /** MH3.1 — salva o rascunho "Personalizado" como time novo nas Settings e
   *  aponta o seletor pra ele (o rascunho vira o próprio preset salvo). */
  function saveAsTeam() {
    const res = saveDraftAsPreset({
      name: saveName,
      presets,
      phases,
      maxCostUsd: capUsd,
      gatePolicy,
      sourcePlan: preset ?? undefined,
    })
    if (!res.ok) {
      setSaveError(SAVE_PRESET_ERROR_COPY[res.error])
      return
    }
    useApp.getState().setSettings({ missionPresets: res.presets })
    setPresetId(res.preset.id)
    setSaveOpen(false)
    setSaveName("")
    setSaveError(null)
  }

  /** Confirma o input do teto (Enter/blur). Inválido → mantém o anterior. */
  function commitCap() {
    const parsed = parseCapInput(capInput)
    if (parsed !== undefined) setCapUsd(parsed)
    setCapEditing(false)
  }

  /** Zera o estado local (rascunho descartado ou lançado). Com `deleteBlobs`,
   *  apaga também os blobs pendentes do disco — NUNCA após o launch (a fase 1
   *  ainda vai ler os arquivos). */
  function resetLocal(deleteBlobs: boolean) {
    if (deleteBlobs) {
      for (const a of attachments) removeAttachment(a.path)
    } else {
      setAttachments([])
    }
    setTask("")
    if (preset) {
      setPhases(clonePhases(preset.phases))
      setGatePolicy(normalizeGatePolicy(preset.gatePolicy))
      setCapUsd(preset.maxCostUsd ?? null)
    }
    setCapEditing(false)
    setSaveOpen(false)
    setSaveName("")
    setSaveError(null)
  }

  // Esc e o X do dialog caem aqui (controlado). Clicar FORA nem chega — o
  // onInteractOutside abaixo bloqueia (anti miss-click). Rascunho sujo →
  // confirmação antes de descartar.
  function handleOpenChange(next: boolean) {
    if (!next) {
      const dirty = draftDirty({
        task,
        initialTask,
        attachmentCount: attachments.length,
        customized,
      })
      if (dirty && !window.confirm("Descartar o rascunho da missão?")) return
      resetLocal(true)
    }
    onOpenChange(next)
  }

  function launch() {
    if (!canLaunch || !preset || !project || !activeId) return
    // conversa ainda carregando do disco: lançar agora criaria estado órfão
    // (mesmo guard do send do Linear e do Fusion).
    if (!useChat.getState().byId[activeId]) return
    // preset EFETIVO: fases E teto do rascunho (editados ou não) sobre o
    // preset base — é ele que o store usa (maxCostUsd da missão sai daqui).
    const effective: MissionPreset = {
      ...preset,
      name: customized ? `${preset.name} · personalizado` : preset.name,
      phases: clonePhases(phases),
      maxCostUsd: capUsd,
      gatePolicy,
    }
    void useMission
      .getState()
      .launch(
        activeId,
        effective,
        task.trim(),
        project.id,
        project.path,
        project.permissionMode ?? "padrao",
        attachments,
      )
    // não apaga os blobs: a fase 1 lê os anexos do disco durante o run.
    resetLocal(false)
    onOpenChange(false)
    onLaunched?.()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="gap-0 overflow-hidden p-0 sm:max-w-3xl"
        // anti miss-click: clicar fora do dialog NÃO fecha (Esc e X fecham,
        // com confirmação se houver rascunho — ver handleOpenChange).
        onInteractOutside={(e) => e.preventDefault()}
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="border-b px-5 py-3.5 text-left">
          <DialogTitle className="flex items-center gap-2 pr-7 text-[14px]">
            <Rocket className="size-4 text-brass" />
            Lançar missão
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            Escolha um Plano de voo; o time de agents executa a rota no worktree
            desta conversa.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 px-5 py-4">
          {/* ── A TAREFA é a estrela: textarea grande, anexos e ditado ── */}
          <div>
            <div className="mb-1.5 flex items-center">
              <span className="label-mono">Tarefa</span>
            </div>
            <div className="rounded-lg border bg-secondary/20 transition-colors focus-within:border-brass/50">
              <AttachmentChips
                attachments={attachments}
                caps={caps}
                destLabel={firstAgentLabel}
                onRemove={removeAttachment}
              />
              <Textarea
                ref={taskRef}
                value={task}
                onChange={(e) => setTask(e.target.value)}
                onPaste={onPaste}
                placeholder="Descreva a tarefa da missão… (cole imagens/PDF; 🎤 dita)"
                aria-label="Tarefa da missão"
                className="max-h-72 min-h-40 resize-none border-0 bg-transparent! px-3 pt-3 text-[14px] leading-relaxed shadow-none focus-visible:ring-0"
                autoFocus
              />
              <div className="flex items-center gap-0.5 px-2 pb-2">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void attach()}
                  className="rounded-full text-muted-foreground hover:text-foreground"
                  title="Anexar arquivo (insere @caminho; cole imagem/PDF direto no texto)"
                  aria-label="Anexar arquivo"
                >
                  <Paperclip className="size-4" />
                </Button>
                {/* ditado local (mesmo comportamento do composer), caindo AQUI */}
                <MicButton
                  onText={(text) =>
                    setTask((cur) =>
                      cur ? `${cur.replace(/\s+$/, "")} ${text}` : text,
                    )
                  }
                />
                <span
                  className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground/60"
                  aria-label="Contador de caracteres"
                >
                  {task.length > 0 ? task.length.toLocaleString("pt-BR") : ""}
                </span>
              </div>
            </div>
            {!allSupported && (
              <p className="mt-1.5 text-[12px] text-st-error">
                Há anexo não suportado por {firstAgentLabel} (fase 1). Remova o
                anexo ou troque o agent da fase 1.
              </p>
            )}
          </div>

          {/* ── Plano: preset como ponto de partida, fases editáveis inline ── */}
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="label-mono">Plano de voo</span>
              {preset ? (
                <RichSelect
                  value={customized ? CUSTOM_PRESET : preset.id}
                  onValueChange={pickPreset}
                  aria-label="Plano de voo da missão"
                  triggerClassName="h-7 gap-1.5 px-2 text-[13px] text-foreground data-[size=default]:h-7"
                  options={presetOptions}
                />
              ) : (
                <span className="text-[12px] text-st-error">
                  Nenhum Plano de voo configurado (Geral ▸ Planos de voo)
                </span>
              )}
              {/* MH3.1 — rascunho "Personalizado" pode virar time salvo. */}
              {preset && customized && !saveOpen && (
                <button
                  type="button"
                  onClick={() => {
                    setSaveOpen(true)
                    setSaveName("")
                    setSaveError(null)
                  }}
                  title="Salvar este rascunho como um Plano de voo novo"
                  className="shrink-0 text-[12px] text-brass transition-colors hover:text-brass/80"
                >
                  Salvar como plano
                </button>
              )}
              {/* Toggle de missão: liga "auto" no TIME TODO (ou desliga). Ao
                  LIGAR também põe a política de gate em "nunca" (autonomia
                  total); ao desligar, a política volta pra do preset (MH3.3).
                  O estado "misto" (alguns membros em auto) aparece com o traço,
                  clicar resolve pra auto-todos. Cada membro ainda pode divergir
                  na pílula da própria linha. */}
              {preset && phases.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const next = toggleTeamAutonomyWithGate({
                      phases,
                      gatePolicy,
                      presetGatePolicy: preset.gatePolicy,
                    })
                    setPhases(next.phases)
                    setGatePolicy(next.gatePolicy)
                  }}
                  aria-pressed={teamAutonomy(phases) === "auto"}
                  title={
                    teamAutonomy(phases) === "auto"
                      ? "Autonomia total ligada: sem pausas de gate e permissão auto (cada CLI com seu freio de segurança). Desligar volta a política de gate do preset."
                      : "Autonomia total: liga Auto no time todo, sem pausas de gate e permissão auto (cada CLI com seu freio de segurança). Você ainda pode ajustar membro a membro."
                  }
                  className={cn(
                    "ml-auto flex h-7 shrink-0 items-center gap-1.5 rounded-md border px-2 text-[12px] font-medium transition-colors",
                    // Ligado = o time inteiro roda sem pedir. Isso é RISCO
                    // AUTORIZADO, e o §2 dá âmbar pra ele — não é seleção
                    // (neutro esconderia o risco) nem gesto (brass).
                    teamAutonomy(phases) === "auto"
                      ? "border-st-warning/50 bg-st-warning/15 text-st-warning"
                      : "border-border/60 text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Zap className="size-3" />
                  {teamAutonomy(phases) === "auto"
                    ? "Auto: time todo"
                    : teamAutonomy(phases) === "mixed"
                      ? "Auto: parcial"
                      : "Autonomia"}
                </button>
              )}
            </div>
            {planIssues.length > 0 && (
              <p className="mt-1.5 text-[12px] text-st-error">
                Este plano não pode decolar: {planIssues[0]}
              </p>
            )}

            {/* MH3.1 — input inline do nome do time (nunca window.prompt);
                Esc fecha SÓ o input, Enter salva; erro honesto embaixo. */}
            {preset && saveOpen && (
              <div className="mb-2">
                <div className="flex items-center gap-1.5">
                  <input
                    value={saveName}
                    onChange={(e) => {
                      setSaveName(e.target.value)
                      setSaveError(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        saveAsTeam()
                      } else if (e.key === "Escape") {
                        e.preventDefault()
                        e.stopPropagation()
                        setSaveOpen(false)
                        setSaveError(null)
                      }
                    }}
                    placeholder="Nome do novo Plano de voo"
                    aria-label="Nome do novo Plano de voo"
                    className="h-7 flex-1 rounded-md border bg-background px-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-brass/50"
                    autoFocus
                  />
                  <Button size="sm" className="h-7" onClick={saveAsTeam}>
                    Salvar
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-muted-foreground"
                    onClick={() => {
                      setSaveOpen(false)
                      setSaveError(null)
                    }}
                  >
                    Cancelar
                  </Button>
                </div>
                {saveError && (
                  <p className="mt-1 text-[12px] text-st-error">{saveError}</p>
                )}
              </div>
            )}

            {preset && (
              <div className="rounded-lg border bg-secondary/30 px-3 py-1.5">
                {phases.map((ph, i) => (
                  <MissionPhaseRow
                    key={ph.id}
                    phase={ph}
                    index={i}
                    onEdit={(edit) => setPhases((cur) => editPhase(cur, i, edit))}
                  />
                ))}
                {/* rodapé do time: política de GATE (MH3.3, discreta) à
                    esquerda; teto EDITÁVEL à direita (clique vira input;
                    Enter/blur confirma, Esc cancela; vazio/0 = SEM teto). */}
                <div className="mt-0.5 flex h-8 items-center justify-between gap-2 border-t">
                  <RichSelect
                    value={gatePolicy}
                    onValueChange={(v) => setGatePolicy(v as MissionGatePolicy)}
                    aria-label="Política de gate humano da missão"
                    title="Quando a missão pausa pra te perguntar (gate humano)"
                    triggerClassName="h-6 gap-1 px-1 text-[11px] text-muted-foreground data-[size=default]:h-6"
                    options={GATE_POLICY_OPTIONS}
                  />
                  {capEditing ? (
                    <label className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">
                      teto US$
                      <input
                        value={capInput}
                        onChange={(e) => setCapInput(e.target.value)}
                        onBlur={() => {
                          if (capCancelRef.current) return
                          commitCap()
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            commitCap()
                          } else if (e.key === "Escape") {
                            // Esc cancela SÓ a edição do teto, não o dialog.
                            e.preventDefault()
                            e.stopPropagation()
                            capCancelRef.current = true
                            setCapEditing(false)
                          }
                        }}
                        inputMode="decimal"
                        placeholder="sem teto"
                        aria-label="Teto de custo da missão em US$ (vazio ou 0 = sem teto)"
                        className="h-5.5 w-16 rounded border bg-background px-1.5 text-right font-mono text-[11px] tabular-nums text-foreground outline-none placeholder:text-muted-foreground/50 focus:border-brass/50"
                        autoFocus
                      />
                    </label>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        capCancelRef.current = false
                        setCapInput(
                          capUsd != null ? String(capUsd).replace(".", ",") : "",
                        )
                        setCapEditing(true)
                      }}
                      title="Editar teto de custo da missão (vazio ou 0 = sem teto)"
                      aria-label="Editar teto de custo da missão"
                      className="font-mono text-[11px] tabular-nums text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {capUsd != null ? (
                        <>teto {fmtCost(capUsd)}</>
                      ) : (
                        <span className="text-muted-foreground/60">
                          sem teto
                        </span>
                      )}
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Nota de clamp: auto é a versão SEM-PAUSA do Padrão. Se o projeto
                está em Leitura ou Liberado, ligar auto numa fase não faz nada
                (o teto do projeto manda) — dizer isso evita a surpresa de
                "liguei auto e nada mudou". */}
            {preset &&
              teamAutonomy(phases) !== "inherit" &&
              projectPermission !== "padrao" && (
                <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                  {projectPermission === "leitura"
                    ? "Projeto em Leitura: Auto não concede escrita, as fases seguem só-leitura. O teto do projeto manda."
                    : "Projeto em Liberado: já roda sem pedir e sem freio; Auto não altera (seria mais restrito). O teto do projeto manda."}
                </p>
              )}
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 border-t px-5 py-3">
          {missionRunning && (
            <span className="mr-auto text-[12px] text-muted-foreground">
              Já há uma missão rodando nesta conversa.
            </span>
          )}
          <Button size="sm" disabled={!canLaunch} onClick={launch}>
            <Rocket className="size-3.5" />
            Lançar missão
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
