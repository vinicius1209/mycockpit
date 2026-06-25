import { useState } from "react"
import ReactMarkdown from "react-markdown"
import type { Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  AlertCircle,
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

const mdComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-brass underline underline-offset-2"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  h1: ({ children }) => (
    <h3 className="mt-2 mb-1 text-[15px] font-semibold">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mt-2 mb-1 text-[14px] font-semibold">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-2 mb-1 text-[13px] font-semibold">{children}</h4>
  ),
  pre: ({ children }) => (
    <pre className="mb-2 overflow-auto rounded-md border bg-background/50 p-3 text-[12.5px] leading-relaxed">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const block =
      String(children).includes("\n") || /language-/.test(className ?? "")
    if (block) return <code className="font-mono">{children}</code>
    return (
      <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[12.5px]">
        {children}
      </code>
    )
  },
}

function Markdown({ text }: { text: string }) {
  return (
    <div
      data-selectable
      className="text-[14px] leading-relaxed text-foreground"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {text}
      </ReactMarkdown>
    </div>
  )
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
          return <Markdown key={it.id} text={it.text} />
        }

        if (it.kind === "tool") {
          return <ToolCard key={it.id} item={it} />
        }

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
