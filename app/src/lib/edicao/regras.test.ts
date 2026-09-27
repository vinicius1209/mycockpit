// As regras puras da edição: quando o texto está sujo, o que fazer quando o
// disco muda, quem pergunta ao fechar e como a busca conta.
import { describe, expect, it } from "vitest"
import { EditorState, Text } from "@codemirror/state"
import {
  contarAchados,
  estaSujo,
  planoDeFechamento,
  reconciliar,
  rotuloDaContagem,
} from "./regras"

// As quatro primeiras linhas reais de app/src/lib/db/schema.ts.
const SCHEMA = `import type Database from "@tauri-apps/plugin-sql"

/** ALTER idempotente: engole só a coluna já existente; erro real propaga. */
export async function addColumn(db: Database, sql: string): Promise<void> {
`

describe("sujo é fato, não toque", () => {
  it("digitar suja e desfazer até o original limpa", () => {
    const base = EditorState.create({ doc: SCHEMA }).doc
    const editado = base.replace(0, 6, Text.of(["export"]))
    expect(estaSujo(editado, base)).toBe(true)
    const voltou = editado.replace(0, 6, Text.of(["import"]))
    expect(estaSujo(voltou, base)).toBe(false)
  })

  it("o mesmo texto lido com CRLF não conta como mudança", () => {
    const crlf = EditorState.create({ doc: SCHEMA.replace(/\n/g, "\r\n") }).doc
    const lf = EditorState.create({ doc: SCHEMA }).doc
    expect(estaSujo(crlf, lf)).toBe(false)
  })
})

describe("reconciliar com o disco", () => {
  const limpo = { sujo: false, versao: "v1", versaoDoConflito: null }
  const sujo = { sujo: true, versao: "v1", versaoDoConflito: null }

  it("mesma versão não faz nada", () => {
    expect(reconciliar(limpo, "v1")).toBe("nada")
    expect(reconciliar(sujo, "v1")).toBe("nada")
  })

  it("disco mudou e o texto está limpo: recarrega", () => {
    expect(reconciliar(limpo, "v2")).toBe("recarregar")
  })

  it("disco mudou e o texto está sujo: conflito, nunca recarrega por cima", () => {
    expect(reconciliar(sujo, "v2")).toBe("conflito")
  })

  it("o mesmo conflito não é avisado duas vezes", () => {
    expect(reconciliar({ ...sujo, versaoDoConflito: "v2" }, "v2")).toBe("nada")
    expect(reconciliar({ ...sujo, versaoDoConflito: "v2" }, "v3")).toBe("conflito")
  })

  it("arquivo que sumiu é sumiço, sujo ou não", () => {
    expect(reconciliar(limpo, null)).toBe("sumiu")
    expect(reconciliar(sujo, null)).toBe("sumiu")
  })
})

describe("quem pergunta antes de fechar", () => {
  const caminhos: Record<string, string> = {
    "src/a.ts": "/p/src/a.ts",
    "src/b.ts": "/p/src/b.ts",
    "src/c.ts": "/p/src/c.ts",
  }
  const base = {
    convId: "c1",
    caminhoDe: (chave: string) => caminhos[chave] ?? null,
    sujos: { "/p/src/a.ts": true, "/p/src/c.ts": true } as Record<string, true>,
    donos: (caminho: string) =>
      new Map(caminho === "/p/src/c.ts" ? [["c1", "src/c.ts"], ["c2", "src/c.ts"]] : [["c1", "x"]]),
    abertaEm: (conv: string, chave: string) => conv === "c2" && chave === "src/c.ts",
  }

  it("aba limpa, aba de diff e aba sem editor fecham direto", () => {
    const plano = planoDeFechamento({ ...base, chaves: ["src/b.ts", "diff:src/a.ts", "README.md"] })
    expect(plano.perguntar).toEqual([])
    expect(plano.fechaDireto).toEqual(["src/b.ts", "diff:src/a.ts", "README.md"])
  })

  it("aba suja que é a última cópia aberta pergunta", () => {
    const plano = planoDeFechamento({ ...base, chaves: ["src/a.ts", "src/b.ts"] })
    expect(plano.perguntar).toEqual([{ chave: "src/a.ts", caminho: "/p/src/a.ts", nome: "a.ts" }])
    expect(plano.fechaDireto).toEqual(["src/b.ts"])
  })

  it("aba suja ainda aberta em outra conversa fecha sem perguntar", () => {
    const plano = planoDeFechamento({ ...base, chaves: ["src/c.ts"] })
    expect(plano.perguntar).toEqual([])
    expect(plano.fechaDireto).toEqual(["src/c.ts"])
  })

  it("se a outra conversa dona já fechou a aba, pergunta", () => {
    const plano = planoDeFechamento({ ...base, abertaEm: () => false, chaves: ["src/c.ts"] })
    expect(plano.perguntar.map((p) => p.chave)).toEqual(["src/c.ts"])
  })
})

describe("a contagem da busca", () => {
  const achados = [
    { from: 10, to: 18 },
    { from: 40, to: 48 },
    { from: 90, to: 98 },
  ]

  it("diz a posição do achado selecionado", () => {
    const c = contarAchados(achados, { from: 40, to: 48 })
    expect(c).toEqual({ atual: 2, total: 3, passou: false })
    expect(rotuloDaContagem(c)).toBe("2 de 3")
  })

  it("sem achado selecionado, diz só quantos", () => {
    const c = contarAchados(achados, { from: 0, to: 0 })
    expect(rotuloDaContagem(c)).toBe("3 resultados")
    expect(rotuloDaContagem(contarAchados([achados[0]], { from: 0, to: 0 }))).toBe("1 resultado")
  })

  it("nada casou", () => {
    expect(rotuloDaContagem(contarAchados([], { from: 0, to: 0 }))).toBe("Nada")
  })

  it("para no teto e avisa que passou", () => {
    function* muitos() {
      for (let i = 0; i < 5000; i++) yield { from: i * 2, to: i * 2 + 1 }
    }
    const c = contarAchados(muitos(), { from: 4, to: 5 }, 1000)
    expect(c).toEqual({ atual: 3, total: 1000, passou: true })
    expect(rotuloDaContagem(c)).toBe("3 de 1.000+")
  })
})
