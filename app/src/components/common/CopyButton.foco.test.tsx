/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/avisos", async () => (await import("@/test/avisosFalsos")).moduloDeAvisosFalsos())
vi.mock("@tauri-apps/plugin-clipboard-manager", () => ({ writeText: vi.fn(async () => {}) }))
vi.mock("@/lib/db", () => ({ isTauri: () => true }))

import { writeText } from "@tauri-apps/plugin-clipboard-manager"
import { avisar } from "@/lib/avisos"

import { Markdown } from "@/components/common/Markdown"

beforeEach(() => {
  vi.mocked(writeText).mockClear().mockResolvedValue(undefined)
  vi.mocked(avisar.feito).mockClear()
  vi.mocked(avisar.erro).mockClear()
})
afterEach(cleanup)

const BLOCO = "```ts\nconst a = 1\n```"

describe("copiar o bloco de código", () => {
  it("clicar copia pelo caminho nativo", async () => {
    const user = userEvent.setup()
    render(<Markdown text={BLOCO} />)
    await user.click(screen.getByRole("button", { name: "Copiar" }))
    expect(writeText).toHaveBeenCalledTimes(1)
    expect(vi.mocked(writeText).mock.calls[0][0]).toContain("const a = 1")
    expect(avisar.feito).toHaveBeenCalledWith("Copiado")
  })

  it("o WebView não é tocado: é isso que solta o copiar do turno em voo", async () => {
    // Enquanto o turno roda, a main thread está renderizando o stream e a
    // escrita do WebView falhava. O nativo não depende dela.
    const doWebview = vi.fn()
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: doWebview },
      configurable: true,
    })
    const user = userEvent.setup()
    render(<Markdown text={BLOCO} />)
    await user.click(screen.getByRole("button", { name: "Copiar" }))
    expect(doWebview).not.toHaveBeenCalled()
    expect(writeText).toHaveBeenCalledTimes(1)
  })

  it("falha do clipboard avisa e não marca como copiado", async () => {
    vi.mocked(writeText).mockRejectedValue(
      new DOMException("Document is not focused", "NotAllowedError"),
    )
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    const user = userEvent.setup()
    render(<Markdown text={BLOCO} />)
    await user.click(screen.getByRole("button", { name: "Copiar" }))
    expect(avisar.erro).toHaveBeenCalledWith("Não consegui copiar")
    expect(log.mock.calls[0][0]).toContain("NotAllowedError")
    log.mockRestore()
  })
})
