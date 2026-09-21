// Trabalho DIFERIDO do provider (deferred-work-plan, D1): o Claude Code lança
// workflows/background tasks que sobrevivem ao turno. O reducer transforma os
// eventos normalizados `deferred_work` (traduzidos no Rust a partir dos
// system/task_* REAIS do 2.1.219, spike D0) num nó tool sintético com ciclo de
// vida próprio — e NUNCA deixa "rodando" falso depois do fim do processo.
import { describe, expect, it } from "vitest"
import {
  deferredLabel,
  deferredResumePrompt,
  markOrphanedProcesses,
  pendingDeferred,
  progressTokens,
  reduceItems,
  type ChatItem,
  type ItemReducible,
} from "@/store/chat"
import type { DeferredWork } from "@/lib/work"
import type { AgentEvent } from "@/lib/agent"
import { settleTerminalTools } from "@/store/chat/terminalTools"

const T0 = 1_785_512_000_000

function base(items: ChatItem[] = []): ItemReducible {
  return {
    items,
    streamingTextId: null,
    model: null,
    sessionId: null,
    startedAt: null,
    contextTokens: undefined,
  }
}

function apply(c: ItemReducible, e: AgentEvent, now = T0): ItemReducible {
  return { ...c, ...reduceItems(c, e, undefined, now) }
}

/** Evento como o adapter Rust emite pro task_started REAL do spike D0. */
function started(over: Partial<Extract<AgentEvent, { type: "deferred_work" }>> = {}): AgentEvent {
  return {
    type: "deferred_work",
    id: "wnz619fti",
    tool_use_id: "toolu_01MmPxeoK9vhakStdhGbVywn",
    kind: "workflow",
    name: "spike-ping",
    status: "running",
    summary: null,
    output_file: null,
    progress: null,
    ...over,
  }
}

const deferredItems = (c: ItemReducible) =>
  c.items.filter(
    (i): i is Extract<ChatItem, { kind: "tool" }> =>
      i.kind === "tool" && i.deferred != null,
  )

describe("trabalho diferido — nó sintético no fio (D1.2)", () => {
  it("task_started cria o nó DeferredWork vinculado ao tool_use Workflow de origem", () => {
    const c = apply(base(), started())
    const [item] = deferredItems(c)
    expect(item.name).toBe("DeferredWork")
    expect(item.deferred?.id).toBe("wnz619fti")
    expect(item.deferred?.status).toBe("running")
    expect(item.deferred?.name).toBe("spike-ping")
    // parentesco no Fio Vivo: pendura no tool_use `Workflow` que o criou
    expect(item.parentToolId).toBe("toolu_01MmPxeoK9vhakStdhGbVywn")
    expect(item.result).toBeUndefined()
  })

  it("progress atualiza o resumo sem sobrescrever o nome nem duplicar o nó", () => {
    let c = apply(base(), started())
    c = apply(c, started({ status: "progress", name: null, summary: "Ping: Responda apenas com a palavra: ping" }), T0 + 1000)
    expect(deferredItems(c)).toHaveLength(1)
    const [item] = deferredItems(c)
    expect(item.deferred?.status).toBe("running")
    expect(item.deferred?.name).toBe("spike-ping")
    expect(item.deferred?.summary).toContain("Ping")
    expect(item.deferred?.updatedAt).toBe(T0 + 1000)
  })

  it("ciclo rodando → concluiu: o nó ganha result ok com o resumo final", () => {
    let c = apply(base(), started())
    c = apply(
      c,
      started({
        status: "completed",
        name: null,
        summary: 'Dynamic workflow "spike D0: dois agentes triviais" completed',
      }),
      T0 + 5000,
    )
    const [item] = deferredItems(c)
    expect(item.deferred?.status).toBe("completed")
    expect(item.result?.ok).toBe(true)
    expect(item.result?.text).toContain("completed")
  })

  it("stopped do provider vira interrompido (result com erro), nunca concluído", () => {
    let c = apply(base(), started())
    c = apply(c, started({ status: "stopped", summary: "No completion record was found" }), T0 + 5000)
    const [item] = deferredItems(c)
    expect(item.deferred?.status).toBe("interrupted")
    expect(item.result?.ok).toBe(false)
  })

  it("task-notification injetada no resume SEM nó prévio cria o nó já terminal", () => {
    // conversa retomada: o item do turno anterior não está no fio (processo
    // morreu antes) — a notificação injetada precisa criar o registro sozinha.
    const c = apply(
      base(),
      started({
        id: "wpue6int0",
        tool_use_id: "toolu_01TCWmKSAySRPCGsQhHuffaV",
        kind: null,
        name: null,
        status: "stopped",
        summary: "No completion record was found for background workflow \"deep-research\"",
      }),
    )
    const [item] = deferredItems(c)
    expect(item.deferred?.id).toBe("wpue6int0")
    expect(item.deferred?.status).toBe("interrupted")
    expect(item.result?.ok).toBe(false)
    expect(item.result?.text).toContain("deep-research")
  })

  it("running atrasado (background_tasks_changed re-listando) não ressuscita nó terminal", () => {
    let c = apply(base(), started())
    c = apply(c, started({ status: "completed", summary: "done" }), T0 + 1)
    c = apply(c, started({ status: "running" }), T0 + 2)
    const [item] = deferredItems(c)
    expect(item.deferred?.status).toBe("completed")
  })

  it("output_file da task_notification é preservado no nó (o resultado em disco nunca some)", () => {
    // lição central do incidente: o relatório existia em /…/tasks/<id>.output
    // e o usuário levou 2h pra chegar nele. O caminho é primeira classe.
    let c = apply(base(), started())
    c = apply(
      c,
      started({
        status: "completed",
        summary: 'Dynamic workflow "spike D0: dois agentes triviais" completed',
        output_file: "/tmp/tasks/wnz619fti.output",
      }),
      T0 + 5000,
    )
    const [item] = deferredItems(c)
    expect(item.deferred?.outputFile).toBe("/tmp/tasks/wnz619fti.output")
    // update posterior SEM output_file não apaga o caminho já conhecido
    const c2 = apply(c, started({ status: "completed" }), T0 + 6000)
    expect(deferredItems(c2)[0].deferred?.outputFile).toBe(
      "/tmp/tasks/wnz619fti.output",
    )
  })

  it("tokens do task_progress (usage.total_tokens) atualizam o contador de progresso", () => {
    let c = apply(base(), started())
    c = apply(
      c,
      started({
        status: "progress",
        summary: "Ping: Responda apenas com a palavra: ping",
        progress: {
          usage: { total_tokens: 15324, tool_uses: 0, duration_ms: 1419 },
          workflow_progress: [{ type: "workflow_phase", index: 1, title: "Ping" }],
        },
      }),
      T0 + 1000,
    )
    expect(deferredItems(c)[0].deferred?.tokens).toBe(15324)
    // tick sem usage não zera o contador (mantém o último conhecido)
    const c2 = apply(c, started({ status: "progress", summary: "Ping: …" }), T0 + 2000)
    expect(deferredItems(c2)[0].deferred?.tokens).toBe(15324)
    // payload sem usage/total_tokens é tolerado
    expect(progressTokens(null)).toBeNull()
    expect(progressTokens({ usage: {} })).toBeNull()
  })
})

