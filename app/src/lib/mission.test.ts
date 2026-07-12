import { describe, expect, it, vi } from "vitest"
import type { AgentEvent } from "@/lib/agent"
import type { GitDiff } from "@/lib/git"
import { checkBudget, diffToText, phasePrompt, runPhase } from "./mission"

function result(ok: boolean, cost: number | null): AgentEvent {
  return {
    type: "result",
    ok,
    text: ok ? "feito" : null,
    cost_usd: cost,
    cost_source: "reported",
    input_tokens: 0,
    output_tokens: 0,
    cache_read: 0,
    cache_creation: 0,
  }
}

const emptyDiff: GitDiff = { isRepo: true, branch: "main", files: [] }

describe("phasePrompt", () => {
  it("planner: sem handoff nem diff, inclui a tarefa", () => {
    const p = phasePrompt("planner", "criar login", null, null)
    expect(p).toContain("PLANNER")
    expect(p).toContain("criar login")
    expect(p).not.toContain("Diff acumulado")
  })

  it("executor: inclui plano e diff quando presentes", () => {
    const p = phasePrompt("executor", "tarefa", "PLANO: passo 1", "── x.ts", "foco no back")
    expect(p).toContain("EXECUTOR")
    expect(p).toContain("PLANO: passo 1")
    expect(p).toContain("Diff acumulado")
    expect(p).toContain("foco no back")
  })

  it("reviewer: rotula o handoff como plano", () => {
    const p = phasePrompt("reviewer", "t", "PLANO", "diff", undefined)
    expect(p).toContain("REVIEWER")
    expect(p).toContain("Plano da missão")
  })
})

describe("diffToText", () => {
  it("fora de repo / sem mudanças", () => {
    expect(diffToText({ isRepo: false, branch: null, files: [] })).toContain("fora de um repositório")
    expect(diffToText(emptyDiff)).toContain("nenhuma mudança")
  })

  it("achata arquivo com hunks e sinais", () => {
    const diff: GitDiff = {
      isRepo: true,
      branch: "main",
      files: [
        {
          path: "src/a.ts",
          oldPath: null,
          status: "modified",
          additions: 1,
          deletions: 1,
          binary: false,
          hunks: [
            {
              header: "@@ -1 +1 @@",
              lines: [
                { type: "del", oldNo: 1, newNo: null, text: "old" },
                { type: "add", oldNo: null, newNo: 1, text: "new" },
              ],
            },
          ],
        },
      ],
    }
    const txt = diffToText(diff)
    expect(txt).toContain("src/a.ts")
    expect(txt).toContain("-old")
    expect(txt).toContain("+new")
  })
})

describe("checkBudget", () => {
  it("sem teto sempre ok", () => {
    expect(checkBudget(999, null).ok).toBe(true)
  })
  it("estourou → não ok com motivo", () => {
    const c = checkBudget(6, 5)
    expect(c.ok).toBe(false)
    expect(c.reason).toContain("esgotado")
  })
  it("abaixo do teto → ok", () => {
    expect(checkBudget(2, 5).ok).toBe(true)
  })
})

describe("runPhase", () => {
  it("sucesso: soma cost_usd dos results e devolve items", async () => {
    const run = vi.fn(async (_r, _c, _a, _m, _e, _p, _cwd, _res, _perm, _att, onEvent) => {
      onEvent(result(true, 0.5))
    })
    const r = await runPhase({
      runId: "r1", convId: "c1", agent: "codex", model: null, effort: null,
      prompt: "p", cwd: "/x", permission: "default", maxRetries: 1,
      run: run as never,
    })
    expect(r.ok).toBe(true)
    expect(r.costUsd).toBe(0.5)
  })

  it("retry: falha ok=false e sucede na 2ª, somando custo das duas", async () => {
    let n = 0
    const run = vi.fn(async (_r, _c, _a, _m, _e, _p, _cwd, _res, _perm, _att, onEvent) => {
      n++
      onEvent(result(n === 1 ? false : true, 0.2))
    })
    const r = await runPhase({
      runId: "r1", convId: "c1", agent: "codex", model: null, effort: null,
      prompt: "p", cwd: "/x", permission: "default", maxRetries: 2,
      run: run as never,
    })
    expect(r.ok).toBe(true)
    expect(r.costUsd).toBeCloseTo(0.4)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it("erro: esgota retries e devolve error", async () => {
    const run = vi.fn(async (_r, _c, _a, _m, _e, _p, _cwd, _res, _perm, _att, onEvent) => {
      onEvent({ type: "error", message: "boom" })
    })
    const r = await runPhase({
      runId: "r1", convId: "c1", agent: "codex", model: null, effort: null,
      prompt: "p", cwd: "/x", permission: "default", maxRetries: 2,
      run: run as never,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toBe("boom")
    expect(run).toHaveBeenCalledTimes(2)
  })
})
