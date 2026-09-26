// S3.1 — o rodapé precisa dizer QUAL build está rodando, inteiro. O formato
// curto existe pra caber sem truncar; o tooltip carrega a string completa.
import { describe, expect, it } from "vitest"
import { quandoFoiFeito, shortVersion, versaoParaRelato } from "./version"

describe("shortVersion", () => {
  it("build de teste vira sufixo curto: 0.1.0-test.177 → v0.1.0-t177", () => {
    expect(shortVersion("0.1.0-test.177")).toBe("v0.1.0-t177")
  })

  it("release limpo só ganha o prefixo v", () => {
    expect(shortVersion("0.1.0")).toBe("v0.1.0")
  })

  it("sufixo desconhecido passa intacto (não inventa formato)", () => {
    expect(shortVersion("0.2.0-rc.1")).toBe("v0.2.0-rc.1")
  })
})

// ADR-264: clicar na versão da faixa copia isto, para colar num relato.
describe("versaoParaRelato", () => {
  it("versão e commit, e diz quando o build tinha mudanças locais", () => {
    const info = { canal: "teste" as const, numero: 442, commit: "b982da6", mudancasLocais: true, feitoEm: null, pasta: null }
    expect(versaoParaRelato("0.1.0-test.442", info)).toBe("Frota 0.1.0-test.442 (b982da6, com mudanças locais)")
    expect(versaoParaRelato("0.1.0", null)).toBe("Frota 0.1.0")
  })
})

describe("quandoFoiFeito", () => {
  const AGORA = new Date(2026, 8, 26, 16, 40).getTime()
  it("hoje com a hora; outro dia com a data; carimbo ausente ou estranho, nada", () => {
    expect(quandoFoiFeito("2026-09-26T14:32:10", AGORA)).toBe("hoje, 14:32")
    expect(quandoFoiFeito("2026-09-25T09:10:00", AGORA)).toBe("25/09, 09:10")
    expect(quandoFoiFeito(null, AGORA)).toBeNull()
    expect(quandoFoiFeito("ontem", AGORA)).toBeNull()
  })
})
