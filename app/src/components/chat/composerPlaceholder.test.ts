import { describe, expect, it } from "vitest"
import { composerPlaceholder } from "@/components/chat/composerPlaceholder"

describe("composerPlaceholder", () => {
  it("prioriza missão em andamento", () => {
    expect(
      composerPlaceholder({
        missionRunning: true,
        preparing: true,
        running: true,
        finalizing: true,
        hasCommands: true,
      }),
    ).toBe("Missão em andamento; pare a missão para enviar")
  })

  it("indica preparação quando preparando", () => {
    expect(
      composerPlaceholder({
        missionRunning: false,
        preparing: true,
        running: false,
        finalizing: false,
        hasCommands: true,
      }),
    ).toBe("Verificando capacidades")
  })

  it("durante a execução, diz as duas saídas sem atalho em prosa", () => {
    expect(
      composerPlaceholder({
        missionRunning: false,
        preparing: false,
        running: true,
        finalizing: false,
        hasCommands: false,
      }),
    ).toBe("Corrigir agora ou deixar para depois")
  })

  it("orienta finalização do turno", () => {
    expect(
      composerPlaceholder({
        missionRunning: false,
        preparing: false,
        running: false,
        finalizing: true,
        hasCommands: false,
      }),
    ).toBe("Turno terminando; o que você escrever vai quando fechar")
  })

  it("mostra dica de comandos quando houver comandos disponíveis", () => {
    expect(
      composerPlaceholder({
        missionRunning: false,
        preparing: false,
        running: false,
        finalizing: false,
        hasCommands: true,
      }),
    ).toBe("Peça algo ao seu time")
  })

  it("retorna texto padrão quando ocioso sem comandos", () => {
    expect(
      composerPlaceholder({
        missionRunning: false,
        preparing: false,
        running: false,
        finalizing: false,
        hasCommands: false,
      }),
    ).toBe("Peça algo ao seu time")
  })
})
