import { useState } from "react"
import { AlertCircle, Check, Loader2, Sparkles } from "lucide-react"
import { useFusion, type FusionCandidate } from "@/store/fusion"
import { candidateText } from "@/lib/fusion"
import { Markdown } from "@/components/common/Markdown"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

function fmtCost(c: number | undefined, src?: string): string {
  if (c == null) return ""
  return `${src === "estimated" ? "~" : ""}US$${c.toFixed(3)}`
}

function CandidateLane({
  c,
  selected,
  suggested,
  deciding,
  onChoose,
}: {
  c: FusionCandidate
  selected: boolean
  suggested: boolean
  deciding: boolean
  onChoose: () => void
}) {
  const text = candidateText(c)
  const running = c.status === "running" || c.status === "queued"
  const failed =
    c.status === "error" || c.status === "cancelled" || c.status === "killed"
  return (
    <div
      className={cn(
        "rounded-xl border bg-card transition-[box-shadow,border-color]",
        selected && "border-brass/70 shadow-[0_0_0_2px_var(--brass-soft)]",
        failed && "opacity-60",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex items-center gap-2">
          {running ? (
            <Loader2 className="size-3.5 animate-spin text-st-running" />
          ) : failed ? (
            <AlertCircle className="size-3.5 text-st-error" />
          ) : (
            <Check className="size-3.5 text-st-success" />
          )}
          <span className="label-mono text-foreground/80">{c.label}</span>
          {suggested && (
            <span className="rounded border border-brass/40 px-1 py-px text-[9px] tracking-wide text-brass uppercase">
              sugerido
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground">
          {c.costUsd != null && <span>{fmtCost(c.costUsd, c.costSource)}</span>}
          {deciding && !failed && (
            <button
              onClick={onChoose}
              className={cn(
                "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                selected
                  ? "border-brass bg-brass/10 text-brass"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {selected ? "✓ escolhida" : "escolher esta"}
            </button>
          )}
        </div>
      </div>
      <div className="max-h-56 overflow-auto px-3 py-2 text-[13px]">
        {text ? (
          <Markdown text={text} />
        ) : (
          <span className="text-[12px] text-muted-foreground">
            {running ? "pensando…" : failed ? "falhou" : "—"}
          </span>
        )}
      </div>
    </div>
  )
}

/** Placar de uma disputa ativa (candidatos ao vivo → veredito → confirmar). */
export function FusionBoard({ convId }: { convId: string }) {
  const fusion = useFusion((s) => s.byConv[convId])
  const confirm = useFusion((s) => s.confirm)
  const [chosen, setChosen] = useState<string | null>(null)
  if (!fusion) return null

  const judging = fusion.phase === "judging"
  const deciding = fusion.phase === "deciding"
  const selected = chosen ?? fusion.chosenId
  const liveCost = fusion.candidates.reduce((a, c) => a + (c.costUsd ?? 0), 0)
  const unavailable = fusion.judge.status === "unavailable"

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-2.5 px-8 py-4">
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Sparkles className="size-3.5 text-brass" />
        <span>
          Disputa · {fusion.candidates.length} candidatos
          {judging ? " · juiz avaliando…" : deciding ? " · escolha o vencedor" : ""}
        </span>
        <span className="ml-auto font-mono tabular-nums">
          ~US${liveCost.toFixed(3)}
        </span>
      </div>

      {fusion.candidates.map((c) => (
        <CandidateLane
          key={c.id}
          c={c}
          selected={selected === c.id}
          suggested={fusion.judge.suggestedId === c.id}
          deciding={deciding}
          onChoose={() => setChosen(c.id)}
        />
      ))}

      {deciding && !unavailable && (
        <div className="flex items-center gap-3 pt-1">
          <p className="flex-1 text-[12px] text-muted-foreground">
            {fusion.judge.agreement ? "✓ juiz concordou nas 2 ordens. " : ""}
            {fusion.judge.rationale}
          </p>
          <Button
            size="sm"
            disabled={!selected}
            onClick={() => selected && void confirm(convId, selected)}
          >
            Confirmar escolha
          </Button>
        </div>
      )}
      {deciding && unavailable && (
        <p className="pt-1 text-[12px] text-st-error">{fusion.judge.rationale}</p>
      )}
    </div>
  )
}
