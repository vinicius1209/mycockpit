import { useEffect, useState } from "react"
import type { ReactNode } from "react"
import {
  AlertCircle,
  AlertTriangle,
  Brain,
  ChevronDown,
  FileDiff,
  FileText,
  FolderGit2,
  PanelRight,
  Plug,
  RefreshCw,
  type LucideIcon,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { DiffPanel } from "@/components/layout/DiffPanel"
import { PillSelect } from "@/components/ui/PillSelect"
import { Separator } from "@/components/ui/separator"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Markdown } from "@/components/common/Markdown"
import { useActiveProject, useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import type { ProjectConfig } from "@/store/app"
import { readProjectContext } from "@/lib/context"
import type { ClaudeDir, ContextFile, ProjectContext } from "@/lib/context"
import { readProjectSources, readTextFile } from "@/lib/sources"
import type { ProjectSources } from "@/lib/sources"
import { writeMycockpitConfig } from "@/lib/mycockpit"
import { fmtBytes } from "@/lib/format"
import type { PermissionMode } from "@/lib/types"
import { isTauri, updateProjectPermission } from "@/lib/db"
import { cn, shortPath } from "@/lib/utils"

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="px-5 py-3">
      <div className="mb-2">
        <span className="label-mono">{title}</span>
      </div>
      {children}
    </section>
  )
}

