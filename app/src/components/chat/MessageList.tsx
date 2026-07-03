import { memo, useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  Ban,
  Bot,
  Check,
  ChevronRight,
  FilePen,
  FileText,
  Globe,
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
import { presentTool, resultMeta, type ToolKind } from "@/lib/toolview"
import { deriveTasks, isTaskTool } from "@/lib/tasks"
import { Markdown } from "@/components/common/Markdown"
import { TaskChecklist } from "@/components/chat/TaskChecklist"
import type { ChatItem } from "@/store/chat"

type ToolItem = Extract<ChatItem, { kind: "tool" }>

/** Máx. de linhas mostradas num bloco de diff (Edit/Write) antes de "… +N linhas". */
const DIFF_MAX_LINES = 80
/** A partir de quantas tools consecutivas o burst colapsa num grupo. */
const GROUP_MIN = 4

const KIND_ICON: Record<ToolKind, LucideIcon> = {
  bash: Terminal,
  read: FileText,
  edit: FilePen,
  write: FilePen,
  search: Search,
  web: Globe,
  agent: Bot,
  generic: Wrench,
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
          <span
            data-selectable
            className="break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground/85"
          >
            {l || " "}
          </span>
        </div>
      ))}
      {all.length > lines.length && (
        <div className="pl-5 text-muted-foreground">
          … +{all.length - lines.length} linhas
        </div>
      )}
    </div>
  )
}

/** Tool call como LINHA (ícone + rótulo humano + meta), colapsável pro cru.
 *  A prosa do agent é o conteúdo; a ferramenta é rodapé, não caixa. */
const ToolLine = memo(function ToolLine({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false)
  const p = presentTool(item.name, item.input)
  const Icon = KIND_ICON[p.kind]
  const i = (item.input ?? {}) as Record<string, unknown>
  const isEdit =
    (item.name === "Edit" || item.name === "MultiEdit") &&
    typeof i.old_string === "string"
  const isWrite = item.name === "Write" && typeof i.content === "string"
  const failed = item.result?.ok === false
  const res = resultMeta(item.name, item.result)
  const meta = [p.meta, res].filter(Boolean).join(" · ")
  const expandable = Boolean(p.detail || isEdit || isWrite || item.result?.text)

  return (
    <div className="min-w-0">
      <button
        onClick={() => expandable && setOpen((o) => !o)}
        className={cn(
          "flex w-full items-center gap-2 rounded-md px-1.5 py-[3px] text-left text-[12.5px] transition-colors",
          expandable && "hover:bg-accent/40",
        )}
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-transform",
            expandable ? "text-muted-foreground/40" : "text-transparent",
            open && "rotate-90",
          )}
        />
        <Icon
          className={cn(
            "size-3.5 shrink-0",
            failed
              ? "text-st-error"
              : p.kind === "edit" || p.kind === "write"
                ? "text-brass"
                : "text-muted-foreground",
          )}
        />
        <span
          className={cn("truncate", failed ? "text-st-error" : "text-foreground/85")}
        >
          {p.label}
        </span>
        {meta && (
          <span className="ml-auto max-w-[45%] shrink-0 truncate pl-2 font-mono text-[10.5px] text-muted-foreground/60">
            {meta}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-0.5 mb-1 ml-[26px] overflow-hidden rounded-md border bg-secondary/30">
          {p.detail && (
            <div
              data-selectable
              className="p-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground/75"
            >
              {p.detail}
            </div>
          )}
          {(isEdit || isWrite) && (
            <div className="space-y-1 border-t p-2 font-mono text-[11.5px] leading-relaxed">
              {isEdit && (
                <>
                  <DiffBlock text={i.old_string as string} kind="del" />
                  <DiffBlock text={i.new_string as string} kind="add" />
                </>
              )}
              {isWrite && <DiffBlock text={i.content as string} kind="add" />}
            </div>
          )}
          {item.result?.text && (
            <div
              data-selectable
              className="border-t p-2 font-mono text-[11px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-muted-foreground"
            >
              {item.result.text}
            </div>
          )}
        </div>
      )}
    </div>
  )
})

/** Burst de tools consecutivas: colapsa num grupo (o último fica aberto
 *  enquanto o run anda, pra atividade continuar visível). */
