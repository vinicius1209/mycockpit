import { describe, expect, it } from "vitest"
import {
  browserBindingWarning,
  browserBoundServers,
  browserChainLine,
  browserDeliveries,
  browserDeliveryLabel,
  browserRowNotice,
  browserStateLabel,
  shouldShowBrowserCard,
  type BrowserSession,
  type BrowserStatus,
} from "@/lib/browser"
import type { McpAgentState, McpServer } from "@/lib/mcp"

/** Sessão com os valores REAIS de um lançamento do Chrome for Testing
 *  149.0.7827.55 com `--remote-debugging-port=0`. */
function session(): BrowserSession {
  return {
    projectId: "proj-1",
    projectPath: "/Users/me/projetos/mycockpit",
    processId: "proc-4242-7",
    pid: 22627,
    endpoint: "http://127.0.0.1:62934",
    browser: "Chrome/149.0.7827.55",
    userDataDir: "/Users/me/Library/Application Support/MyCockpit/browser-profiles/proj-1",
    binary:
      "/Users/me/Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    windowVisible: false,
    startedAt: 1_754_400_000_000,
  }
}

function server(name: string, states: Partial<McpAgentState>[]): McpServer {
  return {
    id: `claude:user:${name}`,
    name,
    source: "claude",
    scope: "user",
    transport: "stdio",
    locator: "npx",
    envKeys: [],
    sourceAgent: "claude-code",
    sourceEnabled: true,
    managed: true,
    portable: true,
    nativeReason: null,
    literalSecret: false,
    runtimeName: name,
    agentStates: states.map((partial) => ({
      agent: "claude-code",
      compatible: true,
      enabled: false,
      required: false,
      browser: false,
      fallback: "ask",
      health: "healthy",
      detail: null,
      checkedAt: null,
      ...partial,
    })),
  }
}

describe("browserStateLabel", () => {
  it("ligado mostra o navegador real sem expor detalhes de transporte", () => {
    const status: BrowserStatus = {
      projectId: "proj-1",
      session: session(),
      binary: session().binary,
      version: "149.0.7827.55",
      detail: null,
    }
    expect(browserStateLabel(status)).toBe(
      "ligado · Chrome/149.0.7827.55 · perfil deste projeto",
    )
  })

  it("desligado fala do binário disponível, nunca de um navegador imaginário", () => {
    expect(
      browserStateLabel({
        projectId: "proj-1",
        session: null,
        binary: session().binary,
        version: "149.0.7827.55",
        detail: null,
      }),
    ).toBe("desligado · Chromium 149.0.7827.55 pronto")
    // Binário existe mas não reportou versão: nada de versão inventada.
    expect(
      browserStateLabel({
        projectId: "proj-1",
        session: null,
        binary: session().binary,
        version: null,
        detail: null,
      }),
    ).toBe("desligado · Chromium pronto")
  })

  it("sem Chromium repete o motivo honesto do backend", () => {
    const detail =
      "não encontrei um Chromium nesta máquina; instale com `npx playwright install chromium` ou tenha o Google Chrome em /Applications"
    expect(
      browserStateLabel({
        projectId: "proj-1",
        session: null,
        binary: null,
        version: null,
        detail,
      }),
    ).toBe(detail)
  })

  it("fora do app (sem backend) não finge estado nenhum", () => {
    expect(browserStateLabel(null)).toBe("indisponível fora do app")
  })
})

describe("browserBoundServers", () => {
  it("lista só quem tem binding ATIVO marcado como navegador", () => {
    const servers = [
      server("playwright", [{ enabled: true, browser: true }]),
      // marcado, mas com o binding desligado: não conta.
      server("chrome-devtools", [{ enabled: false, browser: true }]),
      // binding ativo sem a marca: não pilota o navegador do app.
      server("hostinger", [{ enabled: true, browser: false }]),
    ]
    expect(browserBoundServers(servers)).toEqual(["playwright"])
  })

  it("basta um agent do servidor estar marcado", () => {
    const servers = [
      server("playwright", [
        { agent: "claude-code", enabled: true, browser: false },
        { agent: "codex", enabled: true, browser: true },
      ]),
    ]
    expect(browserBoundServers(servers)).toEqual(["playwright"])
  })
})

