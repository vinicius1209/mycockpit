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

describe("reviewerApproved endurecido (MH1.1): frases armadilha não contam como aprovação", () => {
  // Fixtures no formato REAL do parecer: o template pede "APROVADO e explique
  // em 1 linha" — os pareceres reprovados vêm exatamente nessas variações.
  it("'aprovado com ressalvas' é reprovação (a ressalva É a pendência)", () => {
    expect(
      reviewerApproved([
        textItem(
          "APROVADO COM RESSALVAS: o fluxo principal funciona, mas o erro de rede não é tratado em lib/sync.ts.",
        ),
      ]),
    ).toBe(false)
  })
  it("'ainda não está aprovado' é reprovação", () => {
    expect(
      reviewerApproved([
        textItem(
          "O plano foi seguido, porém ainda não está aprovado: falta o teste do caso vazio em parser.test.ts.",
        ),
      ]),
    ).toBe(false)
  })
  it("'não totalmente aprovado' é reprovação", () => {
    expect(
      reviewerApproved([
        textItem(
          "Não totalmente aprovado. Corrija: 1) src/api.ts ignora o status 429; 2) falta rollback na migração.",
        ),
      ]),
    ).toBe(false)
  })
  it("'NÃO APROVADO' segue reprovação (caso já coberto, não pode regredir)", () => {
    expect(
      reviewerApproved([textItem("NÃO APROVADO: faltou tratar o erro X.")]),
    ).toBe(false)
  })
  it("'não foi totalmente aprovado' (negação com 2 palavras no meio) é reprovação", () => {
    expect(
      reviewerApproved([
        textItem("O trabalho não foi totalmente aprovado; ver itens abaixo."),
      ]),
    ).toBe(false)
  })
  it("'aprovado, mas…' é reprovação (aprovação qualificada)", () => {
    expect(
      reviewerApproved([
        textItem("APROVADO, mas o teste de integração precisa ser reescrito."),
      ]),
    ).toBe(false)
  })
  it("aprovação seca segue valendo (o endurecimento não vira paranoia)", () => {
    expect(
      reviewerApproved([
        textItem("APROVADO. O diff cobre o plano e os testes passam."),
      ]),
    ).toBe(true)
  })
  it("'DESAPROVADO' não passa por substring (fronteira de palavra)", () => {
    expect(
      reviewerApproved([
        textItem("DESAPROVADO. Corrija: src/x.ts engole a exceção."),
      ]),
    ).toBe(false)
  })
  it("'REPROVADO' também não conta como aprovação", () => {
    expect(
      reviewerApproved([textItem("REPROVADO: o plano não foi seguido.")]),
    ).toBe(false)
  })
  it("'NÃO-APROVADO' com hífen é reprovação (separador vale como espaço)", () => {
    expect(
      reviewerApproved([
        textItem("NÃO-APROVADO: falta o rollback da migração."),
      ]),
    ).toBe(false)
  })
  it("regressão: APROVADO embutido em frase legítima segue aprovando", () => {
    expect(
      reviewerApproved([
        textItem("O diff está correto e completo, portanto APROVADO."),
      ]),
    ).toBe(true)
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

  it("doutrina do projeto entra ANTES do aprendizado (regra humana > destilada)", () => {
    const p = phasePrompt({
      persona: "executor",
      task: "t",
      handoffPath: ".mission/1-executor.json",
      doctrineBlock: "<doutrina>não use any</doutrina>",
      lessonsBlock: "## Lições deste projeto",
      instructions: "foco no back",
    })
    expect(p).toContain("não use any")
    // ordem: instrução da fase → doutrina do projeto → lições aprendidas.
    expect(p.indexOf("foco no back")).toBeLessThan(p.indexOf("não use any"))
    expect(p.indexOf("não use any")).toBeLessThan(p.indexOf("Lições deste projeto"))
  })

  it("sem doutrina o prompt não ganha bloco vazio", () => {
    const semNada = phasePrompt({
      persona: "executor",
      task: "t",
      handoffPath: "h.json",
    })
    const comVazia = phasePrompt({
      persona: "executor",
      task: "t",
      handoffPath: "h.json",
      doctrineBlock: "   ",
    })
    expect(comVazia).toBe(semNada)
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
