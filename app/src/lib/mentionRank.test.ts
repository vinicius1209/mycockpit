import { describe, expect, it } from "vitest"
import {
  CLASSE,
  arquivosTocados,
  classeDeCasamento,
  indexarMencoes,
  rankearMencoes,
  type ItemDeMencao,
} from "./mentionRank"

const arquivos = (...paths: string[]): ItemDeMencao[] =>
  paths.map((value) => ({ value, kind: "file" as const }))

function valores(itens: ItemDeMencao[]): string[] {
  return itens.map((i) => i.value)
}

describe("indexarMencoes", () => {
  it("resolve nome, minúsculas e ordem UMA vez", () => {
    const [c] = indexarMencoes(arquivos("src/lib/Fleet/Send.ts"))
    expect(c.base).toBe("Send.ts")
    expect(c.baseLower).toBe("send.ts")
    expect(c.valueLower).toBe("src/lib/fleet/send.ts")
    expect(c.ordem).toBe(0)
  })

  it("persona e nota não têm caminho: o nome é o próprio valor", () => {
    const idx = indexarMencoes([
      { value: "Aline", kind: "agent" },
      { value: "nota/runbook-da-migracao", kind: "nota" },
    ])
    expect(idx[0].base).toBe("Aline")
    // Nota tem barra, mas o endereço INTEIRO é o nome dela — cortar no `/`
    // deixaria o slug sozinho e ele casaria com qualquer coisa.
    expect(idx[1].base).toBe("nota/runbook-da-migracao")
  })
})

describe("classeDeCasamento", () => {
  const c = indexarMencoes(arquivos("src/lib/fleet/send.ts"))[0]

  it("nome exato ganha de tudo", () => {
    expect(classeDeCasamento(c, "send.ts")).toBe(CLASSE.nomeExato)
  })

  it("começo do nome ganha de meio do nome", () => {
    expect(classeDeCasamento(c, "sen")).toBe(CLASSE.nomeComeca)
    expect(classeDeCasamento(c, "end")).toBe(CLASSE.nomeContem)
  })

  it("casar só no caminho é a pior classe que ainda entra", () => {
    expect(classeDeCasamento(c, "fleet")).toBe(CLASSE.caminhoContem)
  })

  it("o que não casa em lugar nenhum sai", () => {
    expect(classeDeCasamento(c, "kubernetes")).toBeGreaterThan(
      CLASSE.caminhoContem,
    )
  })
})

