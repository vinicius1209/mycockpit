import { Globe2, MonitorCog, TriangleAlert } from "lucide-react"
import { agentDef } from "@/lib/agents"
import type { ProviderMcpInventory } from "@/lib/mcp"
import {
  opaqueResourceInventoryCount,
  providerResourceObservations,
  resourceKindLabel,
  type ProviderResourceObservation,
  type ResourceKind,
} from "@/lib/resources"
import {
  toolEnforceabilityLabel,
  toolScopeLabel,
} from "@/lib/tooling"
import {
  Block,
  BlockTitle,
  Card,
  CardBody,
  CardHead,
  Selo,
} from "@/components/settings/parts"

const VISIBLE_KINDS: Exclude<ResourceKind, "project-browser">[] = [
  "external-browser",
  "desktop-control",
]

function icon(kind: Exclude<ResourceKind, "project-browser">) {
  return kind === "external-browser" ? (
    <Globe2 className="size-3.5 text-brass" />
  ) : (
    <MonitorCog className="size-3.5 text-brass" />
  )
}

function consequence(kind: Exclude<ResourceKind, "project-browser">): string {
  return kind === "external-browser"
    ? "Esta integração pode escolher perfil e janela fora da Frota. Para garantir o navegador do projeto, entregue-o por um binding MCP marcado como navegador."
    : "Esta integração pode operar apps e janelas. Como vive no provider, a Frota observa a configuração, mas não consegue conceder ou revogar por run."
}

function sourceLabel(observation: ProviderResourceObservation): string {
  return agentDef(observation.agent)?.shortLabel ?? observation.agent
}

export function ProviderResourcePanel({
  inventories,
}: {
  inventories: ProviderMcpInventory[]
}) {
  const observations = providerResourceObservations(inventories)
  const opaque = opaqueResourceInventoryCount(inventories)

  return (
    <Block>
      <BlockTitle hint="Configurações que pertencem aos providers continuam vivas fora dos bindings da Frota.">
        Fora do controle por run
      </BlockTitle>

      <div className="space-y-2">
        {VISIBLE_KINDS.map((kind) => {
          const sources = observations.filter((item) => item.kind === kind)
          if (sources.length === 0) return null
          return (
            <Card key={kind}>
              <CardHead
                nome={
                  <span className="flex items-center gap-2">
                    {icon(kind)}
                    {resourceKindLabel(kind)}
                  </span>
                }
                selo={<Selo tom="atencao">provider</Selo>}
              />
              <CardBody>
                <div className="divide-y divide-border/40">
                  {sources.map((source) => (
                    <div
                      key={`${source.agent}:${source.server}:${source.kind}`}
                      className="flex items-baseline justify-between gap-3 py-1.5 first:pt-0 last:pb-0"
                    >
                      <span className="min-w-0 truncate text-[12px] text-foreground">
                        {sourceLabel(source)} via {source.server}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {toolScopeLabel(source.scope)} ·{" "}
                        {toolEnforceabilityLabel(source.enforceability)}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[12px] leading-snug text-muted-foreground">
                  {consequence(kind)}
                </p>
              </CardBody>
            </Card>
          )
        })}

        {observations.length === 0 && (
          <Card>
            <CardBody>
              <p className="text-[12px] leading-snug text-muted-foreground">
                Nenhuma integração ativa do catálogo declarou navegador externo
                ou controle do desktop.
              </p>
            </CardBody>
          </Card>
        )}
      </div>

      {opaque > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-st-warning">
          <TriangleAlert className="mt-px size-3.5 shrink-0" />
          {opaque} {opaque === 1 ? "provider não publicou" : "providers não publicaram"}{" "}
          inventário suficiente. Ausência nesta lista não é garantia de que
          nenhum recurso será usado.
        </p>
      )}
    </Block>
  )
}
