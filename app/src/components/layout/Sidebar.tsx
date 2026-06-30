import {
  Plus,
  Moon,
  Sun,
  FolderGit2,
  X,
  ChevronRight,
  Loader2,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { StatusDot } from "@/components/common/StatusDot"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useFusion } from "@/store/fusion"
import { archiveProject, restoreProject } from "@/lib/db"
import { cn, shortPath } from "@/lib/utils"
import type { AgentStatus, Project } from "@/lib/types"

/** Soft-remove do projeto (arquiva, conversas preservadas) com Desfazer. Disco intocado. */
function confirmDeleteProject(project: Project) {
  void (async () => {
    try {
      await archiveProject(project.id)
      const st = useApp.getState()
      const remaining = st.projects.filter((p) => p.id !== project.id)
      st.setProjects(remaining)
      if (st.activeProjectId === project.id) {
        st.setActiveProject(remaining[0]?.id ?? null)
      }
      toast(`"${project.name}" removido`, {
        description: "Arquivado — dá pra restaurar.",
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

function ProjectRow({
  project,
  active,
  status,
  onSelect,
  onDelete,
}: {
  project: Project
  active: boolean
  status: AgentStatus
  onSelect: () => void
  onDelete: () => void
}) {
  return (
    <div
      className={cn(
        "group relative flex w-full items-center rounded-md transition-colors",
        active ? "bg-accent" : "hover:bg-accent/55",
      )}
    >
      {active && (
        <span className="absolute top-1/2 left-0 h-5 w-[2.5px] -translate-y-1/2 rounded-full bg-brass" />
      )}
      <button
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pr-1 pl-2.5 text-left"
      >
        <StatusDot status={status} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-foreground">
            {project.name}
          </div>
          <div className="truncate font-mono text-[10.5px] text-muted-foreground">
            {shortPath(project.path)}
          </div>
        </div>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition hover:text-st-error group-hover:opacity-100"
        title="Remover projeto do cockpit"
        aria-label="Remover projeto"
      >
        <Trash2 className="size-3.5" />
      </button>
      <ChevronRight
        className={cn(
          "mr-2 size-3.5 shrink-0 text-muted-foreground/40 transition-transform duration-200",
          active && "rotate-90 text-muted-foreground/70",
        )}
      />
    </div>
  )
}

/** Ids das conversas rodando, como string estável (só muda em transição de run
 *  — não a cada delta de streaming, evitando re-render da sidebar inteira). */
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

/** Lista de conversas (tarefas) do projeto ativo — accordion sob o projeto. */
function ConversationList({ projectId }: { projectId: string }) {
  const conversations = useChat((s) => s.conversations)
  const activeId = useChat((s) => s.activeId)
  const newConversation = useChat((s) => s.newConversation)
  const switchConversation = useChat((s) => s.switchConversation)
  const removeConversation = useChat((s) => s.removeConversation)
  const running = useRunningConvIds()
  const deciding = useDecidingConvIds()

  return (
    <div className="animate-reveal-down mt-0.5 mb-1 ml-[18px] flex flex-col gap-px border-l border-border/60 pl-2">
      {conversations.map((c) => {
        const isActive = c.id === activeId
        const isRunning = running.has(c.id)
        const isDeciding = deciding.has(c.id)
        return (
          <div
            key={c.id}
            className={cn(
              "group/c flex items-center rounded-md",
              isActive ? "bg-accent" : "hover:bg-accent/50",
            )}
          >
            <button
              onClick={() => void switchConversation(c.id)}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-left text-[12px]",
                isActive
                  ? "text-foreground"
                  : "text-muted-foreground group-hover/c:text-foreground",
              )}
            >
              {/* slot fixo à esquerda → spinner quando roda, sem deslocar o título */}
              <span className="grid size-3 shrink-0 place-items-center">
                {isRunning ? (
                  <Loader2
                    className="size-3 animate-spin text-brass"
                    aria-label="rodando"
                  />
                ) : isDeciding ? (
                  <span
                    className="size-1.5 rounded-full bg-brass"
                    title="Disputa esperando sua decisão"
                    aria-label="decisão pendente"
                  />
                ) : null}
              </span>
              <span className="truncate">{c.title ?? "Nova conversa"}</span>
            </button>
            {!isRunning && (
              <button
                onClick={() => void removeConversation(c.id)}
                className="mr-1 shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition hover:text-st-error group-hover/c:opacity-100"
                title="Excluir conversa"
                aria-label="Excluir conversa"
              >
                <X className="size-3" />
              </button>
            )}
          </div>
        )
      })}
      <button
        onClick={() => void newConversation(projectId)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
      >
        <Plus className="size-3" />
        nova tarefa
      </button>
    </div>
  )
}

export function Sidebar({ onAddProject }: { onAddProject: () => void }) {
  const projects = useApp((s) => s.projects)
  const activeId = useApp((s) => s.activeProjectId)
  const setActive = useApp((s) => s.setActiveProject)
  const theme = useApp((s) => s.theme)
  const toggleTheme = useApp((s) => s.toggleTheme)
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
                  status={
                    runningProjects.has(p.id) ? "running" : (p.status ?? "idle")
                  }
                  onSelect={() => setActive(p.id)}
                  onDelete={() => confirmDeleteProject(p)}
                />
                {p.id === activeId && <ConversationList projectId={p.id} />}
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
          <div className="label-mono">local</div>
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
