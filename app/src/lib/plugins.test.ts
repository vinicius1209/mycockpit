import { describe, expect, it } from "vitest"
import {
  PLUGIN_CAPABILITIES,
  PLUGIN_CAPABILITY_DETAILS,
  PLUGIN_CAPABILITY_LABELS,
  pluginNeedsReview,
  type PluginView,
} from "@/lib/plugins"

function plugin(status: PluginView["grant"]["status"]): PluginView {
  return {
    key: "acme.quality",
    name: "Quality",
    version: "1.0.0",
    state: "validated",
    executable: true,
    capabilities: ["tools:provide"],
    contributes: { skills: 0, mcpServers: 0, tools: 1 },
    fingerprint: "abc123",
    detail: null,
    grant: { status, enabled: status === "approved", reviewedAt: null },
    runtime: {
      state: "idle",
      pid: null,
      activeTool: null,
      startedAt: null,
      lastError: null,
    },
    activeResources: [],
    audit: [],
  }
}

describe("contrato de plugins", () => {
  it("espelha o conjunto fechado de capabilities do manifesto Rust", () => {
    expect([...PLUGIN_CAPABILITIES]).toEqual([
      "workspace:read",
      "workspace:write",
      "process:spawn",
      "network:connect",
      "mcp:provide",
      "tools:provide",
      "browser:control",
      "desktop:control",
      "secrets:read",
      "notifications:show",
    ])
    expect(Object.keys(PLUGIN_CAPABILITY_LABELS).sort()).toEqual(
      [...PLUGIN_CAPABILITIES].sort(),
    )
    expect(Object.keys(PLUGIN_CAPABILITY_DETAILS).sort()).toEqual(
      [...PLUGIN_CAPABILITIES].sort(),
    )
  })

  it("pede revisão só para pacote válido sem grant atual", () => {
    expect(pluginNeedsReview(plugin("pending"))).toBe(true)
    expect(pluginNeedsReview(plugin("stale"))).toBe(true)
    expect(pluginNeedsReview(plugin("approved"))).toBe(false)
    expect(pluginNeedsReview(plugin("disabled"))).toBe(false)

    expect(
      pluginNeedsReview({ ...plugin("pending"), state: "invalid" }),
    ).toBe(false)
  })
})