describe("rankearMencoes", () => {
  it("o defeito que motivou a frente: nome antes de pasta", () => {
    // `@send` devolvia `docs/legacy/sender/README.md` na frente porque ele vem
    // antes no disco. O que a pessoa quer abrir é o arquivo chamado send.
    const idx = indexarMencoes(
      arquivos("docs/legacy/sender/README.md", "src/lib/fleet/send.ts"),
    )
    expect(valores(rankearMencoes(idx, "send"))).toEqual([
      "src/lib/fleet/send.ts",
      "docs/legacy/sender/README.md",
    ])
  })

  it("o que a conversa TOCOU sobe — dentro da mesma classe", () => {
    const idx = indexarMencoes(
      arquivos("src/a/send.ts", "src/b/send.ts", "src/c/send.ts"),
    )
    const tocados = new Set(["src/c/send.ts"])
    expect(valores(rankearMencoes(idx, "send.ts", { tocados }))[0]).toBe(
      "src/c/send.ts",
    )
  })

  it("tocado NÃO atravessa classe de casamento", () => {
    // Relevância recente não compra qualidade de casamento: um arquivo tocado
    // que só casa no CAMINHO continua atrás de um que casa no NOME.
    const idx = indexarMencoes(
      arquivos("src/send/outro.ts", "src/lib/send.ts"),
    )
    const tocados = new Set(["src/send/outro.ts"])
    expect(valores(rankearMencoes(idx, "send", { tocados }))).toEqual([
      "src/lib/send.ts",
      "src/send/outro.ts",
    ])
  })

  it("persona e nota vêm antes de arquivo no mesmo empate", () => {
    const idx = indexarMencoes([
      { value: "notas/planilha.ts", kind: "file" },
      { value: "nota/notas-do-cliente", kind: "nota" },
      { value: "Notas", kind: "agent" },
    ])
    expect(valores(rankearMencoes(idx, "notas"))).toEqual([
      "Notas",
      "nota/notas-do-cliente",
      "notas/planilha.ts",
    ])
  })

  it("empate real vai pro caminho mais curto", () => {
    const idx = indexarMencoes(
      arquivos("src/legacy/v1/send.ts", "src/send.ts"),
    )
    expect(valores(rankearMencoes(idx, "send.ts"))[0]).toBe("src/send.ts")
  })

  it("a ordem é ESTÁVEL: sem desempate a lista pularia entre teclas", () => {
    const idx = indexarMencoes(arquivos("a/x.ts", "b/x.ts", "c/x.ts"))
    const uma = valores(rankearMencoes(idx, "x.ts"))
    const outra = valores(rankearMencoes(idx, "x.ts"))
    expect(uma).toEqual(outra)
    expect(uma).toEqual(["a/x.ts", "b/x.ts", "c/x.ts"])
  })

  it("sem consulta, mantém a ordem original (você ainda não disse o que quer)", () => {
    const idx = indexarMencoes([
      { value: "Aline", kind: "agent" },
      { value: "src/z.ts", kind: "file" },
      { value: "src/a.ts", kind: "file" },
    ])
    expect(valores(rankearMencoes(idx, ""))).toEqual([
      "Aline",
      "src/z.ts",
      "src/a.ts",
    ])
    expect(valores(rankearMencoes(idx, null))).toEqual([
      "Aline",
      "src/z.ts",
      "src/a.ts",
    ])
  })

  it("sem consulta, o tocado ainda sobe — é o único sinal que já existe", () => {
    const idx = indexarMencoes(arquivos("src/a.ts", "src/z.ts"))
    const tocados = new Set(["src/z.ts"])
    expect(valores(rankearMencoes(idx, "", { tocados }))[0]).toBe("src/z.ts")
  })

  it("sem consulta, toda seção aparece mesmo com muitos arquivos tocados", () => {
    const arqs = Array.from({ length: 30 }, (_, i) => `src/t${i}.ts`)
    const idx = indexarMencoes([
      ...["Aline", "Bruno", "Carla", "Davi"].map((value) => ({ value, kind: "agent" as const })),
      { value: "nota/deploy", kind: "nota" as const },
      ...["conversa/todas", "conversa/parser-1a2b3c4d", "conversa/migracao-9f8e7d6c"].map((value) => ({ value, kind: "conversa" as const })),
      ...arquivos(...arqs),
    ])
    const menu = rankearMencoes(idx, "", { tocados: new Set(arqs) }, 8)
    expect(menu.map((i) => i.kind)).toEqual([
      "agent", "agent", "agent", "nota", "conversa", "conversa", "conversa", "file", "file", "file", "file", "file",
    ])
    expect(menu.find((i) => i.kind === "conversa")?.value).toBe("conversa/todas")
  })

  it("respeita o teto e não devolve a listagem inteira", () => {
    const idx = indexarMencoes(
      arquivos(...Array.from({ length: 500 }, (_, i) => `src/send${i}.ts`)),
    )
    expect(rankearMencoes(idx, "send", {}, 8)).toHaveLength(8)
  })

  it("consulta que não casa com nada devolve lista vazia, não tudo", () => {
    const idx = indexarMencoes(arquivos("src/a.ts", "src/b.ts"))
    expect(rankearMencoes(idx, "kubernetes")).toEqual([])
  })

  it("é insensível a caixa nos dois lados", () => {
    const idx = indexarMencoes(arquivos("src/Fleet/Send.ts"))
    expect(valores(rankearMencoes(idx, "SEND"))).toEqual(["src/Fleet/Send.ts"])
  })
})

describe("arquivosTocados", () => {
  const items = [
    { kind: "user", input: undefined },
    { kind: "tool", input: { file_path: "/repo/src/lib/send.ts" } },
    { kind: "tool", input: { path: "src/store/chat.ts" } },
    { kind: "tool", input: { command: "ls -la" } },
    { kind: "text", input: undefined },
  ]

  it("colhe caminho das tool calls, relativo ao projeto", () => {
    expect([...arquivosTocados(items, "/repo")].sort()).toEqual([
      "src/lib/send.ts",
      "src/store/chat.ts",
    ])
  })

  it("ignora arquivo de FORA do projeto", () => {
    // Mencionar arquivo fora da pasta não é o gesto desta feature; deixar
    // entrar poluiria o topo do menu com caminho que o `@` nem oferece.
    const fora = [{ kind: "tool", input: { path: "/etc/hosts" } }]
    expect(arquivosTocados(fora, "/repo").size).toBe(0)
  })

  it("não varre prosa atrás de caminho", () => {
    // Qualquer menção casual a um arquivo no texto viraria falso positivo e
    // empurraria o arquivo errado pro topo.
    const so_texto = [{ kind: "text", input: undefined }]
    expect(arquivosTocados(so_texto, "/repo").size).toBe(0)
  })

  it("aceita a raiz com ou sem barra final", () => {
    const um = [{ kind: "tool", input: { path: "/repo/a.ts" } }]
    expect([...arquivosTocados(um, "/repo")]).toEqual(["a.ts"])
    expect([...arquivosTocados(um, "/repo/")]).toEqual(["a.ts"])
  })
})
