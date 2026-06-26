import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import {
  Check,
  ChevronDown,
  FileText,
  FolderGit2,
  Minus,
  PanelRight,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { useActiveProject, useApp } from "@/store/app"
import { readProjectContext } from "@/lib/agent"
import type { ContextFile, ProjectContext } from "@/lib/agent"
import type { PermissionMode } from "@/lib/types"
import { isTauri, updateProjectPermission } from "@/lib/db"
import { cn, shortPath } from "@/lib/utils"

function Section({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: ReactNode
}) {
  return (
    <section className="px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="label-mono">{title}</span>
        {note && (
          <span className="text-[10px] text-muted-foreground/70">{note}</span>
        )}
      </div>
      {children}
    </section>
  )
}

function DetectRow({
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
        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors enabled:hover:bg-accent/45 disabled:cursor-default"
      >
        <span className="flex items-center gap-2 font-mono text-[12.5px] text-foreground/90">
          <FileText className="size-3.5 text-muted-foreground" />
          {file.name}
        </span>
        {file.exists ? (
          canExpand ? (
            <ChevronDown
              className={cn(
                "size-3.5 text-muted-foreground transition-transform",
                expanded && "rotate-180",
              )}
            />
          ) : (
            <Check className="size-3.5 text-st-success" />
          )
        ) : (
          <Minus className="size-3.5 text-muted-foreground/45" />
        )}
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

export function ContextPanel() {
  const project = useActiveProject()
  const [ctx, setCtx] = useState<ProjectContext | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const setProjectPermission = useApp((s) => s.setProjectPermission)
  const helperModel = useApp((s) => s.helperModel)
  const setHelperModel = useApp((s) => s.setHelperModel)

  function onPermissionChange(mode: PermissionMode) {
    if (!project) return
    setProjectPermission(project.id, mode)
    void updateProjectPermission(project.id, mode)
  }

  const projectPath = project?.path
  useEffect(() => {
    let cancelled = false
    setExpanded(null)
    if (!projectPath || !isTauri()) {
      setCtx(null)
      return
    }
    readProjectContext(projectPath)
      .then((c) => {
        if (!cancelled) setCtx(c)
      })
      .catch(() => {
        if (!cancelled) setCtx(null)
      })
    return () => {
      cancelled = true
    }
  }, [projectPath])

  // Fonte real (disco) quando no app; senão cai pros flags semente.
  const files: ContextFile[] = ctx?.files ?? [
    { name: "CLAUDE.md", exists: !!project?.hasClaudeMd, content: null },
    { name: "AGENTS.md", exists: !!project?.hasAgentsMd, content: null },
  ]
  const hasClaudeDir = ctx?.has_claude_dir ?? !!project?.hasClaudeMd

  return (
    <aside className="reveal-right flex h-full w-full flex-col bg-transparent">
      <header className="flex h-11 shrink-0 items-center gap-2 px-5">
        <PanelRight className="size-3.5 text-muted-foreground" />
        <span className="label-mono">Contexto</span>
      </header>

      {!project ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-[13px] text-muted-foreground">
            Nenhum projeto selecionado.
          </p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="px-5 pt-4 pb-2">
            <div className="flex items-center gap-2">
              <FolderGit2 className="size-4 shrink-0 text-brass" />
              <span className="truncate text-[14px] font-medium text-foreground">
                {project.name}
              </span>
            </div>
            <div
              data-selectable
              className="mt-1 truncate font-mono text-[11px] text-muted-foreground"
            >
              {shortPath(project.path)}
            </div>
          </div>

          <div className="flex items-center justify-between px-5 pb-3">
            <span className="label-mono">Permissões</span>
            <Select
              value={project.permissionMode ?? "padrao"}
              onValueChange={(v) => onPermissionChange(v as PermissionMode)}
            >
              <SelectTrigger className="h-7 w-fit gap-1.5 rounded-full border bg-secondary/50 pr-1.5 pl-2.5 text-[12px] shadow-none focus-visible:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="leitura">Leitura</SelectItem>
                <SelectItem value="padrao">Padrão</SelectItem>
                <SelectItem value="liberado">Liberado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between px-5 pb-3">
            <span className="label-mono">Sugestões</span>
            <Select
              value={helperModel ?? "off"}
              onValueChange={(v) => setHelperModel(v === "off" ? null : v)}
            >
              <SelectTrigger className="h-7 w-fit gap-1.5 rounded-full border bg-secondary/50 pr-1.5 pl-2.5 text-[12px] shadow-none focus-visible:ring-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="haiku">Haiku</SelectItem>
                <SelectItem value="off">Desligado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator className="my-2" />

          <Section
            title="O que o sistema sabe"
            note={ctx ? undefined : "no app (tauri dev)"}
          >
            <div className="flex flex-col gap-0.5">
              {files.map((f) => (
                <DetectRow
                  key={f.name}
                  file={f}
                  expanded={expanded === f.name}
                  onToggle={() =>
                    setExpanded((cur) => (cur === f.name ? null : f.name))
                  }
                />
              ))}
              <DetectRow
                file={{ name: ".claude/", exists: hasClaudeDir, content: null }}
                expanded={false}
                onToggle={() => {}}
              />
            </div>
          </Section>

          <Separator className="my-2" />

          {["Specs", "Regras", "Personas", "Memórias"].map((s) => (
            <Section key={s} title={s}>
              <p className="text-[12.5px] leading-relaxed text-muted-foreground/70">
                Será populado ao conectar o projeto.
              </p>
            </Section>
          ))}
        </ScrollArea>
      )}
    </aside>
  )
}
