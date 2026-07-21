// Testes do encoder QR caseiro (lib/qr): round-trip contra o DECODER
// independente jsQR (devDependency) — o "vetor conhecido" mais forte possível:
// se o jsQR (implementação alheia do padrão) lê de volta o texto exato, o
// bitstream, RS/interleave, máscara e format bits estão todos corretos.
// Complementa com invariantes estruturais (tamanho/versão, quiet-clean, cap).

import { describe, expect, it } from "vitest"
import jsQR from "jsqr"
import { QR_MAX_BYTES, qrModules } from "./qr"

/** Rasteriza a matriz em RGBA (escala 4px + quiet zone 4) pro jsQR ler. */
function rasterize(m: boolean[][], scale = 4, quiet = 4): {
  data: Uint8ClampedArray
  width: number
} {
  const n = (m.length + quiet * 2) * scale
  const data = new Uint8ClampedArray(n * n * 4).fill(255)
  for (let y = 0; y < m.length; y++) {
    for (let x = 0; x < m.length; x++) {
      if (!m[y][x]) continue
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = ((y + quiet) * scale + dy) * n + (x + quiet) * scale + dx
          data[px * 4] = 0
          data[px * 4 + 1] = 0
          data[px * 4 + 2] = 0
        }
      }
    }
  }
  return { data, width: n }
}

function decode(text: string): string | null {
  const { data, width } = rasterize(qrModules(text))
  return jsQR(data, width, width)?.data ?? null
}

describe("qrModules — round-trip com decoder independente (jsQR)", () => {
  it("decodifica um texto curto (v1/v2)", () => {
    expect(decode("FROTA")).toBe("FROTA")
  })

  it("decodifica o URL de pareamento real do companion (~104 chars, v6)", () => {
    const url =
      "http://192.168.15.107:14200#token=" +
      "a3f1c9e2b4d6a8f0c1e3b5d7a9f1c3e5b7d9a1f3c5e7b9d1a3f5c7e9b1d3a5f7"
    expect(url.length).toBe(98)
    expect(decode(url)).toBe(url)
  })

  it("decodifica cada versão de 1 a 10 (todas as tabelas de bloco/ECC)", () => {
    // capacidades byte-mode ECC M: o texto de tamanho `cap` força cada versão.
    const caps = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213]
    caps.forEach((cap, i) => {
      const text = "x".repeat(cap)
      const m = qrModules(text)
      expect(m.length).toBe(17 + 4 * (i + 1)) // tamanho da versão escolhida
      const { data, width } = rasterize(m)
      expect(jsQR(data, width, width)?.data).toBe(text)
    })
  })

  it("decodifica UTF-8 multibyte (pt-BR)", () => {
    const text = "missão pronta — revisão às 9h"
    expect(decode(text)).toBe(text)
  })
})

describe("qrModules — invariantes", () => {
  it("matriz é quadrada e módulos dos finders estão corretos", () => {
    const m = qrModules("abc")
    const n = m.length
    for (const row of m) expect(row.length).toBe(n)
    // centro dos 3 finders é escuro; anel claro em volta do miolo
    for (const [cx, cy] of [
      [3, 3],
      [n - 4, 3],
      [3, n - 4],
    ]) {
      expect(m[cy][cx]).toBe(true)
      expect(m[cy - 2][cx]).toBe(false)
      expect(m[cy + 2][cx]).toBe(false)
    }
  })

  it("estoura acima do máximo (213 bytes) e aceita exatamente o máximo", () => {
    expect(() => qrModules("x".repeat(QR_MAX_BYTES + 1))).toThrow()
    expect(qrModules("x".repeat(QR_MAX_BYTES)).length).toBe(57) // v10
  })

  it("é determinístico (mesma entrada ⇒ mesma matriz)", () => {
    expect(qrModules("determinismo")).toEqual(qrModules("determinismo"))
  })
})
