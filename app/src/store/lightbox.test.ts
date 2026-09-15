// Lightbox único do fio (browser-plan B1 + anexos do usuário): helpers PUROS
// de estado (abrir/clamp/passo) + store zustand. Sem DOM aqui — o overlay só
// consome este estado.
import { beforeEach, describe, expect, it } from "vitest"
import {
  missingLabel,
  openLightbox,
  stepLightbox,
  useLightbox,
  type LightboxImage,
} from "@/store/lightbox"

function img(path: string): LightboxImage {
  return { path, name: path.split("/").pop() ?? path, source: "evidencia" }
}

const TRES = [img("evidence/c1/t-0.png"), img("evidence/c1/t-1.png"), img("evidence/c1/t-2.png")]

beforeEach(() => {
  useLightbox.setState({ current: null })
})

describe("openLightbox", () => {
  it("abre no índice pedido", () => {
    const s = openLightbox(TRES, 1)
    expect(s).not.toBeNull()
    expect(s!.index).toBe(1)
    expect(s!.images).toHaveLength(3)
  })

  it("galeria vazia não abre nada", () => {
    expect(openLightbox([], 0)).toBeNull()
  })

  it("índice fora do intervalo é clampado, nunca abre em imagem inexistente", () => {
    expect(openLightbox(TRES, 99)!.index).toBe(2)
    expect(openLightbox(TRES, -3)!.index).toBe(0)
  })
})

describe("stepLightbox", () => {
  it("navega pra frente e pra trás", () => {
    const s = openLightbox(TRES, 1)!
    expect(stepLightbox(s, 1).index).toBe(2)
    expect(stepLightbox(s, -1).index).toBe(0)
  })

  it("clampa nas bordas (sem wrap): passar do fim mantém a última", () => {
    const fim = openLightbox(TRES, 2)!
    expect(stepLightbox(fim, 1).index).toBe(2)
    const inicio = openLightbox(TRES, 0)!
    expect(stepLightbox(inicio, -1).index).toBe(0)
  })

  it("com UMA imagem o passo é no-op (mesma referência, sem re-render)", () => {
    const s = openLightbox([img("evidence/c1/solo-0.png")], 0)!
    expect(stepLightbox(s, 1)).toBe(s)
    expect(stepLightbox(s, -1)).toBe(s)
  })
})

describe("useLightbox (store)", () => {
  it("open + step + close fazem o ciclo completo", () => {
    useLightbox.getState().open(TRES, 0)
    expect(useLightbox.getState().current?.index).toBe(0)
    useLightbox.getState().step(1)
    expect(useLightbox.getState().current?.index).toBe(1)
    useLightbox.getState().close()
    expect(useLightbox.getState().current).toBeNull()
  })

  it("step com lightbox fechado é no-op (não explode)", () => {
    useLightbox.getState().step(1)
    expect(useLightbox.getState().current).toBeNull()
  })

  it("open com galeria vazia mantém fechado", () => {
    useLightbox.getState().open([], 0)
    expect(useLightbox.getState().current).toBeNull()
  })
})

describe("missingLabel", () => {
  it("placeholder honesto por origem quando o arquivo saiu do disco", () => {
    expect(missingLabel("evidencia")).toBe("evidência removida")
    expect(missingLabel("anexo")).toBe("anexo expirado")
    expect(missingLabel("arquivo")).toBe("arquivo não encontrado")
  })
})
