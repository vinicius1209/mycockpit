/** Domínio de tools da Frota. MCP é um materializador, não a entidade central. */
export type ToolTransport = "native" | "mcp" | "cli" | "acp"
export type ToolScope = "run" | "project" | "user" | "global"
export type ToolEnforceability = "hard" | "advisory"
export type ToolInventoryEvidence =
  | "declared"
  | "runtime-count"
  | "probe"
  | "opaque"
export type ToolMaterializerKind =
  | "provider-native"
  | "frota-gateway"
  | "external-mcp"
export type AgentMcpScope = ToolScope | "none"

export type McpPlanIssueCode =
  | "source-missing"
  | "incompatible"
  | "health-unavailable"
  | "browser-offline"
  | "browser-unavailable"
  | "browser-busy"
  | "proxy-unavailable"
  | "inventory-unavailable"

export type McpPlanDisposition =
  | "omitted"
  | "needs-decision"
  | "blocked-by-policy"
  | "needs-readonly-consent"

export interface McpPlanIssue {
  sourceId: string
  sourceLabel: string
  code: McpPlanIssueCode
  disposition: McpPlanDisposition
  detail: string | null
}

export type McpRecoveryKind =
  | "start-project-browser"
  | "open-mcp-settings"
  | "omit-for-this-run"
  | "retry-readonly"

export interface McpRecovery {
  kind: McpRecoveryKind
  sourceId: string | null
}

export interface McpRunOverride {
  gateFingerprint: string
  sourceId: string
  kind: "omit-for-this-run" | "retry-readonly"
}

export interface McpPreflightGate {
  fingerprint: string
  issues: McpPlanIssue[]
  allowedRecoveries: McpRecovery[]
}

export interface EffectiveCapabilityOmission {
  sourceId: string
  sourceLabel: string
  code: McpPlanIssueCode
  detail: string | null
}

export type InstructionSourceKind = "plugin-skill"

/** Claim interno enviado de volta ao runner. O backend reabre o pacote e
 * confirma fingerprint + contribuição antes de registrar a origem no run. */
export interface InstructionSourceClaim {
  kind: InstructionSourceKind
  pluginKey: string
  fingerprint: string
  contributionId: string
  invocation: string
}

/** Instrução que o runner confirmou como parte do prompt efetivo. */
export interface EffectiveInstructionSource {
  id: string
  label: string
  kind: InstructionSourceKind
  scope: ToolScope
  enforceability: ToolEnforceability
  invocation: string
}

export interface AgentToolingCaps {
  mcpScope: AgentMcpScope
  nativeToolInventory: ToolInventoryEvidence
}

export interface ToolMaterializerDef {
  kind: ToolMaterializerKind
  transport: ToolTransport
  scope: ToolScope
  enforceability: ToolEnforceability
  inventory: ToolInventoryEvidence
  filtersPerRun: boolean
}

/** Snapshot sanitizado do que uma fonte efetivamente entregou ao run. */
export interface EffectiveToolSource extends ToolMaterializerDef {
  id: string
  label: string
  toolNames: string[]
  /** `null` é desconhecido/ainda não publicado, nunca zero inventado. */
  observedCount: number | null
}

export interface EffectiveRunManifest {
  schemaVersion: number
  agentId: string
  managedExternalMcp: boolean
  sources: EffectiveToolSource[]
  /** Ausente em manifests v3 persistidos antes das skills contribuídas. */
  instructions?: EffectiveInstructionSource[]
  resources: import("@/lib/resources").EffectiveResourceAccess[]
  unobservedResources: boolean
  /** MCPs de navegador de terceiro que a config do provider deixa entrar num
   *  run sem binding (ADR-224 §2). Ausente em manifests até v6. */
  externalBrowserMcps?: string[]
  notices: string[]
  /** Ausente em manifests anteriores ao preflight tipado. */
  omissions?: EffectiveCapabilityOmission[]
  /** Redução de permissão aceita explicitamente só para este turno. */
  permissionOverride?: "leitura" | null
  /** Descoberta nativa usada pelo preflight; ausente em manifests até v5. */
  inventoryCache?: Array<{
    source: string
    state: "hit" | "miss" | "shared" | "bypass"
    checkedAt: number | null
  }>
  /** Compatibilidade de leitura com manifests v4. Manifests novos não bloqueiam. */
  blocked?: string | null
}

/** O manifesto nasce antes do processo; providers que publicam a contagem no
 * handshake completam a fonte nativa quando o evento `session` chega. */
export function withObservedNativeToolCount(
  manifest: EffectiveRunManifest,
  count: number,
): EffectiveRunManifest {
  let changed = false
  const sources = manifest.sources.map((source) => {
    if (
      source.kind !== "provider-native" ||
      source.inventory !== "runtime-count" ||
      source.observedCount === count
    ) {
      return source
    }
    changed = true
    return { ...source, observedCount: count }
  })
  return changed ? { ...manifest, sources } : manifest
}

export interface RunManifestStats {
  sourceCount: number
  instructionCount: number
  observedTools: number
  advisorySources: number
  unresolvedSources: number
  resourceCount: number
  blockedResources: number
}

export function runManifestStats(
  manifest: EffectiveRunManifest,
): RunManifestStats {
  const sourceStats = manifest.sources.reduce<
    Omit<
      RunManifestStats,
      "instructionCount" | "resourceCount" | "blockedResources"
    >
  >(
    (stats, source) => ({
      sourceCount: stats.sourceCount + 1,
      observedTools: stats.observedTools + (source.observedCount ?? 0),
      advisorySources:
        stats.advisorySources + (source.enforceability === "advisory" ? 1 : 0),
      unresolvedSources:
        stats.unresolvedSources + (source.observedCount == null ? 1 : 0),
    }),
    {
      sourceCount: 0,
      observedTools: 0,
      advisorySources: 0,
      unresolvedSources: 0,
    },
  )
  return {
    ...sourceStats,
    instructionCount: manifest.instructions?.length ?? 0,
    resourceCount: manifest.resources.length,
    blockedResources: manifest.resources.filter(
      (resource) => resource.state === "blocked",
    ).length,
  }
}

/** Espelho de `Capabilities::tool_materializers` no Rust. Mantê-lo puro deixa
 * a UI explicar a força do controle sem comparar ids de provider. */
export function toolMaterializers(
  caps: AgentToolingCaps,
): ToolMaterializerDef[] {
  const out: ToolMaterializerDef[] = [
    {
      kind: "provider-native",
      transport: "native",
      scope: "run",
      enforceability: "advisory",
      inventory: caps.nativeToolInventory,
      filtersPerRun: false,
    },
  ]
  if (caps.mcpScope !== "none") {
    const hard = caps.mcpScope === "run"
    out.push({
      kind: "external-mcp",
      transport: "mcp",
      scope: caps.mcpScope,
      enforceability: hard ? "hard" : "advisory",
      inventory: "probe",
      filtersPerRun: hard,
    })
  }
  return out
}

const SCOPE_LABEL: Record<ToolScope, string> = {
  run: "neste run",
  project: "neste projeto",
  user: "neste usuário",
  global: "em toda a máquina",
}

export function toolScopeLabel(scope: ToolScope): string {
  return SCOPE_LABEL[scope]
}

export function toolEnforceabilityLabel(
  value: ToolEnforceability,
): string {
  return value === "hard" ? "controlado pela Frota" : "depende do provider"
}
