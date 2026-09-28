// A fase da fala (G8): o Codex no app-server anuncia se a próxima fala é
// narração ("commentary") ou a resposta ("final_answer"). As frases e a ordem
// dos eventos são da captura real de 27/09/2026 (codex 0.157.1,
// `src-tauri/testdata/codex-0.157.1/fases-da-fala-appserver.jsonl`).
import { describe, expect, it } from "vitest"
import { reduceItems, type ChatItem, type ItemReducible } from "@/store/chat"
import type { AgentEvent } from "@/lib/agent"

const T0 = 1_790_561_229_000

function base(): ItemReducible {
  return { items: [], streamingTextId: null, model: null, sessionId: null, startedAt: null, contextTokens: undefined }
}

function aplicar(eventos: AgentEvent[]): ItemReducible {
  return eventos.reduce<ItemReducible>((c, e) => ({ ...c, ...reduceItems(c, e, undefined, T0) }), base())
}

const falas = (c: ItemReducible) => c.items.filter((i): i is Extract<ChatItem, { kind: "text" }> => i.kind === "text")

describe("fase da fala no fio", () => {
  it("a narração e a resposta do Codex nascem marcadas, cada uma no seu item", () => {
    const c = aplicar([
      { type: "text_phase", phase: "commentary" },
      { type: "text_delta", text: "Vou gerar um ícone plano simples" },
      { type: "text_delta", text: " e salvar a imagem no workspace para você." },
      { type: "text_stop" },
      { type: "tool", id: "exec-a07a17e8", name: "Bash", input: { command: "cat SKILL.md" } } as AgentEvent,
      { type: "text_phase", phase: "final_answer" },
      { type: "text_delta", text: "Não consegui gerar a imagem porque a ferramenta de geração não está disponível nesta sessão." },
      { type: "text_stop" },
    ])
    expect(falas(c).map((f) => f.fase)).toEqual(["narracao", "resposta"])
    expect(c.faseDaFala).toBeNull()
  })

  it("a fase fecha o balão aberto: a fala anunciada não cola na anterior", () => {
    const c = aplicar([
      { type: "text_delta", text: "começo sem fase" },
      { type: "text_phase", phase: "final_answer" },
      { type: "text_delta", text: "a resposta" },
    ])
    expect(falas(c).map((f) => [f.text, f.fase])).toEqual([
      ["começo sem fase", undefined],
      ["a resposta", "resposta"],
    ])
  })

  it("motor que não anuncia fase deixa a fala sem fase", () => {
    const c = aplicar([{ type: "text", text: "resposta do Claude" }])
    expect(falas(c)[0].fase).toBeUndefined()
  })

  it("fase desconhecida não vira fase", () => {
    const c = aplicar([{ type: "text_phase", phase: "planning" }, { type: "text", text: "x" }])
    expect(falas(c)[0].fase).toBeUndefined()
  })
})
