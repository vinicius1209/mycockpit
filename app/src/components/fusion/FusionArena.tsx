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

/** Modo Fusion — a Arena: liga + tarefa no topo, candidatos em COLUNAS paralelas
 *  no meio, veredito do juiz embaixo. Reusa todo o motor (useFusion). */
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

  const busy = !!fusion && fusion.phase !== "done" && fusion.phase !== "aborted"
  const deciding = fusion?.phase === "deciding"
  const selected = chosen ?? fusion?.chosenId ?? null

  async function dispute() {
    if (!task.trim() || !project || !activeId || league.length < 2) return
    const cfg: LeagueConfig = {
      scope: "read-only",
      judgeModel: judge,
      candidates: league,
    }
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
    setViewMode("linear") // continuar a conversa no Linear, com o vencedor
  }

  const liveCost = fusion
    ? fusion.candidates.reduce((a, c) => a + (c.costUsd ?? 0), 0)
    : 0

  return (
    <div className="flex h-full flex-col bg-background">
      {/* ── Liga + tarefa ── */}
      <div className="shrink-0 border-b px-6 py-3">
        <div className="mb-2.5 flex flex-wrap items-center gap-2">
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
                disabled={busy}
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
              {league.length > 2 && !busy && (
                <button
                  onClick={() => setLeague((l) => l.filter((_, j) => j !== i))}
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" />
                </button>
              )}
            </span>
          ))}
          {league.length < 5 && !busy && (
            <button
              onClick={() =>
                setLeague((l) => [...l, { agent: "claude-code", model: null, effort: null }])
              }
              className="flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-[12px] text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-3" /> candidato
            </button>
          )}
          <span className="ml-auto flex items-center gap-1.5 text-[12px] text-muted-foreground">
            juiz
            <Select value={judge} onValueChange={setJudge} disabled={busy}>
              <SelectTrigger className="h-7 w-fit gap-1 rounded-full border bg-secondary/50 px-2.5 text-[12px] text-foreground shadow-none focus-visible:ring-0 data-[size=default]:h-7">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                {JUDGES.map((j) => (
                  <SelectItem key={j.id} value={j.id} className="text-[13px]">
                    {j.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </span>
        </div>
        <div className="flex items-end gap-2">
          <Textarea
            value={task}
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault()
                void dispute()
              }
            }}
            placeholder={
              busy
                ? "disputa em andamento…"
                : "Descreva a tarefa para a liga disputar…"
            }
            disabled={busy || !project}
            rows={1}
            className="max-h-32 min-h-[44px] resize-none rounded-xl text-[14px]"
          />
          <Button
            onClick={() => void dispute()}
            disabled={!task.trim() || busy || !project || league.length < 2}
            className="h-11 gap-1.5"
          >
            <Sparkles className="size-4" /> Disputar
          </Button>
        </div>
      </div>

      {/* ── Arena ── */}
      {fusion ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 px-6 pt-3 text-[12px] text-muted-foreground">
            <span>
              {fusion.candidates.length} candidatos
              {fusion.phase === "judging"
                ? " · juiz avaliando…"
                : deciding
                  ? " · escolha o vencedor"
                  : " · disputando…"}
            </span>
            <span className="ml-auto font-mono tabular-nums">
              ~US${liveCost.toFixed(3)}
            </span>
          </div>
          <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto px-6 py-3">
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
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-muted-foreground">
          <Sparkles className="mb-3 size-8 text-brass/60" />
          <p className="text-[15px] text-foreground/80">Monte sua liga e dispute</p>
          <p className="mt-1 max-w-sm text-[13px] leading-relaxed">
            Os agents resolvem a MESMA tarefa em paralelo, read-only. O juiz sugere o
            melhor; você confirma — e o vencedor continua a conversa no Linear.
          </p>
        </div>
      )}
    </div>
  )
}
