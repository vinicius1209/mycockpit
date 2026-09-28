// G3: "[imagem N]" no rascunho vira ficha no editor e volta a ser o MESMO texto
// na serialização. O rascunho continua string; fila, nota e envio não mudam.
import { describe, expect, it } from "vitest"
import { planDraft, serializePlan } from "./lexicalDraft"

const PEDIDO = "Compare o card de faturas de hoje [imagem 1] com a referência [imagem 2] e diga o que falta."

describe("[imagem N] no plano do rascunho", () => {
  it("com as duas imagens no envio, as referências viram fichas no lugar", () => {
    expect(planDraft(PEDIDO, [], undefined, 2)).toEqual([
      [
        { type: "text", text: "Compare o card de faturas de hoje " },
        { type: "imagem", n: 1 },
        { type: "text", text: " com a referência " },
        { type: "imagem", n: 2 },
        { type: "text", text: " e diga o que falta." },
      ],
    ])
  })

  it("ida e volta devolve exatamente o texto", () => {
    expect(serializePlan(planDraft(PEDIDO, [], undefined, 2))).toBe(PEDIDO)
  })

  it("sem imagem no envio, a referência é texto comum", () => {
    expect(planDraft(PEDIDO, [], undefined, 0)).toEqual([[{ type: "text", text: PEDIDO }]])
  })

  it("referência além do total fica texto, a válida vira ficha", () => {
    expect(planDraft("[imagem 1] e [imagem 3]", [], undefined, 1)).toEqual([
      [{ type: "imagem", n: 1 }, { type: "text", text: " e [imagem 3]" }],
    ])
  })

  it("convive com menção na mesma linha", () => {
    const plano = planDraft("@Ana olha a [imagem 1]", ["Ana"], undefined, 1)
    expect(plano).toEqual([[{ type: "mention", name: "Ana" }, { type: "text", text: " olha a " }, { type: "imagem", n: 1 }]])
    expect(serializePlan(plano)).toBe("@Ana olha a [imagem 1]")
  })
})
