import type { ConversationMeta } from "@/lib/db/conversations"

export interface ConversationNode {
  item: ConversationMeta
  children: ConversationMeta[]
}

/**
 * Agrupa conversas de um projeto em uma lista de raízes com seus respectivos
 * forks/filhos aninhados. Conversas com parentId inexistente no mesmo projeto
 * degradam com segurança como raízes (fail-open).
 */
export function groupConversationTree(
  conversations: ConversationMeta[],
): ConversationNode[] {
  const byId = new Map<string, ConversationMeta>()
  for (const c of conversations) {
    byId.set(c.id, c)
  }

  const childrenByParent = new Map<string, ConversationMeta[]>()
  const roots: ConversationMeta[] = []

  for (const c of conversations) {
    if (c.parentId && byId.has(c.parentId) && c.parentId !== c.id) {
      const list = childrenByParent.get(c.parentId) ?? []
      list.push(c)
      childrenByParent.set(c.parentId, list)
    } else {
      roots.push(c)
    }
  }

  return roots.map((root) => ({
    item: root,
    children: childrenByParent.get(root.id) ?? [],
  }))
}

/**
 * Retorna todos os ramos pertencentes à família de uma conversa ativa.
 * A família inclui a conversa raiz e todos os seus forks filhos.
 */
export function getConversationFamily(
  conversations: ConversationMeta[],
  activeId: string | null,
): { root: ConversationMeta; branches: ConversationMeta[] } | null {
  if (!activeId || conversations.length === 0) return null

  const target = conversations.find((c) => c.id === activeId)
  if (!target) return null

  const rootId = target.parentId ?? target.id
  const root = conversations.find((c) => c.id === rootId) ?? target

  const branches = [
    root,
    ...conversations.filter((c) => c.parentId === root.id && c.id !== root.id),
  ]

  return { root, branches }
}
