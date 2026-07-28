// Avatar DiceBear como SISTEMA (Especialistas E2): offline, determinístico,
// estilo base único + COR derivada da categoria + seed = nome.

import { describe, expect, it } from "vitest"
import {
  AVATAR_STYLES,
  avatarDataUri,
  avatarFor,
  avatarSvg,
  categoryColor,
  DEFAULT_AVATAR_STYLE,
} from "./avatar"

describe("avatarSvg — offline e determinístico", () => {
  it("gera um SVG de verdade pra cada estilo suportado", () => {
    for (const [style] of AVATAR_STYLES) {
      expect(avatarSvg(style, "aline").startsWith("<svg")).toBe(true)
    }
  })

  it("mesmo estilo+seed produz sempre o MESMO SVG (identidade estável)", () => {
    expect(avatarSvg("thumbs", "aline")).toBe(avatarSvg("thumbs", "aline"))
  })

  it("mudar a seed muda o avatar (é o botão 'variar')", () => {
    expect(avatarSvg("thumbs", "aline")).not.toBe(avatarSvg("thumbs", "aline-2"))
  })

  it("estilo desconhecido NÃO estoura, cai no default (thumbs)", () => {
    expect(avatarSvg("nao-existe", "aline")).toBe(
      avatarSvg(DEFAULT_AVATAR_STYLE, "aline"),
    )
    expect(DEFAULT_AVATAR_STYLE).toBe("thumbs")
  })

  it("seed vazia ainda dá uma cara (fallback 'x'), sem quebrar", () => {
    expect(avatarSvg("thumbs", "")).toBe(avatarSvg("thumbs", "x"))
  })

  it("a cor de fundo entra no SVG (sem '#') e muda o resultado", () => {
    const azul = avatarSvg("thumbs", "aline", 64, "#60a5fa")
    const semCor = avatarSvg("thumbs", "aline", 64)
    expect(azul).toContain("60a5fa")
    expect(azul).not.toBe(semCor)
  })
})

describe("categoryColor — a cor SIGNIFICA o domínio", () => {
  it("mapeia as categorias conhecidas (paleta do app)", () => {
    expect(categoryColor("Engenharia")).toBe("#60a5fa")
    expect(categoryColor("Qualidade")).toBe("#34d399")
    expect(categoryColor("Estratégia")).toBe("#a78bfa")
    expect(categoryColor("Ops")).toBe("#fbbf24")
    expect(categoryColor("Design")).toBe("#f472b6")
    expect(categoryColor("Segurança")).toBe("#f87171")
  })

  it("normaliza caixa e acento (Estratégia = estrategia = ESTRATÉGIA)", () => {
    expect(categoryColor("estrategia")).toBe("#a78bfa")
    expect(categoryColor("ESTRATÉGIA")).toBe("#a78bfa")
    expect(categoryColor("Seguranca")).toBe(categoryColor("Segurança"))
  })

  it("categoria vazia, 'Geral' ou desconhecida cai no brass", () => {
    expect(categoryColor()).toBe("#e4a862")
    expect(categoryColor("")).toBe("#e4a862")
    expect(categoryColor("Geral")).toBe("#e4a862")
    expect(categoryColor("Marketing")).toBe("#e4a862")
  })
})

describe("avatarFor — a regra do sistema", () => {
  const def = {
    category: "Engenharia",
    avatarStyle: "",
    avatarSeed: "",
    slug: "aline",
    name: "Aline",
  }

  it("compõe estilo do sistema + cor da categoria + seed", () => {
    const spec = avatarFor(def)
    expect(spec.style).toBe("thumbs") // default do sistema (avatarStyle vazio)
    expect(spec.backgroundColor).toBe("#60a5fa") // cor de Engenharia
    expect(spec.seed).toBe("aline") // avatarSeed vazio → slug
  })

  it("avatarStyle setado à mão vira override; a COR ainda vem da categoria", () => {
    const spec = avatarFor({ ...def, avatarStyle: "bottts" })
    expect(spec.style).toBe("bottts")
    expect(spec.backgroundColor).toBe("#60a5fa")
  })

  it("seed cai pra slug, depois nome (avatarSeed vazio)", () => {
    expect(avatarFor({ ...def, avatarSeed: "custom" }).seed).toBe("custom")
    expect(avatarFor({ ...def, slug: "" }).seed).toBe("Aline")
  })

  it("dois especialistas da MESMA categoria: MESMA cor, avatares DIFERENTES (seed)", () => {
    const a = avatarFor({ ...def, name: "Aline", slug: "aline" })
    const b = avatarFor({ ...def, name: "Bruno", slug: "bruno" })
    expect(a.backgroundColor).toBe(b.backgroundColor) // coesão pela cor
    const svgA = avatarSvg(a.style, a.seed, 64, a.backgroundColor)
    const svgB = avatarSvg(b.style, b.seed, 64, b.backgroundColor)
    expect(svgA).not.toBe(svgB) // formas distintas pela seed
  })
})

describe("avatarDataUri", () => {
  it("embrulha o SVG num data-uri pronto pro <img src> (sem rede)", () => {
    const uri = avatarDataUri("thumbs", "aline", 64, "#60a5fa")
    expect(uri.startsWith("data:image/svg+xml;utf8,")).toBe(true)
    expect(uri).toContain("%3Csvg")
  })
})