describe("Retomar ≠ repetir (decisão 3 do plano)", () => {
  const d = (status: DeferredWork["status"]): DeferredWork => ({
    id: "wpue6int0",
    toolUseId: null,
    kind: "local_workflow",
    name: "deep-research",
    status,
    summary: null,
    outputFile: null,
    tokens: null,
    startedAt: T0,
    updatedAt: T0,
  })

  it("interrompido ganha prompt de RETOMADA com cache, nunca relançar do zero", () => {
    const prompt = deferredResumePrompt(d("interrupted"))
    expect(prompt).toContain("deep-research")
    expect(prompt).toContain("resumeFromRunId")
    expect(prompt).toContain("NÃO relance do zero")
  })

  it("interrompido sem suporte a checkpoint (ex.: bash) não promete Workflow nem cache (ADR-182)", () => {
    const bashWork: DeferredWork = {
      ...d("interrupted"),
      kind: "bash",
      name: "Build test app",
    }
    const prompt = deferredResumePrompt(bashWork)
    expect(prompt).toContain("Build test app")
    expect(prompt).not.toContain("Workflow")
    expect(prompt).not.toContain("resumeFromRunId")
    expect(prompt).toContain("Inspecione o estado atual")
  })

  it("rodando e concluído não têm ação de repetição (null)", () => {
    expect(deferredResumePrompt(d("running"))).toBeNull()
    expect(deferredResumePrompt(d("completed"))).toBeNull()
  })
})

describe("fim do processo com diferido vivo (D1.3)", () => {
  it("done com diferido rodando vira interrompido — nunca 'rodando' falso após EOF", () => {
    let c = apply(base(), started())
    c = apply(c, { type: "done", code: 0 }, T0 + 9000)
    const [item] = deferredItems(c)
    expect(item.deferred?.status).toBe("interrupted")
    expect(item.result?.ok).toBe(false)
    expect(item.result?.text).toContain("Envie uma nova mensagem para retomar")
  })

  it("done com diferido já concluído não mexe em nada (fail-open)", () => {
    let c = apply(base(), started())
    c = apply(c, started({ status: "completed", summary: "ok" }), T0 + 1)
    const before = c.items
    const out = reduceItems(c, { type: "done", code: 0 }, undefined, T0 + 2)
    expect(out.items).toBeUndefined() // só streamingTextId, itens intactos
    expect(c.items).toBe(before)
  })
})

