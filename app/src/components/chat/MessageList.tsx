import { useRef, useState, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import type { Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import {
  AlertCircle,
  Ban,
  Check,
  ChevronDown,
  Copy,
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

function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`
  return String(n)
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  function copy() {
    const text = ref.current?.textContent ?? ""
    if (!text) return
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }
  return (
    <div className="group/code relative mb-2">
      <button
        type="button"
        onClick={copy}
        className="absolute top-2 right-2 z-10 rounded-md border bg-card/80 p-1 text-muted-foreground opacity-0 transition hover:text-foreground group-hover/code:opacity-100"
        aria-label="Copiar"
        title="Copiar"
      >
        {copied ? (
          <Check className="size-3 text-st-success" />
        ) : (
          <Copy className="size-3" />
        )}
      </button>
      <pre
        ref={ref}
        className="overflow-auto rounded-md border bg-background/50 p-3 text-[12.5px] leading-relaxed"
      >
        {children}
      </pre>
    </div>
  )
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
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
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
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-brass/40 pl-3 text-foreground/80">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-border/60" />,
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-secondary/40">{children}</thead>,
  tr: ({ children }) => (
    <tr className="border-b border-border/50 last:border-0">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-1.5 text-left font-semibold text-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-1.5 align-top text-foreground/85">{children}</td>
  ),
}

function Markdown({ text }: { text: string }) {
  return (
    <div
      data-selectable
      className="text-[14px] leading-relaxed text-foreground"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={mdComponents}
      >
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
              {it.usage && (it.usage.input > 0 || it.usage.output > 0) && (
                <span className="font-mono tabular-nums">
                  · {fmtTokens(it.usage.input)} in · {fmtTokens(it.usage.output)}{" "}
                  out
                  {it.usage.cacheRead > 0 &&
                    ` · ${fmtTokens(it.usage.cacheRead)} cache`}
                </span>
              )}
              {it.costUsd != null && (
                <span className="font-mono tabular-nums text-foreground/70">
                  · US${it.costUsd.toFixed(3)}
                </span>
              )}
            </div>
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
