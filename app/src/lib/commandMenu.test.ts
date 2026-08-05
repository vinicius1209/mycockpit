// A ponte que deixa o chip de busca (e o nome do projeto) abrirem a MESMA
// paleta ⌘K: quem pede não conhece o dono do estado, e um pedido sem dono não
// pode sumir calado.

import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  _resetCommandMenuListeners,
  commandMenuKeys,
  commandMenuShortcut,
  onOpenCommandMenu,
  openCommandMenu,
} from "@/lib/commandMenu"

beforeEach(() => {
  _resetCommandMenuListeners()
  vi.restoreAllMocks()
})

describe("ponte da paleta ⌘K", () => {
  it("avisa o ouvinte inscrito quando alguém pede a paleta", () => {
    const abrir = vi.fn()
    onOpenCommandMenu(abrir)

    openCommandMenu()

    expect(abrir).toHaveBeenCalledTimes(1)
  })

  it("para de avisar depois que o ouvinte se desinscreve", () => {
    const abrir = vi.fn()
    const cancelar = onOpenCommandMenu(abrir)

    cancelar()
    openCommandMenu()

    expect(abrir).not.toHaveBeenCalled()
  })

  it("sem paleta montada, registra o aviso em vez de engolir o clique", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    openCommandMenu()

    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("um ouvinte que se desinscreve durante o disparo não derruba os outros", () => {
    const primeiro = vi.fn(() => cancelar())
    const segundo = vi.fn()
    const cancelar = onOpenCommandMenu(primeiro)
    onOpenCommandMenu(segundo)

    openCommandMenu()

    expect(primeiro).toHaveBeenCalledTimes(1)
    expect(segundo).toHaveBeenCalledTimes(1)
  })
})

describe("atalho exibido no chip de busca", () => {
  it("mostra ⌘ K no macOS", () => {
    expect(commandMenuKeys("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toEqual([
      "⌘",
      "K",
    ])
  })

  it("mostra Ctrl K fora do macOS", () => {
    expect(commandMenuKeys("Mozilla/5.0 (X11; Linux x86_64)")).toEqual(["Ctrl", "K"])
    expect(commandMenuKeys("")).toEqual(["Ctrl", "K"])
  })

  it("desenha a tecla colada no macOS e com espaço no resto", () => {
    expect(commandMenuShortcut("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(
      "⌘K",
    )
    expect(commandMenuShortcut("Mozilla/5.0 (X11; Linux x86_64)")).toBe("Ctrl K")
  })
})
