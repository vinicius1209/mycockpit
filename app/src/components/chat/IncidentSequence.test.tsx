import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { IncidentSequence } from "@/components/chat/IncidentSequence"
import type { IncidentNode } from "@/components/chat/messageNodes"

function renderIncident(incident: IncidentNode) {
  return renderToStaticMarkup(
    createElement(IncidentSequence, {
      incident,
    }),
  )
}

describe("sequência de incidente", () => {
  it("renderiza o limite como três fatos E0 com um único marcador âmbar", () => {
    const html = renderIncident({
      type: "incident",
      key: "r1",
      severity: "limit",
      message: "You've hit your session limit",
      resetHint: "1:50pm (America/Sao_Paulo)",
      details: ["You've hit your session limit"],
      result: {
        kind: "result",
        id: "r1",
        ok: false,
        durationMs: 121_000,
        costUsd: 35.16,
      },
    })

    expect(html).toContain("Sessão em intervalo")
    expect(html).toContain("Turno encerrado")
    expect(html).toContain("Conversa preservada")
    expect(html).toContain("Retorno informado")
    expect(html).toContain("13:50 · horário de São Paulo")
    expect(html.match(/bg-st-warning/g)).toHaveLength(1)
    expect(html).not.toContain("border-st-warning/40 bg-st-warning/10")
    expect(html).not.toContain("rounded-lg border")
    expect(html).toContain("@min-[560px]:grid-cols-3")
    expect(html).toContain("<ol")
    expect(html).toContain("<details")
    expect(html).not.toContain("<details open")
    expect(html).toContain("Detalhes técnicos")
    expect(html).toContain("2min 01s")
    expect(html).toContain("US$ 35,16")
  })

  it("reserva um único marcador vermelho para falha real", () => {
    const html = renderIncident({
      type: "incident",
      key: "e1",
      severity: "error",
      message: "invalid transport",
      details: ["invalid transport"],
    })

    expect(html).toContain("Execução interrompida")
    expect(html).toContain("Motivo registrado")
    expect(html.match(/bg-st-error/g)).toHaveLength(1)
    expect(html).not.toContain("bg-st-error/[0.07]")
  })

  it("registra o incidente sem repetir a decisão de continuidade", () => {
    const html = renderIncident({
      type: "incident",
      key: "e1",
      severity: "error",
      message: "invalid transport",
      details: ["invalid transport"],
    })
    expect(html).toContain("Detalhes técnicos")
    expect(html).not.toContain("Continuar com outro agente")
    expect(html).not.toContain("Continuar no ")
  })
})
