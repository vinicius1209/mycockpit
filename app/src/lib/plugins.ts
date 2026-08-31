import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"
import type { ResourceKind } from "@/lib/resources"

export type PluginState = "validated" | "invalid"
export type PluginGrantStatus = "pending" | "approved" | "stale" | "disabled"
export type PluginRuntimeState =
  | "idle"
  | "starting"
  | "running"
  | "stopping"
  | "failed"

export const PLUGIN_CAPABILITIES = [
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
] as const

export type PluginCapability = (typeof PLUGIN_CAPABILITIES)[number]

export const PLUGIN_CAPABILITY_LABELS: Record<PluginCapability, string> = {
  "workspace:read": "Ler o projeto",
  "workspace:write": "Alterar o projeto",
  "process:spawn": "Iniciar processos",
  "network:connect": "Acessar a rede",
  "mcp:provide": "Fornecer MCPs",
  "tools:provide": "Fornecer tools",
  "browser:control": "Controlar o navegador do projeto",
  "desktop:control": "Controlar o desktop",
  "secrets:read": "Solicitar segredos autorizados",
  "notifications:show": "Mostrar notificações",
}

export const PLUGIN_CAPABILITY_DETAILS: Record<PluginCapability, string> = {
  "workspace:read": "Pode ler arquivos do projeto entregue à chamada.",
  "workspace:write": "Pode alterar arquivos do projeto entregue à chamada.",
  "process:spawn": "Pode iniciar processos filhos enquanto atende uma chamada.",
  "network:connect": "Pode se conectar à rede enquanto atende uma chamada.",
  "mcp:provide":
    "Publica MCPs válidos por run; stdio passa pelo launcher supervisionado da Frota.",
  "tools:provide": "Pode publicar tools revisadas no catálogo do run.",
  "browser:control":
    "Pode usar somente o Navegador do projeto já ligado, com lease por chamada.",
  "desktop:control":
    "Solicita controle do desktop; fica bloqueado até existir um broker nativo.",
  "secrets:read":
    "Solicita segredos autorizados; o host atual não entrega segredos ao worker.",
  "notifications:show":
    "Solicita notificações; o efeito depende de uma API explícita da Frota.",
}

export interface PluginContributionCounts {
  skills: number
  mcpServers: number
  tools: number
}

export interface PluginGrantView {
  status: PluginGrantStatus
  enabled: boolean
  reviewedAt: number | null
}

export interface PluginRuntimeView {
  state: PluginRuntimeState
  pid: number | null
  activeTool: string | null
  startedAt: number | null
  lastError: string | null
}

export interface PluginAuditEvent {
  event: string
  outcome: string
  detail: string | null
  createdAt: number
}

export interface PluginView {
  key: string
  name: string
  version: string | null
  state: PluginState
  executable: boolean
  capabilities: PluginCapability[]
  contributes: PluginContributionCounts
  fingerprint: string | null
  detail: string | null
  grant: PluginGrantView
  runtime: PluginRuntimeView
  activeResources: ResourceKind[]
  audit: PluginAuditEvent[]
}

export interface PluginInventory {
  manifestVersion: number
  executionSupported: boolean
  plugins: PluginView[]
  detail: string
}

export async function inspectPlugins(): Promise<PluginInventory> {
  if (!isTauri()) {
    return {
      manifestVersion: 1,
      executionSupported: false,
      plugins: [],
      detail: "O inventário de plugins só está disponível no app.",
    }
  }
  return invoke<PluginInventory>("inspect_plugins")
}

export async function approvePlugin(
  pluginKey: string,
  reviewedFingerprint: string,
): Promise<void> {
  await invoke("approve_plugin", { pluginKey, reviewedFingerprint })
}

export async function setPluginEnabled(
  pluginKey: string,
  enabled: boolean,
): Promise<void> {
  await invoke("set_plugin_enabled", { pluginKey, enabled })
}

export async function revokePluginGrant(pluginKey: string): Promise<void> {
  await invoke("revoke_plugin_grant", { pluginKey })
}

export async function stopPluginRuntime(pluginKey: string): Promise<void> {
  await invoke("stop_plugin_runtime", { pluginKey })
}

export function pluginNeedsReview(plugin: PluginView): boolean {
  return (
    plugin.state === "validated" &&
    (plugin.grant.status === "pending" || plugin.grant.status === "stale")
  )
}
