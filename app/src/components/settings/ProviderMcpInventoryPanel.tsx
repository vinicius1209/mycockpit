import { ChevronRight } from "lucide-react"
import { Card } from "@/components/settings/parts"
import { agentDef } from "@/lib/agents"
import { type ProviderMcpInventory, type ProviderMcpServer } from "@/lib/mcp"
import { toolEnforceabilityLabel, toolScopeLabel } from "@/lib/tooling"

function serverLabel(server: ProviderMcpServer): string {
  return [
    server.name,
    server.transport,
    toolScopeLabel(server.scope),
    server.enabled ? null : "desligado",
  ]
    .filter(Boolean)
    .join(" · ")
}

function inventoryLabel(inventory: ProviderMcpInventory): string {
  if (inventory.evidence === "unavailable") return "inventário indisponível"
  if (inventory.evidence === "opaque") return "inventário não observado"
  if (inventory.servers.length === 0) {
    return `nenhum MCP ${toolScopeLabel(inventory.defaultScope)}`
  }
  const enabled = inventory.servers.filter((server) => server.enabled).length
  const disabled = inventory.servers.length - enabled
  return [
    `${enabled} ${enabled === 1 ? "MCP ativo" : "MCPs ativos"}`,
    disabled > 0 ? `${disabled} desligado${disabled === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ")
}

/** Os canais da Frota que um motor de cadastro global lista no próprio CLI
 *  (`work_gateway`, `browser_gateway`, `desktop_gateway::MCP_SERVER_NAME`).
 *  Não são MCPs da pessoa: moram na página de cada motor (ADR-268), e aqui só
 *  repetiriam a mesma coisa com outro nome. */
const CANAIS_DA_FROTA = new Set(["frota-work", "frota-browser", "frota-desktop"])

/** O inventário sem os canais da Frota. Puro. */
export function semCanaisDaFrota(inventory: ProviderMcpInventory): ProviderMcpInventory {
  return { ...inventory, servers: inventory.servers.filter((s) => !CANAIS_DA_FROTA.has(s.name)) }
}

export function ProviderMcpInventoryPanel({
  inventories,
}: {
  inventories: ProviderMcpInventory[]
}) {
  if (inventories.length === 0) return null
  // Recolhido: repete a lista de cima pelo ângulo de cada motor. Serve a quem
  // quer conferir o que o CLI de um motor tem cadastrado, não a primeira leitura.
  return (
    <Card className="mt-3">
    <details className="group">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[13px] text-foreground select-none [&::-webkit-details-marker]:hidden">
        <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
        O que cada motor tem no próprio CLI
      </summary>
      <div className="border-t border-border/40 px-3 py-2">
        <p className="mb-2 text-[12px] leading-snug text-muted-foreground">
          MCPs que já vivem no CLI ou no projeto. A Frota os mostra como estão;
          quem decide como usar é o motor.
        </p>
        <div className="divide-y divide-border/40">
          {inventories.map(semCanaisDaFrota).map((inventory) => {
            const label = agentDef(inventory.agent)?.shortLabel ?? inventory.agent
            return (
              <div
                key={inventory.agent}
                className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2 py-2 first:pt-0 last:pb-0"
              >
                <span className="truncate text-[12px] text-foreground" title={label}>
                  {label}
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-[12px] text-muted-foreground">
                      {inventoryLabel(inventory)}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground/75">
                      {toolEnforceabilityLabel(inventory.enforceability)}
                    </span>
                  </div>
                  {inventory.servers.length > 0 && (
                    <div className="mt-0.5 break-words font-mono text-[11px] leading-snug text-muted-foreground/80">
                      {inventory.servers.map(serverLabel).join("  ·  ")}
                    </div>
                  )}
                  {inventory.detail && (
                    <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground/70">
                      {inventory.detail}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </details>
    </Card>
  )
}
