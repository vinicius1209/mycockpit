import { Radar } from "lucide-react"
import { Card, CardBody } from "@/components/settings/parts"
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

export function ProviderMcpInventoryPanel({
  inventories,
}: {
  inventories: ProviderMcpInventory[]
}) {
  if (inventories.length === 0) return null
  return (
    <Card className="mt-3 bg-secondary/15">
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md bg-background/60">
          <Radar className="size-3.5 text-brass" />
        </span>
        <div className="min-w-0">
          <h3 className="text-[13px] font-medium text-foreground">
            Estado nos providers
          </h3>
          <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
            MCPs que já vivem no CLI ou no projeto. A Frota os mostra, mas não chama
            configuração persistente de controle por run.
          </p>
        </div>
      </div>
      <CardBody>
        <div className="divide-y divide-border/40">
          {inventories.map((inventory) => {
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
      </CardBody>
    </Card>
  )
}
