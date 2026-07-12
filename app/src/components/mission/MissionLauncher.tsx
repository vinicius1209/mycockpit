// Launcher da MISSÃO: dialog leve acionado do composer (Rocket). Escolhe o
// preset (settings.missionPresets), mostra o time fase-a-fase, recebe a tarefa
// (pré-preenchida com o rascunho do composer) e dispara useMission.launch.
// Padrão de dialog do CommandMenu (ui/dialog); code contra a API do store.
import { useEffect, useState } from "react"
import { Rocket } from "lucide-react"
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
import { useApp, useActiveProject } from "@/store/app"
import { useChat } from "@/store/chat"
import { useMission } from "@/store/mission"
import { phaseAgentModel } from "@/components/mission/MissionTimeline"
import { fmtCost } from "@/lib/format"

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
  // ao abrir, a tarefa parte do rascunho do composer (editar aqui não mexe lá)
  useEffect(() => {
    if (open) setTask(initialTask ?? "")
  }, [open, initialTask])

  const preset =
    presets.find((p) => p.id === presetId) ?? presets[0] ?? null
  const canLaunch =
    !!preset &&
    task.trim().length > 0 &&
    !!project &&
    !!activeId &&
    !missionRunning

  function launch() {
    if (!canLaunch || !preset || !project || !activeId) return
    // conversa ainda carregando do disco: lançar agora criaria estado órfão
    // (mesmo guard do send do Linear e do Fusion).
    if (!useChat.getState().byId[activeId]) return
    void useMission
      .getState()
      .launch(
        activeId,
        preset,
        task.trim(),
        project.path,
        project.permissionMode ?? "padrao",
      )
    onOpenChange(false)
    onLaunched?.()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg">
        <DialogHeader className="border-b px-5 py-3 text-left">
          <DialogTitle className="flex items-center gap-2 pr-7 text-[14px]">
            <Rocket className="size-4 text-brass" />
            Lançar missão
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            Um time de agents executa a tarefa em fases sequenciais, no worktree
            desta conversa.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-muted-foreground">Time</span>
            {preset ? (
              <RichSelect
                value={preset.id}
                onValueChange={setPresetId}
                aria-label="Preset da missão"
                triggerClassName="h-8 gap-1.5 px-2.5 text-[13px] text-foreground data-[size=default]:h-8"
                options={presets.map((p) => ({
                  value: p.id,
                  label: p.name,
                  description: `${p.phases.length} fases${
                    p.maxCostUsd != null
                      ? ` · teto ${fmtCost(p.maxCostUsd)}`
                      : ""
                  }`,
                }))}
              />
            ) : (
              <span className="text-[12px] text-st-error">
                Nenhum preset configurado (Settings ▸ Missions)
              </span>
            )}
          </div>

          {preset && (
            <div className="rounded-lg border bg-secondary/30 px-3 py-2">
              {preset.phases.map((ph, i) => (
                <div
                  key={ph.id}
                  className="flex items-center gap-2 py-1 text-[12px]"
                >
                  <span className="w-4 shrink-0 text-center font-mono text-[10px] tabular-nums text-muted-foreground/70">
                    {i + 1}
                  </span>
                  <span className="truncate text-foreground/85">
                    {ph.label}
                  </span>
                  <span className="ml-auto shrink-0 text-muted-foreground">
                    {phaseAgentModel(ph)}
                  </span>
                </div>
              ))}
              {preset.maxCostUsd != null && (
                <div className="mt-1 border-t pt-1.5 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                  teto {fmtCost(preset.maxCostUsd)}
                </div>
              )}
            </div>
          )}

          <Textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Descreva a tarefa da missão…"
            className="max-h-48 min-h-20 text-[13px] leading-relaxed"
            autoFocus
          />
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
