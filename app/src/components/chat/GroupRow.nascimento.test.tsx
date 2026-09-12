import { afterEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { GroupRow } from "@/components/chat/GroupRow"

// A sua mensagem REAL, 71ms depois do corte de 09/09/2026.
const SUA = 1_788_962_247_852

afterEach(() => {
  vi.useRealTimers()
})

function grupo(
  author: Parameters<typeof GroupRow>[0]["author"],
  agora: number,
  brasa = false,
): string {
  vi.useFakeTimers()
  vi.setSystemTime(agora)
  return renderToStaticMarkup(
    <GroupRow groupKey="g1" author={author} agent="codex" presetId={null} ts={SUA} brasa={brasa}>
      voce consegue se conectar no banco de prod
    </GroupRow>,
  )
}

describe("GroupRow: a chegada do grupo (ADR-179)", () => {
  it("a sua mensagem que acabou de sair sobe", () => {
    expect(grupo({ kind: "you" }, SUA + 50)).toContain("fio-nasce-sobe")
  })

  it("o grupo do agente só acende, sem subir", () => {
    const html = grupo({ kind: "executor" }, SUA + 50)
    expect(html).toContain("fio-nasce")
    expect(html).not.toContain("fio-nasce-sobe")
  })

  it("reabrir a conversa no dia seguinte não reencena nada", () => {
    expect(grupo({ kind: "you" }, SUA + 86_400_000)).not.toContain("fio-nasce")
  })

  it("com brasa, a brasa é a única chegada do bloco cortado", () => {
    const html = grupo({ kind: "executor" }, SUA + 50, true)
    expect(html).toContain("fio-brasa")
    expect(html).not.toContain("fio-nasce")
  })
})
