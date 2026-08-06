import { describe, expect, it } from "vitest"
import {
  browserStateLabel,
  type BrowserSession,
  type BrowserStatus,
} from "@/lib/browser"

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
