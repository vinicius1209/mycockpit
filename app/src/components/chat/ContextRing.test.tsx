import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ContextRingView } from "./ContextRing"
import { emptyConv, type ConvState } from "@/store/chat"
import type { EngineContext, EngineContextEntry } from "@/lib/engineContext"

function render(patch: Partial<ConvState>, engine: EngineContextEntry | null = null) {
  return renderToStaticMarkup(
    <ContextRingView
      conv={{
        ...emptyConv("p"),
        agent: "codex",
        model: "gpt-5.6-sol",
        ...patch,
      }}
      engine={engine}
      initiallyOpen
    />,
  )
}

// Leitura real do Claude Code 2.1.270 (testdata/claude-2.1.270/context-usage*.jsonl).
function leitura(patch: Partial<EngineContext> = {}, error: string | null = null): EngineContextEntry {
  return {
    sessionId: "s1",
    model: null,
    error,
    contextTokens: 882_525,
    reading: {
      totalTokens: 322_236,
      engineEstimate: null,
      maxTokens: 1_000_000,
      autoCompactThreshold: 967_000,
      autoCompactEnabled: true,
      source: "model-default",
      origin: "engine-report",
      model: "claude-opus-5[1m]",
      categories: [],
      observedAt: 1,
      ...patch,
    },
  }
}

const CLAUDE_CHEIO: Partial<ConvState> = {
  agent: "claude-code",
  model: "claude-opus-5",
  contextBasis: "last_call",
  contextTokens: 882_525,
  contextWindow: 1_000_000,
}

describe("ContextRing", () => {
  it("explica a última chamada contra a janela efetiva do runtime", () => {
    const html = render({
      contextBasis: "last_call",
      contextTokens: 211_547,
      contextWindow: 258_400,
    })
    expect(html).toContain("82%")
    expect(html).toContain("211.547")
    expect(html).toContain("258.400")
    expect(html).toContain("janela informada pelo agent")
    expect(html).toContain("Última chamada")
  })

  it("contradição oculta o percentual em vez de fabricar 100% e 1M", () => {
    const html = render({
      contextBasis: "last_call",
      contextTokens: 1_540_542,
      contextWindow: 258_400,
    })
    expect(html).toContain("1.540.542")
    expect(html).toContain("percentual foi ocultado")
    expect(html).not.toContain(">100%<")
    expect(html).not.toContain("1.000.000")
  })

  it("falha da fonte diz por que o total do turno não será usado", () => {
    const html = render({ contextBasis: "unavailable" })
    expect(html).toContain("Medição")
    expect(html).toContain("Indisponível")
    expect(html).toContain("total processado no turno não é usado como contexto")
  })

  it("janela de catálogo aparece explicitamente como estimada", () => {
    const html = render({
      agent: "claude-code",
      model: "claude-sonnet",
      contextBasis: "last_call",
      contextTokens: 100_000,
    })
    expect(html).toContain("≈ 200.000")
    expect(html).toContain("janela estimada pelo catálogo")
  })

  it("com o limiar do motor, mede até a compactação automática e diz onde ela dispara", () => {
    const html = render(CLAUDE_CHEIO, leitura())
    expect(html).toContain("91%")
    expect(html).toContain("até a compactação automática")
    expect(html).toContain("Compacta sozinho em")
    expect(html).toContain("967.000")
    expect(html).toContain("84.475")
    expect(html).toContain("Limiar lido do próprio motor")
  })

  it("compactação automática desligada avisa que encher a janela derruba o turno", () => {
    const html = render(CLAUDE_CHEIO, leitura({ autoCompactEnabled: false, autoCompactThreshold: null }))
    expect(html).toContain("88%")
    expect(html).toContain("Desligada")
    expect(html).toContain("o turno falha")
  })

  it("falha da sonda aparece com motivo e não apaga a última leitura", () => {
    const html = render(CLAUDE_CHEIO, leitura({}, "a leitura de contexto do motor estourou o prazo de 8s"))
    expect(html).toContain("Limiar do motor não lido agora")
    expect(html).toContain("prazo de 8s")
    expect(html).toContain("967.000")
  })

  it("Codex: mede contra 244.800 calculado da configuração e do catálogo", () => {
    // gpt-6-astra real: 244.800 de 258.400 (binário 0.154.0 validado ao token).
    const html = render(
      { agent: "codex", model: "gpt-6-astra", contextBasis: "last_call", contextTokens: 230_000, contextWindow: 258_400 },
      leitura({ totalTokens: null, maxTokens: 258_400, autoCompactThreshold: 244_800, origin: "engine-config", source: "catalogo" }),
    )
    expect(html).toContain("94%")
    expect(html).toContain("244.800")
    expect(html).toContain("Calculado da configuração e do catálogo")
  })

  it("agy: percentual pela estimativa dele contra 256.000, não pela janela de 1M", () => {
    // Conversa "nuvem" real: API 248.850, estimativa do agy 244.639, limite 256.000.
    const html = render(
      { agent: "agy", model: "gemini-3.8-flash-high", contextBasis: "last_call", contextTokens: 248_850 },
      leitura({ totalTokens: null, engineEstimate: 244_639, maxTokens: null, autoCompactThreshold: 256_000, origin: "engine-record", source: "registro-da-geracao" }),
    )
    expect(html).toContain("96%")
    expect(html).toContain("Estimativa do motor")
    expect(html).toContain("244.639")
    expect(html).toContain("11.361")
    expect(html).toContain("não é contrato do motor")
    expect(html).not.toContain(">25%<")
  })
})

