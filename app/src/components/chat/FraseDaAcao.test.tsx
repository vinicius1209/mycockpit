import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { alvoDaPilula, FraseDaAcao, PilulaDeArquivo } from "@/components/chat/FraseDaAcao"
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

describe("a pílula abre o arquivo, não a ação", () => {
  const raiz = "/Users/x/projetos/app"

  it("caminho absoluto do motor dentro da raiz da conversa vira alvo relativo, com a primeira linha da faixa", () => {
    expect(alvoDaPilula(`${raiz}/src/components/chat/WorkingIndicator.tsx`, raiz, "60–160")).toMatchObject({
      rel: "src/components/chat/WorkingIndicator.tsx",
      line: 60,
    })
  })

  it("caminho relativo (motor que manda relativo) é da raiz da conversa", () => {
    expect(alvoDaPilula("src/lib/x.ts", raiz)).toMatchObject({ rel: "src/lib/x.ts" })
  })

  it("fora do projeto e das raízes autorizadas, ou sem projeto, não é alvo: a pílula não vira clique", () => {
    expect(alvoDaPilula("/etc/hosts.ts", raiz)).toBeNull()
    expect(alvoDaPilula(`${raiz}/a.ts`, null)).toBeNull()
  })

  it("com alvo, a pílula é clicável e leva o arquivo ao menu de contexto; sem alvo, é só objeto", () => {
    const alvo = alvoDaPilula(`${raiz}/src/a.ts`, raiz)
    const com = renderToStaticMarkup(createElement(PilulaDeArquivo, { path: `${raiz}/src/a.ts`, alvo, raiz }))
    expect(com).toContain('role="link"')
    expect(com).toContain('aria-label="Abrir a.ts"')
    expect(com).toContain('data-ctx-arquivo="src/a.ts"')
    const sem = renderToStaticMarkup(createElement(PilulaDeArquivo, { path: "/etc/hosts.ts" }))
    expect(sem).not.toContain('role="link"')
    expect(sem).not.toContain("cursor-pointer")
  })
})
