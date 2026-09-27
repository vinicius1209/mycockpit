// Travas de fonte da edição (spec §12.3): o que quebraria em silêncio se
// alguém "simplificasse" depois.
import { describe, expect, it } from "vitest"

const fontes = import.meta.glob(
  ["./*.tsx", "./*.ts", "../layout/abasNoPrincipal.ts", "../../store/edicao.ts"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>

const de = (fim: string) => Object.entries(fontes).find(([k]) => k.endsWith(fim))?.[1] ?? ""

describe("travas da edição", () => {
  it("o editor não rouba os atalhos das abas (⌘1-9, ⌃Tab, ⌘⇧T)", () => {
    const editor = de("CodeEditor.tsx")
    expect(editor).toContain('"Mod-s"')
    for (const tecla of ['"Mod-1"', '"Mod-9"', '"Ctrl-Tab"', '"Mod-Shift-t"', '"Mod-w"']) {
      expect(editor).not.toContain(tecla)
    }
  })

  it("fechar aba passa pelo portão antes de fechar", () => {
    const abas = de("abasNoPrincipal.ts")
    const corpo = abas.slice(abas.indexOf("export function fecharArquivos"))
    expect(corpo.indexOf("planoDoPortao(")).toBeGreaterThan(-1)
    expect(corpo.indexOf("planoDoPortao(")).toBeLessThan(corpo.indexOf("useAbasDeArquivo.getState().fechar("))
  })

  it("o texto em edição nunca é persistido", () => {
    const store = de("store/edicao.ts")
    expect(store).toContain("create<EdicaoState>")
    expect(store).not.toContain("zustand/middleware")
  })

  it("seleção e busca no editor são neutras, nunca brass nem âmbar (ADR-043)", () => {
    const tema = de("temaDoEditor.ts")
    expect(tema).not.toMatch(/--brass|st-warning|#[0-9a-f]{3,8}\b/i)
  })
})

describe("só leitura continua navegável", () => {
  it("usa readOnly e não desliga o contenteditable", () => {
    const editor = de("CodeEditor.tsx")
    expect(editor).toContain("EditorState.readOnly.of(!gravavel)")
    expect(editor).not.toContain("EditorView.editable.of(")
  })
})
