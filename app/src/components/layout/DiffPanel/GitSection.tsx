import { useState, type ReactNode } from "react"
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Minus,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react"
import {
  type GitFileItem,
  stageFile,
  unstageFile,
  discardFile,
} from "@/lib/git"
import { buildGitTree, type GitTreeNode } from "@/lib/gitTree"
import { FilePathLabel, STATUS_META } from "./parts"
import { OpenInEditor } from "@/components/common/OpenInEditor"
import { controle } from "@/components/ui/controle"
import { confirm } from "@/lib/confirm"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

export function GitSection({
  title,
  count,
  isOpen,
  onToggle,
  actions,
  children,
}: {
  title: string
  count: number
  isOpen: boolean
  onToggle: () => void
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col border-b border-border/40 last:border-b-0">
      <div className="group flex shrink-0 items-center justify-between px-3 py-1 text-[11px] font-medium text-muted-foreground">
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            controle("chip"),
            "min-w-0 flex-1 justify-start px-0 text-left select-none hover:text-foreground",
          )}
        >
          {isOpen ? (
            <ChevronDown className="size-3 shrink-0 opacity-70" />
          ) : (
            <ChevronRight className="size-3 shrink-0 opacity-70" />
          )}
          <span className="truncate">{title}</span>
          <span className="rounded-full bg-secondary px-1.5 py-0.2 font-mono text-[11px] tabular-nums text-foreground/80">
            {count}
          </span>
        </button>

        {actions && (
          <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            {actions}
          </div>
        )}
      </div>

      {isOpen && <div className="flex flex-col pb-1">{children}</div>}
    </div>
  )
}

