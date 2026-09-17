import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => ({})) }))

import { invoke } from "@tauri-apps/api/core"
import { startRequiredProjectBrowser } from "@/lib/mcpPreflightRetry"

beforeEach(() => {
  vi.mocked(invoke).mockClear()
})

describe("ligar o navegador pelo bloqueio do composer", () => {
  it("liga sem janela, como Configurações (ADR-131)", async () => {
    await startRequiredProjectBrowser("/Users/me/projetos/app")
    expect(invoke).toHaveBeenCalledWith("browser_start", {
      projectPath: "/Users/me/projetos/app",
      windowVisible: false,
    })
  })
})
