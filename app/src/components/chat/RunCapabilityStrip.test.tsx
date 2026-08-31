import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { RunCapabilityStrip } from "@/components/chat/RunCapabilityStrip"
import type { EffectiveRunManifest } from "@/lib/tooling"

const manifest: EffectiveRunManifest = {
  schemaVersion: 4,
  agentId: "engine",
  managedExternalMcp: true,
  instructions: [
    {
      id: "plugin-skill:acme.quality:review",
      label: "Quality · /acme.quality:review",
      kind: "plugin-skill",
      scope: "user",
      enforceability: "hard",
      invocation: "acme.quality:review",
    },
  ],
  notices: [],
  blocked: null,
  sources: [
    {
      id: "provider-native",
      label: "Tools nativas do provider",
      kind: "provider-native",
      transport: "native",
      scope: "run",
      enforceability: "advisory",
      inventory: "runtime-count",
      filtersPerRun: false,
      toolNames: [],
      observedCount: 12,
    },
    {
      id: "mc-work",
      label: "Trabalho e processos",
      kind: "frota-gateway",
      transport: "mcp",
      scope: "run",
      enforceability: "hard",
      inventory: "declared",
      filtersPerRun: true,
      toolNames: ["process_start", "work_plan"],
      observedCount: 2,
    },
  ],
  resources: [
    {
      id: "project-browser:playwright",
      label: "Navegador do projeto",
      kind: "project-browser",
      owner: "frota",
      scope: "project",
      enforceability: "hard",
      evidence: "binding",
      state: "ready",
      via: "playwright",
    },
  ],
  unobservedResources: false,
}

describe("RunCapabilityStrip", () => {
  it("resume controle e revela a cadeia efetiva sem esconder o provider", () => {
    const collapsed = renderToStaticMarkup(
      createElement(RunCapabilityStrip, { manifest }),
    )
    expect(collapsed).toContain(
      "2 fontes · 1 instrução · 14 tools confirmadas · 1 recurso · 1 depende do provider",
    )
    expect(collapsed).not.toContain("process_start · work_plan")

    const open = renderToStaticMarkup(
      createElement(RunCapabilityStrip, { manifest, defaultOpen: true }),
    )
    expect(open).toContain("process_start · work_plan")
    expect(open).toContain("MCP → neste run → controlado pela Frota")
    expect(open).toContain("Navegador do projeto")
    expect(open).toContain("via playwright · possuído pela Frota")
    expect(open).toContain("Quality · /acme.quality:review")
    expect(open).toContain("neste usuário → controlado pela Frota")
  })

  it("não transforma superfície opaca do provider em lista vazia segura", () => {
    const html = renderToStaticMarkup(
      createElement(RunCapabilityStrip, {
        manifest: { ...manifest, resources: [], unobservedResources: true },
        defaultOpen: true,
      }),
    )
    expect(html).toContain("recursos do provider não observados")
    expect(html).toContain("não os enumerou nem filtrou neste run")
  })
})