function ToolGroup({
  tools,
  defaultOpen,
}: {
  tools: ToolItem[]
  defaultOpen: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const preview = tools
    .slice(0, 3)
    .map((t) => presentTool(t.name, t.input).label)
    .join(" · ")
  return (
    <div className="min-w-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-md px-1.5 py-[3px] text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent/40"
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-foreground/40 transition-transform",
            open && "rotate-90",
          )}
        />
        <span className="shrink-0">{tools.length} passos</span>
        {!open && (
          <span className="min-w-0 truncate font-mono text-[10.5px] text-muted-foreground/50">
            {preview}
            {tools.length > 3 ? " …" : ""}
          </span>
        )}
      </button>
      {open && (
        <div className="ml-[5px] flex flex-col gap-px border-l border-border/50 pl-2">
          {tools.map((t) => (
            <ToolLine key={t.id} item={t} />
          ))}
        </div>
      )}
    </div>
  )
}

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

/** Um item NÃO-tool da conversa. `memo`: só re-renderiza quando a REFERÊNCIA do
 *  item muda (itens não-streaming têm ref estável), não re-pinta a cada delta (F12). */
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
            className="max-w-[82%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[14px] break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground"
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
    return <ToolLine item={it} />
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
          className="font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground/85"
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
            className="font-mono text-[12px] leading-relaxed break-words whitespace-pre-wrap [overflow-wrap:anywhere] text-foreground/85"
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

/** Nó de render: item comum, burst de tools, ou A checklist (task tools). */
type Node =
  | { type: "item"; key: string; item: ChatItem }
  | { type: "tools"; key: string; tools: ToolItem[] }
  | { type: "tasklist"; key: string }

/** Agrupa: tools consecutivas viram um nó só; task tools somem do fluxo e viram
 *  UMA checklist (na posição da primeira). */
function buildNodes(items: ChatItem[]): Node[] {
  const nodes: Node[] = []
  let taskShown = false
  let buf: ToolItem[] = []
  const flush = () => {
    if (buf.length) nodes.push({ type: "tools", key: buf[0].id, tools: buf })
    buf = []
  }
  for (const it of items) {
    if (it.kind === "tool" && isTaskTool(it.name)) {
      flush()
      if (!taskShown) {
        nodes.push({ type: "tasklist", key: it.id })
        taskShown = true
      }
      continue
    }
    if (it.kind === "tool") {
      buf.push(it)
      continue
    }
    flush()
    nodes.push({ type: "item", key: it.id, item: it })
  }
  flush()
  return nodes
}

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
  const nodes = useMemo(() => buildNodes(items), [items])
  const tasks = useMemo(() => deriveTasks(items), [items])

  // Custo acumulado da sessão (soma dos turnos com result), consciência de gasto.
  let sessionCost = 0
  let sessionEstimated = false
  let resultCount = 0
  for (const it of items) {
    if (it.kind === "result") {
      resultCount++
      sessionCost += it.costUsd ?? 0
      if (it.costSource === "estimated" || it.costSource === "unknown")
        sessionEstimated = true
    }
  }
  return (
    <div className="mx-auto flex w-full max-w-[760px] min-w-0 flex-col gap-4 px-8 py-8">
      {nodes.map((n, idx) => {
        if (n.type === "tasklist") {
          return (
            <div key={n.key} className="animate-cockpit-rise">
              <TaskChecklist tasks={tasks} />
            </div>
          )
        }
        if (n.type === "tools") {
          if (n.tools.length >= GROUP_MIN) {
            return (
              <ToolGroup
                key={n.key}
                tools={n.tools}
                defaultOpen={running && idx === nodes.length - 1}
              />
            )
          }
          return (
            <div key={n.key} className="flex flex-col gap-px">
              {n.tools.map((t) => (
                <ToolLine key={t.id} item={t} />
              ))}
            </div>
          )
        }
        return <MessageItem key={n.key} item={n.item} />
      })}

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

      {resultCount >= 2 && sessionCost > 0 && (
        <div className="pt-1 text-[11px] text-muted-foreground/60">
          <span className="font-mono tabular-nums">
            sessão ·{" "}
            {fmtCost(sessionCost, sessionEstimated ? "estimated" : "reported")}
          </span>
        </div>
      )}
    </div>
  )
}
