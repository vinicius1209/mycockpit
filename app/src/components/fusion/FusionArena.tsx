import { useState } from "react"
import { Plus, Sparkles, X } from "lucide-react"
import { useChat } from "@/store/chat"
import { useActiveProject, useApp } from "@/store/app"
import { useFusion, type LeagueConfig } from "@/store/fusion"
import { CandidateLane, FusionVerdict } from "@/components/fusion/FusionBoard"
import { AgentSelect } from "@/components/chat/ComposerParts"
import { ComposerShell } from "@/components/chat/ComposerShell"
import { Button } from "@/components/ui/button"
import { PillSelect } from "@/components/ui/PillSelect"
import { liveCostOf } from "@/lib/format"
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

/** Modo Fusion, a Arena. OCIOSO: launch pad centralizado (liga + tarefa).
 *  DISPUTANDO: barra de status fina + candidatos em COLUNAS paralelas + veredito. */
export function FusionArena() {
  const activeId = useChat((s) => s.activeId)
  const project = useActiveProject()
  const fusion = useFusion((s) => (activeId ? s.byConv[activeId] : undefined))
  const confirm = useFusion((s) => s.confirm)
  const setViewMode = useApp((s) => s.setViewMode)

  const [league, setLeague] = useState<LeagueEntry[]>([
    newEntry("claude-code"),
    newEntry("codex"),
  ])
  const [judge, setJudge] = useState("sonnet")
  const [task, setTask] = useState("")
  const [chosen, setChosen] = useState<string | null>(null)

  const deciding = fusion?.phase === "deciding"
  const judging = fusion?.phase === "judging"
  const selected =
    chosen ?? fusion?.chosenId ?? fusion?.judge.suggestedId ?? null
  const liveCost = fusion ? liveCostOf(fusion) : 0

  async function dispute() {
    if (!task.trim() || !project || !activeId || league.length < 2) return
    const cfg: LeagueConfig = { scope: "read-only", judgeModel: judge, candidates: league }
    const t = task.trim()
    setTask("")
    setChosen(null)
    await useFusion
      .getState()
      .launch(activeId, cfg, t, [], project.path, project.permissionMode ?? "padrao")
  }

  async function decide() {
    if (!selected || !activeId) return
    await confirm(activeId, selected)
    setViewMode("linear") // o vencedor continua a conversa no Linear
  }

  // ── OCIOSO: launch pad centralizado ──────────────────────────────────────
  if (!fusion) {
    return (
      <div className="relative flex h-full items-center justify-center px-6">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-72 -translate-y-1/2 bg-[radial-gradient(58%_70%_at_50%_50%,var(--brass-soft),transparent_72%)] opacity-50" />
        <div className="relative w-full max-w-[600px]">
          <div className="mb-5 text-center">
            <Sparkles className="mx-auto mb-3 size-7 text-brass" />
            <h2 className="text-[22px] font-medium tracking-[-0.02em] text-foreground">
              Disputa multi-agent
            </h2>
            <p className="mx-auto mt-1.5 max-w-md text-[13.5px] leading-relaxed text-muted-foreground">
              Os agents resolvem a MESMA tarefa em paralelo, read-only. O juiz sugere
              o melhor; você confirma e o vencedor continua no Linear.
            </p>
          </div>

          <ComposerShell
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void dispute()
              }
            }}
            placeholder="Descreva a tarefa para a liga disputar…"
            disabled={!project}
            rows={3}
            cardClassName="p-3"
            textareaClassName="max-h-44 min-h-[88px] resize-none border-0 bg-transparent px-1 text-[15px] leading-relaxed shadow-none focus-visible:ring-0"
            footerClassName="px-1 pt-1"
            chips={
              <div className="mb-1 flex flex-wrap items-center gap-2 px-1">
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
            }
            footer={
              <>
                <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  juiz
                  <PillSelect
                    value={judge}
                    onValueChange={setJudge}
                    options={JUDGES.map((j) => ({ value: j.id, label: j.label }))}
                    triggerClassName="h-7 gap-1 px-2.5 text-foreground data-[size=default]:h-7"
                    itemClassName="text-[13px]"
                    aria-label="Juiz da disputa"
                  />
                </span>
                <Button
                  onClick={() => void dispute()}
                  disabled={!task.trim() || !project || league.length < 2}
                  className="ml-auto gap-1.5"
                >
                  <Sparkles className="size-4" /> Disputar
                </Button>
              </>
            }
          />
        </div>
      </div>
    )
  }

  // ── DISPUTANDO: status fino + colunas + veredito ─────────────────────────
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex shrink-0 items-center gap-2 border-b px-6 py-2.5 text-[12px] text-muted-foreground">
        <Sparkles className="size-3.5 text-brass" />
        <span className="text-foreground/80">{fusion.candidates.length} candidatos</span>
        <span>
          {judging ? "· juiz avaliando…" : deciding ? "· escolha o vencedor" : "· disputando…"}
        </span>
        <span className="ml-auto font-mono tabular-nums">~US${liveCost.toFixed(3)}</span>
      </div>

      <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-6 py-4">
        {fusion.candidates.map((c) => (
          <div key={c.id} className="flex min-w-[300px] flex-1 flex-col">
            <CandidateLane
              c={c}
              selected={selected === c.id}
              userPicked={chosen === c.id}
              suggested={fusion.judge.suggestedId === c.id}
              deciding={!!deciding}
              onChoose={() => setChosen(c.id)}
              fill
            />
          </div>
        ))}
      </div>

      {deciding && (
        <div className="shrink-0 border-t p-4">
          <FusionVerdict
            fusion={fusion}
            selected={selected}
            onConfirm={() => void decide()}
            onDiscard={() => activeId && useFusion.getState().discard(activeId)}
          />
        </div>
      )}
    </div>
  )
}
