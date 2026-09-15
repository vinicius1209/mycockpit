// Imagem citada por link no fio: bytes pela porta contida do Rust → object URL
// cacheado. Caso real de 15/09/2026: o agy citou a captura no brain dele e o
// fio não tinha como mostrá-la.
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  files: new Map<string, Uint8Array>(),
  reads: [] as { root: string; path: string }[],
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd !== "read_project_file_bytes") throw new Error(`invoke não mapeado: ${cmd}`)
    const path = args.path as string
    h.reads.push({ root: args.root as string, path })
    const bytes = h.files.get(path)
    if (!bytes) throw new Error("caminho fora do projeto (e de locais autorizados): leitura bloqueada")
    return bytes
  }),
}))

// 1×1 PNG real (67 bytes), o mesmo fixture de `evidence.rs`.
const PNG_1X1 = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
)
const PROJETO = "/Users/viniciusmachado/projetos/prime/prime-sales-hub"
const CAPTURA =
  "/Users/viniciusmachado/.gemini/antigravity-cli/brain/904ca29f-13c5-4602-811d-dd808a237137/screenshot_tiny_pedido_21_full.png"

async function carregar() {
  return (await import("@/lib/imagemCitada")).imagemCitadaUrl
}

beforeEach(() => {
  vi.resetModules()
  h.files.clear()
  h.reads.length = 0
})

describe("imagemCitadaUrl", () => {
  it("lê pela porta contida do Rust, com a raiz do projeto, e cacheia a URL", async () => {
    h.files.set(CAPTURA, PNG_1X1)
    const imagemCitadaUrl = await carregar()
    const primeira = await imagemCitadaUrl(PROJETO, CAPTURA)
    const segunda = await imagemCitadaUrl(PROJETO, CAPTURA)
    expect(primeira).toMatch(/^blob:/)
    expect(segunda).toBe(primeira)
    expect(h.reads).toEqual([{ root: PROJETO, path: CAPTURA }])
  })

  it("recusa do Rust rejeita, e a falha não envenena o cache", async () => {
    const imagemCitadaUrl = await carregar()
    await expect(imagemCitadaUrl(PROJETO, CAPTURA)).rejects.toThrow("leitura bloqueada")
    h.files.set(CAPTURA, PNG_1X1)
    await expect(imagemCitadaUrl(PROJETO, CAPTURA)).resolves.toMatch(/^blob:/)
    expect(h.reads).toHaveLength(2)
  })

  it("bytes que não são a imagem que a extensão promete não viram URL", async () => {
    h.files.set(CAPTURA, new TextEncoder().encode("não sou png"))
    const imagemCitadaUrl = await carregar()
    await expect(imagemCitadaUrl(PROJETO, CAPTURA)).rejects.toThrow()
  })

  it("extensão que o visualizador não mostra nem chega a ler o disco", async () => {
    const imagemCitadaUrl = await carregar()
    await expect(imagemCitadaUrl(PROJETO, "/x/.gemini/antigravity-cli/brain/1/a.svg")).rejects.toThrow()
    expect(h.reads).toEqual([])
  })
})
