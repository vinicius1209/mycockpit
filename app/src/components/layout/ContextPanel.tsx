import { useEffect, useMemo, useState } from "react"
import type { ReactNode } from "react"
import {
  AlertCircle,
  AlertTriangle,
  Brain,
  ChevronDown,
  FileDiff,
  FileText,
  FolderGit2,
  FolderPlus,
  ListChecks,
  PanelRight,
  Plug,
  RefreshCw,
  X,
  type LucideIcon,
} from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { DiffPanel } from "@/components/layout/DiffPanel"
import { TaskChecklist } from "@/components/chat/TaskChecklist"
import { deriveTasks } from "@/lib/tasks"
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
import { LearningSection } from "@/components/layout/LearningSection"
import { useActiveProject, useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import type { ProjectConfig } from "@/store/app"
import { readProjectContext } from "@/lib/context"
import type { ClaudeDir, ContextFile, ProjectContext } from "@/lib/context"
import { loadGitDiff } from "@/lib/git"
import { readProjectSources, readTextFile } from "@/lib/sources"
import type { ProjectSources } from "@/lib/sources"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
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
        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase",
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
  badge,
}: {
  active: boolean
  onClick: () => void
  icon: LucideIcon
  children: ReactNode
  /** Contador opcional (ex.: nº de arquivos alterados). 0 = sem badge. */
  badge?: number
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
      {badge != null && badge > 0 && (
        <span
          className={cn(
            "grid min-w-4 place-items-center rounded-full px-1 text-[9.5px] font-semibold tabular-nums",
            active
              ? "bg-brass text-background"
              : "bg-muted-foreground/25 text-foreground/80",
          )}
        >
          {badge}
        </span>
      )}
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
  // Referência do agente (personas/specs/memórias/instruções) COLAPSADA por
  // padrão: é consulta rara, não deve dominar o painel. Abre sob demanda.
  const [showAgentCtx, setShowAgentCtx] = useState(false)
  const [detail, setDetail] = useState<DetailTarget | null>(null)
  const [tab, setTab] = useState<"contexto" | "alteracoes" | "plano">("contexto")
  // diff atribuído à conversa ativa: worktree isolado dela, senão a pasta do projeto.
  const activeWorktree = useChat(
    (s) => s.conversations.find((c) => c.id === s.activeId)?.worktreePath ?? null,
  )
  // running da conversa ativa: quando o turno termina, recarrega a contagem de
  // arquivos alterados (o diff mudou) → badge na aba Alterações.
  const running = useChat((s) =>
    s.activeId ? (s.byId[s.activeId]?.running ?? false) : false,
  )
  const [changedCount, setChangedCount] = useState(0)
  // items da conversa ativa SÓ quando a aba Plano está visível (evita re-render
  // do painel inteiro a cada delta de streaming nas outras abas).
  const planItems = useChat((s) =>
    tab === "plano" && s.activeId ? s.byId[s.activeId]?.items : undefined,
  )
  const planTasks = useMemo(
    () => (planItems ? deriveTasks(planItems) : []),
    [planItems],
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
      extraDirs: [],
    }
    setMycockpit(project.id, { ...cur, ...patch, exists: true })
  }

  /** Adiciona/remove pastas liberadas (viram --add-dir no próximo turno). Persiste
   *  no .mycockpit/config.toml; o Rust resolve no spawn. Aplica ao PRÓXIMO envio
   *  (o gate de diretório do CLI é fixo no spawn — não expande mid-run). */
  function setExtraDirs(dirs: string[]) {
    if (!project) return
    upsertConfig({ extraDirs: dirs })
    void writeMycockpitConfig(project.path, { extraDirs: dirs })
  }

  async function onAddExtraDir() {
    if (!project) return
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: "Liberar pasta ao agente",
    })
    if (typeof picked !== "string") return
    const cur = cfg?.extraDirs ?? []
    if (cur.includes(picked)) return
    setExtraDirs([...cur, picked])
  }

  function onPermissionChange(mode: PermissionMode) {
    if (!project) return
    // run_claude lê project.permissionMode (cache); SQLite cache; .mycockpit = truth
    setProjectPermission(project.id, mode)
    void updateProjectPermission(project.id, mode)
    upsertConfig({ permission: mode })
    void writeMycockpitConfig(project.path, { permission: mode })
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

  // Contagem de arquivos alterados p/ o badge da aba Alterações. Recarrega
  // quando o worktree muda, no reload manual, e ao fim de cada turno (running).
  useEffect(() => {
    let cancelled = false
    const cwd = activeWorktree ?? projectPath
    if (!cwd) {
      setChangedCount(0)
      return
    }
    void loadGitDiff(cwd).then((d) => {
      if (!cancelled) setChangedCount(d.isRepo ? d.files.length : 0)
    })
    return () => {
      cancelled = true
    }
  }, [activeWorktree, projectPath, reload, running])

  // Resumo numa linha do que o agente enxerga (cabeçalho colapsado).
  const agentCtxSummary = (() => {
    const parts: string[] = []
    const instrTotal = ctx?.files.length ?? 0
    const instrPresent = ctx?.files.filter((f) => f.exists).length ?? 0
    if (instrTotal > 0) parts.push(`${instrPresent}/${instrTotal} instruções`)
    const nP = sources?.personas.length ?? 0
    if (nP) parts.push(`${nP} personas`)
    const nS = sources?.specs.length ?? 0
    if (nS) parts.push(`${nS} specs`)
    if (sources?.memory.exists) parts.push(`${sources.memory.count} memórias`)
    return parts.length ? parts.join(" · ") : "instruções, personas, memórias"
  })()

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
          badge={changedCount}
        >
          Alterações
        </TabBtn>
        <TabBtn
          active={tab === "plano"}
          onClick={() => setTab("plano")}
          icon={ListChecks}
        >
          Plano
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
      ) : tab === "plano" ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {planTasks.length > 0 ? (
            <TaskChecklist tasks={planTasks} />
          ) : (
            <p className="px-2 py-10 text-center text-[12.5px] text-muted-foreground">
              Sem plano nesta conversa. Quando o agent criar tarefas, a checklist
              aparece aqui.
            </p>
          )}
        </div>
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
                  // "liberado" = bypassPermissions: a pílula fica em cor de alerta
                  // pra você SEMPRE saber em que modo está (não parecer neutro).
                  triggerClassName={cn(
                    "h-7 gap-1.5 pr-1.5 pl-2.5",
                    (cfg?.permission ?? project.permissionMode) === "liberado" &&
                      "border-st-warning/60 bg-st-warning/15 text-st-warning",
                  )}
                  aria-label="Permissões do projeto"
                  options={[
                    { value: "leitura", label: "Leitura" },
                    { value: "padrao", label: "Padrão" },
                    { value: "liberado", label: "⚠ Liberado" },
                  ]}
                />
              </div>
              {(cfg?.permission ?? project.permissionMode) === "liberado" && (
                <p className="-mt-1 text-[11px] leading-snug text-st-warning/90">
                  O agente executa comandos e escreve arquivos sem pedir
                  confirmação.
                </p>
              )}

              {/* Pastas permitidas: viram --add-dir. Resolve o caso de o agent
                  precisar de um repo irmão fora do cwd (ex.: backend). Aplica ao
                  PRÓXIMO turno — o gate de diretório do CLI é fixo no spawn. */}
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] text-muted-foreground">
                    Pastas permitidas
                  </span>
                  <button
                    onClick={() => void onAddExtraDir()}
                    className="flex h-7 items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-[12px] text-muted-foreground transition-colors hover:border-brass/60 hover:text-brass"
                    aria-label="Adicionar pasta permitida"
                  >
                    <FolderPlus className="size-3.5" />
                    Adicionar
                  </button>
                </div>
                {(cfg?.extraDirs?.length ?? 0) === 0 ? (
                  <p className="text-[11px] leading-snug text-muted-foreground/70">
                    Só o diretório do projeto é acessível. Libere um repo irmão
                    (ex.: backend) para o agent alcançá-lo.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1">
                    {cfg!.extraDirs.map((dir) => (
                      <li
                        key={dir}
                        className="group/dir flex items-center gap-1.5 rounded-md bg-secondary/40 px-2 py-1"
                      >
                        <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground/70" />
                        <span
                          className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/90"
                          title={dir}
                        >
                          {dir}
                        </span>
                        <button
                          onClick={() =>
                            setExtraDirs(
                              cfg!.extraDirs.filter((d) => d !== dir),
                            )
                          }
                          title="Remover"
                          aria-label={`Remover ${dir}`}
                          className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/dir:opacity-100 hover:text-st-error"
                        >
                          <X className="size-3" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {cfg?.exists && (
                <p className="text-[10.5px] text-muted-foreground/55">
                  salvo em <span className="font-mono">.mycockpit/config.toml</span>
                </p>
              )}
            </div>
          </Section>

          <Separator />

          {/* Auto-aprendizado (M1/M2): entregas no recall + lições podáveis.
              Auditável — o app propõe, você revisa/remove (princípio do doc). */}
          <Section title="Aprendizado">
            <LearningSection key={reload} projectId={project.id} />
          </Section>

          <Separator />

          {/* Referência do agente colapsada: cabeçalho clicável + resumo numa
              linha. O conteúdo (instruções/extensões/personas/specs/memórias)
              só monta quando aberto — deixa o painel enxuto no dia a dia. */}
          <button
            onClick={() => setShowAgentCtx((v) => !v)}
            className="flex w-full items-center gap-2 px-1 py-1 text-left"
            aria-expanded={showAgentCtx}
          >
            <ChevronDown
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                showAgentCtx && "rotate-180",
              )}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[10.5px] font-medium tracking-wide text-muted-foreground/70 uppercase">
                O que o agente enxerga
              </div>
              {!showAgentCtx && (
                <div className="truncate text-[11.5px] text-muted-foreground/60">
                  {agentCtxSummary}
                </div>
              )}
            </div>
          </button>

          {showAgentCtx && (
            <>

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
                          <span className="shrink-0 rounded border px-1 py-px text-[10px] tracking-wide text-muted-foreground uppercase">
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
            </>
          )}
        </ScrollArea>
      )}

      <DetailDialog
        root={project?.path ?? ""}
        target={detail}
        onClose={() => setDetail(null)}
      />
    </aside>
  )
}
