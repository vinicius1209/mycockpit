// promoteToDocs: NUNCA sobrescreve conteúdo diferente em silêncio. Fake invoke
// com um "docs/" virtual: read devolve o que já foi escrito, write grava.
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  fs: new Map<string, string>(), // path absoluto → conteúdo
  writes: [] as { relPath: string; content: string }[],
}))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "read_text_file") {
      const path = args.path as string
      const v = h.fs.get(path)
      if (v == null) throw new Error("ENOENT")
      return v
    }
    if (cmd === "write_mission_state") {
      const relPath = args.relPath as string
      const content = args.content as string
      h.writes.push({ relPath, content })
      h.fs.set(`/proj/${relPath}`, content) // cwd = /proj
      return null
    }
    if (cmd === "list_mission_files") return []
    throw new Error(`invoke não mapeado: ${cmd}`)
  }),
}))

import { promoteToDocs } from "@/lib/missionFiles"

const CWD = "/proj"
const DIR = ".mycockpit/missions/2026-07-24-abc-tarefa"
const SLUG = "2026-07-24-abc-tarefa"

/** Semeia o arquivo-fonte da missão que será promovido. */
function seedSource(relFile: string, content: string) {
  h.fs.set(`${CWD}/${DIR}/${relFile}`, content)
}

beforeEach(() => {
  h.fs.clear()
  h.writes.length = 0
})

describe("promoteToDocs", () => {
  it("destino livre → grava em docs/<slug>/<arquivo>", async () => {
    seedSource("reports/05.md", "conteúdo do relatório")
    const r = await promoteToDocs(CWD, DIR, "reports/05.md", SLUG)
    expect(r).toEqual({ path: `docs/${SLUG}/05.md`, alreadyThere: false })
    expect(h.writes).toHaveLength(1)
  })

  it("re-promoção idêntica é NO-OP (idempotente, não regrava)", async () => {
    seedSource("plan.md", "mesmo conteúdo")
    await promoteToDocs(CWD, DIR, "plan.md", SLUG) // 1ª grava
    h.writes.length = 0
    const r = await promoteToDocs(CWD, DIR, "plan.md", SLUG) // 2ª idêntica
    expect(r).toEqual({ path: `docs/${SLUG}/plan.md`, alreadyThere: true })
    expect(h.writes).toHaveLength(0) // NÃO regravou
  })

  it("conteúdo DIFERENTE no destino → grava numerado, sem esmagar", async () => {
    // usuário editou docs/<slug>/plan.md à mão:
    h.fs.set(`${CWD}/docs/${SLUG}/plan.md`, "edição manual do usuário")
    seedSource("plan.md", "plano NOVO da missão")
    const r = await promoteToDocs(CWD, DIR, "plan.md", SLUG)
    expect(r).toEqual({ path: `docs/${SLUG}/plan-2.md`, alreadyThere: false })
    // a edição manual continua intacta:
    expect(h.fs.get(`${CWD}/docs/${SLUG}/plan.md`)).toBe("edição manual do usuário")
  })

  it("fonte ilegível lança (o dialog mostra o toast de erro)", async () => {
    await expect(
      promoteToDocs(CWD, DIR, "sumiu.md", SLUG),
    ).rejects.toThrow(/Não consegui ler/)
  })
})
