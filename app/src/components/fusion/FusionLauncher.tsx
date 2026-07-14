// Launcher da DISPUTA: dialog leve acionado do composer (⚔️), padrão do
// MissionLauncher. Monta a liga (candidatos configuráveis, 2–5), escolhe o
// juiz, recebe a tarefa (pré-preenchida com o rascunho do composer) e dispara
// useFusion.launch. Sem chip de destino: o launcher abre DE DENTRO da conversa
// ativa — o contexto é o destino. A UI/lógica da liga veio da antiga
// FusionArena (F3: a Arena se dissolveu; a disputa vive só aqui + FusionBoard).
import { useEffect, useState } from "react"
import { Plus, Swords, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { PillSelect } from "@/components/ui/PillSelect"
import { AgentSelect } from "@/components/chat/ComposerParts"
import { useActiveProject } from "@/store/app"
import { useChat } from "@/store/chat"
import { useFusion, defaultLeague, type LeagueConfig } from "@/store/fusion"
import { LEAGUE_DESTINATIONS } from "@/lib/agents"
import type { AgentRunConfig } from "@/lib/types"

const JUDGES = [
  { id: "sonnet", label: "Sonnet" },
  { id: "opus", label: "Opus" },
  { id: "haiku", label: "Haiku" },
]

/** Candidato da liga + um id estável local (p/ a key do React na lista mutável). */
type LeagueEntry = AgentRunConfig & { id: string }

function newEntry(agent: string): LeagueEntry {
  return { id: crypto.randomUUID(), agent, model: null, effort: null }
}

function entryOf(c: AgentRunConfig): LeagueEntry {
  return { id: crypto.randomUUID(), agent: c.agent, model: c.model, effort: c.effort }
}

export function FusionLauncher({
  open,
  onOpenChange,
  initialTask,
  seed,
  onLaunched,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Texto já digitado no composer → vira a tarefa (editável aqui). */
  initialTask?: string
  /** Config efetivo do composer → semeia a liga (agent atual + complementar). */
  seed?: AgentRunConfig
  /** Chamado após lançar (o composer limpa o rascunho, já virou a disputa). */
  onLaunched?: () => void
}) {
  const project = useActiveProject()
  const activeId = useChat((s) => s.activeId)
  // uma disputa por conversa: com uma viva, o launch do store ignora — aqui o
  // botão já desabilita e explica (mesma guarda visível do MissionLauncher).
  const fusionAlive = useFusion((s) =>
    activeId ? !!s.byConv[activeId] : false,
  )

  const [league, setLeague] = useState<LeagueEntry[]>([
    newEntry("claude-code"),
    newEntry("codex"),
  ])
  const [judge, setJudge] = useState("sonnet")
  const [task, setTask] = useState("")
  // deps PRIMITIVAS (não o objeto seed, ref nova a cada render do composer):
  // o reset só roda ao abrir/quando o config efetivo muda, nunca no meio da edição.
  const seedAgent = seed?.agent ?? "claude-code"
  const seedModel = seed?.model ?? null
  const seedEffort = seed?.effort ?? null
  // ao abrir: tarefa parte do rascunho do composer (editar aqui não mexe lá) e a
  // liga parte da default do agent efetivo (atual + complementar, juiz sonnet).
  useEffect(() => {
    if (!open) return
    setTask(initialTask ?? "")
    const d = defaultLeague({
      agent: seedAgent,
      model: seedModel,
      effort: seedEffort,
    })
    setLeague(d.candidates.map(entryOf))
    setJudge(d.judgeModel)
  }, [open, initialTask, seedAgent, seedModel, seedEffort])

  const canLaunch =
    task.trim().length > 0 &&
    !!project &&
    !!activeId &&
    league.length >= 2 &&
    !fusionAlive

  function launch() {
    if (!canLaunch || !project || !activeId) return
    // conversa ainda carregando do disco: beginFusion recusaria e o board
    // ficaria órfão do transcript (mesmo guard do send do Linear e do Mission).
    if (!useChat.getState().byId[activeId]) return
    const cfg: LeagueConfig = {
      scope: "read-only",
      judgeModel: judge,
      candidates: league.map((c) => ({
        agent: c.agent,
        model: c.model,
        effort: c.effort,
      })),
    }
    void useFusion
      .getState()
      .launch(
        activeId,
        cfg,
        task.trim(),
        [],
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
            <Swords className="size-4 text-brass" />
            Disputar entre agents
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            Os candidatos resolvem a MESMA tarefa em paralelo, read-only; o juiz
            sugere o melhor e o vencedor continua nesta conversa.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] tracking-wide text-muted-foreground uppercase">
              Liga
            </span>
            {league.map((c, i) => (
              <span key={c.id} className="flex items-center gap-1">
                <AgentSelect
                  value={c.agent}
                  onValueChange={(v) =>
                    setLeague((l) =>
                      l.map((x, j) => (j === i ? { ...x, agent: v } : x)),
                    )
                  }
                  options={LEAGUE_DESTINATIONS}
                />
                {league.length > 2 && (
                  <button
                    onClick={() => setLeague((l) => l.filter((_, j) => j !== i))}
                    className="text-muted-foreground hover:text-foreground"
                    aria-label="Remover candidato"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </span>
            ))}
            {league.length < 5 && (
              <button
                onClick={() => setLeague((l) => [...l, newEntry("claude-code")])}
                className="flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-[12px] text-muted-foreground hover:text-foreground"
              >
                <Plus className="size-3" /> candidato
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
            juiz
            <PillSelect
              value={judge}
              onValueChange={setJudge}
              options={JUDGES.map((j) => ({ value: j.id, label: j.label }))}
              triggerClassName="h-7 gap-1 px-2.5 text-foreground data-[size=default]:h-7"
              itemClassName="text-[13px]"
              aria-label="Juiz da disputa"
            />
          </div>

          <Textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Descreva a tarefa para a liga disputar…"
            className="max-h-48 min-h-20 text-[13px] leading-relaxed"
            autoFocus
          />
        </div>

        <div className="flex items-center justify-end gap-3 border-t px-5 py-3">
          {fusionAlive && (
            <span className="mr-auto text-[12px] text-muted-foreground">
              Já há uma disputa nesta conversa.
            </span>
          )}
          <Button size="sm" disabled={!canLaunch} onClick={launch}>
            <Swords className="size-3.5" />
            Disputar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
