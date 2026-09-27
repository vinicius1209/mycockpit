// A pasta em que os arquivos da conversa ativa vivem: o worktree dela, ou a
// pasta do projeto. Saiu do `FileTab` quando a tira de abas e o portão de
// fechar passaram a precisar da MESMA resposta (a edição indexa o buffer por
// raiz + chave da aba).

import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

type AppParaRaiz = Pick<ReturnType<typeof useApp.getState>, "projects" | "activeProjectId">
type ChatParaRaiz = Pick<
  ReturnType<typeof useChat.getState>,
  "conversationsByProject" | "conversations" | "projectId" | "activeId"
>

/** Puro. `null` sem projeto ativo. */
export function raizEfetiva(app: AppParaRaiz, chat: ChatParaRaiz): string | null {
  const projeto = app.projects.find((item) => item.id === app.activeProjectId)
  if (!projeto) return null
  const worktree =
    (chat.conversationsByProject[chat.projectId ?? ""] ?? chat.conversations).find(
      (conversation) => conversation.id === chat.activeId,
    )?.worktreePath ?? null
  return worktree ?? projeto.path
}

export function raizEfetivaAgora(): string | null {
  return raizEfetiva(useApp.getState(), useChat.getState())
}

export function useRaizEfetiva(): string | null {
  const projeto = useApp((s) => s.projects.find((item) => item.id === s.activeProjectId)?.path ?? null)
  const worktree = useChat(
    (s) =>
      (s.conversationsByProject[s.projectId ?? ""] ?? s.conversations).find(
        (conversation) => conversation.id === s.activeId,
      )?.worktreePath ?? null,
  )
  return projeto === null ? null : (worktree ?? projeto)
}
