import { describe, expect, it, vi } from "vitest"
import {
  applyAgentPatch,
  initialMcpProjectId,
  mcpAgentStatusLabel,
  mcpAuthActionLabel,
  mcpAuthHint,
  mcpAuthLabel,
  mcpHealthLabel,
  mcpPortabilityNotices,
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
    nativeReason: null,
    literalSecret: false,
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

describe("mcpPortabilityNotices", () => {
  // Config REAL do prime-mcp (.mcp.json do prime-sales-hub): HTTP + OAuth, sem
  // nenhum valor literal. A tela dizia "contém valor literal", que é falso.
  const primeMcp: Parameters<typeof mcpPortabilityNotices>[0] = {
    managed: true,
    portable: false,
    nativeReason: "oauth",
    literalSecret: false,
    sourceAgent: null,
  }

  it("OAuth explica o keychain e para onde ir, sem falar em valor literal", () => {
    const [notice, ...resto] = mcpPortabilityNotices(primeMcp)
    expect(resto).toEqual([])
    expect(notice.kind).toBe("native-only")
    expect(notice.text).toContain("Login próprio do CLI (OAuth)")
    expect(notice.text).toContain("keychain")
    expect(notice.text).toContain("autentique por lá")
    expect(notice.text).not.toContain("valor literal")
  })

  it("origem conhecida nomeia o CLI onde o MCP já funciona nativo", () => {
    const [notice] = mcpPortabilityNotices({
      ...primeMcp,
      sourceAgent: "claude-code",
    })
    expect(notice.text).toContain("No Claude Code ele já funciona nativo")
  })

  it("origem sem agent conhecido não inventa nome de CLI", () => {
    const [notice] = mcpPortabilityNotices(primeMcp)
    expect(notice.text).toContain("Ele segue funcionando no CLI que fez o login")
  })

  it("SSE/WebSocket aponta a sessão do CLI de origem e o endpoint HTTP", () => {
    const [notice] = mcpPortabilityNotices({
      ...primeMcp,
      nativeReason: "stream",
      sourceAgent: "codex",
    })
    expect(notice.kind).toBe("native-only")
    expect(notice.text).toContain("Transporte SSE/WebSocket")
    expect(notice.text).toContain("No Codex ele já funciona nativo")
    expect(notice.text).toContain("use um endpoint HTTP MCP")
  })

  it("helper de header aponta o comando local e a saída por env ref", () => {
    const [notice] = mcpPortabilityNotices({
      ...primeMcp,
      nativeReason: "headers-helper",
    })
    expect(notice.kind).toBe("native-only")
    expect(notice.text).toContain("helper do CLI de origem")
    expect(notice.text).toContain("referência de ambiente (${VAR})")
  })

  it("credencial literal mantém a copy que ali é verdadeira", () => {
    const notices = mcpPortabilityNotices({
      ...primeMcp,
      nativeReason: null,
      literalSecret: true,
    })
    expect(notices).toEqual([
      {
        kind: "literal-secret",
        text: "Não portável: contém valor literal ou expansão específica do CLI de origem.",
      },
    ])
  })

  it("os dois motivos juntos aparecem juntos, um não engole o outro", () => {
    const notices = mcpPortabilityNotices({
      ...primeMcp,
      nativeReason: "stream",
      literalSecret: true,
    })
    expect(notices.map((n) => n.kind)).toEqual([
      "native-only",
      "literal-secret",
    ])
  })

  it("servidor portável e MCP interno não recebem aviso", () => {
    expect(
      mcpPortabilityNotices({ ...primeMcp, portable: true, nativeReason: null }),
    ).toEqual([])
    expect(
      mcpPortabilityNotices({
        managed: false,
        portable: false,
        nativeReason: null,
        literalSecret: false,
        sourceAgent: null,
      }),
    ).toEqual([])
  })

  it("não portável sem motivo tipado admite o desconhecido em vez de chutar", () => {
    const notices = mcpPortabilityNotices({
      ...primeMcp,
      nativeReason: null,
      literalSecret: false,
    })
    expect(notices).toHaveLength(1)
    expect(notices[0].text).not.toContain("valor literal")
    expect(notices[0].text).toContain("não pode ser roteada para outro agent")
  })
})

describe("mcpAgentStatusLabel", () => {
  const state = (partial: Partial<McpAgentState>) => ({
    compatible: false,
    health: "unchecked" as const,
    ...partial,
  })

  it("nativo-apenas diz que falta roteamento, não que o MCP não existe", () => {
    expect(mcpAgentStatusLabel({ nativeReason: "oauth" }, state({}))).toBe(
      "sem roteamento (nativo do CLI)",
    )
  })

  it("incompatível sem causa nativa segue como não suportado", () => {
    expect(mcpAgentStatusLabel({ nativeReason: null }, state({}))).toBe(
      "não suportado",
    )
  })

  it("compatível mostra o health real, mesmo com causa nativa ausente", () => {
    expect(
      mcpAgentStatusLabel(
        { nativeReason: null },
        state({ compatible: true, health: "healthy" }),
      ),
    ).toBe("saudável")
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

describe("login do MyCockpit no MCP (A1)", () => {
  it("cada estado tem a sua copy, e nenhuma promete conexão que não existe", () => {
    expect(mcpAuthLabel("sem-login")).toBe("sem login do MyCockpit")
    expect(mcpAuthLabel("conectado")).toBe("conectado pelo MyCockpit")
    expect(mcpAuthLabel("expirado")).toBe("sessão expirada")
  })

  it("o botão só oferece Sair quando há sessão viva", () => {
    expect(mcpAuthActionLabel("sem-login")).toBe("Entrar")
    // Expirado volta pra "Entrar": é isso que resolve, e não um "tentar de
    // novo" que esconderia o motivo.
    expect(mcpAuthActionLabel("expirado")).toBe("Entrar")
    expect(mcpAuthActionLabel("conectado")).toBe("Sair")
  })

  it("a dica diz onde o token mora antes do login e o prazo depois dele", () => {
    expect(mcpAuthHint({ state: "sem-login", expiresAt: null })).toContain(
      "Keychain",
    )
    expect(mcpAuthHint({ state: "expirado", expiresAt: null })).toContain(
      "Entre de novo",
    )
    const agora = 1_000_000_000_000
    expect(
      mcpAuthHint({ state: "conectado", expiresAt: agora / 1000 + 1800 }, agora),
    ).toBe("Sessão ativa, renova em 30 min.")
    expect(
      mcpAuthHint({ state: "conectado", expiresAt: agora / 1000 + 7200 }, agora),
    ).toBe("Sessão ativa, renova em 2 h.")
  })

  it("sem prazo informado, a dica não inventa validade", () => {
    expect(mcpAuthHint({ state: "conectado", expiresAt: null })).toContain(
      "não informou prazo",
    )
  })
})
