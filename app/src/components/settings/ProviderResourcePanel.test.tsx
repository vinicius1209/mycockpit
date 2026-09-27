import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import type { ProviderMcpInventory } from "@/lib/mcp"
import { ProviderResourcePanel } from "./ProviderResourcePanel"

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
]

describe("ProviderResourcePanel", () => {
  it("separa navegador externo de controle do desktop e declara a força", () => {
    const html = renderToStaticMarkup(
      createElement(ProviderResourcePanel, { inventories }),
    )
    expect(html).toContain("Outro navegador")
    expect(html).toContain("Controle do desktop")
    expect(html).toContain("agy via playwright")
    expect(html).toContain("agy via computer-use")
    expect(html).toContain("o motor decide")
    expect(html).toContain("não consegue conceder ou revogar por run")
  })

  it("fonte opaca impede promessa de ausência", () => {
    const html = renderToStaticMarkup(
      createElement(ProviderResourcePanel, {
        inventories: [
          {
            agent: "engine-futuro",
            evidence: "opaque",
            enforceability: "advisory",
            defaultScope: "run",
            detail: null,
            servers: [],
          },
        ],
      }),
    )
    expect(html).toContain("Ausência nesta lista não é garantia")
  })
})