describe("replay-safe (D1.5)", () => {
  it("diferido 'rodando' vindo do disco vira interrompido no restore", () => {
    let c = apply(base(), started())
    const restored = markOrphanedProcesses(c.items)
    const [item] = restored.filter(
      (i): i is Extract<ChatItem, { kind: "tool" }> =>
        i.kind === "tool" && i.deferred != null,
    )
    expect(item.deferred?.status).toBe("interrupted")
    expect(item.result?.ok).toBe(false)
    expect(item.result?.text).toContain("reiniciou")
  })

  it("diferido já terminal não é alterado no restore", () => {
    let c = apply(base(), started())
    c = apply(c, started({ status: "completed", summary: "ok" }), T0 + 1)
    const [item] = c.items
    expect(markOrphanedProcesses(c.items)[0]).toBe(item)
  })
})

describe("meta honesto do turno (D1.3)", () => {
  it("pendingDeferred deriva de items o que alimenta o rótulo 'trabalho em background rodando'", () => {
    let c = apply(base(), started())
    expect(pendingDeferred(c.items).map(deferredLabel)).toEqual(["spike-ping"])
    // terminou → o rótulo honesto some junto (deriva da MESMA fonte)
    c = apply(c, started({ status: "completed" }), T0 + 1)
    expect(pendingDeferred(c.items)).toEqual([])
  })

  it("deferredLabel nunca mostra id cru quando há nome ou tipo melhor", () => {
    const d: DeferredWork = {
      id: "wnz619fti",
      toolUseId: null,
      kind: "local_workflow",
      name: null,
      status: "running",
      summary: null,
      outputFile: null,
      tokens: null,
      startedAt: T0,
      updatedAt: T0,
    }
    expect(deferredLabel(d)).toBe("workflow")
    expect(deferredLabel({ ...d, name: "deep-research" })).toBe("deep-research")
  })

  it("dois results no mesmo stream (flush do turno de conclusão) colapsam no último custo", () => {
    // spike 1b: com background task, o CLI descarrega os DOIS results juntos no
    // fim (custo do 2º é cumulativo) — o fio guarda só a última leitura.
    const result = (cost: number): AgentEvent => ({
      type: "result",
      ok: true,
      text: "ok",
      cost_usd: cost,
      cost_source: "reported",
      input_tokens: 1,
      output_tokens: 1,
      cache_read: 0,
      cache_creation: 0,
    })
    let c = apply(base(), result(0.068))
    c = apply(c, result(0.181), T0 + 1)
    const results = c.items.filter((i) => i.kind === "result")
    expect(results).toHaveLength(1)
    expect(results[0].kind === "result" && results[0].costUsd).toBe(0.181)
  })

  it("comando bash background recebe output_file no item de tool e preserva caminho ao ser interrompido", () => {
    // Cenário do incidente do build:
    // 1. Tool Bash invocada
    const toolItem: ChatItem = {
      kind: "tool",
      id: "tool-1",
      toolId: "toolu_01T3cSiZKnzUhyzaVHiNbtMa",
      name: "Bash",
      input: { command: "./scripts/build.sh test", run_in_background: true },
      result: { ok: true, text: "Command running in background with ID: b3pbaal2v", lines: 1 },
    }
    const c0 = base([toolItem])

    // 2. Evento deferred_work emitido a partir do tool_result com output_file
    const bgEvent: AgentEvent = {
      type: "deferred_work",
      id: "b3pbaal2v",
      tool_use_id: "toolu_01T3cSiZKnzUhyzaVHiNbtMa",
      kind: "terminal",
      name: null,
      status: "running",
      summary: null,
      output_file: "/private/tmp/tasks/b3pbaal2v.output",
      progress: null,
    }
    const c1 = apply(c0, bgEvent, T0)
    const [runningTool] = deferredItems(c1)
    expect(runningTool.deferred?.id).toBe("b3pbaal2v")
    expect(runningTool.deferred?.outputFile).toBe("/private/tmp/tasks/b3pbaal2v.output")
    expect(runningTool.deferred?.status).toBe("running")

    // 3. Fim do turno (Done): settleTerminalTools encerra o trabalho vivo como interrompido
    const settled = settleTerminalTools(c1.items, "done", T0 + 1000)
    const [interruptedTool] = settled.filter(
      (i): i is Extract<ChatItem, { kind: "tool" }> =>
        i.kind === "tool" && i.deferred != null,
    )
    expect(interruptedTool.deferred?.status).toBe("interrupted")
    // O caminho do arquivo de saída em disco NUNCA se perde
    expect(interruptedTool.deferred?.outputFile).toBe("/private/tmp/tasks/b3pbaal2v.output")
  })
})
