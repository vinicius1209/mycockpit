import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ chamadas: 0, resolver: [] as ((v: unknown) => void)[] }))

vi.mock("@/lib/git", () => ({
  loadGitStatus: vi.fn(
    () =>
      new Promise((r) => {
        h.chamadas += 1
        h.resolver.push(r)
      }),
  ),
}))

const PASTA = "/Users/v/projetos/frota"
const STATUS = {
  isRepo: true,
  branch: "main",
  upstream: "origin/main",
  ahead: 0,
  behind: 0,
  staged: [{ path: "docs/PLAN.md", oldPath: null, status: "modified", staged: true, additions: 1, deletions: 0 }],
  unstaged: [{ path: "app/src/lib/git.ts", oldPath: null, status: "modified", staged: false, additions: 2, deletions: 1 }],
}

beforeEach(() => {
  vi.resetModules()
  h.chamadas = 0
  h.resolver.length = 0
})

describe("o git status compartilhado por pasta", () => {
  it("a árvore e a aba pedindo juntas viram uma chamada só", async () => {
    const { lerStatusDoGit, statusEmCache } = await import("@/lib/statusCompartilhado")
    const a = lerStatusDoGit(PASTA)
    const b = lerStatusDoGit(PASTA)
    expect(h.chamadas).toBe(1)
    h.resolver[0](STATUS)
    expect(await a).toBe(await b)
    expect(statusEmCache(PASTA)).toBe(STATUS)
    void lerStatusDoGit(PASTA)
    expect(h.chamadas).toBe(2)
  })

  it("a aba Alterações lê por conta própria e só publica: quem chega depois acha o cache", async () => {
    const { publicarStatus, statusEmCache } = await import("@/lib/statusCompartilhado")
    publicarStatus(PASTA, STATUS as never)
    expect(statusEmCache(PASTA)).toBe(STATUS)
    expect(h.chamadas).toBe(0)
  })

  it("alterado é preparado ou não, e fora de repositório não há nenhum", async () => {
    const { caminhosAlterados } = await import("@/lib/statusCompartilhado")
    expect([...caminhosAlterados(STATUS as never).keys()]).toEqual(["docs/PLAN.md", "app/src/lib/git.ts"])
    expect(caminhosAlterados({ ...STATUS, isRepo: false } as never).size).toBe(0)
    expect(caminhosAlterados(null).size).toBe(0)
  })

  it("a letra mais informativa vence, e a pasta de um filho mudado fica marcada", async () => {
    const { caminhosAlterados, pastasComMudanca } = await import("@/lib/statusCompartilhado")
    const status = {
      ...STATUS,
      staged: [{ ...STATUS.staged[0], path: "docs/novo.md", status: "added" }],
      unstaged: [
        { ...STATUS.unstaged[0], path: "docs/novo.md", status: "modified" },
        { ...STATUS.unstaged[0], path: "rascunho.txt", status: "untracked" },
        { ...STATUS.unstaged[0], path: "app/src/lib/git.ts", status: "modified" },
      ],
    }
    const letras = caminhosAlterados(status as never)
    expect(Object.fromEntries(letras)).toEqual({ "docs/novo.md": "A", "rascunho.txt": "U", "app/src/lib/git.ts": "M" })
    expect([...pastasComMudanca(letras)].sort()).toEqual(["app", "app/src", "app/src/lib", "docs"])
  })
})
