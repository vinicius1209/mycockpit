// Contrato v2 do revezamento (revezamento PRD R1): a conversa viaja com a mesma
// memória por significado do `/compactar`, orçada pela janela do destino.
import { describe, expect, it } from "vitest"
import {
  buildContextEnvelope,
  HANDOFF_RECENT_BUDGET_CHARS,
  orcamentoDoHandoff,
  prepareHybridHandoff,
} from "./handoff"
import { HISTORY_CLOSE, HISTORY_OPEN } from "./trust"
import type { GitDiff } from "./git"
import type { ChatItem } from "@/store/chat"

const emptyDiff: GitDiff = { isRepo: true, branch: "main", files: [] }

/** Fio de 100 itens: pedidos, respostas longas, ferramentas e um plano
 *  aprovado no MEIO — o que a cauda de 6 mil caracteres do v1 perdia. */
function fioLongo(): ChatItem[] {
  const items: ChatItem[] = []
  for (let i = 0; i < 97; i++) {
    if (i === 20) items.push({ kind: "user", id: `u${i}`, text: "Use SQLite local, nada de Postgres nesta fase." })
    else if (i === 45) items.push({ kind: "planGate", id: `g${i}`, text: "Migrar o cache para o Rust antes da UI.", decision: "approved" })
    else if (i % 3 === 0) items.push({ kind: "user", id: `u${i}`, text: `Pedido ${i}: ajuste o módulo ${i}.` })
    else if (i % 3 === 1) items.push({ kind: "text", id: `t${i}`, text: `Resposta ${i}: ${"detalhe da implementação ".repeat(60)}` })
    else items.push({ kind: "tool", id: `f${i}`, name: "Edit", input: { file_path: `src/m${i}.ts` }, result: { ok: true, text: "ok" } } as ChatItem)
  }
  items.push({ kind: "text", id: "t97", text: "Pronto, cache migrado." })
  items.push({ kind: "user", id: "u98", text: "Agora ligue a UI ao cache novo." })
  items.push({ kind: "notice", id: "n99", message: "Revezamento preparado." })
  return items
}

const semMolduras = (s: string) => s

describe("revezamento com memória por significado", () => {
  it("pedidos e decisões do meio da conversa chegam ao motor de destino", async () => {
    const items = fioLongo()
    const prepared = await prepareHybridHandoff({
      projectId: "p1",
      cwd: "/repo",
      convId: "c1",
      sourceAgent: "codex",
      targetAgent: "claude-code",
      items,
      pendingUserIndex: 98,
      janelaDoDestino: 1_000_000,
      getDiff: async () => emptyDiff,
      exportBundle: async () => ({ transcriptPath: ".mycockpit/context/c1.md", manifestPath: ".mycockpit/context/c1.handoff.json" }),
    })
    const { envelope, prompt } = prepared
    expect(envelope.version).toBe(2)
    expect(envelope.conversation_memory).toContain("Use SQLite local, nada de Postgres nesta fase.")
    expect(envelope.conversation_memory).toContain("PLANO (APROVADO): Migrar o cache para o Rust antes da UI.")
    expect(envelope.recent_history).toContain("Pronto, cache migrado.")
    const conteudo = semMolduras(envelope.conversation_memory).length + envelope.recent_history.length
    expect(conteudo).toBeLessThanOrEqual(60_000)
    expect(prompt).toContain("Você está assumindo no Claude Code uma conversa iniciada no Codex")
    expect(prompt).not.toContain("claude-code")
    expect(prompt.endsWith("Agora ligue a UI ao cache novo.")).toBe(true)
    // uma moldura só para memória e últimas mensagens (H3)
    expect(prompt.split(HISTORY_OPEN)).toHaveLength(2)
    expect(prompt.split(HISTORY_CLOSE)).toHaveLength(2)
    expect(envelope.conversation_memory.startsWith(HISTORY_OPEN)).toBe(false)
  })

  it("o orçamento segue a janela do destino, com teto de 60 mil e piso do contrato v1", () => {
    expect(orcamentoDoHandoff(1_000_000)).toBe(60_000)
    expect(orcamentoDoHandoff(32_000)).toBe(9_600)
    expect(orcamentoDoHandoff(null)).toBe(HANDOFF_RECENT_BUDGET_CHARS)
  })

  it("janela desconhecida leva pelo menos o que o v1 levava e marca o corte", () => {
    const envelope = buildContextEnvelope({
      convId: "c1",
      sourceAgent: "claude-code",
      targetAgent: "agy",
      items: fioLongo(),
      pendingUserIndex: 98,
      diff: emptyDiff,
      references: [],
      janelaDoDestino: null,
    })
    const conteudo = semMolduras(envelope.conversation_memory).length + envelope.recent_history.length
    expect(conteudo).toBeLessThanOrEqual(HANDOFF_RECENT_BUDGET_CHARS)
    expect(envelope.conversation_memory).toContain("Use SQLite local")
    expect(envelope.truncation.conversation_memory).toBe(true)
  })
})
