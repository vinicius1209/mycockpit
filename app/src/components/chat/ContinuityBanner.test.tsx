import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { ContinuityBanner } from "@/components/chat/ContinuityBanner"
import { PENDING_DECISION } from "@/lib/attention"

const alternatives = [
  { id: "claude-code", label: "Claude Code" },
  { id: "agy", label: "Antigravity" },
  { id: "opencode", label: "OpenCode" },
]

function renderChoice(mode: "continue-now" | "next-send") {
  return renderToStaticMarkup(
    <ContinuityBanner
      state="choose"
      mode={mode}
      sourceLabel="Codex"
      resetHint="em 4d 15h"
      alternatives={alternatives}
      onSelect={() => {}}
    />,
  )
}

describe("continuidade unificada acima do composer", () => {
  it("retoma imediatamente um pedido interrompido", () => {
    const html = renderChoice("continue-now")
    expect(html).toContain("Codex parou antes de terminar")
    expect(html).toContain("pedido que ficou pendente")
    expect(html).toContain("Continuar agora no Claude Code")
    expect(html).not.toContain("próximo envio")
    expect(html).toContain('data-continuity-mode="continue-now"')
  })

  it("prepara o agente sem enviar após um turno concluído", () => {
    const html = renderChoice("next-send")
    expect(html).toContain("Codex sem cota para o próximo turno")
    expect(html).toContain("Este turno terminou normalmente")
    expect(html).toContain("Volta em 4d 15h")
    expect(html).toContain("Usar Claude Code no próximo envio")
    expect(html).toContain("sem enviar nada agora")
    expect(html).toContain('data-continuity-mode="next-send"')
  })

  it("usa um seletor neutro com os três destinos reais e um único CTA", () => {
    const html = renderChoice("next-send")
    expect(html).toContain("Claude Code")
    expect(html).toContain("Antigravity")
    expect(html).toContain("OpenCode")
    expect(html.match(/aria-pressed=/g)).toHaveLength(3)
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1)
    expect(html).toContain("bg-sel")
    expect(html).not.toContain("rounded-full")
    expect(html).not.toContain("bg-st-success")
    expect(html.match(/data-variant="default"/g)).toHaveLength(1)
    for (const part of PENDING_DECISION.split(" ")) {
      expect(html).not.toContain(part)
    }
  })

  it("explica o handoff sem afirmar que ele já foi preparado", () => {
    const html = renderChoice("continue-now")
    expect(html).toContain("O que vai junto")
    expect(html).toContain("Ao continuar, o Frota leva")
    expect(html).toContain("O pedido pendente integral")
    expect(html).not.toContain("Memória pronta")
  })

  it("absorve a retomada automática sem criar uma segunda superfície", () => {
    const html = renderToStaticMarkup(
      <ContinuityBanner
        state="choose"
        mode="continue-now"
        sourceLabel="Codex"
        resetHint={null}
        alternatives={alternatives}
        scheduledResume={{
          detail: "Retomada no Codex às 14:30 · limite de uso · tentativa 2 de 5",
          onCancel: () => {},
        }}
        onSelect={() => {}}
      />,
    )
    expect(html).toContain("Retomada no Codex às 14:30")
    expect(html).toContain("Cancelar retomada automática")
    expect(html).toContain("Aguardar Codex")
    expect(html.match(/data-continuity-state=/g)).toHaveLength(1)
  })

  it("não inventa ação quando nenhum destino é elegível", () => {
    const html = renderToStaticMarkup(
      <ContinuityBanner
        state="choose"
        mode="continue-now"
        sourceLabel="Codex"
        resetHint={null}
        alternatives={[]}
        onSelect={() => {}}
      />,
    )
    expect(html).toContain("Nenhum outro agente disponível foi confirmado")
    expect(html).not.toContain("Escolher agente de destino")
    expect(html).not.toContain("Continuar agora no")
  })

  it("mantém a troca preparada como intenção até a sessão do destino", () => {
    const html = renderToStaticMarkup(
      <ContinuityBanner
        state="staged"
        sourceLabel="Codex"
        targetLabel="Antigravity"
        onUndo={() => {}}
      />,
    )
    expect(html).toContain("Próximo envio: Antigravity")
    expect(html).toContain("Codex permanece nesta conversa")
    expect(html).toContain("até Antigravity abrir a nova sessão")
    expect(html).toContain("Desfazer")
    expect(html).toContain('data-continuity-state="staged"')
  })

  it("não permite desfazer a intenção durante um envio em voo", () => {
    const html = renderToStaticMarkup(
      <ContinuityBanner
        state="staged"
        sourceLabel="Codex"
        targetLabel="OpenCode"
        busy
        onUndo={() => {}}
      />,
    )
    expect(html).toContain("disabled")
    expect(html).toContain("Desfazer")
  })

  it("diz quanto a sessão nova leva do fio, como estimativa", () => {
    const html = renderToStaticMarkup(
      <ContinuityBanner
        state="staged"
        sourceLabel="Codex"
        targetLabel="Claude Code"
        estimativa="leva ~12 mil tokens do histórico (estimativa)"
        onUndo={() => {}}
      />,
    )
    expect(html).toContain("Sessão nova com a memória desta: leva ~12 mil tokens do histórico (estimativa).")
    expect(html).toContain("Desfazer")
  })
})
