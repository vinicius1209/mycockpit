import { useEffect, useRef, useState } from "react"
import { getVersion } from "@tauri-apps/api/app"
import {
  Plus,
  Moon,
  Sun,
  Folder,
  FolderGit2,
  X,
  ChevronRight,
  Loader2,
  Trash2,
  Pencil,
  Copy,
  Ban,
  Archive,
  GitBranch,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { confirm } from "@/lib/confirm"
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
} from "@/components/ui/context-menu"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useFusion } from "@/store/fusion"
import { archiveProject, restoreProject, type ConversationMeta } from "@/lib/db"
import { createWorktree, removeWorktree } from "@/lib/git"
import { LABEL_COLORS } from "@/lib/labelColors"
import { cn } from "@/lib/utils"
import type { AgentStatus, Project } from "@/lib/types"

/** Soft-remove do projeto (arquiva, conversas preservadas) com Desfazer. Disco intocado. */
function confirmDeleteProject(project: Project) {
  void (async () => {
    if (
      !(await confirm({
        title: `Arquivar "${project.name}"?`,
        description: "As conversas são preservadas e dá pra restaurar depois.",
        confirmLabel: "Arquivar",
      }))
    )
      return
    try {
      await archiveProject(project.id)
      const st = useApp.getState()
      const remaining = st.projects.filter((p) => p.id !== project.id)
      st.setProjects(remaining)
      if (st.activeProjectId === project.id) {
        st.setActiveProject(remaining[0]?.id ?? null)
      }
      toast(`"${project.name}" removido`, {
        description: "Arquivado. Dá pra restaurar.",
        action: {
          label: "Desfazer",
          onClick: () => {
            void (async () => {
              await restoreProject(project.id)
              const s = useApp.getState()
              if (!s.projects.some((p) => p.id === project.id)) {
                s.setProjects([project, ...s.projects])
              }
              s.setActiveProject(project.id)
              toast.success(`"${project.name}" restaurado`)
            })()
          },
        },
      })
    } catch {
      toast.error("Falha ao remover o projeto")
    }
  })()
}

/** Submenu de cor reusado (conversa + projeto): swatches + remover. */
function ColorSubmenu({
  current,
  onPick,
}: {
  current?: string | null
  onPick: (color: string | null) => void
}) {
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <span
          className="size-3.5 rounded-full border"
          style={current ? { background: current } : undefined}
        />
        Cor
      </ContextMenuSubTrigger>
      <ContextMenuSubContent>
        <div className="grid grid-cols-3 gap-1 p-1">
          {LABEL_COLORS.map((c) => (
            <ContextMenuItem
              key={c.id}
              title={c.name}
              onSelect={() => onPick(c.hex)}
              className="justify-center p-1.5"
            >
              <span
                className={cn(
                  "size-4 rounded-full",
                  current === c.hex &&
                    "ring-2 ring-foreground/40 ring-offset-1 ring-offset-popover",
                )}
                style={{ background: c.hex }}
              />
            </ContextMenuItem>
          ))}
        </div>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => onPick(null)}>
          <Ban /> Remover cor
        </ContextMenuItem>
      </ContextMenuSubContent>
    </ContextMenuSub>
  )
}

/** Ícone do projeto: pasta TINGIDA da cor-rótulo (cinza se sem cor), com um
 *  pulso no canto quando o projeto tem um turno rodando. Marcador do container. */
function ProjectFolder({
  color,
  status,
}: {
  color?: string | null
  status: AgentStatus
}) {
  return (
    <span className="relative grid size-5 shrink-0 place-items-center">
      <Folder
        className={cn("size-[18px]", !color && "text-muted-foreground/70")}
        style={color ? { color } : undefined}
      />
      {status === "running" && (
        <span className="animate-cockpit-pulse absolute -top-0.5 -right-0.5 size-2 rounded-full bg-st-running ring-2 ring-rail" />
      )}
    </span>
  )
}

