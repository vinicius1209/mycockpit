// Fixture: o manifesto do teste da faixa antiga (RunCapabilityStrip.test.tsx),
// com as exceções que ele cobria. As invariantes dele seguem valendo aqui.
import { describe, expect, it } from "vitest"
import type { EffectiveRunManifest } from "@/lib/tooling"
import { excecoesDoTurno } from "./excecoesDoTurno"

const manifest: EffectiveRunManifest = {
  schemaVersion: 5,
  agentId: "engine",
  managedExternalMcp: true,
  notices: [],
  omissions: [],
  sources: [
    {
      id: "provider-native", label: "Tools nativas do provider", kind: "provider-native",
      transport: "native", scope: "run", enforceability: "advisory", inventory: "runtime-count",
      filtersPerRun: false, toolNames: [], observedCount: 12,
    },
  ],
  resources: [],
  unobservedResources: false,
}

describe("exceções do turno", () => {
  it("turno sem exceção: nada a mostrar, nem mesmo com superfície opaca do motor", () => {
    expect(excecoesDoTurno(manifest, "Claude Code")).toEqual([])
    expect(excecoesDoTurno({ ...manifest, unobservedResources: true }, "Claude Code")).toEqual([])
    expect(excecoesDoTurno(undefined, "Claude Code")).toEqual([])
  })

  it("navegador de terceiro sai com NOME e o caminho de volta (ADR-224)", () => {
    const [e] = excecoesDoTurno({ ...manifest, externalBrowserMcps: ["playwright"] }, "Antigravity")
    expect(e.texto).toBe("Este turno pode abrir um navegador fora da Frota, pelo playwright.")
    expect(e.detalhe).toContain("Vincule ao navegador da Frota")
    expect(e.detalhe).toContain("Antigravity")
    expect(e.acao).toMatchObject({ tipo: "configuracoes", secao: "integrations" })
  })

  it("controle do computador de terceiro sai com NOME e diz onde desativar (ADR-225)", () => {
    const [e] = excecoesDoTurno({ ...manifest, externalDesktopMcps: ["computer-use"] }, "Claude Code")
    expect(e.texto).toContain("controlar o computador fora da Frota, pelo computer-use")
    expect(e.detalhe).toContain("sem Revogar")
    // ADR-268: o controle de terceiro mora na página do motor, que é quem o tem.
    expect(e.detalhe).toContain("Configurações › Motores › Claude Code")
    expect(e.acao).toEqual({ tipo: "configuracoes", rotulo: "Configurar", secao: "motor:engine" })
  })

  it("motor sem o acompanhamento diz o que falta e leva ao gesto na página dele (ADR-268)", () => {
    const [e] = excecoesDoTurno({ ...manifest, missingFrotaChannels: ["work"] }, "Antigravity")
    expect(e.id).toBe("sem-acompanhamento")
    expect(e.texto).toBe("O Antigravity não está conectado ao acompanhamento da Frota.")
    expect(e.detalhe).toContain("título automático")
    expect(e.acao).toEqual({ tipo: "configuracoes", rotulo: "Conectar", secao: "motor:engine" })
    // Canal desconhecido não vira exceção: o front só fala do que conhece.
    expect(excecoesDoTurno({ ...manifest, missingFrotaChannels: ["outro"] }, "Antigravity")).toEqual([])
  })

  it("capacidade que não entrou diz qual, por quê, e o gesto quando há", () => {
    const [e] = excecoesDoTurno(
      {
        ...manifest,
        omissions: [{ sourceId: "playwright", sourceLabel: "Playwright", code: "browser-offline", detail: "o navegador deste projeto está desligado" }],
      },
      "Claude Code",
    )
    expect(e.texto).toBe("Playwright não entrou neste turno.")
    expect(e.detalhe).toBe("Navegador deste projeto desligado.")
    expect(e.acao).toEqual({ tipo: "ligar-navegador", rotulo: "Ligar" })
  })

  it("com o navegador da Frota no turno, o MCP vinculado desligado não vira faixa (24/09/2026)", () => {
    const comNavegador: EffectiveRunManifest = {
      ...manifest,
      sources: [
        ...manifest.sources,
        // a forma de `run_manifest::gateway` para o navegador da Frota
        {
          id: "frota-browser", label: "Navegador da Frota", kind: "frota-gateway",
          transport: "mcp", scope: "run", enforceability: "hard", inventory: "declared",
          filtersPerRun: true, toolNames: ["browser_status", "browser_navigate"], observedCount: 2,
        },
      ],
      omissions: [
        { sourceId: "playwright", sourceLabel: "playwright", code: "browser-offline", detail: "o navegador deste projeto está desligado" },
        // outro motivo de ausência continua sendo exceção
        { sourceId: "figma", sourceLabel: "figma", code: "health-unavailable", detail: null },
      ],
    }
    const excecoes = excecoesDoTurno(comNavegador, "Claude Code")
    expect(excecoes.map((e) => e.texto)).toEqual(["figma não entrou neste turno."])
  })

  it("expõe o modo somente leitura aceito para este turno", () => {
    expect(excecoesDoTurno({ ...manifest, permissionOverride: "leitura" }, "Codex")[0].texto).toBe("Só lê neste turno.")
  })

  it("mais de uma exceção: uma por linha, sem travessão", () => {
    const todas = excecoesDoTurno(
      { ...manifest, externalBrowserMcps: ["playwright"], permissionOverride: "leitura" },
      "Claude Code",
    )
    expect(todas.map((e) => e.id)).toEqual(["navegador-de-terceiro", "so-leitura"])
    expect(JSON.stringify(todas)).not.toContain("—")
  })
})
