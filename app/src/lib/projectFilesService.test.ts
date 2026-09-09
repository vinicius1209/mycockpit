import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  list: vi.fn(),
  search: vi.fn(),
}))

vi.mock("@/lib/sources", () => ({
  listDirChildren: h.list,
  searchProjectFiles: h.search,
}))

import {
  _resetProjectFilesServiceForTests,
  invalidateProjectFiles,
  loadProjectDirectory,
  searchProjectFileIndex,
} from "./projectFilesService"

beforeEach(() => {
  _resetProjectFilesServiceForTests()
  h.list.mockReset()
  h.search.mockReset()
})

describe("serviço de arquivos do projeto", () => {
  it("compartilha a promessa em voo e depois responde do cache", async () => {
    let resolve!: (value: unknown) => void
    h.list.mockReturnValue(new Promise((done) => (resolve = done)))
    const input = { root: "/projeto", relPath: "src" }
    const first = loadProjectDirectory(input)
    const duplicate = loadProjectDirectory(input)
    expect(h.list).toHaveBeenCalledTimes(1)
    resolve({
      parent: "src",
      entries: [],
      nextCursor: null,
      truncated: false,
      rootRevision: "r1",
    })

    await expect(first).resolves.toMatchObject({ cache: "miss", generation: 0 })
    await expect(duplicate).resolves.toMatchObject({ cache: "miss", generation: 0 })
    await expect(loadProjectDirectory(input)).resolves.toMatchObject({
      cache: "hit",
      generation: 0,
    })
    expect(h.list).toHaveBeenCalledTimes(1)
  })

  it("invalidação por gesto sobe a geração e força nova leitura", async () => {
    h.list.mockResolvedValue({
      parent: "",
      entries: [],
      nextCursor: null,
      truncated: false,
      rootRevision: "r1",
    })
    await loadProjectDirectory({ root: "/projeto" })
    expect(invalidateProjectFiles("/projeto")).toBe(1)
    await expect(loadProjectDirectory({ root: "/projeto" })).resolves.toMatchObject({
      cache: "miss",
      generation: 1,
    })
    expect(h.list).toHaveBeenCalledTimes(2)
  })

  it("refresh durante leitura em voo não reaproveita a promessa invalidada", async () => {
    let resolveOld!: (value: unknown) => void
    let resolveFresh!: (value: unknown) => void
    h.list
      .mockReturnValueOnce(new Promise((done) => (resolveOld = done)))
      .mockReturnValueOnce(new Promise((done) => (resolveFresh = done)))

    const oldRequest = loadProjectDirectory({ root: "/projeto" })
    invalidateProjectFiles("/projeto")
    const freshRequest = loadProjectDirectory({ root: "/projeto" })
    expect(h.list).toHaveBeenCalledTimes(2)

    resolveFresh({
      parent: "",
      entries: [{ name: "novo", relPath: "novo", kind: "file", isSymlink: false }],
      nextCursor: null,
      truncated: false,
      rootRevision: "r2",
    })
    await expect(freshRequest).resolves.toMatchObject({ generation: 1 })
    resolveOld({
      parent: "",
      entries: [{ name: "velho", relPath: "velho", kind: "file", isSymlink: false }],
      nextCursor: null,
      truncated: false,
      rootRevision: "r1",
    })
    await expect(oldRequest).resolves.toMatchObject({ generation: 0 })

    await expect(loadProjectDirectory({ root: "/projeto" })).resolves.toMatchObject({
      cache: "hit",
      generation: 1,
      page: { rootRevision: "r2" },
    })
  })

  it("resposta antiga com outra revisão não substitui o cache mais novo", async () => {
    let resolveOld!: (value: unknown) => void
    let resolveFresh!: (value: unknown) => void
    h.list
      .mockReturnValueOnce(new Promise((done) => (resolveOld = done)))
      .mockReturnValueOnce(new Promise((done) => (resolveFresh = done)))

    const oldRequest = loadProjectDirectory({ root: "/projeto", relPath: "antiga" })
    const freshRequest = loadProjectDirectory({ root: "/projeto", relPath: "nova" })
    resolveFresh({
      parent: "nova",
      entries: [],
      nextCursor: null,
      truncated: false,
      rootRevision: "r2",
    })
    await expect(freshRequest).resolves.toMatchObject({ generation: 0 })
    resolveOld({
      parent: "antiga",
      entries: [],
      nextCursor: null,
      truncated: false,
      rootRevision: "r1",
    })
    await expect(oldRequest).resolves.toMatchObject({ generation: -1 })

    await expect(
      loadProjectDirectory({ root: "/projeto", relPath: "nova" }),
    ).resolves.toMatchObject({ cache: "hit", page: { rootRevision: "r2" } })
  })

  it("normaliza a consulta e compartilha a busca entre consumidores", async () => {
    h.search.mockResolvedValue({
      query: "readme",
      entries: [],
      nextCursor: null,
      truncated: false,
      source: "git",
      rootRevision: "r1",
    })
    await searchProjectFileIndex({ root: "/projeto", query: "  README " })
    await searchProjectFileIndex({ root: "/projeto", query: "readme" })

    expect(h.search).toHaveBeenCalledTimes(1)
    expect(h.search).toHaveBeenCalledWith(
      expect.objectContaining({ query: "readme" }),
    )
  })
})