function ProjectRow({
  project,
  active,
  expanded,
  status,
  onSelect,
  onToggle,
  onDelete,
}: {
  project: Project
  active: boolean
  expanded: boolean
  status: AgentStatus
  onSelect: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const renameProject = useApp((s) => s.renameProject)
  const setProjectColor = useApp((s) => s.setProjectColor)
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState(project.name)

  function commit() {
    setEditing(false)
    const v = val.trim()
    if (v && v !== project.name) renameProject(project.id, v)
    else setVal(project.name)
  }

  // Cor-rótulo = DOT ao lado do nome (a tinta de linha inteira competia com o
  // bg-accent/barra de seleção — 3 sinais no mesmo canal). Seleção é dona do bg.
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group relative flex w-full items-center rounded-md transition-colors",
            active ? "bg-accent" : "hover:bg-accent/55",
          )}
        >
          {active && (
            <span className="absolute top-1/2 left-0 h-5 w-[2.5px] -translate-y-1/2 rounded-full bg-brass" />
          )}
          {editing ? (
            <div className="flex min-w-0 flex-1 items-center gap-3 p-2">
              <ProjectFolder color={project.color} status={status} />
              <input
                autoFocus
                value={val}
                onChange={(e) => setVal(e.target.value)}
                onBlur={commit}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit()
                  if (e.key === "Escape") {
                    setVal(project.name)
                    setEditing(false)
                  }
                }}
                className="min-w-0 flex-1 rounded border border-brass/40 bg-background px-1.5 py-0.5 text-[13px] text-foreground outline-none"
              />
            </div>
          ) : (
            <button
              onClick={onSelect}
              className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-1 pl-2 text-left"
            >
              {/* Pasta TINGIDA da cor do projeto (Codex-like): é o marcador do
                  container. Path saiu da linha → vira tooltip (menos ruído). */}
              <ProjectFolder color={project.color} status={status} />
              <span
                className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground"
                title={project.path}
              >
                {project.name}
              </span>
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition hover:text-st-error group-hover:opacity-100"
            title="Arquivar projeto"
            aria-label="Arquivar projeto"
          >
            <Trash2 className="size-3.5" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
            title={expanded ? "Retrair" : "Expandir"}
            aria-label={expanded ? "Retrair projeto" : "Expandir projeto"}
            aria-expanded={expanded}
            className="mr-1 shrink-0 rounded p-1.5 text-muted-foreground/50 transition-colors hover:bg-accent hover:text-muted-foreground"
          >
            <ChevronRight
              className={cn(
                "size-3.5 transition-transform duration-200",
                expanded && "rotate-90",
              )}
            />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
        <ContextMenuItem
          onSelect={() => {
            setVal(project.name)
            setEditing(true)
          }}
        >
          <Pencil /> Renomear
        </ContextMenuItem>
        <ColorSubmenu
          current={project.color}
          onPick={(c) => setProjectColor(project.id, c)}
        />
        <ContextMenuItem
          onSelect={() => {
            void navigator.clipboard.writeText(project.path)
            toast.success("Caminho copiado")
          }}
        >
          <Copy /> Copiar caminho
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onDelete}>
          <Archive /> Arquivar
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Ids das conversas rodando, como string estável (só muda em transição de run
 * , não a cada delta de streaming, evitando re-render da sidebar inteira). */
function useRunningConvIds(): Set<string> {
  const key = useChat((s) =>
    Object.entries(s.byId)
      .filter(([, c]) => c.running)
      .map(([id]) => id)
      .sort()
      .join(","),
  )
  return new Set(key ? key.split(",") : [])
}

/** Ids das conversas com disputa de Fusion esperando DECISÃO (string estável). */
function useDecidingConvIds(): Set<string> {
  const key = useFusion((s) =>
    Object.entries(s.byConv)
      .filter(([, f]) => f.phase === "deciding")
      .map(([id]) => id)
      .sort()
      .join(","),
  )
  return new Set(key ? key.split(",") : [])
}

/** Lista de conversas (tarefas) de UM projeto (árvore independente: pode haver
 *  várias montadas ao mesmo tempo, cada uma lendo a lista do seu projectId). */
// Array vazio ESTÁVEL (module-level): o selector abaixo NÃO pode retornar um `[]`
// novo a cada chamada — o useSyncExternalStore do React 18 detecta referência
// nova a cada snapshot e entra em loop infinito ("getSnapshot should be cached"),
// que dava TELA PRETA quando o projeto ainda não tinha as conversas carregadas.
const EMPTY_CONVS: ConversationMeta[] = []

