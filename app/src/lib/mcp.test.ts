import { describe, expect, it, vi } from "vitest"
import {
  applyAgentPatch,
  initialMcpProjectId,
  mcpAgentStatusLabel,
  mcpAgentUtilizavel,
  gestoDaLinha,
  CONSEQUENCIA_ESCOPO_GLOBAL,
  CONSEQUENCIA_ESCOPO_PROJETO,
  rotuloDaAcao,
  consequenciaDaAcao,
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

describe("login do Frota no MCP (A1)", () => {
  it("cada estado tem a sua copy, e nenhuma promete conexão que não existe", () => {
    expect(mcpAuthLabel("sem-login")).toBe("sem login do Frota")
    expect(mcpAuthLabel("conectado")).toBe("conectado pelo Frota")
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

describe("proxy MCP autenticado (A2)", () => {
  const oauthServer = {
    managed: true,
    portable: false,
    nativeReason: "oauth" as const,
    literalSecret: false,
    sourceAgent: null,
  }

  it("com login do app, o servidor OAuth deixa de acusar falta de roteamento", () => {
    // Sem login, a copy de hoje continua igual.
    expect(mcpPortabilityNotices(oauthServer, false)).toHaveLength(1)
    expect(mcpPortabilityNotices(oauthServer, false)[0].kind).toBe("native-only")
    // Com login, quem autentica é o app e o proxy roteia: não há mais o que
    // avisar.
    expect(mcpPortabilityNotices(oauthServer, true)).toEqual([])
  })

  it("login do app não perdoa segredo literal, que é outra trava", () => {
    const comLiteral = { ...oauthServer, literalSecret: true }
    const notices = mcpPortabilityNotices(comLiteral, true)
    expect(notices).toHaveLength(1)
    expect(notices[0].kind).toBe("literal-secret")
  })

  it("login do app não afeta as outras causas de não roteamento", () => {
    const streamServer = { ...oauthServer, nativeReason: "stream" as const }
    // SSE/WS segue fora: o proxy ainda não fala streaming.
    expect(mcpPortabilityNotices(streamServer, true)).toHaveLength(1)
    expect(mcpPortabilityNotices(streamServer, true)[0].kind).toBe("native-only")
  })

  it("a linha por agent diz que o Frota roteia, em vez de negar", () => {
    const health = "auth-required" as const
    expect(
      mcpAgentStatusLabel(oauthServer, {
        compatible: false,
        roteavelPeloApp: false,
        health,
      }),
    ).toBe("sem roteamento (nativo do CLI)")
    expect(
      mcpAgentStatusLabel(oauthServer, {
        compatible: false,
        roteavelPeloApp: true,
        health,
      }),
    ).toBe("roteado pelo Frota")
  })

  it("o interruptor segue o MESMO fato que o rótulo", () => {
    // O bug: o rótulo já dizia "roteado pelo Frota" e o interruptor continuava
    // preso, porque lia `compatible` cru (que num MCP OAuth é sempre false).
    // Dizer "roteado" e não deixar ligar é a tela contradizendo a si mesma.
    const roteado = {
      compatible: false,
      roteavelPeloApp: true,
      health: "auth-required" as const,
    }
    expect(mcpAgentStatusLabel(oauthServer, roteado)).toBe("roteado pelo Frota")
    expect(mcpAgentUtilizavel(roteado)).toBe(true)
  })

  it("sem login o interruptor continua preso, e o rótulo concorda", () => {
    const preso = { compatible: false, roteavelPeloApp: false }
    expect(mcpAgentUtilizavel(preso)).toBe(false)
  })

  it("motor que não roteia não é chamado de 'não suportado'", () => {
    // O agy DESMENTIU o app: perguntado, respondeu que tem suporte completo a
    // MCP (stdio e http), e está certo. O que falta é escopo por-run, porque a
    // config dele é global. O limite é do Frota, e a frase tem de dizer isso.
    const agy = {
      compatible: false,
      roteiaMcpGerenciado: false,
      health: "unchecked" as const,
    }
    expect(mcpAgentStatusLabel({ nativeReason: null }, agy)).toBe(
      "sem roteamento do Frota (configure no CLI)",
    )
    // Vale também quando o servidor TEM causa nativa: o limite do motor é o
    // fato dominante, e é o único acionável (não adianta logar no app).
    expect(mcpAgentStatusLabel({ nativeReason: "oauth" }, agy)).toBe(
      "sem roteamento do Frota (configure no CLI)",
    )
  })

  it("motor que roteia mantém as frases antigas", () => {
    // Guarda do outro lado: a frase nova não pode vazar pra quem roteia.
    const capaz = {
      compatible: false,
      roteiaMcpGerenciado: true,
      health: "unchecked" as const,
    }
    expect(mcpAgentStatusLabel({ nativeReason: "oauth" }, capaz)).toBe(
      "sem roteamento (nativo do CLI)",
    )
    expect(mcpAgentStatusLabel({ nativeReason: null }, capaz)).toBe(
      "não suportado",
    )
  })

  it("escopo global oferece AÇÃO, nunca interruptor", () => {
    // Interruptor comunica "eu sei como está e controlo". O app NÃO sabe o que
    // já existe no `agy mcp list` do usuário, então mostrar um seria a mesma
    // classe de mentira do ADR-100, na direção oposta.
    expect(
      gestoDaLinha({
        compatible: false,
        roteavelPeloApp: false,
        escopo: "global",
      }),
    ).toBe("acao-no-cli")
  })

  it("quem o app controla de verdade continua com interruptor", () => {
    expect(
      gestoDaLinha({ compatible: true, escopo: "por-run" }),
    ).toBe("interruptor")
    // E roteado pelo proxy do app também: ali o app sabe e controla.
    expect(
      gestoDaLinha({
        compatible: false,
        roteavelPeloApp: true,
        escopo: "por-run",
      }),
    ).toBe("interruptor")
  })

  it("escopo de projeto tem gesto PRÓPRIO, não o mesmo do global", () => {
    // Escrever na config global do CLI e escrever num arquivo do repositório
    // do usuário não são o mesmo risco. Juntar os dois num gesto só faria a
    // tela dizer a consequência errada em um dos casos.
    const gesto = gestoDaLinha({ compatible: false, escopo: "por-projeto" })
    expect(gesto).toBe("acao-no-projeto")
    expect(rotuloDaAcao(gesto)).toBe("Instalar no projeto")
    expect(consequenciaDaAcao(gesto)).toBe(CONSEQUENCIA_ESCOPO_PROJETO)
    expect(consequenciaDaAcao("acao-no-cli")).toBe(CONSEQUENCIA_ESCOPO_GLOBAL)
    expect(CONSEQUENCIA_ESCOPO_PROJETO).not.toBe(CONSEQUENCIA_ESCOPO_GLOBAL)
  })

  it("a consequência do projeto avisa que o arquivo é versionado", () => {
    // O commit seguinte carrega a mudança junto. Descobrir isso no `git diff`
    // é a pior hora.
    expect(CONSEQUENCIA_ESCOPO_PROJETO).toContain("repositório")
    expect(CONSEQUENCIA_ESCOPO_PROJETO).toContain("versionado")
    // E promete o limite que o merge de fato cumpre (ADR-105).
    expect(CONSEQUENCIA_ESCOPO_PROJETO).toContain("Só a entrada do Frota")
  })

  it("escopo sem receita não inventa gesto", () => {
    expect(gestoDaLinha({ compatible: false })).toBe("nada")
    expect(rotuloDaAcao("nada")).toBeNull()
    expect(consequenciaDaAcao("nada")).toBeNull()
    expect(rotuloDaAcao("interruptor")).toBeNull()
  })

  it("a consequência do escopo global é dita ANTES do clique", () => {
    // Escopo global não se desfaz no fim do run. Quem lê precisa saber os dois
    // fatos: alcance (todos os projetos) e duração (continua depois).
    expect(CONSEQUENCIA_ESCOPO_GLOBAL).toContain("todos os projetos")
    expect(CONSEQUENCIA_ESCOPO_GLOBAL).toContain("continua depois")
    // E de quem é a mão que escreve, que é o ponto do ADR-103.
    expect(CONSEQUENCIA_ESCOPO_GLOBAL).toContain("CLI do agent")
  })

  it("estado gravado ANTES deste campo não vira 'roteável' por omissão", () => {
    // `roteavelPeloApp` é opcional porque snapshot antigo não o tem. Ausente
    // tem de significar "não sei, então não libera", nunca `true` por descuido.
    expect(mcpAgentUtilizavel({ compatible: false })).toBe(false)
    expect(mcpAgentUtilizavel({ compatible: true })).toBe(true)
  })
})
