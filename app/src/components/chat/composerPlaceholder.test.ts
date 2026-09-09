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
    ).toBe("Missão em andamento; pare a missão para enviar manualmente…")
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
    ).toBe("Verificando capacidades…")
  })

  it("orienta atalhos de envio durante execução", () => {
    expect(
      composerPlaceholder({
        missionRunning: false,
        preparing: false,
        running: true,
        finalizing: false,
        hasCommands: false,
      }),
    ).toBe("Enter corrige agora · Tab envia no próximo turno…")
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
    ).toBe("Turno terminando · Tab envia assim que fechar…")
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
    ).toBe("Peça algo…  ou / para comandos")
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
    ).toBe("Peça algo ao seu time de agents…")
  })
})