describe("browserBindingWarning", () => {
  const status = (live: boolean): BrowserStatus => ({
    projectId: "proj-1",
    session: live ? session() : null,
    binary: session().binary,
    version: "149.0.7827.55",
    detail: null,
  })

  it("avisa que o run bloqueia antes de abrir outro navegador", () => {
    const servers = [server("playwright", [{ enabled: true, browser: true }])]
    const warning = browserBindingWarning(servers, status(false))
    expect(warning).toContain("playwright pede o navegador do projeto")
    expect(warning).toContain("run será bloqueado")
    expect(warning).toContain("antes que o MCP abra outro navegador")
  })

  it("concorda no plural com mais de um MCP marcado", () => {
    const servers = [
      server("playwright", [{ enabled: true, browser: true }]),
      server("chrome-devtools", [{ enabled: true, browser: true }]),
    ]
    expect(browserBindingWarning(servers, status(false))).toContain(
      "playwright, chrome-devtools pedem o navegador do projeto",
    )
  })

  it("navegador ligado, ou nenhum binding marcado, não gera ruído", () => {
    const marcado = [server("playwright", [{ enabled: true, browser: true }])]
    expect(browserBindingWarning(marcado, status(true))).toBeNull()
    const semMarca = [server("hostinger", [{ enabled: true, browser: false }])]
    expect(browserBindingWarning(semMarca, status(false))).toBeNull()
  })
})

// ---- o encadeamento: ligar o navegador não basta --------------------------
//
// O incidente: o usuário ligou o navegador do projeto e o agent respondeu "o
// controlador retornou zero navegadores disponíveis". O `playwright` estava
// descoberto (source `claude`) e o Chromium subia de verdade, mas nenhuma linha
// de `mcp_bindings` tinha `browser = 1`, então `plan_for_run` nunca injetou o
// `--cdp-endpoint`. A UI só sabia dizer "ligado".

/** Estado real do Chromium do incidente (Chrome for Testing 151.0.7922.34,
 *  `chromium-1234`, subido com `--remote-debugging-port=0`). */
function statusDoIncidente(live: boolean): BrowserStatus {
  return {
    projectId: "proj-1",
    session: live
      ? {
          ...session(),
          browser: "Chrome/151.0.7922.34",
          endpoint: "http://127.0.0.1:61019",
          binary:
            "/Users/me/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
        }
      : null,
    binary:
      "/Users/me/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    version: "151.0.7922.34",
    detail: null,
  }
}

describe("browserDeliveries", () => {
  it("agrupa por agent quem tem binding ligado E marcado como navegador", () => {
    const servers = [
      server("playwright", [
        { agent: "claude-code", enabled: true, browser: true },
        { agent: "codex", enabled: true, browser: true },
      ]),
      server("chrome-devtools", [
        { agent: "codex", enabled: true, browser: true },
      ]),
    ]
    expect(browserDeliveries(servers)).toEqual([
      { agent: "claude-code", servers: ["playwright"] },
      { agent: "codex", servers: ["playwright", "chrome-devtools"] },
    ])
  })

  it("marca sem binding, e binding sem marca, não entregam nada", () => {
    const servers = [
      // O estado do incidente: binding existe, `browser` está em 0.
      server("playwright", [{ agent: "claude-code", enabled: true, browser: false }]),
      // Marca sem binding: o backend lê por LINHA de binding, sem linha não há
      // injeção de `--cdp-endpoint`.
      server("chrome-devtools", [
        { agent: "codex", enabled: false, browser: true },
      ]),
    ]
    expect(browserDeliveries(servers)).toEqual([])
  })

  it("agent fora do registry aparece com o próprio id, nunca some", () => {
    const servers = [
      server("playwright", [
        { agent: "agy" as never, enabled: true, browser: true },
      ]),
    ]
    expect(browserDeliveryLabel(browserDeliveries(servers))).toBe(
      "agy via playwright",
    )
  })

  it("a frase nomeia cada agent e por qual MCP ele recebe", () => {
    const servers = [
      server("playwright", [
        { agent: "claude-code", enabled: true, browser: true },
        { agent: "codex", enabled: true, browser: true },
      ]),
    ]
    expect(browserDeliveryLabel(browserDeliveries(servers))).toBe(
      "Claude via playwright · Codex via playwright",
    )
  })
})

