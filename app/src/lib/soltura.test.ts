import { describe, expect, it } from "vitest"
import { MAX_ATTACH_COUNT, MAX_ATTACH_BYTES } from "@/lib/attachments"
import { dentroDoRetangulo, mencaoDoCaminho, planoDaSoltura, rotuloDaSoltura } from "./soltura"

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
