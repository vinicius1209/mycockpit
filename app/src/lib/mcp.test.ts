import { describe, expect, it, vi } from "vitest"
import {
  applyAgentPatch,
  initialMcpProjectId,
  mcpHealthLabel,
  mcpProjectOptionLabel,
  optimisticBindingUpdate,
  type McpAgentState,
  type McpServer,
} from "@/lib/mcp"

function makeServer(id: string, states: Partial<McpAgentState>[]): McpServer {
  return {
    id,
    name: id,
    source: "claude",
    scope: "user",
    transport: "stdio",
    locator: "/bin/server",
    envKeys: [],
    sourceAgent: null,
    sourceEnabled: true,
    managed: true,
    portable: true,
    runtimeName: null,
    agentStates: states.map((partial) => ({
      agent: "claude-code",
      compatible: true,
      enabled: false,
      required: false,
      browser: false,
      fallback: "ask",
      health: "unchecked",
      detail: null,
      checkedAt: null,
      ...partial,
    })),
  }
}

describe("mcpHealthLabel", () => {
  it("mantém estados operacionais honestos", () => {
    expect(mcpHealthLabel("healthy")).toBe("saudável")
    expect(mcpHealthLabel("auth-delegated")).toBe("alcançável · auth por env")
    expect(mcpHealthLabel("auth-required")).toBe("requer autenticação")
    expect(mcpHealthLabel("unavailable")).toBe("indisponível")
    expect(mcpHealthLabel("unchecked")).toBe("não testado")
  })
})

describe("mcpProjectOptionLabel", () => {
  it("anexa a contagem quando o projeto tem bindings", () => {
    expect(mcpProjectOptionLabel("viniciusmachado", 2)).toBe(
      "viniciusmachado · 2",
    )
    expect(mcpProjectOptionLabel("prime-sales-hub", 1)).toBe(
      "prime-sales-hub · 1",
    )
  })

  it("sem bindings mostra só o nome, sem zero decorativo", () => {
    expect(mcpProjectOptionLabel("prime-sales-hub", 0)).toBe("prime-sales-hub")
  })
})

describe("initialMcpProjectId", () => {
  const projects = [{ id: "a" }, { id: "b" }]

  it("o default do painel é o projeto ativo da sidebar", () => {
    expect(initialMcpProjectId(projects, "b")).toBe("b")
  })

  it("ativo ausente da lista cai pro primeiro projeto", () => {
    expect(initialMcpProjectId(projects, "fantasma")).toBe("a")
    expect(initialMcpProjectId(projects, null)).toBe("a")
  })

  it("sem projetos não inventa id", () => {
    expect(initialMcpProjectId([], "a")).toBeNull()
  })
})

describe("applyAgentPatch", () => {
  it("altera só o par servidor×agent alvo, sem mutar a lista original", () => {
    const servers = [
      makeServer("s1", [{ agent: "claude-code" }, { agent: "codex" }]),
      makeServer("s2", [{ agent: "claude-code" }]),
    ]
    const next = applyAgentPatch(servers, "s1", "codex", { enabled: true })
    expect(next[0].agentStates[1].enabled).toBe(true)
    expect(next[0].agentStates[0].enabled).toBe(false)
    expect(next[1].agentStates[0].enabled).toBe(false)
    // Imutável: o estado anterior segue disponível pra reverter.
    expect(servers[0].agentStates[1].enabled).toBe(false)
    expect(next[1]).toBe(servers[1])
  })
})

describe("optimisticBindingUpdate", () => {
  it("marca na hora, antes do backend responder", async () => {
    const order: string[] = []
    let release: () => void = () => {}
    const commit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = () => {
            order.push("commit")
            resolve()
          }
        }),
    )
    const pending = optimisticBindingUpdate({
      apply: () => order.push("apply"),
      revert: () => order.push("revert"),
      commit,
      onError: () => order.push("erro"),
    })
    // O patch otimista já aconteceu com o invoke ainda em voo.
    expect(order).toEqual(["apply"])
    release()
    await expect(pending).resolves.toBe(true)
    expect(order).toEqual(["apply", "commit"])
  })

  it("sucesso confirma em silêncio, sem revert nem erro", async () => {
    const revert = vi.fn()
    const onError = vi.fn()
    const confirmed = await optimisticBindingUpdate({
      apply: vi.fn(),
      revert,
      commit: () => Promise.resolve(),
      onError,
    })
    expect(confirmed).toBe(true)
    expect(revert).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it("recusa do backend reverte o toggle e explica o motivo", async () => {
    const order: string[] = []
    const onError = vi.fn()
    const confirmed = await optimisticBindingUpdate({
      apply: () => order.push("apply"),
      revert: () => order.push("revert"),
      commit: () =>
        Promise.reject(new Error("agy ainda não suporta este MCP")),
      onError,
    })
    expect(confirmed).toBe(false)
    expect(order).toEqual(["apply", "revert"])
    expect(onError).toHaveBeenCalledWith("agy ainda não suporta este MCP")
  })
})
