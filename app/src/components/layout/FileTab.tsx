import { ProjectFileViewer } from "@/components/layout/ProjectFileViewer"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

/** Resolve a raiz efetiva da conversa e entrega o palco largo ao arquivo. */
export function FileTab({ path }: { path: string }) {
  const project = useApp((state) =>
    state.projects.find((item) => item.id === state.activeProjectId),
  )
  const worktree = useChat(
    (state) =>
      (state.conversationsByProject[state.projectId ?? ""] ?? state.conversations).find(
        (conversation) => conversation.id === state.activeId,
      )?.worktreePath ?? null,
  )

  if (!project) {
    return (
      <div className="grid h-full place-items-center text-[13px] text-muted-foreground">
        Nenhum projeto selecionado.
      </div>
    )
  }

  return <ProjectFileViewer root={worktree ?? project.path} path={path} />
}
