import { describe, expect, it } from "vitest"
import {
  formatIncidentReset,
  incidentPresentation,
} from "@/components/chat/incidentPresentation"
import type { IncidentNode } from "@/components/chat/messageNodes"

function incident(
  severity: IncidentNode["severity"],
  resetHint?: string,
): IncidentNode {
  return {
    type: "incident",
    key: "incidente-real",
    severity,
    message: "causa preservada",
    resetHint,
    details: ["causa preservada"],
  }
}

describe("apresentação factual do incidente", () => {
  it("humaniza o relógio real do limite sem declarar disponibilidade", () => {
    const view = incidentPresentation(
      incident("limit", "1:50pm (America/Sao_Paulo)"),
    )

    expect(view.title).toBe("Sessão em intervalo")
    expect(view.stages.map((stage) => stage.title)).toEqual([
      "Turno encerrado",
      "Conversa preservada",
      "Retorno informado",
    ])
    expect(view.stages[2].meta).toBe("13:50 · horário de São Paulo")
    expect(JSON.stringify(view)).not.toMatch(/agora|disponível/i)
  })

  it("não inventa horário quando o agente não informou retorno", () => {
    const view = incidentPresentation(incident("limit"))

    expect(view.stages[2]).toMatchObject({
      title: "Retorno não informado",
      description:
        "O agente não informou quando a sessão poderá continuar.",
    })
    expect(view.stages[2].meta).toBeUndefined()
  })

  it("preserva um hint desconhecido em vez de reinterpretá-lo", () => {
    expect(formatIncidentReset("reset after administrator review")).toBe(
      "reset after administrator review",
    )
  })

  it("mantém a falha real distinta e aponta para a causa auditável", () => {
    const view = incidentPresentation(incident("error"))

    expect(view).toMatchObject({
      severity: "error",
      title: "Execução interrompida",
    })
    expect(view.stages.map((stage) => stage.title)).toEqual([
      "Turno encerrado",
      "Conversa preservada",
      "Motivo registrado",
    ])
    expect(JSON.stringify(view)).not.toMatch(/agora|disponível/i)
  })
})
