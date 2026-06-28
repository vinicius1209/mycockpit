import { useState } from "react"
import { Plus, Sparkles, X } from "lucide-react"
import { useChat } from "@/store/chat"
import { useActiveProject, useApp } from "@/store/app"
import { useFusion, type FusionRun, type LeagueConfig } from "@/store/fusion"
import { CandidateLane } from "@/components/fusion/FusionBoard"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const AGENTS = [
  { id: "claude-code", label: "Claude Code" },
  { id: "codex", label: "Codex" },
]
const JUDGES = [
  { id: "sonnet", label: "Sonnet" },
  { id: "opus", label: "Opus" },
  { id: "haiku", label: "Haiku" },
]

function nameOf(fusion: FusionRun, id: string | null): string {
  return fusion.candidates.find((c) => c.id === id)?.label ?? "—"
}

type Cand = { agent: string; model: string | null; effort: string | null }

/** Modo Fusion — a Arena. OCIOSO: launch pad centralizado (liga + tarefa).
 *  DISPUTANDO: barra de status fina + candidatos em COLUNAS paralelas + veredito. */
export function FusionArena() {
  const activeId = useChat((s) => s.activeId)
  const project = useActiveProject()
  const fusion = useFusion((s) => (activeId ? s.byConv[activeId] : undefined))
  const confirm = useFusion((s) => s.confirm)
  const setViewMode = useApp((s) => s.setViewMode)

  const [league, setLeague] = useState<Cand[]>([
    { agent: "claude-code", model: null, effort: null },
    { agent: "codex", model: null, effort: null },
  ])
  const [judge, setJudge] = useState("sonnet")
  const [task, setTask] = useState("")
  const [chosen, setChosen] = useState<string | null>(null)

  const deciding = fusion?.phase === "deciding"
  const judging = fusion?.phase === "judging"
  const selected = chosen ?? fusion?.chosenId ?? null
  const liveCost = fusion
    ? fusion.candidates.reduce((a, c) => a + (c.costUsd ?? 0), 0)
    : 0

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
              o melhor; você confirma — e o vencedor continua no Linear.
            </p>
          </div>

          <div className="rounded-2xl border bg-card p-3 shadow-[var(--shadow-pop)]">
            <div className="mb-1 flex flex-wrap items-center gap-2 px-1">
              <span className="text-[11px] tracking-wide text-muted-foreground uppercase">
                Liga
              </span>
              {league.map((c, i) => (
                <span
                  key={i}
                  className="flex items-center gap-0.5 rounded-full border bg-secondary/50 py-0.5 pr-1.5 pl-1"
                >
                  <Select
                    value={c.agent}
                    onValueChange={(v) =>
                      setLeague((l) => l.map((x, j) => (j === i ? { ...x, agent: v } : x)))
                    }
                  >
                    <SelectTrigger className="h-7 w-fit gap-1 border-0 bg-transparent px-2 text-[12px] shadow-none focus-visible:ring-0 data-[size=default]:h-7">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      {AGENTS.map((a) => (
                        <SelectItem key={a.id} value={a.id} className="text-[13px]">
                          {a.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {league.length > 2 && (
                    <button
                      onClick={() => setLeague((l) => l.filter((_, j) => j !== i))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </span>
              ))}
              {league.length < 5 && (
                <button
                  onClick={() =>
                    setLeague((l) => [
                      ...l,
                      { agent: "claude-code", model: null, effort: null },
                    ])
                  }
                  className="flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-[12px] text-muted-foreground hover:text-foreground"
                >
                  <Plus className="size-3" /> candidato
                </button>
              )}
            </div>

            <Textarea
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
              className="max-h-44 min-h-[88px] resize-none border-0 bg-transparent px-1 text-[15px] leading-relaxed shadow-none focus-visible:ring-0"
            />

            <div className="flex items-center gap-2 px-1 pt-1">
              <span className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                juiz
                <Select value={judge} onValueChange={setJudge}>
                  <SelectTrigger className="h-7 w-fit gap-1 rounded-full border bg-secondary/50 px-2.5 text-[12px] text-foreground shadow-none focus-visible:ring-0 data-[size=default]:h-7">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    {JUDGES.map((j) => (
                      <SelectItem key={j.id} value={j.id} className="text-[13px]">
                        {j.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </span>
              <Button
                onClick={() => void dispute()}
                disabled={!task.trim() || !project || league.length < 2}
                className="ml-auto gap-1.5"
              >
                <Sparkles className="size-4" /> Disputar
              </Button>
            </div>
          </div>
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
              suggested={fusion.judge.suggestedId === c.id}
              deciding={!!deciding}
              onChoose={() => setChosen(c.id)}
              fill
            />
          </div>
        ))}
      </div>

      {deciding && (
        <div className="shrink-0 border-t px-6 py-3">
          {fusion.judge.status === "unavailable" ? (
            <p className="text-[12.5px] text-st-error">{fusion.judge.rationale}</p>
          ) : (
            <div className="flex items-center gap-3">
              <Sparkles className="size-4 shrink-0 text-brass" />
              <p className="flex-1 text-[12.5px] text-muted-foreground">
                <span className="text-foreground/80">
                  Juiz sugere {nameOf(fusion, fusion.judge.suggestedId)}.
                </span>{" "}
                {fusion.judge.agreement ? "✓ concordou nas 2 ordens. " : ""}
                {fusion.judge.rationale}
              </p>
              <Button disabled={!selected} onClick={() => void decide()}>
                Confirmar escolha
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
