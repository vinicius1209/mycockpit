import { describe, expect, it } from "vitest"
import { PRESETS, TAMANHO_PADRAO, doPreset, ehPadrao, ladoValido, medidaDoTamanho, medidas, nomeDoTamanho } from "./tamanhoDaPagina"

// Gêmeo do Rust: os presets que a tela oferece são os que o Rust emula.
const RUST = Object.values(
  import.meta.glob("../../src-tauri/src/browser_tamanho.rs", { query: "?raw", import: "default", eager: true }),
)[0] as string

describe("tamanho da página (ADR-285)", () => {
  it("os presets são os mesmos do Rust, com as mesmas medidas e o mesmo modo celular", () => {
    const tabela = RUST.slice(RUST.indexOf("const PRESETS"), RUST.indexOf("];", RUST.indexOf("const PRESETS")))
    const doRust = [...tabela.matchAll(/\("([a-z-]+)", (\d+), (\d+), (true|false), [\d.]+\)/g)].map((m) => ({
      id: m[1],
      largura: Number(m[2]),
      altura: Number(m[3]),
      celular: m[4] === "true",
    }))
    expect(doRust).toEqual(PRESETS.map(({ id, largura, altura, celular }) => ({ id, largura, altura, celular })))
  })

  it("o padrão é o notebook sem girar, o de sempre", () => {
    expect(ehPadrao(TAMANHO_PADRAO)).toBe(true)
    expect(ehPadrao({ ...TAMANHO_PADRAO, girado: true })).toBe(false)
    expect(ehPadrao(doPreset("celular", false))).toBe(false)
  })

  it("girar troca largura e altura, e a medida diz o modo celular", () => {
    const tab = doPreset("tablet", true)
    expect(medidas(tab)).toEqual({ largura: 1180, altura: 820 })
    expect(medidaDoTamanho(tab)).toBe("1180×820 · como celular")
    expect(medidaDoTamanho(doPreset("desktop", false))).toBe("1440×900")
    expect(nomeDoTamanho({ preset: "personalizado", largura: 1000, altura: 700, celular: false, girado: false })).toBe("Personalizado")
  })

  it("o lado do personalizado vai de 200 a 3840", () => {
    expect(ladoValido(" 1024 ")).toBe(1024)
    expect(ladoValido("199")).toBeNull()
    expect(ladoValido("3841")).toBeNull()
    expect(ladoValido("12.5")).toBeNull()
  })
})
