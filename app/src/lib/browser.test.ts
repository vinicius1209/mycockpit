import { describe, expect, it } from "vitest"
import {
  browserBindingWarning,
  browserBoundServers,
  browserStateLabel,
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
  it("ligado mostra o navegador real e o endpoint que o MCP recebe", () => {
    const status: BrowserStatus = {
      projectId: "proj-1",
      session: session(),
      binary: session().binary,
      version: "149.0.7827.55",
      detail: null,
    }
    expect(browserStateLabel(status)).toBe(
      "ligado · Chrome/149.0.7827.55 · http://127.0.0.1:62934",
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

  it("avisa que o MCP vai abrir navegador próprio quando o do projeto está desligado", () => {
    const servers = [server("playwright", [{ enabled: true, browser: true }])]
    const warning = browserBindingWarning(servers, status(false))
    expect(warning).toContain("playwright pede o navegador do projeto")
    expect(warning).toContain("navegador próprio")
    // Degradação, não bloqueio: nada aqui promete que o run vai parar.
    expect(warning).not.toContain("bloque")
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
