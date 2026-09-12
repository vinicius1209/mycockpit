// Regra 1 do ADR-179 nas superfícies que TROCAM de estado: montar não é evento.
// `renderToStaticMarkup` é exatamente uma montagem sem história, então o que
// ele devolve é o que a pessoa vê ao abrir a conversa ou expandir o projeto.
import { afterEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { ConversationSlot } from "@/components/layout/ConversationSlot"
import { WorkingIndicator } from "@/components/chat/WorkingIndicator"
import { TurnTelemetry } from "@/components/chat/TurnTelemetry"
import { StepDot, ToolGroupStatus } from "@/components/chat/statusGlyphs"
import type { ChatItem } from "@/store/chat"

afterEach(() => {
  vi.useRealTimers()
})

describe("montar não anima (ADR-179)", () => {
  it("slot da sidebar: conversa que já está rodando aparece parada no lugar", () => {
    const html = renderToStaticMarkup(
      <ConversationSlot pede={false} rodando falhou={false} updatedAt={Date.now()} />,
    )
    expect(html).toContain("conv-spin")
    expect(html).not.toContain("fio-nasce")
  })

  it("linha viva: abrir uma conversa em curso não reencena a frase", () => {
    const html = renderToStaticMarkup(
      <WorkingIndicator
        agent="codex"
        presetId={null}
        finalizing={false}
        running
        startedAt={Date.now() - 6_000}
        deferred={[]}
        nodes={[]}
        inline
      />,
    )
    expect(html).toContain("está trabalhando")
    expect(html).not.toContain("fio-nasce")
  })
})

describe("legenda de fim de turno", () => {
  // O `result` REAL do turno que respondeu depois do corte (09/09/2026).
  const RESULT: Extract<ChatItem, { kind: "result" }> = {
    kind: "result",
    id: "bd3f93ab-3767-4cbd-84c1-74a24007045a",
    ok: true,
    costUsd: 3.449664,
    costSource: "estimated",
    model: "gpt-5.6-sol",
    usage: { input: 5727270, output: 37218, cacheRead: 5612160, cacheCreation: 0 },
    durationMs: 1077653,
    ts: 1_789_067_407_886,
  }

  it("o ✓ assenta no instante em que o turno fecha", () => {
    vi.useFakeTimers()
    vi.setSystemTime(RESULT.ts! + 40)
    expect(renderToStaticMarkup(<TurnTelemetry it={RESULT} />)).toContain("fio-assenta")
  })

  it("relida, a legenda chega pronta", () => {
    vi.useFakeTimers()
    vi.setSystemTime(RESULT.ts! + 86_400_000)
    expect(renderToStaticMarkup(<TurnTelemetry it={RESULT} />)).not.toContain("fio-assenta")
  })
})

describe("glifo da ação que parou (ADR-180)", () => {
  it("anel vazado e estático, nunca giro congelado nem ponto vermelho", () => {
    const html = renderToStaticMarkup(<StepDot status="stopped" />)
    expect(html).toContain('aria-label="parou"')
    expect(html).not.toContain("animate-spin")
    expect(html).not.toContain("bg-st-error")
  })

  it("o grupo que parou usa o mesmo anel", () => {
    const html = renderToStaticMarkup(<ToolGroupStatus state="stopped" />)
    expect(html).toContain("<svg")
    expect(html).not.toContain("animate-spin")
  })
})