function ConversationList({ projectId }: { projectId: string }) {
  // default FORA do selector (?? numa constante estável): selector devolve o
  // array do store (ref estável) ou undefined (estável) — nunca um `[]` novo.
  const conversations =
    useChat((s) => s.conversationsByProject[projectId]) ?? EMPTY_CONVS
  const activeId = useChat((s) => s.activeId)
  const newConversation = useChat((s) => s.newConversation)
  const switchConversation = useChat((s) => s.switchConversation)
  const removeConversation = useChat((s) => s.removeConversation)
  const renameConversation = useChat((s) => s.renameConversation)
  const setConversationColor = useChat((s) => s.setConversationColor)
  const duplicateConversation = useChat((s) => s.duplicateConversation)
  const setWorktree = useChat((s) => s.setWorktree)
  // Projeto DESTA lista (não o ativo): worktree/isolamento usam o path certo,
  // mesmo numa árvore de projeto não-ativo.
  const project = useApp((s) => s.projects.find((p) => p.id === projectId) ?? null)
  const setActiveProject = useApp((s) => s.setActiveProject)
  const running = useRunningConvIds()
  const deciding = useDecidingConvIds()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState("")

  // Clicar numa conversa: torna o projeto DELA o ativo (abre no painel) e troca
  // a conversa. Funciona pra projeto não-ativo (setActive + switch pelo id único).
  function openConv(id: string) {
    if (projectId !== useApp.getState().activeProjectId) setActiveProject(projectId)
    void switchConversation(id)
  }

  function commitRename(id: string) {
    const v = editValue.trim()
    setEditingId(null)
    if (v) void renameConversation(id, v)
  }

  // conversa é HARD-DELETE (sem desfazer) → sempre confirma antes.
  async function askDeleteConv(id: string, title: string | null) {
    const ok = await confirm({
      title: "Excluir conversa?",
      description: `"${title ?? "Nova conversa"}" — o histórico e os anexos são apagados. Não dá pra desfazer.`,
      confirmLabel: "Excluir",
      danger: true,
    })
    if (ok) void removeConversation(id)
  }

  // v2.5 — isola a conversa num worktree (o cockpit cria) ou volta pra o projeto.
  async function toggleWorktree(id: string, wt: string | null) {
    if (!project) return
    if (wt) {
      try {
        await removeWorktree(project.path, wt)
        setWorktree(id, null)
        toast.success("Isolamento removido")
      } catch (e) {
        // git recusa sem --force se houver mudança não-commitada (preserva o trabalho)
        toast.error(
          typeof e === "string" && e
            ? e
            : "Não removi — há mudanças não-commitadas no worktree?",
        )
      }
    } else {
      try {
        const info = await createWorktree(project.path, id)
        setWorktree(id, info.path)
        toast.success(`Isolado em ${info.branch}`)
      } catch (e) {
        toast.error(typeof e === "string" ? e : "Falha ao isolar")
      }
    }
  }

  return (
    // Sem border-l nem indentação de container: a hierarquia é só alinhamento.
    // Cada filho recebe pl-10 (40px) → texto sob o texto do projeto.
    <div className="animate-reveal-down mt-0.5 mb-1 flex flex-col gap-px">
      {conversations.map((c) => {
        const isActive = c.id === activeId
        const isRunning = running.has(c.id)
        const isDeciding = deciding.has(c.id)
        const isEditing = editingId === c.id
        const statusEl = isRunning ? (
          <Loader2 className="size-3 animate-spin text-brass" aria-label="rodando" />
        ) : isDeciding ? (
          <span
            className="size-1.5 rounded-full bg-brass"
            title="Disputa esperando sua decisão"
            aria-label="decisão pendente"
          />
        ) : null
        // Cor-rótulo = DOT à direita do título (tinta de linha competia com a
        // seleção). Seleção é dona do background.
        return (
          <ContextMenu key={c.id}>
            <ContextMenuTrigger asChild>
              <div
                className={cn(
                  "group/c flex items-center rounded-md",
                  isActive ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                {isEditing ? (
                  <div className="flex min-w-0 flex-1 items-center py-2 pr-2 pl-10">
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onBlur={() => commitRename(c.id)}
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename(c.id)
                        if (e.key === "Escape") setEditingId(null)
                      }}
                      className="min-w-0 flex-1 rounded border border-brass/40 bg-background px-1 py-0.5 text-[12px] text-foreground outline-none"
                    />
                  </div>
                ) : (
                  <button
                    onClick={() => openConv(c.id)}
                    className={cn(
                      "flex min-w-0 flex-1 items-center gap-2 py-2 pr-2 pl-10 text-left text-[12px]",
                      // active = cor de destaque no texto (bg fixo vem do container);
                      // inativo = cinza médio, clareia no hover.
                      isActive
                        ? "font-normal text-brass"
                        : "font-normal text-muted-foreground group-hover/c:text-foreground",
                    )}
                  >
                    {/* Sem ícone à esquerda: a indentação (pl-10) define a hierarquia.
                        Título trunca; status/worktree ficam à DIREITA, nunca deslocam. */}
                    <span className="min-w-0 flex-1 truncate">
                      {c.title ?? "Nova conversa"}
                    </span>
                    {c.color && (
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: c.color }}
                        title="Cor da conversa"
                      />
                    )}
                    {c.worktreePath && (
                      <GitBranch
                        className="size-3 shrink-0 text-brass/60"
                        aria-label="isolado em worktree"
                      />
                    )}
                    {statusEl && (
                      <span className="grid size-3 shrink-0 place-items-center">
                        {statusEl}
                      </span>
                    )}
                  </button>
                )}
                {!isRunning && !isEditing && (
                  <button
                    onClick={() => void askDeleteConv(c.id, c.title)}
                    className="mr-1 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition hover:text-st-error group-hover/c:opacity-100"
                    title="Excluir conversa"
                    aria-label="Excluir conversa"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent onCloseAutoFocus={(e) => e.preventDefault()}>
              <ContextMenuItem
                onSelect={() => {
                  setEditValue(c.title ?? "")
                  setEditingId(c.id)
                }}
              >
                <Pencil /> Renomear
              </ContextMenuItem>
              <ColorSubmenu
                current={c.color}
                onPick={(col) => void setConversationColor(c.id, col)}
              />
              <ContextMenuItem onSelect={() => void duplicateConversation(c.id)}>
                <Copy /> Duplicar
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => void toggleWorktree(c.id, c.worktreePath)}
              >
                <GitBranch />{" "}
                {c.worktreePath ? "Remover isolamento" : "Isolar em worktree"}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                variant="destructive"
                disabled={isRunning}
                onSelect={() => void askDeleteConv(c.id, c.title)}
              >
                <X /> Excluir
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
      <button
        onClick={() => {
          // Nova tarefa neste projeto → torna-o o ativo (abre no painel) e cria.
          if (projectId !== useApp.getState().activeProjectId)
            setActiveProject(projectId)
          void newConversation(projectId)
        }}
        className="flex items-center gap-3 rounded-md p-2 text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
      >
        {/* Plus ocupa a mesma coluna de ícone (20px) do projeto → "nova tarefa"
            alinha com as conversas, mantendo a leitura da coluna. */}
        <span className="grid size-5 shrink-0 place-items-center">
          <Plus className="size-3.5" />
        </span>
        Nova tarefa
      </button>
    </div>
  )
}

/** Rodapé: "local · vX.Y.Z". Nos builds de teste a versão vira 0.1.0-test.N,
 *  então você SEMPRE sabe qual build está rodando. */
function AppVersion() {
  const [version, setVersion] = useState("")
  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {}) // browser (vite dev): sem versão, só "local"
  }, [])
  return (
    <div className="label-mono truncate text-[10.5px] normal-case tracking-normal text-muted-foreground/80">
      local{version ? ` · v${version}` : ""}
    </div>
  )
}

