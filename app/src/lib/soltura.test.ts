import { describe, expect, it } from "vitest"
import { MAX_ATTACH_COUNT, MAX_ATTACH_BYTES } from "@/lib/attachments"
import {
  anexosComOutro,
  dentroDoRetangulo,
  planoDaSoltura,
  planoDoArrasto,
  rotuloDaSoltura,
  rotuloDoArrasto,
} from "./soltura"

const PROJETO = "/Users/ana/projetos/jornal"
const arq = (path: string, bytes = 100) => ({ path, pasta: false, bytes })

describe("soltar arquivos no composer", () => {
  it("imagem e PDF viram anexo; o resto vira cartão, dentro ou fora do projeto (ADR-252)", () => {
    const plano = planoDaSoltura(
      [
        arq("/Users/ana/Desktop/print.PNG"),
        arq(`${PROJETO}/src/app.ts`),
        arq("/Users/ana/Documents/contrato.pdf"),
        arq("/etc/hosts", 305),
      ],
      { anexosAtuais: 0 },
    )
    expect(plano).toEqual({
      anexos: ["/Users/ana/Desktop/print.PNG", "/Users/ana/Documents/contrato.pdf"],
      arquivos: [
        { tipo: "arquivo", id: `arquivo:${PROJETO}/src/app.ts`, caminho: `${PROJETO}/src/app.ts`, pasta: false, bytes: 100 },
        { tipo: "arquivo", id: "arquivo:/etc/hosts", caminho: "/etc/hosts", pasta: false, bytes: 305 },
      ],
      recusados: [],
    })
  })

  it("pasta vira cartão de pasta, mesmo com nome de imagem", () => {
    const plano = planoDaSoltura([{ path: `${PROJETO}/fotos.png`, pasta: true, bytes: 0 }], { anexosAtuais: 0 })
    expect(plano.anexos).toEqual([])
    expect(plano.arquivos).toEqual([
      { tipo: "arquivo", id: `arquivo:${PROJETO}/fotos.png`, caminho: `${PROJETO}/fotos.png`, pasta: true, bytes: 0 },
    ])
  })

  it("o 9º anexo e o arquivo acima de 10 MB ficam de fora com aviso", () => {
    const plano = planoDaSoltura(
      [arq("/tmp/a.png"), arq("/tmp/grande.jpg", MAX_ATTACH_BYTES + 1), arq("/tmp/b.png")],
      { anexosAtuais: MAX_ATTACH_COUNT - 1 },
    )
    expect(plano.anexos).toEqual(["/tmp/a.png"])
    expect(plano.recusados).toEqual([
      '"grande.jpg" excede 10 MB',
      `"b.png" ficou de fora: máx. ${MAX_ATTACH_COUNT} anexos por mensagem`,
    ])
  })

  it("caminho com espaço fica inteiro no cartão, e o mesmo arquivo não repete", () => {
    const plano = planoDaSoltura(
      [arq(`${PROJETO}/docs/meu plano.md`), arq(`${PROJETO}/docs/meu plano.md`)],
      { anexosAtuais: 0 },
    )
    expect(plano.arquivos.map((a) => a.caminho)).toEqual([`${PROJETO}/docs/meu plano.md`])
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
  it("arquivo da árvore vira o mesmo cartão, com o caminho absoluto, e o rótulo diz isso antes de soltar", () => {
    const carga = {
      tipo: "arquivo" as const,
      id: "arquivo:src/lib/soltura.ts",
      caminho: "src/lib/soltura.ts",
      pasta: false,
    }
    expect(planoDoArrasto(carga, PROJETO)).toEqual({
      acao: "arquivo",
      bloco: { tipo: "arquivo", id: `arquivo:${PROJETO}/src/lib/soltura.ts`, caminho: `${PROJETO}/src/lib/soltura.ts`, pasta: false, bytes: 0 },
    })
    expect(rotuloDoArrasto(carga)).toBe("Solte para anexar soltura.ts")
  })

  it("pasta da árvore vira cartão de pasta, com espaço no nome intacto", () => {
    const plano = planoDoArrasto(
      { tipo: "arquivo", id: "arquivo:docs/plano de voo", caminho: "docs/plano de voo", pasta: true },
      `${PROJETO}/`,
    )
    expect(plano).toMatchObject({ acao: "arquivo", bloco: { caminho: `${PROJETO}/docs/plano de voo`, pasta: true } })
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