describe("browserChainLine", () => {
  it("ligado e entregando confirma QUEM recebe, em cinza", () => {
    const servers = [
      server("playwright", [{ agent: "claude-code", enabled: true, browser: true }]),
    ]
    expect(browserChainLine(servers, statusDoIncidente(true))).toEqual({
      tom: "ok",
      texto: "Recebem este navegador: Claude via playwright.",
    })
  })

  it("ligado sem ninguém marcado diz que nenhum agent usa, e o que fazer", () => {
    // O incidente exato: playwright ligado para o Claude, `browser` em 0.
    const servers = [
      server("playwright", [
        { agent: "claude-code", enabled: true, browser: false },
      ]),
    ]
    const linha = browserChainLine(servers, statusDoIncidente(true))
    expect(linha?.tom).toBe("aviso")
    expect(linha?.texto).toContain("Nenhum agent vai usar este navegador")
    expect(linha?.texto).toContain("marque 'navegador'")
    // Nunca promete que o run vai parar: é degradação, não bloqueio.
    expect(linha?.texto).not.toContain("bloque")
  })

  it("ligado sem binding nenhum manda ligar o MCP antes de marcar", () => {
    const servers = [
      server("playwright", [
        { agent: "claude-code", enabled: false, browser: false },
      ]),
    ]
    const linha = browserChainLine(servers, statusDoIncidente(true))
    expect(linha?.tom).toBe("aviso")
    expect(linha?.texto).toContain("nenhum MCP está ligado neste projeto")
    expect(linha?.texto).toContain("ligue a integração")
  })

  it("desligado com alguém pedindo repete o bloqueio preventivo", () => {
    const servers = [
      server("playwright", [{ agent: "claude-code", enabled: true, browser: true }]),
    ]
    const linha = browserChainLine(servers, statusDoIncidente(false))
    expect(linha?.tom).toBe("aviso")
    expect(linha?.texto).toContain("playwright pede o navegador do projeto")
    expect(linha?.texto).toContain("run será bloqueado")
  })

  it("desligado e sem ninguém pedindo não inventa pendência", () => {
    const servers = [
      server("hostinger", [{ agent: "claude-code", enabled: true, browser: false }]),
    ]
    expect(browserChainLine(servers, statusDoIncidente(false))).toBeNull()
  })

  it("copy de UI sem travessão", () => {
    const casos = [
      browserChainLine(
        [server("playwright", [{ enabled: true, browser: true }])],
        statusDoIncidente(true),
      ),
      browserChainLine(
        [server("playwright", [{ enabled: true, browser: false }])],
        statusDoIncidente(true),
      ),
      browserChainLine([], statusDoIncidente(true)),
    ]
    for (const caso of casos) expect(caso?.texto).not.toContain("—")
  })
})

describe("shouldShowBrowserCard", () => {
  const semChromium: BrowserStatus = {
    projectId: "proj-1",
    session: null,
    binary: null,
    version: null,
    detail:
      "não encontrei um Chromium nesta máquina; instale com `npx playwright install chromium` ou tenha o Google Chrome em /Applications",
  }

  it("sem Chromium e sem nada marcado, a seção some junto com o toggle", () => {
    expect(shouldShowBrowserCard(semChromium, false)).toBe(false)
    expect(shouldShowBrowserCard(null, false)).toBe(false)
  })

  it("sem Chromium mas com MCP marcado, a seção FICA para dizer o motivo", () => {
    expect(shouldShowBrowserCard(semChromium, true)).toBe(true)
    expect(shouldShowBrowserCard(null, true)).toBe(true)
  })

  it("com Chromium disponível a seção sempre aparece", () => {
    expect(shouldShowBrowserCard(statusDoIncidente(false), false)).toBe(true)
    expect(shouldShowBrowserCard(statusDoIncidente(true), false)).toBe(true)
  })
})

describe("browserRowNotice", () => {
  it("linha que pediu o navegador com ele desligado avisa ali mesmo", () => {
    expect(
      browserRowNotice(
        { enabled: true, browser: true },
        statusDoIncidente(false),
      ),
    ).toBe("navegador desligado; ligue em Navegador e desktop ou desmarque antes do run")
  })

  it("sem Chromium na máquina, o motivo é outro e é dito", () => {
    expect(
      browserRowNotice(
        { enabled: true, browser: true },
        { projectId: "proj-1", session: null, binary: null, version: null, detail: null },
      ),
    ).toBe("não há Chromium nesta máquina; o run será bloqueado até instalar ou desmarcar")
  })

  it("elo inteiro (ligado e marcado) não vira ruído na linha", () => {
    expect(
      browserRowNotice({ enabled: true, browser: true }, statusDoIncidente(true)),
    ).toBeNull()
  })

  it("linha que não pediu navegador nunca é cobrada por ele", () => {
    expect(
      browserRowNotice(
        { enabled: true, browser: false },
        statusDoIncidente(false),
      ),
    ).toBeNull()
    expect(
      browserRowNotice(
        { enabled: false, browser: true },
        statusDoIncidente(false),
      ),
    ).toBeNull()
  })

  it("sem leitura de estado não escolhe uma causa nem finge saber", () => {
    // `null` é fora do app OU falha de leitura: a linha não chuta qual.
    expect(browserRowNotice({ enabled: true, browser: true }, null)).toBe(
      "estado indisponível; confira Navegador e desktop antes do run",
    )
  })
})
