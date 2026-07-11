import { useState } from "react"
import { AlertCircle, Check, Loader2, Maximize2, Swords } from "lucide-react"
import {
  useFusion,
  isFailed,
  isRunning,
  type FusionCandidate,
  type FusionRun,
} from "@/store/fusion"
import { useApp } from "@/store/app"
import { candidateText } from "@/lib/fusion"
import { fmtCost, liveCostOf } from "@/lib/format"
import { Markdown } from "@/components/common/Markdown"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

export function CandidateLane({
  c,
  selected,
  userPicked,
  suggested,
  deciding,
  onChoose,
  fill,
}: {
  c: FusionCandidate
  selected: boolean
  /** O usuário clicou NESTA lane (vs. a pré-seleção automática do juiz). */
  userPicked: boolean
  suggested: boolean
  deciding: boolean
  onChoose: () => void
  /** Preenche a altura (modo Arena, colunas) em vez de max-h fixo (board). */
  fill?: boolean
}) {
  const text = candidateText(c)
  const running = isRunning(c.status)
  const failed = isFailed(c.status)
  const [expanded, setExpanded] = useState(false)

  const statusIcon = running ? (
    <Loader2 className="size-3.5 shrink-0 animate-spin text-st-running" />
  ) : failed ? (
    <AlertCircle className="size-3.5 shrink-0 text-st-error" />
  ) : (
    <Check className="size-3.5 shrink-0 text-st-success" />
  )
  const suggestedBadge = suggested && (
    <span className="shrink-0 rounded border border-brass/40 px-1 py-px text-[10px] tracking-wide text-brass uppercase">
      sugerido
    </span>
  )
  const body = text ? (
    <Markdown text={text} />
  ) : (
    <span className="text-[12px] text-muted-foreground">
      {running ? "pensando…" : failed ? "falhou" : "sem resposta"}
    </span>
  )
  const chooseBtn = deciding && !failed && (
    <button
      onClick={onChoose}
      className={cn(
        "rounded-full border px-2 py-0.5 text-[11px] transition-colors",
        userPicked
          ? "border-brass bg-brass/10 text-brass"
          : selected
            ? "border-brass/35 text-brass/80"
            : "text-muted-foreground hover:text-foreground",
      )}
    >
      {userPicked ? "✓ escolhida" : selected ? "pré-selecionada" : "escolher esta"}
    </button>
  )

  return (
    <div
      className={cn(
        "rounded-xl border bg-card transition-[box-shadow,border-color]",
        fill && "flex h-full min-h-0 flex-col",
        selected && "border-brass/70 shadow-[0_0_0_2px_var(--brass-soft)]",
        failed && "opacity-60",
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          {statusIcon}
          <span className="truncate text-[13px] font-medium text-foreground">
            {c.label}
          </span>
          {suggestedBadge}
        </div>
        <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground">
          {c.costUsd != null && <span>{fmtCost(c.costUsd, c.costSource)}</span>}
          <button
            onClick={() => setExpanded(true)}
            className="transition-colors hover:text-foreground"
            aria-label="Expandir resposta"
            title="Expandir"
          >
            <Maximize2 className="size-3.5" />
          </button>
          {chooseBtn}
        </div>
      </div>
      <div
        className={cn(
          "overflow-auto px-3 py-2 text-[13px]",
          fill ? "min-h-0 flex-1" : "max-h-56",
        )}
      >
        {body}
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b px-5 py-3 text-left">
            <DialogTitle className="flex items-center gap-2 pr-7 text-[14px]">
              {statusIcon}
              <span className="label-mono text-foreground/90">{c.label}</span>
              {suggestedBadge}
              {c.costUsd != null && (
                <span className="ml-auto font-mono text-[11px] font-normal text-muted-foreground">
                  {fmtCost(c.costUsd, c.costSource)}
                </span>
              )}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Conteúdo completo da resposta de {c.label}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-auto px-5 py-4 text-[14px] leading-relaxed">
            {body}
          </div>
          {deciding && !failed && (
            <div className="flex shrink-0 justify-end border-t px-5 py-3">
              <Button
                size="sm"
                variant={userPicked ? "default" : "outline"}
                onClick={onChoose}
              >
                {userPicked
                  ? "✓ escolhida"
                  : selected
                    ? "pré-selecionada"
                    : "escolher esta"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
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
  // default da seleção = a sugestão do juiz (mesmo quando a auto-confirmação foi
  // suprimida por anti-viés) → "Confirmar" já funciona com 1 clique; dá pra trocar.
  const selected = chosen ?? fusion.chosenId ?? fusion.judge.suggestedId
  // total REAL (candidatos + juiz) quando o juiz já rodou; ao vivo soma as lanes.
  const liveCost = fusion.costTotal > 0 ? fusion.costTotal : liveCostOf(fusion)

  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-2.5 px-8 py-4">
      <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
        <Swords className="size-3.5 text-brass" />
        <span>
          Disputa · {fusion.candidates.length} candidatos
          {judging ? " · juiz avaliando…" : deciding ? " · escolha o vencedor" : ""}
        </span>
        <span className="ml-auto font-mono tabular-nums">
          ~US${liveCost.toFixed(3)}
        </span>
        <button
          onClick={() => useApp.getState().setViewMode("fusion")}
          className="underline-offset-2 transition-colors hover:text-foreground hover:underline"
          title="Abrir em tela cheia (colunas paralelas)"
        >
          tela cheia
        </button>
      </div>

      {fusion.candidates.map((c) => (
        <CandidateLane
          key={c.id}
          c={c}
          selected={selected === c.id}
          userPicked={chosen === c.id}
          suggested={fusion.judge.suggestedId === c.id}
          deciding={deciding}
          onChoose={() => setChosen(c.id)}
        />
      ))}

      {deciding && (
        <FusionVerdict
          fusion={fusion}
          selected={selected}
          onConfirm={() => selected && void confirm(convId, selected)}
          onDiscard={() => useFusion.getState().discard(convId)}
        />
      )}
    </div>
  )
}

/** Veredito do juiz: racional em largura cheia + ações numa linha separada.
 *  Único (Board + Arena reusam), antes era duplicado e espremido. */
export function FusionVerdict({
  fusion,
  selected,
  onConfirm,
  onDiscard,
}: {
  fusion: FusionRun
  selected: string | null
  onConfirm: () => void
  onDiscard: () => void
}) {
  const unavailable = fusion.judge.status === "unavailable"
  const labelOf = (id: string | null) =>
    fusion.candidates.find((c) => c.id === id)?.label
  const selectedLabel = labelOf(selected)
  // 2º lugar que o juiz JÁ calcula (sinal comparativo de custo zero, sem fundir).
  const runnerupLabel =
    fusion.judge.runnerupId &&
    fusion.judge.runnerupId !== fusion.judge.suggestedId
      ? labelOf(fusion.judge.runnerupId)
      : undefined

  return (
    <div className="flex flex-col gap-2.5 rounded-xl border bg-secondary/30 p-3">
      <div className="flex items-start gap-2">
        <Swords className="mt-px size-4 shrink-0 text-brass" />
        {unavailable ? (
          <p className="text-[12.5px] leading-relaxed text-st-error">
            {fusion.judge.rationale}
          </p>
        ) : (
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground/85">
              Juiz sugere {labelOf(fusion.judge.suggestedId)}.
            </span>{" "}
            {runnerupLabel && (
              <span className="text-muted-foreground/70">
                2º: {runnerupLabel}.{" "}
              </span>
            )}
            {fusion.judge.agreement ? "✓ concordou nas 2 ordens. " : ""}
            {fusion.judge.rationale}
          </p>
        )}
      </div>
      <div className="flex items-center justify-end gap-3">
        <button
          onClick={onDiscard}
          className="text-[12px] text-muted-foreground hover:text-foreground"
        >
          descartar
        </button>
        {!unavailable && (
          <Button size="sm" disabled={!selected} onClick={onConfirm}>
            {selectedLabel ? `Confirmar ${selectedLabel}` : "Escolha um candidato"}
          </Button>
        )}
      </div>
    </div>
  )
}
