import { describe, expect, it } from "vitest"
import { MAX_ATTACH_COUNT, MAX_ATTACH_BYTES } from "@/lib/attachments"
import {
  anexosComOutro,
  dentroDoRetangulo,
  mencaoDoCaminho,
  planoDaSoltura,
  planoDoArrasto,
  rotuloDaSoltura,
  rotuloDoArrasto,
} from "./soltura"

const PROJETO = "/Users/ana/projetos/jornal"
const arq = (path: string, bytes = 100) => ({ path, pasta: false, bytes })

describe("soltar arquivos no composer", () => {
  it("imagem e PDF viram anexo; código do projeto vira @relativo; fora do projeto, @absoluto", () => {
    const plano = planoDaSoltura(
      [
        arq("/Users/ana/Desktop/print.PNG"),
        arq(`${PROJETO}/src/app.ts`),
        arq("/Users/ana/Documents/contrato.pdf"),
        arq("/etc/hosts"),
      ],
      { projectPath: PROJETO, anexosAtuais: 0 },
    )
    expect(plano).toEqual({
      anexos: ["/Users/ana/Desktop/print.PNG", "/Users/ana/Documents/contrato.pdf"],
      mencoes: ["@src/app.ts", "@/etc/hosts"],
      recusados: [],
    })
  })

  it("pasta vira menção, mesmo com nome de imagem", () => {
    expect(
      planoDaSoltura([{ path: `${PROJETO}/fotos.png`, pasta: true, bytes: 0 }], { projectPath: PROJETO, anexosAtuais: 0 }),
    ).toEqual({ anexos: [], mencoes: ["@fotos.png"], recusados: [] })
  })

  it("o 9º anexo e o arquivo acima de 10 MB ficam de fora com aviso", () => {
    const plano = planoDaSoltura(
      [arq("/tmp/a.png"), arq("/tmp/grande.jpg", MAX_ATTACH_BYTES + 1), arq("/tmp/b.png")],
      { projectPath: PROJETO, anexosAtuais: MAX_ATTACH_COUNT - 1 },
    )
    expect(plano.anexos).toEqual(["/tmp/a.png"])
    expect(plano.recusados).toEqual([
      '"grande.jpg" excede 10 MB',
      `"b.png" ficou de fora: máx. ${MAX_ATTACH_COUNT} anexos por mensagem`,
    ])
  })

  it("menção com espaço vai entre aspas e não repete", () => {
    expect(mencaoDoCaminho(`${PROJETO}/docs/meu plano.md`, PROJETO)).toBe('@"docs/meu plano.md"')
    expect(mencaoDoCaminho(`${PROJETO}-outro/x.ts`, PROJETO)).toBe(`@${PROJETO}-outro/x.ts`)
    expect(planoDaSoltura([arq(`${PROJETO}/a.ts`), arq(`${PROJETO}/a.ts`)], { projectPath: PROJETO, anexosAtuais: 0 }).mencoes).toEqual(["@a.ts"])
  })

  it("posição física do Tauri dividida pela escala antes de testar o composer", () => {
    const composer = { left: 100, top: 500, right: 700, bottom: 640 }
    expect(dentroDoRetangulo({ x: 800, y: 1100 }, 2, composer)).toBe(true)
    expect(dentroDoRetangulo({ x: 800, y: 1100 }, 1, composer)).toBe(false)
    expect(rotuloDaSoltura(1)).toBe("Solte para anexar · 1 item")
    expect(rotuloDaSoltura(3)).toBe("Solte para anexar · 3 itens")
  })
})

describe("soltar de DENTRO do app no composer (R8)", () => {
  it("arquivo da árvore vira menção, e o rótulo diz isso antes de soltar", () => {
    const carga = {
      tipo: "arquivo" as const,
      id: "arquivo:src/lib/soltura.ts",
      caminho: "src/lib/soltura.ts",
      pasta: false,
    }
    expect(planoDoArrasto(carga)).toEqual({ acao: "mencao", texto: "@src/lib/soltura.ts" })
    expect(rotuloDoArrasto(carga)).toBe("Solte para mencionar src/lib/soltura.ts")
  })

  it("caminho com espaço vai entre aspas, como na menção de sempre", () => {
    expect(
      planoDoArrasto({
        tipo: "arquivo",
        id: "arquivo:docs/plano de voo.md",
        caminho: "docs/plano de voo.md",
        pasta: false,
      }),
    ).toEqual({ acao: "mencao", texto: '@"docs/plano de voo.md"' })
  })

  it("seleção curta entra como texto e seleção grande vira bloco, pela régua do colar", () => {
    const curta = { tipo: "texto" as const, id: "t1", texto: "  const a = 1  " }
    expect(planoDoArrasto(curta)).toEqual({ acao: "texto", texto: "const a = 1" })
    expect(rotuloDoArrasto(curta)).toBe("Solte para citar o trecho")

    const grande = { tipo: "texto" as const, id: "t2", texto: "linha\n".repeat(60) }
    expect(planoDoArrasto(grande).acao).toBe("colagem")
    expect(rotuloDoArrasto(grande)).toBe("Solte para anexar o trecho como bloco")
  })

  it("seleção só de espaço não vira nada, e o alvo nem acende", () => {
    const vazia = { tipo: "texto" as const, id: "t3", texto: "   \n  " }
    expect(planoDoArrasto(vazia)).toEqual({ acao: "nada" })
    expect(rotuloDoArrasto(vazia)).toBeNull()
  })

  it("carga de reordenação não tem o que fazer no composer", () => {
    expect(planoDoArrasto({ tipo: "projeto", id: "p1" })).toEqual({ acao: "nada" })
    expect(rotuloDoArrasto({ tipo: "conversa", projectId: "p", id: "c1" })).toBeNull()
  })
})

describe("imagem do fio arrastada para o composer (R8)", () => {
  const anexo = { path: "attachments/c1/print.png", name: "print.png", kind: "image" }
  const carga = { tipo: "imagem" as const, id: "imagem:attachments/c1/print.png", anexo }

  it("vira anexo do rascunho, apontando para o mesmo arquivo", () => {
    expect(planoDoArrasto(carga)).toEqual({
      acao: "anexo",
      anexo: { path: anexo.path, name: "print.png" },
    })
    expect(rotuloDoArrasto(carga)).toBe("Solte para anexar print.png")
  })

  it("o mesmo arquivo não entra duas vezes, e o teto recusa em vez de empurrar", () => {
    const um = { path: "a.png" }
    expect(anexosComOutro([um], um)).toEqual({ anexos: [um], coube: true })
    const cheio = Array.from({ length: MAX_ATTACH_COUNT }, (_, i) => ({ path: `${i}.png` }))
    const resultado = anexosComOutro(cheio, { path: "novo.png" })
    expect(resultado.coube).toBe(false)
    expect(resultado.anexos).toHaveLength(MAX_ATTACH_COUNT)
  })
})
