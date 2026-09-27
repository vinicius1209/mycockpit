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

/** A consequência diz o gesto que TEM efeito no motor (ADR-224 §4): binding
 *  só existe em motor por run; nos outros, o caminho é desabilitar no CLI ou
 *  conectar o frota-browser. Mandar o agy "vincular binding" era pedir um
 *  gesto que não existe. Puro. */
export function consequence(
  kind: Exclude<ResourceKind, "project-browser">,
  agents: readonly string[] = [],
): string {
  if (kind !== "external-browser") {
    return "Esta integração pode operar apps e janelas. Como vive no provider, a Frota observa a configuração, mas não consegue conceder ou revogar por run."
  }
  const semBinding = agents.some((id) => agentDef(id)?.mcpEscopo !== "por-run")
  return semBinding
    ? "Esta integração abre o próprio navegador, fora da Frota. Neste motor a Frota não vincula MCP por projeto: desabilite-a no CLI ou conecte o navegador da Frota na página do motor, em Motores."
    : "Esta integração pode escolher perfil e janela fora da Frota. Para garantir o navegador do projeto, entregue-a por um binding MCP marcado como navegador."
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
      <BlockTitle hint="Vêm da configuração de cada motor e seguem valendo por fora do pedido e do Revogar da Frota.">
        De fora da Frota
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
                selo={<Selo tom="atencao">do motor</Selo>}
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
                  {consequence(kind, sources.map((source) => source.agent))}
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
          {opaque} {opaque === 1 ? "motor não publicou" : "motores não publicaram"}{" "}
          inventário suficiente. Ausência nesta lista não é garantia de que
          nenhum recurso será usado.
        </p>
      )}
    </Block>
  )
}
