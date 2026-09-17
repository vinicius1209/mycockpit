// Peças da aba Contexto (`ContextoDoProjeto`): linha de arquivo de instrução,
// nó da pasta do Claude, esqueleto de carregamento e o diálogo de detalhe.

import { useEffect, useState } from "react"
import { ChevronDown, FileText, FolderGit2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Markdown } from "@/components/common/Markdown"
import type { ClaudeDir, ContextFile } from "@/lib/context"
import { readTextFile } from "@/lib/sources"
import { fmtBytes } from "@/lib/format"
import { controle } from "@/components/ui/controle"
import { cn, shortPath } from "@/lib/utils"

/** Linha de arquivo de instrução, 3 estados (presente/ausente), sem cheque. */
export function FileRow({
  file,
  expanded,
  onToggle,
}: {
  file: ContextFile
  expanded: boolean
  onToggle: () => void
}) {
  const canExpand = file.exists && !!file.content
  return (
    <div>
      <button
        disabled={!canExpand}
        onClick={onToggle}
        className={cn(
          // Ação de linha dentro de painel = degrau `compacto` (§13).
          controle("compacto"),
          "w-full justify-between transition-colors",
          canExpand ? "hover:bg-accent/45" : "cursor-default",
          !file.exists && "opacity-45",
        )}
      >
        <span className="flex items-center gap-2 font-mono text-[13px] text-foreground/90">
          <FileText className="size-3.5 text-muted-foreground" />
          {file.name}
        </span>
        <span className="flex items-center gap-1.5">
          {file.exists ? (
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground/70">
              {fmtBytes(file.bytes)}
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground/45">ausente</span>
          )}
          {canExpand && (
            <ChevronDown
              className={cn(
                "size-3.5 text-muted-foreground transition-transform",
                expanded && "rotate-180",
              )}
            />
          )}
        </span>
      </button>
      {expanded && file.content && (
        <pre
          data-selectable
          className="mt-1 mb-1 max-h-72 overflow-auto rounded-md border bg-background/40 p-2.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground"
        >
          {file.content}
        </pre>
      )}
    </div>
  )
}

/** Nó .claude/ expansível com as contagens reais por categoria. */
export function ClaudeNode({ cd }: { cd: ClaudeDir }) {
  const [open, setOpen] = useState(false)

  if (!cd.exists) {
    return (
      <div className="flex h-7 items-center justify-between rounded-md px-2.5 opacity-45">
        <span className="flex items-center gap-2 font-mono text-[13px]">
          <FolderGit2 className="size-3.5 text-muted-foreground" />
          .claude/
        </span>
        <span className="text-[11px] text-muted-foreground/45">ausente</span>
      </div>
    )
  }

  const rows: [string, number][] = [
    ["Subagents", cd.agents],
    ["Comandos", cd.commands],
    ["Skills", cd.skills],
    ["Planos", cd.plans],
    ["Hooks", cd.hooks],
  ]
  const present = rows.filter(([, n]) => n > 0)
  const kinds = present.length + (cd.settings ? 1 : 0)

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(controle("compacto"), "w-full justify-between transition-colors hover:bg-accent/45")}
      >
        <span className="flex items-center gap-2 font-mono text-[13px] text-foreground/90">
          <FolderGit2 className="size-3.5 text-muted-foreground" />
          .claude/
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[11px] text-muted-foreground/70">
            {kinds} {kinds === 1 ? "tipo" : "tipos"}
          </span>
          <ChevronDown
            className={cn(
              "size-3.5 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </span>
      </button>
      {open && (
        <div className="animate-reveal-down mt-0.5 mb-1 ml-[18px] flex flex-col gap-px border-l border-border/40 pl-2">
          {present.map(([label, n]) => (
            <div
              key={label}
              className="flex items-center justify-between px-2 py-1 text-[12px]"
            >
              <span className="text-muted-foreground">{label}</span>
              <span className="font-mono tabular-nums text-foreground/80">{n}</span>
            </div>
          ))}
          {cd.settings && (
            <div className="flex items-center justify-between px-2 py-1 text-[12px]">
              <span className="text-muted-foreground">Permissões</span>
              <span className="font-mono text-foreground/70">settings.json</span>
            </div>
          )}
          {kinds === 0 && (
            <div className="px-2 py-1 text-[12px] text-muted-foreground/60">
              vazio
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function SkeletonRows() {
  return (
    <div className="flex flex-col gap-1.5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-7 animate-pulse rounded-md bg-accent/40" />
      ))}
    </div>
  )
}

export type DetailTarget = { title: string; path: string }

/** Detalhe de um item de contexto (persona/memória): lê o arquivo e renderiza. */
export function DetailDialog({
  root,
  target,
  onClose,
}: {
  /** Raiz permitida da leitura (pasta do projeto; ~/.claude passa também). */
  root: string
  target: DetailTarget | null
  onClose: () => void
}) {
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!target) return
    let cancelled = false
    setContent(null)
    setLoading(true)
    readTextFile(root, target.path)
      .then((c) => !cancelled && setContent(c))
      .catch(() => !cancelled && setContent("_não foi possível ler o arquivo._"))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [target, root])

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-3 text-left">
          <DialogTitle className="font-mono text-[14px]">
            {target?.title}
          </DialogTitle>
          {target && (
            <DialogDescription className="truncate font-mono text-[11px]">
              {shortPath(target.path)}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="overflow-auto px-5 py-4">
          {loading ? (
            <p className="text-[13px] text-muted-foreground">carregando…</p>
          ) : (
            content && <Markdown text={content} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export type Status = "loading" | "ready" | "error" | "browser"