export function GitFileList({
  cwd,
  files,
  viewMode,
  activePath,
  onOpenFile,
  onReload,
  renderDelta,
}: {
  cwd: string
  files: readonly GitFileItem[]
  viewMode: "list" | "tree"
  activePath?: string
  onOpenFile: (path: string) => void
  onReload: () => void
  renderDelta?: (additions: number, deletions: number) => ReactNode
}) {
  if (files.length === 0) {
    return (
      <div className="px-6 py-2 text-center text-[11px] text-muted-foreground/60">
        Nenhum arquivo nesta seção.
      </div>
    )
  }

  if (viewMode === "tree") {
    const tree = buildGitTree(files)
    return (
      <div className="flex flex-col">
        {tree.map((node) => (
          <GitTreeNodeItem
            key={node.path}
            cwd={cwd}
            node={node}
            depth={0}
            activePath={activePath}
            onOpenFile={onOpenFile}
            onReload={onReload}
            renderDelta={renderDelta}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      {files.map((file) => (
        <GitFileRow
          key={file.path}
          cwd={cwd}
          file={file}
          isActive={file.path === activePath}
          onOpenFile={onOpenFile}
          onReload={onReload}
          renderDelta={renderDelta}
        />
      ))}
    </div>
  )
}

function GitTreeNodeItem({
  cwd,
  node,
  depth,
  activePath,
  onOpenFile,
  onReload,
  renderDelta,
}: {
  cwd: string
  node: GitTreeNode
  depth: number
  activePath?: string
  onOpenFile: (path: string) => void
  onReload: () => void
  renderDelta?: (additions: number, deletions: number) => ReactNode
}) {
  const [open, setOpen] = useState(true)

  if (node.kind === "dir") {
    return (
      <div className="flex flex-col">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          style={{ paddingLeft: `${depth * 12 + 12}px` }}
          className={cn(
            controle("chip"),
            "w-full justify-start pr-3 text-muted-foreground hover:bg-accent/30 hover:text-foreground",
          )}
        >
          {open ? (
            <ChevronDown className="size-3 shrink-0 opacity-60" />
          ) : (
            <ChevronRight className="size-3 shrink-0 opacity-60" />
          )}
          {open ? (
            <FolderOpen className="size-3.5 shrink-0 text-brass/70" />
          ) : (
            <Folder className="size-3.5 shrink-0 text-brass/70" />
          )}
          <span className="truncate font-mono text-[11px]">{node.name}</span>
        </button>
        {open && (
          <div className="flex flex-col">
            {node.children.map((child) => (
              <GitTreeNodeItem
                key={child.path}
                cwd={cwd}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                onOpenFile={onOpenFile}
                onReload={onReload}
                renderDelta={renderDelta}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <GitFileRow
      cwd={cwd}
      file={node.file}
      depth={depth}
      isActive={node.path === activePath}
      onOpenFile={onOpenFile}
      onReload={onReload}
      renderDelta={renderDelta}
    />
  )
}

export function GitFileRow({
  cwd,
  file,
  depth = 0,
  isActive,
  onOpenFile,
  onReload,
  renderDelta,
}: {
  cwd: string
  file: GitFileItem
  depth?: number
  isActive?: boolean
  onOpenFile: (path: string) => void
  onReload: () => void
  renderDelta?: (additions: number, deletions: number) => ReactNode
}) {
  const [busy, setBusy] = useState(false)

  const meta = STATUS_META[file.status] ?? STATUS_META.modified
  const isUntracked = file.status === "untracked"

  async function handleToggleStage(e: React.MouseEvent) {
    e.stopPropagation()
    if (busy) return
    setBusy(true)
    try {
      if (file.staged) {
        await unstageFile(cwd, file.path)
        toast.success(`Preparação desfeita em ${file.path}`)
      } else {
        await stageFile(cwd, file.path)
        toast.success(`${file.path} preparado para commit`)
      }
      onReload()
    } catch (err) {
      toast.error(typeof err === "string" ? err : "Falha ao atualizar a preparação")
    } finally {
      setBusy(false)
    }
  }

  async function handleDiscard(e: React.MouseEvent) {
    e.stopPropagation()
    if (busy) return
    const accepted = await confirm({
      title: isUntracked
        ? `Apagar ${file.path}?`
        : `Descartar alterações em ${file.path}?`,
      description: isUntracked
        ? "O arquivo ainda não é rastreado e será apagado do disco. O Git não poderá recuperá-lo."
        : "As mudanças não preparadas serão removidas. O que já está preparado para commit será preservado.",
      confirmLabel: isUntracked ? "Apagar arquivo" : "Descartar alterações",
      danger: true,
    })
    if (!accepted) return
    setBusy(true)
    try {
      await discardFile(cwd, file.path)
      toast.success(`Alterações descartadas em ${file.path}`)
      onReload()
    } catch (err) {
      toast.error(typeof err === "string" ? err : "Falha ao descartar")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{ paddingLeft: `${depth * 12 + 12}px` }}
      className={cn(
        controle("compacto"),
        "group/row w-full justify-start gap-1.5 pr-2.5 text-left",
        isActive ? "bg-sel" : "hover:bg-accent/40",
      )}
    >
      <button
        type="button"
        onClick={() => onOpenFile(file.path)}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        title={`${file.path} · abrir alterações`}
      >
        <span
          className={cn(
            "w-3.5 shrink-0 text-center font-mono text-[11px] font-bold",
            meta.cls,
          )}
          title={meta.title}
        >
          {meta.label}
        </span>

        <FilePathLabel path={file.path} />

        {/* Delta de linhas (+ e -). Cede o trilho direito às ações enquanto
            elas aparecem: o trilho mostra o número OU os gestos, nunca empurra
            um pro lado do outro. */}
        <span className="ml-auto flex shrink-0 group-hover/row:hidden group-has-[:focus-visible]/row:hidden">
          {renderDelta ? (
            renderDelta(file.additions, file.deletions)
          ) : (
            <span className="flex shrink-0 items-center gap-1 font-mono text-[11px] tabular-nums">
              {file.additions > 0 && <span>+{file.additions}</span>}
              {file.deletions > 0 && (
                <span className="text-st-error">−{file.deletions}</span>
              )}
            </span>
          )}
        </span>
      </button>

      {/* Ações no hover da linha estilo VS Code / Zed. `hidden`, não
          `opacity-0`: invisíveis elas ainda reservavam ~80px em TODA linha, e
          o nome do arquivo truncava ao lado de um vazio. Foco por teclado na
          linha também as revela, senão o Tab nunca chegaria nelas. */}
      <div className="hidden shrink-0 items-center gap-0.5 group-hover/row:flex group-has-[:focus-visible]/row:flex">
        {file.staged ? (
          <button
            type="button"
            onClick={handleToggleStage}
            disabled={busy}
            title="Desfazer preparação"
            aria-label={`Desfazer preparação de ${file.path}`}
            className={cn(
              controle("chip", { quadrado: true }),
              "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <Minus className="size-3" />
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleDiscard}
              disabled={busy}
              title={isUntracked ? "Apagar arquivo novo" : "Descartar alterações"}
              aria-label={`Descartar ${file.path}`}
              className={cn(
                controle("chip", { quadrado: true }),
                "text-muted-foreground hover:bg-accent hover:text-st-error",
              )}
            >
              {isUntracked ? (
                <Trash2 className="size-3" />
              ) : (
                <RotateCcw className="size-3" />
              )}
            </button>
            <button
              type="button"
              onClick={handleToggleStage}
              disabled={busy}
              title="Preparar para commit"
              aria-label={`Preparar ${file.path} para commit`}
              className={cn(
                controle("chip", { quadrado: true }),
                "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <Plus className="size-3" />
            </button>
          </>
        )}
        <div>
          <OpenInEditor projectPath={cwd} rel={file.path} alvo={file.path} />
        </div>
      </div>
    </div>
  )
}
