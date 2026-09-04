import { describe, expect, it } from "vitest"

const sources = import.meta.glob("./ProjectFilesPanel.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

const source = Object.values(sources)[0] ?? ""

describe("a árvore de arquivos", () => {
  it("mantém ícone e nome no trilho esquerdo da linha", () => {
    expect(source).toContain('className="w-full justify-start text-left')
    expect(source).toContain(
      'className="min-w-0 flex-1 truncate text-left font-mono',
    )
  })
})
