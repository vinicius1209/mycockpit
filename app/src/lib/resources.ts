import type {
  ToolEnforceability,
  ToolScope,
} from "@/lib/tooling"
import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"

export interface OsPermissionView {
  supported: boolean
  granted: boolean
  canRequest: boolean
  label: string
}

export interface DesktopCapabilityStatus {
  platform: "macos" | "linux"
  screenRecording: OsPermissionView
  accessibility: OsPermissionView
  controllerAvailable: boolean
  detail: string
}

export async function desktopCapabilityStatus(): Promise<DesktopCapabilityStatus | null> {
  if (!isTauri()) return null
  return invoke<DesktopCapabilityStatus>("desktop_capability_status")
}

export async function requestDesktopPermission(
  kind: "screen-recording" | "accessibility",
): Promise<DesktopCapabilityStatus> {
  return invoke<DesktopCapabilityStatus>("desktop_permission_request", { kind })
}

/** Controle do computador de terceiro (`computer-use`) no cadastro de um
 *  motor: entra nos turnos por fora do pedido e do Revogar da Frota. */
export interface ExternalDesktopController {
  name: string
  enabled: boolean
  /** A Frota sabe ligar e desligar pelo CLI do motor. */
  manageable: boolean
}

export async function desktopExternalControllers(agent: string): Promise<ExternalDesktopController[]> {
  if (!isTauri()) return []
  return invoke<ExternalDesktopController[]>("desktop_external_controllers", { agent })
}

export async function setDesktopExternalEnabled(agent: string, name: string, enabled: boolean): Promise<void> {
  if (!isTauri()) return
  return invoke<void>("set_desktop_external_enabled", { agent, name, enabled })
}

export async function desktopGrantRun(runId: string): Promise<void> {
  if (!isTauri()) return
  return invoke<void>("desktop_grant_run", { runId })
}

export async function desktopRevokeRun(runId: string): Promise<void> {
  if (!isTauri()) return
  return invoke<void>("desktop_revoke_run", { runId })
}

/** A pessoa fechou o aviso de liberar o computador sem liberar (ADR-242): a
 *  tool que espera o gesto para agora, com resposta honesta. No Rust é o mesmo
 *  gesto do Revogar: "não, neste turno". */
export async function desktopRecusarPedido(runId: string): Promise<void> {
  if (!isTauri()) return
  return invoke<void>("desktop_revoke_run", { runId })
}

/** Recurso operado por uma tool. O browser do projeto é diferente de um
 * navegador que uma integração externa pode abrir por conta própria. */
export type ResourceKind =
  | "project-browser"
  | "external-browser"
  | "desktop-control"

export type ResourceOwner = "frota" | "provider"
export type ResourceEvidence =
  | "binding"
  | "integration-registry"
  | "plugin-manifest"
export type ResourceState = "ready" | "blocked"

export interface EffectiveResourceAccess {
  id: string
  label: string
  kind: ResourceKind
  owner: ResourceOwner
  scope: ToolScope
  enforceability: ToolEnforceability
  evidence: ResourceEvidence
  state: ResourceState
  via: string
}

interface ProviderResourceServerLike {
  name: string
  enabled: boolean
  scope: ToolScope
  resourceKinds: ResourceKind[]
  resourceOwner: ResourceOwner
  resourceEvidence: ResourceEvidence
}

interface ProviderResourceInventoryLike {
  agent: string
  evidence: "structured" | "summary" | "opaque" | "unavailable"
  enforceability: ToolEnforceability
  servers: ProviderResourceServerLike[]
}

export interface ProviderResourceObservation {
  agent: string
  server: string
  kind: Exclude<ResourceKind, "project-browser">
  scope: ToolScope
  enforceability: ToolEnforceability
  owner: ResourceOwner
  evidence: ResourceEvidence
}

/** Claims ativos que o catálogo reconheceu em configurações dos providers.
 * A função é estrutural e não compara provider: a classificação veio do
 * registry Rust e sobreviveria ao mesmo MCP aparecer em qualquer adapter. */
export function providerResourceObservations(
  inventories: ProviderResourceInventoryLike[],
): ProviderResourceObservation[] {
  return inventories.flatMap((inventory) =>
    inventory.servers.flatMap((server) =>
      server.enabled
        ? server.resourceKinds
            .filter(
              (kind): kind is Exclude<ResourceKind, "project-browser"> =>
                kind !== "project-browser",
            )
            .map((kind) => ({
              agent: inventory.agent,
              server: server.name,
              kind,
              scope: server.scope,
              enforceability: inventory.enforceability,
              owner: server.resourceOwner,
              evidence: server.resourceEvidence,
            }))
        : [],
    ),
  )
}

/** Quantos providers ainda podem esconder recursos por falta de inventário. */
export function opaqueResourceInventoryCount(
  inventories: ProviderResourceInventoryLike[],
): number {
  return inventories.filter(
    (inventory) =>
      inventory.evidence === "opaque" || inventory.evidence === "unavailable",
  ).length
}

const RESOURCE_LABEL: Record<ResourceKind, string> = {
  "project-browser": "Navegador do projeto",
  "external-browser": "Outro navegador",
  "desktop-control": "Controle do desktop",
}

export function resourceKindLabel(kind: ResourceKind): string {
  return RESOURCE_LABEL[kind]
}

export function resourceOwnerLabel(owner: ResourceOwner): string {
  return owner === "frota" ? "possuído pela Frota" : "possuído pelo provider"
}