/** Linha de arquivo de instrução, 3 estados (presente/ausente), sem cheque. */
function FileRow({
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
          "flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors",
          canExpand ? "hover:bg-accent/45" : "cursor-default",
          !file.exists && "opacity-45",
        )}
      >
        <span className="flex items-center gap-2 font-mono text-[12.5px] text-foreground/90">
          <FileText className="size-3.5 text-muted-foreground" />
          {file.name}
        </span>
        <span className="flex items-center gap-1.5">
          {file.exists ? (
            <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground/70">
              {fmtBytes(file.bytes)}
            </span>
          ) : (
            <span className="text-[10.5px] text-muted-foreground/45">ausente</span>
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
function ClaudeNode({ cd }: { cd: ClaudeDir }) {
  const [open, setOpen] = useState(false)

  if (!cd.exists) {
    return (
      <div className="flex items-center justify-between rounded-md px-2 py-1.5 opacity-45">
        <span className="flex items-center gap-2 font-mono text-[12.5px]">
          <FolderGit2 className="size-3.5 text-muted-foreground" />
          .claude/
        </span>
        <span className="text-[10.5px] text-muted-foreground/45">ausente</span>
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
        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 transition-colors hover:bg-accent/45"
      >
        <span className="flex items-center gap-2 font-mono text-[12.5px] text-foreground/90">
          <FolderGit2 className="size-3.5 text-muted-foreground" />
          .claude/
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-[10.5px] text-muted-foreground/70">
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
        <div className="animate-reveal-down mt-0.5 mb-1 ml-[18px] flex flex-col gap-px border-l border-border/60 pl-2">
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

function SkeletonRows() {
  return (
    <div className="flex flex-col gap-1.5">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-7 animate-pulse rounded-md bg-accent/40" />
      ))}
    </div>
  )
}

type DetailTarget = { title: string; path: string }

/** Detalhe de um item de contexto (persona/spec/memória): lê o arquivo e renderiza. */
function DetailDialog({
  target,
  onClose,
}: {
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
    readTextFile(target.path)
      .then((c) => !cancelled && setContent(c))
      .catch(() => !cancelled && setContent("_não foi possível ler o arquivo._"))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [target])

  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-3 text-left">
          <DialogTitle className="font-mono text-[14px]">
            {target?.title}
          </DialogTitle>
          {target && (
            <DialogDescription className="truncate font-mono text-[10.5px]">
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

/** Estágio do manifest SDD (discovery→…→done). */
function StageBadge({ stage }: { stage: string }) {
  const done = stage === "done"
  return (
    <span
      className={cn(
        "shrink-0 rounded-full px-2 py-0.5 text-[9px] font-medium tracking-wide uppercase",
        done ? "bg-st-success/15 text-st-success" : "bg-brass/15 text-brass",
      )}
    >
      {stage}
    </span>
  )
}

type Status = "loading" | "ready" | "error" | "browser"

/** Tab do painel direito (Contexto | Alterações) com sublinhado brass no ativo. */
function TabBtn({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean
  onClick: () => void
  icon: LucideIcon
  children: ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative flex h-full items-center gap-1.5 text-[11px] font-medium tracking-[0.08em] uppercase transition-colors",
        active
          ? "text-foreground"
          : "text-muted-foreground/50 hover:text-muted-foreground",
      )}
    >
      <Icon className="size-3.5" />
      {children}
      {active && (
        <span className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-brass" />
      )}
    </button>
  )
}

export function ContextPanel() {
  const project = useActiveProject()
  const [ctx, setCtx] = useState<ProjectContext | null>(null)
  const [sources, setSources] = useState<ProjectSources | null>(null)
  const [status, setStatus] = useState<Status>("loading")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [detail, setDetail] = useState<DetailTarget | null>(null)
  const [tab, setTab] = useState<"contexto" | "alteracoes">("contexto")
  // diff atribuído à conversa ativa: worktree isolado dela, senão a pasta do projeto.
  const activeWorktree = useChat(
    (s) => s.conversations.find((c) => c.id === s.activeId)?.worktreePath ?? null,
  )
  const setProjectPermission = useApp((s) => s.setProjectPermission)
  const setMycockpit = useApp((s) => s.setMycockpit)
  const cfg = useApp((s) => (project ? s.mycockpit[project.id] : undefined))

  // upsert da config do projeto em memória (cria com defaults se ainda não há)
  function upsertConfig(patch: Partial<ProjectConfig>) {
    if (!project) return
    const cur: ProjectConfig = cfg ?? {
      exists: true,
      permission: project.permissionMode ?? "padrao",
      helper: "haiku",
      mode: "linear",
    }
    setMycockpit(project.id, { ...cur, ...patch, exists: true })
  }

  function onPermissionChange(mode: PermissionMode) {
    if (!project) return
    // run_claude lê project.permissionMode (cache); SQLite cache; .mycockpit = truth
    setProjectPermission(project.id, mode)
    void updateProjectPermission(project.id, mode)
    upsertConfig({ permission: mode })
    void writeMycockpitConfig(project.path, { permission: mode })
  }

  function onHelperChange(v: string) {
    if (!project) return
    upsertConfig({ helper: v === "off" ? null : v })
    void writeMycockpitConfig(project.path, { helper: v })
  }

  const projectPath = project?.path
  useEffect(() => {
    let cancelled = false
    setExpanded(null)
    if (!projectPath) return
    // Separar 'fora do app' de 'erro de disco' (antes ambos viravam ctx=null).
    if (!isTauri()) {
      setCtx(null)
      setSources(null)
      setStatus("browser")
      return
    }
    setStatus("loading")
    Promise.all([
      readProjectContext(projectPath),
      readProjectSources(projectPath),
    ])
      .then(([c, s]) => {
        if (!cancelled) {
          setCtx(c)
          setSources(s)
          setStatus("ready")
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCtx(null)
          setSources(null)
          setStatus("error")
        }
      })
    return () => {
      cancelled = true
    }
  }, [projectPath, reload])

  return (
    <aside className="reveal-right flex h-full w-full flex-col bg-transparent">
      <header className="flex h-11 shrink-0 items-center gap-4 px-5">
        <TabBtn
          active={tab === "contexto"}
          onClick={() => setTab("contexto")}
          icon={PanelRight}
        >
          Contexto
        </TabBtn>
        <TabBtn
          active={tab === "alteracoes"}
          onClick={() => setTab("alteracoes")}
          icon={FileDiff}
        >
          Alterações
        </TabBtn>
      </header>

      {!project ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <p className="text-[13px] text-muted-foreground">
            Nenhum projeto selecionado.
          </p>
        </div>
      ) : tab === "alteracoes" ? (
        <DiffPanel cwd={activeWorktree ?? project.path} />
      ) : (
        <ScrollArea className="flex-1">
          {/* Identidade (nome/path) mora no titlebar + sidebar; copiar o caminho
              vive no menu de contexto do projeto. Painel começa nos controles. */}
          <Section title="Ajustes">
            <div className="flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] text-muted-foreground">
                  Permissões
                </span>
                <PillSelect
                  value={cfg?.permission ?? project.permissionMode ?? "padrao"}
                  onValueChange={(v) => onPermissionChange(v as PermissionMode)}
                  align="end"
                  triggerClassName="h-7 gap-1.5 pr-1.5 pl-2.5"
                  aria-label="Permissões do projeto"
                  options={[
                    { value: "leitura", label: "Leitura" },
                    { value: "padrao", label: "Padrão" },
                    { value: "liberado", label: "Liberado" },
                  ]}
                />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[12.5px] text-muted-foreground">
                  Modelo das sugestões
                </span>
                <PillSelect
                  value={cfg ? (cfg.helper ?? "off") : "haiku"}
                  onValueChange={onHelperChange}
                  align="end"
                  triggerClassName="h-7 gap-1.5 pr-1.5 pl-2.5"
                  aria-label="Modelo das sugestões"
                  options={[
                    { value: "haiku", label: "Haiku" },
                    { value: "off", label: "Desligado" },
                  ]}
                />
              </div>
              {cfg?.exists && (
                <p className="text-[10.5px] text-muted-foreground/55">
                  salvo em <span className="font-mono">.mycockpit/config.toml</span>
                </p>
              )}
            </div>
          </Section>

          <Separator />

          {/* Zona de INVENTÁRIO (read-only): o que o claude enxerga no cwd */}
          <Section title="No contexto do agente">
            {status === "loading" && <SkeletonRows />}

            {status === "browser" && (
              <p className="text-[12.5px] leading-relaxed text-muted-foreground/70">
                Inventário disponível no app (tauri dev).
              </p>
            )}

            {status === "error" && (
              <button
                onClick={() => setReload((r) => r + 1)}
                className="flex w-full items-center gap-2 rounded-md border border-st-error/40 bg-st-error/10 px-3 py-2 text-[12px] text-foreground/85 transition-colors hover:bg-st-error/15"
              >
                <AlertCircle className="size-3.5 shrink-0 text-st-error" />
                Não foi possível ler o contexto
                <RefreshCw className="ml-auto size-3.5 text-muted-foreground" />
              </button>
            )}

            {status === "ready" && ctx && (
              <div className="flex flex-col gap-3">
                {sources && sources.drift.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    {sources.drift.map((d) => (
                      <div
                        key={d.copy}
                        className="flex items-start gap-2 rounded-md border border-st-queued/40 bg-st-queued/10 px-2.5 py-1.5 text-[11.5px] leading-snug text-foreground/85"
                      >
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-st-queued" />
                        <span>
                          <span className="font-mono">{d.copy}</span> está{" "}
                          {d.days_stale}d atrás de{" "}
                          <span className="font-mono">{d.source}</span> (cópia
                          stale)
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex flex-col gap-0.5">
                  <div className="mb-0.5 text-[10.5px] text-muted-foreground/55">
                    Instruções
                  </div>
                  {ctx.files.map((f) => (
                    <FileRow
                      key={f.name}
                      file={f}
                      expanded={expanded === f.name}
                      onToggle={() =>
                        setExpanded((cur) => (cur === f.name ? null : f.name))
                      }
                    />
                  ))}
                </div>

                <div className="flex flex-col gap-0.5">
                  <div className="mb-0.5 text-[10.5px] text-muted-foreground/55">
                    Extensões
                  </div>
                  <ClaudeNode cd={ctx.claude_dir} />
                </div>

                {ctx.mcp_servers != null && (
                  <div className="flex flex-col gap-0.5">
                    <div className="mb-0.5 text-[10.5px] text-muted-foreground/55">
                      MCP
                    </div>
                    <div className="flex items-center justify-between rounded-md px-2 py-1.5">
                      <span className="flex items-center gap-2 font-mono text-[12.5px] text-foreground/90">
                        <Plug className="size-3.5 text-muted-foreground" />
                        .mcp.json
                      </span>
                      <span className="text-[10.5px] text-muted-foreground/70">
                        {ctx.mcp_servers}{" "}
                        {ctx.mcp_servers === 1 ? "servidor" : "servidores"}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Section>

          {/* Fase 2, fontes REAIS indexadas (não copiadas) */}
          {status === "ready" && sources && sources.personas.length > 0 && (
            <>
              <Separator />
              <Section title="Personas">
                <div className="flex flex-col gap-1.5">
                  {sources.personas.map((p) => (
                    <button
                      key={p.name}
                      onClick={() => setDetail({ title: p.name, path: p.path })}
                      className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/40"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate font-mono text-[12.5px] text-foreground/90">
                          {p.name}
                        </span>
                        {p.model && p.model !== "inherit" && (
                          <span className="shrink-0 rounded border px-1 py-px text-[9px] tracking-wide text-muted-foreground uppercase">
                            {p.model}
                          </span>
                        )}
                      </div>
                      {p.description && (
                        <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-muted-foreground/80">
                          {p.description}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              </Section>
            </>
          )}

          {status === "ready" && sources && sources.specs.length > 0 && (
            <>
              <Separator />
              <Section title="Specs">
                <div className="flex flex-col gap-1">
                  {sources.specs.map((s) => (
                    <button
                      key={s.slug}
                      onClick={() =>
                        setDetail({ title: s.title ?? s.slug, path: s.path })
                      }
                      className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/40"
                    >
                      <span className="truncate text-[12px] text-foreground/90">
                        {s.title ?? s.slug}
                      </span>
                      {s.stage && <StageBadge stage={s.stage} />}
                    </button>
                  ))}
                </div>
              </Section>
            </>
          )}

          {status === "ready" && sources?.memory.exists && (
            <>
              <Separator />
              <Section title="Memórias">
                <button
                  onClick={() =>
                    sources.memory.path &&
                    setDetail({ title: "MEMORY.md", path: sources.memory.path })
                  }
                  disabled={!sources.memory.path}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent/40 disabled:cursor-default disabled:hover:bg-transparent"
                >
                  <span className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                    <Brain className="size-3.5" />
                    memória do projeto
                  </span>
                  <span className="text-[10.5px] text-muted-foreground/70">
                    {sources.memory.count}{" "}
                    {sources.memory.count === 1 ? "nota" : "notas"}
                  </span>
                </button>
              </Section>
            </>
          )}
        </ScrollArea>
      )}

      <DetailDialog target={detail} onClose={() => setDetail(null)} />
    </aside>
  )
}
