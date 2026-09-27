import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ProviderMcpInventoryPanel, semCanaisDaFrota } from "./ProviderMcpInventoryPanel"
import type { ProviderMcpInventory } from "@/lib/mcp"

const inventories: ProviderMcpInventory[] = [
  {
    agent: "agy",
    evidence: "summary",
    enforceability: "advisory",
    defaultScope: "global",
    detail: "Resumo do CLI",
    servers: [
      {
        name: "computer-use",
        enabled: true,
        transport: "stdio",
        scope: "global",
        resourceKinds: ["desktop-control"],
        resourceOwner: "provider",
        resourceEvidence: "integration-registry",
      },
      {
        name: "playwright",
        enabled: true,
        transport: "stdio",
        scope: "global",
        resourceKinds: ["external-browser"],
        resourceOwner: "provider",
        resourceEvidence: "integration-registry",
      },
    ],
  },
  {
    agent: "opencode",
    evidence: "structured",
    enforceability: "advisory",
    defaultScope: "project",
    detail: null,
    servers: [],
  },
]

describe("ProviderMcpInventoryPanel", () => {
  it("mostra estado persistente sem fingir controle por run", () => {
    const html = renderToStaticMarkup(
      createElement(ProviderMcpInventoryPanel, { inventories }),
    )
    expect(html).toContain("2 MCPs ativos")
    expect(html).toContain("computer-use · stdio · em toda a máquina")
    expect(html).toContain("nenhum MCP neste projeto")
    expect(html).toContain("o motor decide")
    expect(html).not.toContain("Instalar")
  })

  it("os canais da Frota no CLI de um motor não aparecem como MCP da pessoa (ADR-268)", () => {
    const comCanais: ProviderMcpInventory = {
      ...inventories[0],
      servers: [
        ...inventories[0].servers,
        { ...inventories[0].servers[0], name: "frota-work" },
        { ...inventories[0].servers[0], name: "frota-browser" },
        { ...inventories[0].servers[0], name: "frota-desktop" },
      ],
    }
    expect(semCanaisDaFrota(comCanais).servers.map((s) => s.name)).toEqual(["computer-use", "playwright"])
    const html = renderToStaticMarkup(
      createElement(ProviderMcpInventoryPanel, { inventories: [comCanais] }),
    )
    expect(html).not.toContain("frota-work")
    expect(html).toContain("2 MCPs ativos")
  })
})
