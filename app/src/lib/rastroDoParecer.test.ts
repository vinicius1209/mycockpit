import { describe, expect, it } from "vitest"
import { parecerLevado, pedidoQueLevou, trechoDoParecer } from "./rastroDoParecer"
import type { ChatItem } from "@/store/chat"

// O parecer REAL da Íris (26/09/2026), começo do texto.
const PARECER =
  "**Parecer da Íris: LP gerada + painel do prospector**\n\nVocê tem razão, a LP tem cara de IA. Ela não está feia, só parece genérica."

const items: ChatItem[] = [
  { kind: "advice", id: "a1", personaId: "iris", personaName: "Íris", personaVersion: 1, digest: "04ab091d", question: "q", text: PARECER, ts: 1 },
  { kind: "user", id: "u1", text: "O que você acha disso?", pareceres: [{ itemId: "a1", personaId: "iris", personaNome: "Íris" }], ts: 2 },
] as ChatItem[]

describe("o rastro do parecer levado (ADR-267)", () => {
  it("o parecer acha o pedido que o levou, e o pedido acha o parecer", () => {
    expect(pedidoQueLevou(items, "a1")?.id).toBe("u1")
    expect(pedidoQueLevou(items, "outro")).toBeNull()
    expect(parecerLevado(items, "a1")?.personaName).toBe("Íris")
    expect(parecerLevado(items, "sumiu")).toBeNull()
  })

  it("o trecho pula o título 'Parecer da…' e corta na palavra", () => {
    expect(trechoDoParecer(PARECER)).toBe("Você tem razão, a LP tem cara de IA. Ela não está feia, só…")
    expect(trechoDoParecer("curto")).toBe("curto")
  })
})
