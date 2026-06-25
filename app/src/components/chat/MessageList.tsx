import {
  AlertCircle,
  Check,
  FilePen,
  FileText,
  Search,
  Terminal,
  Wrench,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import type { ChatItem } from "@/store/chat"

function toolIcon(name: string): LucideIcon {
  if (name === "Bash") return Terminal
  if (name === "Read") return FileText
  if (name === "Edit" || name === "Write" || name === "MultiEdit") return FilePen
  if (name === "Glob" || name === "Grep") return Search
  return Wrench
}

function toolSummary(input: unknown): string {
  if (input && typeof input === "object") {
    const i = input as Record<string, unknown>
    for (const key of ["command", "file_path", "pattern", "path", "query"]) {
      if (typeof i[key] === "string") return i[key] as string
    }
  }
  try {
    return JSON.stringify(input)
  } catch {
    return ""
  }
}

export function MessageList({
  items,
  running,
}: {
  items: ChatItem[]
  running: boolean
}) {
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-6 py-8">
      {items.map((it) => {
        if (it.kind === "user") {
          return (
            <div key={it.id} className="flex justify-end">
              <div
                data-selectable
                className="max-w-[82%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[14px] whitespace-pre-wrap text-foreground"
              >
                {it.text}
              </div>
            </div>
          )
        }

        if (it.kind === "text") {
          return (
            <div
              key={it.id}
              data-selectable
              className="animate-cockpit-rise text-[14px] leading-relaxed whitespace-pre-wrap text-foreground"
            >
              {it.text}
            </div>
          )
        }

        if (it.kind === "tool") {
          const Icon = toolIcon(it.name)
          return (
            <div
              key={it.id}
              className="animate-cockpit-rise flex items-start gap-2.5 rounded-lg border bg-card px-3 py-2"
            >
              <Icon className="mt-0.5 size-3.5 shrink-0 text-brass" />
              <div className="min-w-0 flex-1">
                <div className="label-mono mb-1 text-foreground/80">{it.name}</div>
                <div
                  data-selectable
                  className="truncate font-mono text-[12px] text-muted-foreground"
                >
                  {toolSummary(it.input)}
                </div>
              </div>
            </div>
          )
        }

        // result
        return (
          <div
            key={it.id}
            className="flex items-center gap-2 pt-1 text-[12px] text-muted-foreground"
          >
            {it.ok ? (
              <Check className="size-3.5 text-st-success" />
            ) : (
              <AlertCircle className="size-3.5 text-st-error" />
            )}
            <span>{it.ok ? "concluído" : "erro"}</span>
            {it.costUsd != null && (
              <span className="font-mono tabular-nums">
                · US${it.costUsd.toFixed(3)}
              </span>
            )}
          </div>
        )
      })}

      {running && (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span className="animate-cockpit-pulse size-2 rounded-full bg-st-running" />
          Claude Code trabalhando…
        </div>
      )}
    </div>
  )
}
