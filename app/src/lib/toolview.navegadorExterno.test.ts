// ADR-224 §3: o que abre navegador por fora da Frota não é bloqueável (tool
// nativa do motor, shell), então vira estado visível na linha da tool.
import { describe, expect, it } from "vitest"
import { META_NAVEGADOR_EXTERNO, abreNavegadorForaDaFrota, presentTool } from "./toolview"

describe("navegador fora da Frota", () => {
  it("tool nativa de navegador (inventário real do agy 1.2.x) é marcada", () => {
    // Nomes tirados de testdata/agy-1.2.2/resume.jsonl (init.tools).
    for (const name of ["open_browser_url", "browser_subagent", "read_browser_page", "capture_browser_screenshot"]) {
      expect(abreNavegadorForaDaFrota(name, { url: "http://localhost:5173" })).toBe(true)
      expect(presentTool(name, {}).meta).toContain(META_NAVEGADOR_EXTERNO)
    }
  })

  it("shell que sobe Playwright ou entrega a URL ao navegador do sistema é marcado", () => {
    for (const command of [
      "npx playwright test e2e/login.spec.ts",
      "npx -y playwright open http://localhost:3000",
      "open -a 'Google Chrome' http://localhost:3000",
      "open http://localhost:5173",
      "xdg-open http://localhost:5173",
    ]) {
      expect(abreNavegadorForaDaFrota("Bash", { command }), command).toBe(true)
    }
    const view = presentTool("Bash", { command: "open http://localhost:5173", description: "Abrir o app" })
    expect(view.meta).toBe(META_NAVEGADOR_EXTERNO)
    expect(view.label).toBe("Abrir o app")
  })

  it("shell comum e as demais tools não ganham a marca", () => {
    for (const command of ["bun run test", "open docs/mocks/aba-conversa.html", "git status", "cat playwright.config.ts"]) {
      expect(abreNavegadorForaDaFrota("Bash", { command }), command).toBe(false)
    }
    expect(presentTool("Read", { file_path: "a.ts" }).meta ?? "").not.toContain(META_NAVEGADOR_EXTERNO)
    // MCP de navegador pode ser o da Frota (binding com browser=1): a linha
    // não sabe, então não afirma.
    expect(abreNavegadorForaDaFrota("mcp__playwright__browser_navigate", {})).toBe(false)
  })
})
