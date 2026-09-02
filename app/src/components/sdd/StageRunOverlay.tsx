import { Check, CircleSlash2, Loader2 } from "lucide-react"
import { Markdown } from "@/components/common/Markdown"
import { Button } from "@/components/ui/button"
import type { ChatItem } from "@/store/chat"

export interface StageRun {
  skill: string
  items: ChatItem[]
  streamingTextId: string | null
  model: string | null
  sessionId: string | null
  startedAt: number | null
  running: boolean
  preparing?: boolean
  preflightBlocked?: boolean
}

function runText(items: ChatItem[]): string {
  const texts = items.filter(
    (item): item is Extract<ChatItem, { kind: "text" }> => item.kind === "text",
  )
  if (texts.length) return texts.map((item) => item.text).join("\n\n")
  return items.find(
    (item): item is Extract<ChatItem, { kind: "result" }> =>
      item.kind === "result",
  )?.text ?? ""
}

/** Overlay do run de uma etapa. Fechar não ressuscita o stream. */
export function StageRunOverlay({
  run,
  onClose,
}: {
  run: StageRun
  onClose: () => void
}) {
  const text = runText(run.items)
  const result = run.items.find(
    (item): item is Extract<ChatItem, { kind: "result" }> =>
      item.kind === "result",
  )
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-8">
      <div className="flex max-h-[80vh] w-full max-w-[760px] flex-col rounded-xl border bg-card shadow-[var(--shadow-pop)]">
        <div className="flex shrink-0 items-center gap-2 border-b px-5 py-3">
          {run.running || run.preparing ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          ) : run.preflightBlocked ? (
            <CircleSlash2 className="size-4 text-muted-foreground" />
          ) : (
            <Check className="size-4 text-muted-foreground" />
          )}
          <span className="font-mono text-[13px] text-foreground">/{run.skill}</span>
          <span className="text-[12px] text-muted-foreground">
            {run.preparing
              ? "verificando capacidades…"
              : run.running
                ? "rodando…"
                : run.preflightBlocked
                  ? "não iniciada, capacidade exigida indisponível"
                  : "concluído"}
          </span>
          {result?.costUsd != null && (
            <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
              ~US${result.costUsd.toFixed(3)}
            </span>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4 text-[13px]">
          {text ? <Markdown text={text} /> : <span className="text-muted-foreground">iniciando…</span>}
        </div>
        <div className="flex shrink-0 justify-end border-t px-5 py-3">
          <Button
            onClick={onClose}
            variant="outline"
            size="compacto"
          >
            {run.running
              ? "Fechar (continua em background)"
              : run.preflightBlocked
                ? "Fechar"
                : "Fechar e atualizar"}
          </Button>
        </div>
      </div>
    </div>
  )
}