export function Sidebar({ onAddProject }: { onAddProject: () => void }) {
  const projects = useApp((s) => s.projects)
  const activeId = useApp((s) => s.activeProjectId)
  const setActive = useApp((s) => s.setActiveProject)
  const theme = useApp((s) => s.theme)
  const toggleTheme = useApp((s) => s.toggleTheme)
  const loadProjectConversations = useChat((s) => s.loadProjectConversations)
  // Árvore INDEPENDENTE (Finder/VS Code): `expanded` guarda os projetos ABERTOS
  // — vários ao mesmo tempo, DESATRELADO do ativo. Em memória (ok no v1).
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Projetos que o usuário COLAPSOU de propósito (chevron): o auto-expand do
  // ativo respeita a escolha e os pula. Expandir de novo (chevron/seleção)
  // tira do set. Ref (não re-renderiza; só o efeito abaixo lê).
  const userCollapsed = useRef<Set<string>>(new Set())
  // Abrir um projeto = adicionar ao set + carregar (lazy) as conversas dele.
  const openExpand = (id: string) => {
    userCollapsed.current.delete(id) // expandir desfaz o colapso deliberado
    void loadProjectConversations(id)
    setExpanded((s) => {
      if (s.has(id)) return s
      const n = new Set(s)
      n.add(id)
      return n
    })
  }
  // Chevron: alterna SÓ este projeto (não fecha os outros).
  function toggleExpand(id: string) {
    if (expanded.has(id)) {
      userCollapsed.current.add(id) // colapso DELIBERADO → auto-expand pula
      setExpanded((s) => {
        const n = new Set(s)
        n.delete(id)
        return n
      })
    } else {
      openExpand(id)
    }
  }
  // Auto-expande o projeto ativo (seleção via ⌘K, boot etc. abre a árvore dele),
  // EXCETO se o usuário o colapsou de propósito (userCollapsed).
  useEffect(() => {
    if (activeId && !userCollapsed.current.has(activeId)) openExpand(activeId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId])
  // Projetos com QUALQUER conversa rodando (string estável → menos re-render).
  const runningProjectsKey = useChat((s) =>
    Array.from(
      new Set(
        Object.values(s.byId)
          .filter((c) => c.running)
          .map((c) => c.projectId),
      ),
    )
      .sort()
      .join(","),
  )
  const runningProjects = new Set(
    runningProjectsKey ? runningProjectsKey.split(",") : [],
  )

  return (
    <aside className="reveal-left flex h-full w-full flex-col bg-rail">
      <header className="flex h-11 shrink-0 items-center justify-between px-3">
        <div className="flex items-center gap-2">
          <span className="label-mono">Projetos</span>
          <span className="text-[11px] text-muted-foreground tabular-nums">
            {projects.length}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={onAddProject}
          title="Adicionar projeto"
          aria-label="Adicionar projeto"
        >
          <Plus className="size-4" />
        </Button>
      </header>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-0.5 px-2 pb-2">
          {projects.length === 0 ? (
            <div className="mt-10 flex flex-col items-center gap-3 px-4 text-center">
              <FolderGit2 className="size-6 text-muted-foreground/60" />
              <p className="text-[13px] text-muted-foreground">
                Nenhum projeto ainda.
              </p>
              <Button variant="outline" size="sm" onClick={onAddProject}>
                <Plus className="size-4" />
                Adicionar projeto
              </Button>
            </div>
          ) : (
            projects.map((p) => (
              <div key={p.id} className="flex flex-col">
                <ProjectRow
                  project={p}
                  active={p.id === activeId}
                  expanded={expanded.has(p.id)}
                  status={
                    runningProjects.has(p.id) ? "running" : (p.status ?? "idle")
                  }
                  onSelect={() => {
                    setActive(p.id)
                    openExpand(p.id) // selecionar auto-expande, sem fechar os outros
                  }}
                  onToggle={() => toggleExpand(p.id)}
                  onDelete={() => confirmDeleteProject(p)}
                />
                {expanded.has(p.id) && <ConversationList projectId={p.id} />}
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      <footer className="flex h-12 shrink-0 items-center gap-2.5 border-t px-3">
        <div className="grid size-6 place-items-center rounded-full bg-brass/15 text-[11px] font-semibold text-brass">
          V
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium text-foreground">
            Vinícius
          </div>
          <AppVersion />
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={toggleTheme}
          title="Alternar tema"
          aria-label="Alternar tema"
        >
          {theme === "dark" ? (
            <Sun className="size-4" />
          ) : (
            <Moon className="size-4" />
          )}
        </Button>
      </footer>
    </aside>
  )
}
