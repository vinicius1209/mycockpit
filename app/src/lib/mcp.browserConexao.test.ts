// B4: a forma de conexão ao navegador é do binding. Os valores são os MESMOS do
// Rust (`ConexaoDoNavegador::como_texto` em browser_conexao.rs).
import { describe, expect, it } from "vitest"
import { applyAgentPatch, CONEXOES_DO_NAVEGADOR, type McpServer } from "./mcp"

describe("forma de conexão ao navegador do projeto", () => {
  it("as três formas, na ordem, com a flag como rótulo", () => {
    expect(CONEXOES_DO_NAVEGADOR.map((c) => [c.value, c.label])).toEqual([
      ["cdp-endpoint", "--cdp-endpoint"],
      ["browser-url", "--browserUrl"],
      ["ws-endpoint", "--wsEndpoint"],
    ])
  })

  it("trocar a forma só mexe no binding daquele motor", () => {
    const servers = [
      {
        id: "claude:user:chrome-devtools",
        agentStates: [
          { agent: "claude-code", browser: true, browserConexao: "cdp-endpoint" },
          { agent: "codex", browser: true, browserConexao: "cdp-endpoint" },
        ],
      },
    ] as unknown as McpServer[]
    const [s] = applyAgentPatch(servers, "claude:user:chrome-devtools", "claude-code", { browserConexao: "browser-url" })
    expect(s.agentStates.map((a) => a.browserConexao)).toEqual(["browser-url", "cdp-endpoint"])
  })
})
