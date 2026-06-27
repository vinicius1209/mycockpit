import { useEffect, useState } from "react"
import {
  AlertCircle,
  Ban,
  Check,
  ChevronDown,
  FilePen,
  FileText,
  Search,
  Terminal,
  Wrench,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { agentLabel } from "@/lib/agent"
import { Markdown } from "@/components/common/Markdown"
import type { ChatItem } from "@/store/chat"

type ToolItem = Extract<ChatItem, { kind: "tool" }>

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

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, "0")}`
}

/** Cronômetro ao vivo enquanto o run pensa (atualiza a cada 1s). */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return <span className="tabular-nums">{fmtDuration(now - since)}</span>
}

function DiffBlock({ text, kind }: { text: string; kind: "del" | "add" }) {
  const all = text.split("\n")
  const lines = all.slice(0, 80)
  const sign = kind === "del" ? "−" : "+"
  const color = kind === "del" ? "text-st-error" : "text-st-success"
  const bg = kind === "del" ? "bg-st-error/10" : "bg-st-success/10"
  return (
    <div className={cn("rounded px-2 py-1", bg)}>
      {lines.map((l, idx) => (
        <div key={idx} className="flex gap-2">
          <span className={cn("shrink-0 select-none", color)}>{sign}</span>
          <span data-selectable className="whitespace-pre-wrap text-foreground/85">
            {l || " "}
          </span>
        </div>
      ))}
      {all.length > lines.length && (
        <div className="pl-5 text-muted-foreground">… +{all.length - lines.length} linhas</div>
      )}
    </div>
  )
}

function ToolCard({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false)
  const Icon = toolIcon(item.name)
  const i = (item.input ?? {}) as Record<string, unknown>
  const isEdit =
    (item.name === "Edit" || item.name === "MultiEdit") &&
    typeof i.old_string === "string"
  const isWrite = item.name === "Write" && typeof i.content === "string"
  const hasDiff = isEdit || isWrite

  return (
    <div className="animate-cockpit-rise rounded-lg border bg-card">
      <button
        disabled={!hasDiff}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2.5 px-3 py-2 text-left disabled:cursor-default"
      >
        <Icon className="mt-0.5 size-3.5 shrink-0 text-brass" />
        <div className="min-w-0 flex-1">
          <div className="label-mono mb-1 text-foreground/80">{item.name}</div>
          <div
            data-selectable
            className="truncate font-mono text-[12px] text-muted-foreground"
          >
            {toolSummary(item.input)}
          </div>
        </div>
        {hasDiff && (
          <ChevronDown
            className={cn(
              "mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        )}
      </button>
      {open && hasDiff && (
        <div className="space-y-1 border-t px-3 py-2 font-mono text-[11.5px] leading-relaxed">
          {isEdit && (
            <>
              <DiffBlock text={i.old_string as string} kind="del" />
              <DiffBlock text={i.new_string as string} kind="add" />
            </>
          )}
          {isWrite && <DiffBlock text={i.content as string} kind="add" />}
        </div>
      )}
    </div>
  )
}

export function MessageList({
  items,
  running,
  startedAt,
  agent,
}: {
  items: ChatItem[]
  running: boolean
  startedAt: number | null
  agent: string
}) {
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-8 py-8">
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
          return <Markdown key={it.id} text={it.text} />
        }

        if (it.kind === "tool") {
          return <ToolCard key={it.id} item={it} />
        }

        if (it.kind === "error") {
          return (
            <div
              key={it.id}
              className="rounded-lg border border-st-error/40 bg-st-error/10 px-3 py-2.5"
            >
              <div className="mb-1 flex items-center gap-2 text-st-error">
                <AlertCircle className="size-3.5" />
                <span className="label-mono text-st-error">erro</span>
              </div>
              <div
                data-selectable
                className="font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-foreground/85"
              >
                {it.message}
              </div>
            </div>
          )
        }

        if (it.kind === "cancelled") {
          return (
            <div
              key={it.id}
              className="flex items-center gap-2 pt-1 text-[12px] text-muted-foreground"
            >
              <Ban className="size-3.5" />
              <span>interrompido</span>
            </div>
          )
        }

        return (
          <div key={it.id} className="flex flex-col gap-1.5">
            {!it.ok && it.text && (
              <div className="rounded-lg border border-st-error/40 bg-st-error/10 px-3 py-2">
                <div
                  data-selectable
                  className="font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-foreground/85"
                >
                  {it.text}
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-1 text-[12px] text-muted-foreground">
              {it.ok ? (
                <Check className="size-3.5 text-st-success" />
              ) : (
                <AlertCircle className="size-3.5 text-st-error" />
              )}
              <span>{it.ok ? "concluído" : "erro"}</span>
              {it.model && <span className="font-mono">· {it.model}</span>}
              {it.durationMs != null && (
                <span className="font-mono tabular-nums">
                  · {fmtDuration(it.durationMs)}
                </span>
              )}
              {it.usage && (it.usage.input > 0 || it.usage.output > 0) && (
                <span className="font-mono tabular-nums">
                  · {fmtTokens(it.usage.input)} in · {fmtTokens(it.usage.output)}{" "}
                  out
                  {it.usage.cacheRead > 0 &&
                    ` · ${fmtTokens(it.usage.cacheRead)} cache`}
                </span>
              )}
              {it.costUsd != null && (
                <span
                  className="font-mono tabular-nums text-foreground/70"
                  title={
                    it.costSource === "estimated"
                      ? "estimado: tokens × tabela de preço"
                      : undefined
                  }
                >
                  · {it.costSource === "estimated" ? "~" : ""}US$
                  {it.costUsd.toFixed(3)}
                </span>
              )}
            </div>
          </div>
        )
      })}

      {running && (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span className="animate-cockpit-pulse size-2 rounded-full bg-st-running" />
          <span>{agentLabel(agent)} trabalhando…</span>
          {startedAt && (
            <span className="font-mono text-foreground/70">
              <Elapsed since={startedAt} />
            </span>
          )}
        </div>
      )}
    </div>
  )
}
