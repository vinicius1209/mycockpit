import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { FraseDaAcao } from "@/components/chat/FraseDaAcao"
import { presentTool } from "@/lib/toolview"

const html = (name: string, input: unknown) =>
  renderToStaticMarkup(createElement(FraseDaAcao, { view: presentTool(name, input) }))

describe("FraseDaAcao · verbo + objeto na linha do fio", () => {
  it("arquivo vira pílula: só o nome aparece, o caminho fica no hover", () => {
    const out = html("Read", { file_path: "/Users/x/projetos/app/src-tauri/src/sources.rs" })
    expect(out).toContain(">Ler<")
    expect(out).toContain('title="/Users/x/projetos/app/src-tauri/src/sources.rs"')
    expect(out).toContain(">sources.rs<")
    expect(out).toContain('data-file-icon="rust"')
  })

  it("leitura por shell mostra a faixa de linhas ao lado da pílula (payload real, 23/09)", () => {
    const out = html("Bash", {
      description: "Read file byte reader, path validation and tauri setup",
      command:
        'cd /Users/x/app/src-tauri && sed -n 320,370p src/sources.rs; grep -n "fn validate_project_path" src/sources.rs',
    })
    expect(out).toContain(">sources.rs<")
    expect(out).toContain(">320–370<")
    expect(out).toContain(">+1<")
  })

  it("narração do agente é frase inteira: nenhum verbo em pt-BR colado na frente", () => {
    const out = html("Bash", {
      description: "Show raw cargo test output",
      command: "cargo test --lib migracao_do_banco 2>&1 | tail -5",
    })
    expect(out).toContain(">Show raw cargo test output<")
    expect(out).not.toContain(">Testar<")
  })

  it("tool da própria Frota diz o que fez", () => {
    const out = html("mcp__frota-work__work_update", { id: "estudo", status: "completed" })
    expect(out).toContain(">Concluir etapa<")
    expect(out).toContain(">estudo<")
    expect(out).not.toContain("Executar ferramenta")
  })
})
