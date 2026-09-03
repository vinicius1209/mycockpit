import { describe, expect, it } from "vitest"
import {
  groupConversationTree,
  getConversationFamily,
} from "./conversationTree"
import type { ConversationMeta } from "@/lib/db/conversations"

describe("groupConversationTree", () => {
  it("mantém conversas planas quando não há parentId", () => {
    const list: ConversationMeta[] = [
      { id: "1", title: "Tarefa 1", updatedAt: 1, color: null, worktreePath: null, agent: null },
      { id: "2", title: "Tarefa 2", updatedAt: 2, color: null, worktreePath: null, agent: null },
    ]
    const tree = groupConversationTree(list)
    expect(tree).toHaveLength(2)
    expect(tree[0].item.id).toBe("1")
    expect(tree[0].children).toHaveLength(0)
    expect(tree[1].item.id).toBe("2")
    expect(tree[1].children).toHaveLength(0)
  })

  it("agrupa forks sob a conversa raiz", () => {
    const list: ConversationMeta[] = [
      { id: "root1", title: "Tarefa Principal", updatedAt: 1, color: null, worktreePath: null, agent: null },
      { id: "fork1", title: "Tarefa (fork)", updatedAt: 2, color: null, worktreePath: null, agent: null, parentId: "root1" },
      { id: "root2", title: "Outra Tarefa", updatedAt: 3, color: null, worktreePath: null, agent: null },
      { id: "fork2", title: "Tarefa (fork 2)", updatedAt: 4, color: null, worktreePath: null, agent: null, parentId: "root1" },
    ]
    const tree = groupConversationTree(list)
    expect(tree).toHaveLength(2)
    expect(tree[0].item.id).toBe("root1")
    expect(tree[0].children).toHaveLength(2)
    expect(tree[0].children.map((c) => c.id)).toEqual(["fork1", "fork2"])
    expect(tree[1].item.id).toBe("root2")
    expect(tree[1].children).toHaveLength(0)
  })

  it("degrada como raiz se o parentId apontar para uma conversa inexistente (fail-open)", () => {
    const list: ConversationMeta[] = [
      { id: "orphan", title: "Orfã", updatedAt: 1, color: null, worktreePath: null, agent: null, parentId: "inexistente" },
    ]
    const tree = groupConversationTree(list)
    expect(tree).toHaveLength(1)
    expect(tree[0].item.id).toBe("orphan")
    expect(tree[0].children).toHaveLength(0)
  })
})

describe("getConversationFamily", () => {
  it("devolve raiz e todos os ramos quando a conversa ativa é a raiz", () => {
    const list: ConversationMeta[] = [
      { id: "root", title: "Raiz", updatedAt: 1, color: null, worktreePath: null, agent: null },
      { id: "f1", title: "Fork 1", updatedAt: 2, color: null, worktreePath: null, agent: null, parentId: "root" },
      { id: "f2", title: "Fork 2", updatedAt: 3, color: null, worktreePath: null, agent: null, parentId: "root" },
    ]
    const family = getConversationFamily(list, "root")
    expect(family).not.toBeNull()
    expect(family?.root.id).toBe("root")
    expect(family?.branches.map((b) => b.id)).toEqual(["root", "f1", "f2"])
  })

  it("devolve a mesma família quando a conversa ativa é um dos forks", () => {
    const list: ConversationMeta[] = [
      { id: "root", title: "Raiz", updatedAt: 1, color: null, worktreePath: null, agent: null },
      { id: "f1", title: "Fork 1", updatedAt: 2, color: null, worktreePath: null, agent: null, parentId: "root" },
    ]
    const family = getConversationFamily(list, "f1")
    expect(family).not.toBeNull()
    expect(family?.root.id).toBe("root")
    expect(family?.branches.map((b) => b.id)).toEqual(["root", "f1"])
  })

  it("retorna null se activeId for nulo ou ausente", () => {
    const list: ConversationMeta[] = [
      { id: "root", title: "Raiz", updatedAt: 1, color: null, worktreePath: null, agent: null },
    ]
    expect(getConversationFamily(list, null)).toBeNull()
    expect(getConversationFamily(list, "outro")).toBeNull()
  })
})
