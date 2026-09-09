import { describe, expect, it, vi } from "vitest"
import { indexarMencoes } from "@/lib/mentionRank"
import { searchMentionItems } from "./useMentionSearch"

const local = indexarMencoes([
  { value: "Aline", kind: "agent" },
  { value: "nota/release", kind: "nota" },
  { value: "src/tocado.ts", kind: "file" },
])

describe("busca incremental do @", () => {
  it("abre com o conjunto quente sem tocar no disco", async () => {
    const searchFiles = vi.fn()
    const result = await searchMentionItems({
      indiceLocal: local,
      query: "",
      projectRoot: "/repo",
      searchFiles,
    })
    expect(searchFiles).not.toHaveBeenCalled()
    expect(result.map((item) => typeof item === "string" ? item : item.value)).toEqual([
      "Aline",
      "nota/release",
      "src/tocado.ts",
    ])
  })

  it("consulta candidatos paginados só depois de uma query", async () => {
    const searchFiles = vi.fn(async () => ({
      page: {
        query: "send",
        entries: [
          { name: "send.ts", relPath: "src/send.ts", kind: "file" as const, isSymlink: false },
          { name: "agent.md", relPath: ".claude/agents/send.md", kind: "file" as const, isSymlink: false },
        ],
        nextCursor: null,
        truncated: false,
        source: "git" as const,
        rootRevision: "r1",
      },
      cache: "miss" as const,
      generation: 0,
    }))
    const result = await searchMentionItems({
      indiceLocal: local,
      query: "send",
      projectRoot: "/repo",
      searchFiles,
    })
    expect(searchFiles).toHaveBeenCalledWith({
      root: "/repo",
      query: "send",
      limit: 32,
    })
    expect(result).toEqual([{ value: "src/send.ts", kind: "file" }])
  })

  it("falha da busca degrada para os itens locais relevantes", async () => {
    const result = await searchMentionItems({
      indiceLocal: local,
      query: "tocado",
      projectRoot: "/repo",
      searchFiles: vi.fn(async () => { throw new Error("git indisponível") }),
    })
    expect(result).toEqual([{ value: "src/tocado.ts", kind: "file" }])
  })
})
