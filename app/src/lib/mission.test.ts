import { describe, expect, it, vi } from "vitest"
import type { AgentEvent } from "@/lib/agent"
import type { ChatItem } from "@/store/chat"
import {
  checkBudget,
  phasePrompt,
  phaseText,
  reviewerApproved,
  runPhase,
} from "./mission"

function textItem(text: string): ChatItem {
  return { kind: "text", id: "t", text }
}

describe("reviewerApproved", () => {
  it("true com APROVADO", () => {
    expect(reviewerApproved([textItem("Tudo certo. APROVADO — cobre o caso.")])).toBe(true)
  })
  it("false com NÃO APROVADO", () => {
    expect(reviewerApproved([textItem("NÃO APROVADO: faltou tratar o erro X.")])).toBe(false)
  })
  it("false sem a palavra", () => {
    expect(reviewerApproved([textItem("Precisa ajustar o timeout.")])).toBe(false)
  })
})

describe("phaseText", () => {
  it("junta só os itens de texto", () => {
    const items: ChatItem[] = [
      textItem("linha 1"),
      { kind: "tool", id: "x", name: "Bash", input: {}, toolId: "1" },
      textItem("linha 2"),
    ]
    expect(phaseText(items)).toBe("linha 1\n\nlinha 2")
  })
})

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

describe("phasePrompt", () => {
  it("planner: 1ª fase só com a tarefa + instrução de handoff", () => {
    const p = phasePrompt({
      persona: "planner",
      task: "criar login",
      handoffPath: ".mission/0-planner.json",
    })
    expect(p).toContain("PLANNER")
    expect(p).toContain("criar login")
    expect(p).not.toContain("Handoff das fases anteriores")
    // toda fase é instruída a gravar seu próprio handoff tipado.
    expect(p).toContain(".mission/0-planner.json")
    expect(p).toContain("Handoff obrigatório")
  })

  it("executor: injeta handoff tipado anterior + referência de arquivos, não o patch", () => {
    const p = phasePrompt({
      persona: "executor",
      task: "tarefa",
      handoffPath: ".mission/1-executor.json",
      priorHandoffs: "### Planejar (planner)\nIntenção: fazer X",
      changedFiles: "- M x.ts (+3 -1)",
      instructions: "foco no back",
    })
    expect(p).toContain("EXECUTOR")
    expect(p).toContain("Handoff das fases anteriores")
    expect(p).toContain("Intenção: fazer X")
    expect(p).toContain("Arquivos alterados no worktree")
    expect(p).toContain("foco no back")
    expect(p).not.toContain("Diff acumulado")
  })

  it("reviewer: manda rodar git diff e cai no fallback quando não há handoff tipado", () => {
    const p = phasePrompt({
      persona: "reviewer",
      task: "t",
      handoffPath: ".mission/2-reviewer.json",
      priorHandoffs: null,
      fallbackContext: "resumo do transcript anterior",
    })
    expect(p).toContain("REVIEWER")
    expect(p).toContain("git diff")
    expect(p).toContain("resumo do transcript anterior")
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
