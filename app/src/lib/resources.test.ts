import { describe, expect, it } from "vitest"
import {
  opaqueResourceInventoryCount,
  providerResourceObservations,
} from "@/lib/resources"

describe("recursos observados nos providers", () => {
  it("usa claims do catálogo sem comparar id de provider", () => {
    const inventories = ["engine-a", "engine-b"].map((agent) => ({
      agent,
      evidence: "structured" as const,
      enforceability: "advisory" as const,
      servers: [
        {
          name: "playwright",
          enabled: true,
          scope: "user" as const,
          resourceKinds: ["external-browser" as const],
          resourceOwner: "provider" as const,
          resourceEvidence: "integration-registry" as const,
        },
      ],
    }))
    expect(providerResourceObservations(inventories)).toEqual([
      {
        agent: "engine-a",
        server: "playwright",
        kind: "external-browser",
        scope: "user",
        enforceability: "advisory",
        owner: "provider",
        evidence: "integration-registry",
      },
      {
        agent: "engine-b",
        server: "playwright",
        kind: "external-browser",
        scope: "user",
        enforceability: "advisory",
        owner: "provider",
        evidence: "integration-registry",
      },
    ])
  })

  it("não conta integração desativada como acesso efetivo", () => {
    expect(
      providerResourceObservations([
        {
          agent: "engine",
          evidence: "summary",
          enforceability: "advisory",
          servers: [
            {
              name: "computer-use",
              enabled: false,
              scope: "global",
              resourceKinds: ["desktop-control"],
              resourceOwner: "provider",
              resourceEvidence: "integration-registry",
            },
          ],
        },
      ]),
    ).toEqual([])
  })

  it("mantém explícito quando o inventário não prova ausência", () => {
    expect(
      opaqueResourceInventoryCount([
        {
          agent: "engine-a",
          evidence: "opaque",
          enforceability: "advisory",
          servers: [],
        },
        {
          agent: "engine-b",
          evidence: "unavailable",
          enforceability: "advisory",
          servers: [],
        },
      ]),
    ).toBe(2)
  })
})
