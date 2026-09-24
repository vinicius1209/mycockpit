import { describe, expect, it } from "vitest"
import { presentTool } from "@/lib/toolview"
import { describeToolGroup } from "@/lib/toolGroup"

// Payloads REAIS da sessão de 23/09/2026 (b6cd7444): as tools dos MCPs da
// própria Frota que caíam no balde "Executar ferramenta".
const WORK_UPDATE = { id: "estudo", status: "completed" }
const WORK_PLAN = {
  tasks: [
    { id: "protocolo", title: "Rust: protocolo de arquivos do projeto com leitura em partes (Range)", status: "in_progress" },
    { id: "visualizador", title: "Visualizador: vídeo, áudio, PDF, SVG, e cartão para formato sem prévia", status: "pending" },
    { id: "anexos", title: "Composer: anexos com miniatura, prévia e tela cheia", status: "pending" },
    { id: "fila", title: "Fila polida: duas linhas, miniaturas, reordenar, Enviar agora no cabeçalho", status: "pending" },
    { id: "rodape", title: "Rodapé numa linha: esquerda cede, direita com botão de duas intenções", status: "pending" },
    { id: "entrega", title: "Testes, guardas, ADR, commit", status: "pending" },
  ],
}
const ASK_USER = {
  questions: [
    {
      header: "Mock",
      question: "O mock (vídeo e arquivos, anexos visíveis, fila, rodapé) está no rumo?",
      multiSelect: false,
      options: [{ label: "Aprovado, pode implementar tudo" }, { label: "Quero ajustes" }],
    },
  ],
}

describe("toolFrota · a Frota reconhece as próprias tools", () => {
  it.each([
    ["mcp__frota-work__work_update", WORK_UPDATE, "Concluir etapa", "estudo"],
    ["mcp__frota-work__work_plan", WORK_PLAN, "Publicar o plano", "6 etapas"],
    [
      "mcp__frota-approval__ask_user",
      ASK_USER,
      "Perguntar a você",
      "O mock (vídeo e arquivos, anexos visíveis, fila, rodapé) está no rumo?",
    ],
  ])("%s ganha verbo e objeto, nunca 'Executar ferramenta'", (name, input, verb, texto) => {
    const v = presentTool(name, input)
    expect(v.label).not.toBe("Executar ferramenta")
    expect(v.verb).toBe(verb)
    expect(v.object).toEqual({ kind: "text", text: texto })
    expect(v.category).toBe("coordinate")
  })

  it("casa pelo nome da tool, não pelo prefixo do motor (o Codex manda o nome puro)", () => {
    expect(presentTool("work_update", WORK_UPDATE).verb).toBe("Concluir etapa")
    expect(presentTool("mcp__frota-work__work_update", WORK_UPDATE).verb).toBe("Concluir etapa")
  })

  it("o grupo de UMA ação diz o que ela foi (antes: 'Executar ferramenta' sem nome)", () => {
    const digest = describeToolGroup([
      { name: "mcp__frota-work__work_update", input: WORK_UPDATE, result: { ok: true } },
    ])
    expect(digest.label).toBe("Concluir etapa estudo")
  })

  it("rajada de coordenação vira frase, não contagem", () => {
    const digest = describeToolGroup([
      { name: "mcp__frota-work__work_update", input: WORK_UPDATE, result: { ok: true } },
      { name: "mcp__frota-work__work_update", input: { id: "mock", status: "completed" }, result: { ok: true } },
      { name: "mcp__frota-approval__ask_user", input: ASK_USER, result: { ok: true } },
    ])
    expect(digest.label).toBe("Atualizou o plano · perguntou a você")
  })

  it("MCP de terceiros continua genérico, mas diz qual tool rodou", () => {
    const v = presentTool("mcp__hostinger__VPS_getVirtualMachinesV1", {})
    expect(v.verb).toBe("Usar")
    expect(v.object).toEqual({ kind: "text", text: "hostinger · VPS_getVirtualMachinesV1" })
  })

  it("desktop e navegador da Frota têm nome (visto no fio em 24/09: 'Usar frota-desktop · desktop_capture')", () => {
    expect(presentTool("mcp__frota-desktop__desktop_capture", {}).verb).toBe("Capturar a tela")
    const nav = presentTool("mcp__frota-browser__browser_navigate", { url: "http://localhost:1420/" })
    expect(nav.verb).toBe("Abrir no navegador")
    expect(nav.object).toEqual({ kind: "text", text: "localhost:1420/" })
    // o navegador da Frota não é "navegador fora da Frota"
    expect(nav.meta).toBeNull()
  })

  it("browser_* puro segue sem dono: é ambíguo com as tools nativas de outros motores", () => {
    expect(presentTool("browser_snapshot", {}).verb).toBe("Usar")
  })

  it("o ToolSearch do motor vira 'Carregar ferramentas', não 'Usar ToolSearch'", () => {
    const v = presentTool("ToolSearch", { query: "select:mcp__frota-desktop__desktop_capture", max_results: 2 })
    expect(v.verb).toBe("Carregar ferramentas")
  })
})
