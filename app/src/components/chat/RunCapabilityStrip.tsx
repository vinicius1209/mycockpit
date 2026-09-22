import { useState } from "react"
import { Braces, ChevronDown } from "lucide-react"
import {
  runManifestStats,
  toolEnforceabilityLabel,
  toolScopeLabel,
  type EffectiveRunManifest,
  type EffectiveToolSource,
} from "@/lib/tooling"
import {
  resourceKindLabel,
  resourceOwnerLabel,
} from "@/lib/resources"
import { cn } from "@/lib/utils"

const TRANSPORT_LABEL = {
  native: "nativo",
  mcp: "MCP",
  cli: "CLI",
  acp: "ACP",
} as const

function inventoryLabel(source: EffectiveToolSource): string {
  if (source.observedCount != null) {
    return `${source.observedCount} ${source.observedCount === 1 ? "tool confirmada" : "tools confirmadas"}`
  }
  if (source.inventory === "runtime-count") return "aguardando handshake"
  return "inventário não observado"
}

const OMISSION_LABEL = {
  "source-missing": "não está mais configurado",
  incompatible: "não é compatível com este motor",
  "health-unavailable": "não respondeu ao teste de disponibilidade",
  "browser-offline": "navegador deste projeto desligado",
  "browser-unavailable": "navegador deste projeto indisponível",
  "browser-busy": "navegador deste projeto em uso",
  "proxy-unavailable": "rota autenticada indisponível",
  "inventory-unavailable": "inventário indisponível",
} as const

export function RunCapabilityStrip({
  manifest,
  defaultOpen = false,
}: {
  manifest?: EffectiveRunManifest
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  if (!manifest) return null

  const stats = runManifestStats(manifest)
  const instructions = manifest.instructions ?? []
  const omissions = manifest.omissions ?? []
  const summary = [
    `${stats.sourceCount} ${stats.sourceCount === 1 ? "fonte" : "fontes"}`,
    stats.instructionCount > 0
      ? `${stats.instructionCount} ${stats.instructionCount === 1 ? "instrução" : "instruções"}`
      : null,
    stats.observedTools > 0 ? `${stats.observedTools} tools confirmadas` : null,
    stats.resourceCount > 0
      ? `${stats.resourceCount} ${stats.resourceCount === 1 ? "recurso" : "recursos"}`
      : null,
    manifest.externalBrowserMcps?.length
      ? `navegador fora da Frota: ${manifest.externalBrowserMcps.join(", ")}`
      : manifest.unobservedResources
        ? "recursos do provider não observados"
        : null,
    manifest.externalDesktopMcps?.length
      ? `computador fora da Frota: ${manifest.externalDesktopMcps.join(", ")}`
      : null,
    omissions.length > 0
      ? `${omissions.length} ${omissions.length === 1 ? "capacidade não entrou" : "capacidades não entraram"}`
      : null,
    manifest.permissionOverride === "leitura" ? "Só lê neste turno" : null,
    stats.advisorySources > 0
      ? `${stats.advisorySources} ${stats.advisorySources === 1 ? "depende" : "dependem"} do provider`
      : "controle integral da Frota",
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <div className="mx-auto mb-1.5 max-w-[760px] px-8">
      <div className="overflow-hidden rounded-md border border-border/40 bg-card/40 transition-colors hover:bg-card/70">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-label="Detalhar capacidades deste run"
          className="flex min-h-6 w-full items-center gap-2 px-2 py-0.5 text-left"
        >
          <Braces className="size-3 shrink-0 text-brass" />
          <span className="shrink-0 text-[11px] font-medium text-foreground">
            Capacidades deste run
          </span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground/80">
            {summary}
          </span>
          <ChevronDown
            className={cn(
              "size-3 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
          />
        </button>

        {open && (
          <div className="border-t border-border/40 px-2.5 py-1.5">
            <div className="divide-y divide-border/40">
              {manifest.sources.map((source) => (
                <div key={source.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-1.5">
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate text-[12px] text-foreground">
                        {source.label}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                        {TRANSPORT_LABEL[source.transport]} → {toolScopeLabel(source.scope)} → {toolEnforceabilityLabel(source.enforceability)}
                      </span>
                    </div>
                    {source.toolNames.length > 0 && (
                      <div className="mt-0.5 break-words font-mono text-[11px] leading-snug text-muted-foreground/80">
                        {source.toolNames.join(" · ")}
                      </div>
                    )}
                  </div>
                  <span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                    {inventoryLabel(source)}
                  </span>
                </div>
              ))}
            </div>
            {omissions.length > 0 && (
              <div className="mt-1.5 border-t border-border/40 pt-1.5">
                <div className="label-mono mb-0.5">Fora deste turno</div>
                {omissions.map((omission) => (
                  <div
                    key={`${omission.sourceId}:${omission.code}`}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-1"
                  >
                    <span className="min-w-0 truncate text-[12px] text-foreground">
                      {omission.sourceLabel}
                    </span>
                    <span className="text-right font-mono text-[11px] text-muted-foreground">
                      {OMISSION_LABEL[omission.code]}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {instructions.length > 0 && (
              <div className="mt-1.5 border-t border-border/40 pt-1.5">
                <div className="label-mono mb-0.5">Instruções</div>
                {instructions.map((instruction) => (
                  <div
                    key={instruction.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-1"
                  >
                    <span className="min-w-0 truncate text-[12px] text-foreground">
                      {instruction.label}
                    </span>
                    <span className="whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                      {toolScopeLabel(instruction.scope)} → {toolEnforceabilityLabel(instruction.enforceability)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {(manifest.resources.length > 0 || manifest.unobservedResources) && (
              <div className="mt-1.5 border-t border-border/40 pt-1.5">
                <div className="label-mono mb-0.5">Recursos</div>
                {manifest.resources.map((resource) => (
                  <div
                    key={resource.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-1"
                  >
                    <div className="min-w-0">
                      <span className="text-[12px] text-foreground">
                        {resourceKindLabel(resource.kind)}
                      </span>
                      <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                        via {resource.via} · {resourceOwnerLabel(resource.owner)}
                      </span>
                    </div>
                    <span
                      className={cn(
                        "font-mono text-[11px]",
                        resource.state === "blocked"
                          ? "text-st-warning"
                          : "text-muted-foreground",
                      )}
                    >
                      {resource.state === "blocked" ? "bloqueado" : "pronto"}
                    </span>
                  </div>
                ))}
                {manifest.externalBrowserMcps?.length ? (
                  <p className="py-1 text-[11px] leading-snug text-st-warning">
                    Este run pode abrir um navegador fora da Frota por{" "}
                    {manifest.externalBrowserMcps.join(", ")}, configurado no
                    provider. Vincule ao navegador da Frota em Configurações
                    ou desabilite no CLI.
                  </p>
                ) : manifest.unobservedResources ? (
                  <p className="py-1 text-[11px] leading-snug text-st-warning">
                    O provider pode expor recursos por configuração própria. A
                    Frota não os enumerou nem filtrou neste run.
                  </p>
                ) : null}
                {manifest.externalDesktopMcps?.length ? (
                  <p className="py-1 text-[11px] leading-snug text-st-warning">
                    Este run pode controlar o computador por{" "}
                    {manifest.externalDesktopMcps.join(", ")}, configurado no
                    provider, sem pedido na tela e sem Revogar. Desative em
                    Configurações › Recursos locais › Controle do desktop.
                  </p>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
