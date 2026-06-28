import { memo, useEffect, useState } from "react"
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
import { fmtCost, fmtDuration, fmtTokens } from "@/lib/format"
import type { Attachment } from "@/lib/attachments"
import { attachmentUrl } from "@/lib/attachments"
import { Markdown } from "@/components/common/Markdown"
import type { ChatItem } from "@/store/chat"

type ToolItem = Extract<ChatItem, { kind: "tool" }>

/** Máx. de linhas mostradas num bloco de diff (Edit/Write) antes de "… +N linhas". */
const DIFF_MAX_LINES = 80

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
  const lines = all.slice(0, DIFF_MAX_LINES)
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

const ToolCard = memo(function ToolCard({ item }: { item: ToolItem }) {
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
})

/** Thumbnail de um anexo no histórico (bytes → object URL cacheado). */
function AttachmentThumb({ att }: { att: Attachment }) {
  const [url, setUrl] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    attachmentUrl(att)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [att.path])
  if (att.kind === "pdf") {
    return (
      <span className="flex items-center gap-1.5 rounded-md border bg-card px-2.5 py-1.5 text-[12px] text-muted-foreground">
        <FileText className="size-3.5 shrink-0" />
        <span className="max-w-[160px] truncate">{att.name}</span>
      </span>
    )
  }
  if (failed) {
    return (
      <span className="rounded-md border bg-card px-2.5 py-1.5 text-[11.5px] text-muted-foreground">
        anexo expirado
      </span>
    )
  }
  if (!url) {
    return <span className="size-20 animate-pulse rounded-lg border bg-secondary/40" />
  }
  return (
    <img
      src={url}
      alt={att.name}
      className="max-h-44 max-w-[220px] rounded-lg border object-contain"
    />
  )
}

/** Um item da conversa. `memo`: só re-renderiza quando a REFERÊNCIA do item muda
 *  (itens não-streaming têm ref estável) → não re-pinta tudo a cada text_delta (F12). */
const MessageItem = memo(function MessageItem({ item: it }: { item: ChatItem }) {
  if (it.kind === "user") {
    return (
      <div className="flex flex-col items-end gap-1.5">
        {it.attachments && it.attachments.length > 0 && (
          <div className="flex max-w-[82%] flex-wrap justify-end gap-1.5">
            {it.attachments.map((a) => (
              <AttachmentThumb key={a.path} att={a} />
            ))}
          </div>
        )}
        {it.text && (
          <div
            data-selectable
            className="max-w-[82%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[14px] whitespace-pre-wrap text-foreground"
          >
            {it.text}
          </div>
        )}
      </div>
    )
  }

  if (it.kind === "text") {
    return <Markdown text={it.text} />
  }

  if (it.kind === "tool") {
    return <ToolCard item={it} />
  }

  if (it.kind === "error") {
    return (
      <div className="rounded-lg border border-st-error/40 bg-st-error/10 px-3 py-2.5">
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
      <div className="flex items-center gap-2 pt-1 text-[12px] text-muted-foreground">
        <Ban className="size-3.5" />
        <span>interrompido</span>
      </div>
    )
  }

  if (it.kind === "notice") {
    return (
      <div className="flex items-center gap-2 px-1 text-[11.5px] text-muted-foreground/80">
        <AlertCircle className="size-3 shrink-0" />
        <span>{it.message}</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
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
            · {fmtTokens(it.usage.input)} in · {fmtTokens(it.usage.output)} out
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
            · {fmtCost(it.costUsd, it.costSource)}
          </span>
        )}
      </div>
    </div>
  )
})

export function MessageList({
  items,
  running,
  finalizing,
  startedAt,
  agent,
}: {
  items: ChatItem[]
  running: boolean
  finalizing: boolean
  startedAt: number | null
  agent: string
}) {
  return (
    <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4 px-8 py-8">
      {items.map((it) => (
        <MessageItem key={it.id} item={it} />
      ))}

      {(running || finalizing) && (
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <span className="animate-cockpit-pulse size-2 rounded-full bg-st-running" />
          <span>
            {finalizing ? "finalizando…" : `${agentLabel(agent)} trabalhando…`}
          </span>
          {running && startedAt && (
            <span className="font-mono text-foreground/70">
              <Elapsed since={startedAt} />
            </span>
          )}
        </div>
      )}
    </div>
  )
}
