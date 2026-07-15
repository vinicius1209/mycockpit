// Launcher da MISSÃO: dialog acionado do composer (Rocket). A TAREFA é a
// estrela (textarea grande, ditado, anexos); o time do preset vira rascunho
// editável fase-a-fase (agent+modelo inline → "Personalizado", lógica pura em
// lib/missionDraft). Anexos reusam o pipeline do composer (useAttachments) com
// a MESMA trava de capacidade — valem p/ o agent da FASE 1 e vão no prompt
// dela pelo caminho existente do runAgent (nada muda no Rust). Clicar fora NÃO
// fecha (anti miss-click); Esc/X fecham, mas rascunho sujo pede confirmação.
import { useEffect, useMemo, useRef, useState } from "react"
import { Paperclip, Rocket } from "lucide-react"
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
import type { MissionPhaseDef, MissionPreset } from "@/lib/missionTypes"
import {
  attachmentsSupported,
  clonePhases,
  draftDirty,
  editPhase,
  phasesCustomized,
  type PhaseEdit,
} from "@/lib/missionDraft"
import {
  LEAGUE_DESTINATIONS,
  agentCaps,
  agentDef,
  agentModels,
} from "@/lib/agents"
import { fmtCost } from "@/lib/format"

// Sentinela do seletor de time quando as fases foram editadas inline. Nunca
// chega ao store — o launch monta o preset efetivo com as fases do rascunho.
const CUSTOM_PRESET = "__custom__"

const SELECT_TRIGGER =
  "h-7 gap-1 px-2 text-[12px] text-muted-foreground data-[size=default]:h-7"

/** UMA fase do rascunho: nº, rótulo e selects compactos de agent + modelo
 *  (mesmas opções do composer, via lib/agents; modelo respeita o agent). */
function PhaseDraftRow({
  phase,
  index,
  onEdit,
}: {
  phase: MissionPhaseDef
  index: number
  onEdit: (edit: PhaseEdit) => void
}) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="w-4 shrink-0 text-center font-mono text-[10px] tabular-nums text-muted-foreground/70">
        {index + 1}
      </span>
      <span className="min-w-0 truncate text-[12.5px] text-foreground/85">
        {phase.label}
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <RichSelect
          value={phase.agent}
          onValueChange={(v) => onEdit({ agent: v })}
          aria-label={`Agent da fase ${index + 1}`}
          triggerClassName={SELECT_TRIGGER}
          options={LEAGUE_DESTINATIONS.map((d) => ({
            value: d.id,
            label: d.label,
            description: d.description,
          }))}
        />
        <RichSelect
          value={phase.model ?? "default"}
          onValueChange={(v) => onEdit({ model: v === "default" ? null : v })}
          aria-label={`Modelo da fase ${index + 1}`}
          triggerClassName={SELECT_TRIGGER}
          options={agentModels(phase.agent)}
        />
      </div>
    </div>
  )
}

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTask])

  // editar uma fase → o seletor de time passa a mostrar "Personalizado"
  const customized = preset ? phasesCustomized(preset.phases, phases) : false

  // trava de capacidade: os anexos vão pro prompt da FASE 1 → valem as caps do
  // agent dela (mesma regra do composer, espelho do trait Rust).
  const firstAgent = phases[0]?.agent ?? null
  const caps = agentCaps(firstAgent ?? "")
  const firstAgentLabel = firstAgent
    ? (agentDef(firstAgent)?.label ?? firstAgent)
    : "o agent da fase 1"
  const allSupported = attachmentsSupported(attachments, caps)

  const canLaunch =
    !!preset &&
    phases.length > 0 &&
    task.trim().length > 0 &&
    !!project &&
    !!activeId &&
    !missionRunning &&
    allSupported

  const presetOptions = useMemo(() => {
    const opts = presets.map((p) => ({
      value: p.id,
      label: p.name,
      description: `${p.phases.length} fases${
        p.maxCostUsd != null ? ` · teto ${fmtCost(p.maxCostUsd)}` : ""
      }`,
    }))
    if (customized && preset) {
      opts.push({
        value: CUSTOM_PRESET,
        label: "Personalizado",
        description: `baseado em ${preset.name} — fases editadas aqui`,
      })
    }
    return opts
  }, [presets, customized, preset])

  function pickPreset(id: string) {
    if (id === CUSTOM_PRESET) return // já é o rascunho corrente
    setPresetId(id)
    const p = presets.find((x) => x.id === id)
    setPhases(p ? clonePhases(p.phases) : [])
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
    if (preset) setPhases(clonePhases(preset.phases))
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
    // preset EFETIVO: fases do rascunho (editadas ou não) sobre o preset base.
    const effective: MissionPreset = {
      ...preset,
      name: customized ? `${preset.name} · personalizado` : preset.name,
      phases: clonePhases(phases),
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
            Um time de agents executa a tarefa em fases sequenciais, no worktree
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
                className="max-h-72 min-h-40 resize-none border-0 bg-transparent! px-3 pt-3 text-[13.5px] leading-relaxed shadow-none focus-visible:ring-0"
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
                  className="ml-auto font-mono text-[10.5px] tabular-nums text-muted-foreground/60"
                  aria-label="Contador de caracteres"
                >
                  {task.length > 0 ? task.length.toLocaleString("pt-BR") : ""}
                </span>
              </div>
            </div>
            {!allSupported && (
              <p className="mt-1.5 text-[11.5px] text-st-error">
                Há anexo não suportado por {firstAgentLabel} (fase 1) — remova o
                anexo ou troque o agent da fase 1.
              </p>
            )}
          </div>

          {/* ── Time: preset como ponto de partida, fases editáveis inline ── */}
          <div>
            <div className="mb-1.5 flex items-center gap-2">
              <span className="label-mono">Time</span>
              {preset ? (
                <RichSelect
                  value={customized ? CUSTOM_PRESET : preset.id}
                  onValueChange={pickPreset}
                  aria-label="Preset da missão"
                  triggerClassName="h-7 gap-1.5 px-2 text-[12.5px] text-foreground data-[size=default]:h-7"
                  options={presetOptions}
                />
              ) : (
                <span className="text-[12px] text-st-error">
                  Nenhum preset configurado (Settings ▸ Missions)
                </span>
              )}
            </div>

            {preset && (
              <div className="rounded-lg border bg-secondary/30 px-3 py-1.5">
                {phases.map((ph, i) => (
                  <PhaseDraftRow
                    key={ph.id}
                    phase={ph}
                    index={i}
                    onEdit={(edit) => setPhases((cur) => editPhase(cur, i, edit))}
                  />
                ))}
                {preset.maxCostUsd != null && (
                  <div className="mt-0.5 border-t py-1.5 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                    teto {fmtCost(preset.maxCostUsd)}
                  </div>
                )}
              </div>
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
