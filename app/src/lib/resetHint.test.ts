import { describe, expect, it } from "vitest"
import {
  formatIncidentReset,
  formatResetBrief,
  formatResetSentence,
  parseClockHint,
} from "./resetHint"

describe("parseClockHint", () => {
  it("extrai horário de 12h sem minutos (o caso real do incidente: 2pm)", () => {
    expect(parseClockHint("2pm (America/Sao_Paulo)")).toEqual({
      time: "14:00",
      zoneLabel: "horário de São Paulo",
    })
  })

  it("extrai horário de 12h com minutos", () => {
    expect(parseClockHint("1:50pm (America/Sao_Paulo)")).toEqual({
      time: "13:50",
      zoneLabel: "horário de São Paulo",
    })
    expect(parseClockHint("9:15am")).toEqual({
      time: "09:15",
      zoneLabel: undefined,
    })
  })

  it("trata meia-noite e meio-dia em 12h", () => {
    expect(parseClockHint("12pm")).toEqual({ time: "12:00", zoneLabel: undefined })
    expect(parseClockHint("12am")).toEqual({ time: "00:00", zoneLabel: undefined })
  })

  it("extrai horário em 24h", () => {
    expect(parseClockHint("14:30 (America/Sao_Paulo)")).toEqual({
      time: "14:30",
      zoneLabel: "horário de São Paulo",
    })
  })

  it("ignora prefixos como reset at", () => {
    expect(parseClockHint("resets at 2pm (America/Sao_Paulo)")).toEqual({
      time: "14:00",
      zoneLabel: "horário de São Paulo",
    })
  })

  it("retorna null para durações relativas ou textos genéricos", () => {
    expect(parseClockHint("60s")).toBeNull()
    expect(parseClockHint("reseta em 2h")).toBeNull()
    expect(parseClockHint("reset after review")).toBeNull()
  })
})

describe("formatIncidentReset", () => {
  it("humaniza relógio civil com fuso em pt-BR", () => {
    expect(formatIncidentReset("2pm (America/Sao_Paulo)")).toBe(
      "14:00 · horário de São Paulo",
    )
    expect(formatIncidentReset("1:50pm (America/Sao_Paulo)")).toBe(
      "13:50 · horário de São Paulo",
    )
  })

  it("preserva texto sem relógio íntegro", () => {
    expect(formatIncidentReset("reset after administrator review")).toBe(
      "reset after administrator review",
    )
  })
})

describe("formatResetSentence", () => {
  it("monta frase em pt-BR para relógio com fuso", () => {
    expect(formatResetSentence("2pm (America/Sao_Paulo)")).toBe(
      "Volta às 14:00 (horário de São Paulo).",
    )
  })

  it("monta frase para duração relativa", () => {
    expect(formatResetSentence("reseta em 2h")).toBe("Reseta em 2h.")
    expect(formatResetSentence("em 4d 15h")).toBe("Volta em 4d 15h.")
  })

  it("trata 100% e ausência de horário", () => {
    expect(formatResetSentence("100%")).toBe("A leitura mais recente chegou a 100%.")
    expect(formatResetSentence(null)).toBe("O horário de retorno ainda não foi informado.")
    expect(formatResetSentence("")).toBe("O horário de retorno ainda não foi informado.")
  })
})

describe("formatResetBrief", () => {
  it("monta versão curta para tooltips e badges", () => {
    expect(formatResetBrief("2pm (America/Sao_Paulo)")).toBe("volta às 14:00")
    expect(formatResetBrief("reseta em 2h")).toBe("reseta em 2h")
    expect(formatResetBrief(null)).toBeNull()
  })
})
