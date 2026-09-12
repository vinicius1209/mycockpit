// R5 — o desfecho para de mentir.
//
// A fixture é o transcript REAL do incidente, colhido de
// `conversations.items` no SQLite (conversa be01e5c5, automação "Pendencias na
// Prime", disparo de 09/09/2026 07:00). Fixture inventada esconde bug, e este
// bug passou três execuções escondido justamente porque ninguém olhou o
// transcript de verdade.

import { describe, expect, it } from "vitest"
import { barradoPeloAmbiente, turnOutcome } from "@/lib/scheduleOutcome"
import type { ChatItem } from "@/store/chat"

/** Ferramenta com desfecho, no formato do store. */
function tool(
  name: string,
  result: { ok: boolean; text: string; lines: number; interrupted?: true },
): ChatItem {
  return {
    kind: "tool",
    id: `t-${name}-${result.ok}-${result.text.length}`,
    name,
    input: {},
    ts: 1,
    result,
  } as ChatItem
}

/** O turno de 09/09/2026, item a item, com os desfechos que o banco guardou. */
const INCIDENTE: ChatItem[] = [
  { kind: "user", id: "u1", text: "Acesse o JSON…", ts: 1 } as ChatItem,
  { kind: "text", id: "x1", text: "Vou tratar isso como…", ts: 2 } as ChatItem,
  tool("work_plan", {
    ok: false,
    text: "MCP tool call requires approval, but approval policy is never",
    lines: 1,
  }),
  { kind: "text", id: "x2", text: "A telemetria mc-work…", ts: 3 } as ChatItem,
  tool("js", { ok: false, text: "", lines: 0 }),
  tool("context_read", { ok: false, text: "", lines: 0 }),
  // As DUAS que passaram, e é por elas que "alguma tool passou" não serve de
  // régua: `ok: true` com saída vazia, o agente tateando.
  tool("list_mcp_resource_templates", { ok: true, text: "", lines: 0 }),
  tool("list_mcp_resources", { ok: true, text: "", lines: 0 }),
  {
    kind: "result",
    id: "r1",
    ok: true,
    costUsd: 0.3679648,
    ts: 4,
  } as ChatItem,
]

describe("barradoPeloAmbiente", () => {
  it("o turno do incidente terminava `ok` e agora acusa o bloqueio", () => {
    // A prova de que o bug existia: o item terminal diz sucesso.
    expect(turnOutcome(INCIDENTE).ok).toBe(true)
    // E a prova de que ele foi consertado, com o MOTIVO real.
    const motivo = barradoPeloAmbiente(INCIDENTE)
    expect(motivo).not.toBeNull()
    expect(motivo).toContain("sem produzir trabalho")
    expect(motivo).toContain("approval policy is never")
  })

  it("o custo continua sendo contabilizado num turno barrado", () => {
    // Falhar não apaga o que foi gasto: o US$ 0,37 saiu da conta de qualquer
    // jeito, e esconder isso do histórico seria outra forma de teatro.
    expect(turnOutcome(INCIDENTE).cost).toBeCloseTo(0.3679648, 6)
  })

  it("turno que PRODUZIU saída não é barrado, mesmo com uma falha no meio", () => {
    // `grep` sem resultado é rotina. Condenar por "alguma falhou" transformaria
    // a régua num gerador de falso negativo, e automação que falha à toa é tão
    // inútil quanto automação que mente.
    const itens = [
      tool("grep", { ok: false, text: "no matches", lines: 0 }),
      tool("read_file", { ok: true, text: "conteúdo do arquivo", lines: 42 }),
      { kind: "result", id: "r", ok: true, ts: 9 } as ChatItem,
    ]
    expect(barradoPeloAmbiente(itens)).toBeNull()
  })

  it("turno sem ferramenta nenhuma não é barrado", () => {
    // Responder de cabeça é desfecho legítimo: uma automação de "resuma o que
    // você sabe" não toca ferramenta e não pode virar falha por isso.
    const itens = [
      { kind: "text", id: "t", text: "resposta", ts: 1 } as ChatItem,
      { kind: "result", id: "r", ok: true, ts: 2 } as ChatItem,
    ]
    expect(barradoPeloAmbiente(itens)).toBeNull()
  })

  it("corte SEU não é falha de ambiente", () => {
    // ADR-180: `interrupted` é gesto humano, não defeito. Contá-lo faria todo
    // "Parar" virar uma automação falhada no histórico.
    const itens = [
      tool("bash", { ok: false, text: "", lines: 0, interrupted: true }),
      { kind: "result", id: "r", ok: true, ts: 2 } as ChatItem,
    ]
    expect(barradoPeloAmbiente(itens)).toBeNull()
  })

  it("sem texto em nenhuma falha, a frase nomeia as ferramentas", () => {
    // Motivo REAL, nunca inventado: se nenhuma falha trouxe texto, diz quais
    // falharam em vez de chutar uma causa.
    const itens = [
      tool("js", { ok: false, text: "", lines: 0 }),
      tool("context_read", { ok: false, text: "", lines: 0 }),
      { kind: "result", id: "r", ok: true, ts: 3 } as ChatItem,
    ]
    const motivo = barradoPeloAmbiente(itens)
    expect(motivo).toContain("js")
    expect(motivo).toContain("context_read")
  })
})
