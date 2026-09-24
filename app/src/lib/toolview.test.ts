import { describe, expect, it } from "vitest"
import {
  cleanResultText,
  evidenceMeta,
  presentTool,
  unwrapShellCommand,
} from "./toolview"
import { summarizeToolGroup } from "./toolGroup"

const ok = (text: string) => ({ ok: true, text, lines: text.split("\n").length })

describe("cleanResultText", () => {
  it("suprime 'File created successfully at:' no Write", () => {
    const r = ok(
      "File created successfully at: /a/b/c.ts (file state is current in your context — no need to Read it back)",
    )
    expect(cleanResultText("Write", r)).toBe("")
  })

  it("suprime 'has been updated successfully' no Edit", () => {
    const r = ok(
      "The file /a/b/c.ts has been updated successfully. (file state is current — no need to Read it back)",
    )
    expect(cleanResultText("Edit", r)).toBe("")
  })

  it("remove só o sufixo de estado, preserva texto útil", () => {
    const r = ok(
      "Applied 3 edits (file state is current in your context — no need to Read it back)",
    )
    expect(cleanResultText("MultiEdit", r)).toBe("Applied 3 edits")
  })

  it("não mexe em output de Bash", () => {
    const r = ok("File created successfully at: /tmp/x")
    expect(cleanResultText("Bash", r)).toBe("File created successfully at: /tmp/x")
  })

  it("não mexe em erro de write/edit", () => {
    const r = { ok: false, text: "Error: file not found", lines: 1 }
    expect(cleanResultText("Write", r)).toBe("Error: file not found")
  })

  it("result vazio/undefined vira ''", () => {
    expect(cleanResultText("Write", undefined)).toBe("")
  })
})

describe("presentTool", () => {
  it("remove o launcher do Codex só para classificar", () => {
    const raw = '/bin/zsh -lc "sqlite3 -readonly /tmp/app.db \\"SELECT count(*) FROM cards;\\""'
    expect(unwrapShellCommand(raw)).toContain("sqlite3 -readonly")
    const p = presentTool("Bash", { command: raw })
    expect(p.label).toBe("Consultar dados locais")
    expect(p.category).toBe("inspect")
    expect(p.emphasis).toBe("quiet")
    expect(p.detail).toBe(raw)
    expect(p.label).not.toContain("/bin/zsh")
  })

  it.each([
    ["rg -n 'ToolGroup' app/src", "Buscar no projeto", "inspect"],
    ["git status --short", "Verificar o estado do repositório", "inspect"],
    [
      'for p in app docs; do find "$p" -maxdepth 1 -type f; done',
      "Inspecionar arquivos",
      "inspect",
    ],
    ["bun run test", "Executar testes", "validate"],
    ["bun run build", "Gerar o build", "validate"],
    ["git commit -m 'fix: caption'", "Criar commit", "change"],
  ] as const)("classifica %s", (command, label, category) => {
    const p = presentTool("Bash", { command })
    expect(p.label).toBe(label)
    expect(p.category).toBe(category)
  })

  it("mantém ação sensível evidente sem vazar argumentos", () => {
    const p = presentTool("Bash", { command: "git push origin main" })
    expect(p.label).toBe("Enviar alterações ao repositório")
    expect(p.emphasis).toBe("warning")
    expect(p.label).not.toContain("origin main")
  })

  it("prefere description humana e preserva o comando nos detalhes", () => {
    const p = presentTool("Bash", {
      description: "Verificando métricas do Cockpit",
      command: "sqlite3 -readonly app.db 'select 1'",
    })
    expect(p.label).toBe("Verificando métricas do Cockpit")
    expect(p.detail).toContain("sqlite3")
  })

  it("fallback genérico não promove payload a caption", () => {
    const p = presentTool("mcp__server__run", { command: "segredo --token abc" })
    expect(p.label).toBe("Executar ferramenta")
    expect(p.meta).toBe("server · run")
    expect(p.label).not.toContain("segredo")
  })
})

describe("summarizeToolGroup", () => {
  it("resume o burst por verbos contados (ADR-241)", () => {
    const view = summarizeToolGroup([
      { name: "Read", input: { file_path: "/tmp/a.ts" }, result: { ok: true } },
      { name: "Bash", input: { command: "rg foo src" }, result: { ok: true } },
      {
        name: "Bash",
        input: { command: "sqlite3 -readonly app.db 'select 1'" },
        result: { ok: true },
      },
    ])
    expect(view).toMatchObject({
      label: "Rodou 1 comando · leu 1 arquivo · buscou 1 vez",
      emphasis: "quiet",
      state: "ok",
    })
  })

  it("mostra a ação corrente durante o run", () => {
    const view = summarizeToolGroup(
      [
        { name: "Read", input: { file_path: "/tmp/a.ts" }, result: { ok: true } },
        { name: "Bash", input: { command: "bun test" } },
      ],
      true,
    )
    expect(view).toMatchObject({ label: "Executar testes", state: "running" })
    // o vivo nomeia a ação corrente pelo rótulo: é a mesma régua da culpada
  })

  it("falha vence qualquer resumo de categoria", () => {
    const view = summarizeToolGroup([
      { name: "Bash", input: { command: "bun test" }, result: { ok: false } },
      { name: "Read", input: { file_path: "/tmp/a.ts" }, result: { ok: true } },
    ])
    expect(view).toMatchObject({
      label: "Uma ação falhou",
      emphasis: "warning",
      state: "error",
    })
  })

  it("histórico sem tool_result não finge que está pendente", () => {
    const view = summarizeToolGroup([
      { name: "Bash", input: { command: "ls" } },
      { name: "Bash", input: { command: "pwd" } },
    ])
    expect(view).toMatchObject({
      label: "Rodou 2 comandos · sem desfecho registrado",
      state: "recorded",
    })
  })
})

describe("evidenceMeta (B1)", () => {
  it("conta as capturas na linha da tool, singular e plural", () => {
    expect(evidenceMeta(["evidence/c/t-0.png"])).toBe("1 captura")
    expect(
      evidenceMeta(["evidence/c/t-0.png", "evidence/c/t-1.png"]),
    ).toBe("2 capturas")
  })

  it("tool sem imagem não ganha meta nenhuma (linha idêntica à de hoje)", () => {
    expect(evidenceMeta(undefined)).toBeNull()
    expect(evidenceMeta([])).toBeNull()
  })
})
