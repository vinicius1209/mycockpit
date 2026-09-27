import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, RefreshCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { BlockTitle, Card, CardBody, SectionHeader } from "@/components/settings/parts"
import {
  ProjectBrowserCard,
  useProjectBrowser,
} from "@/components/settings/ProjectBrowserCard"
import { ProviderResourcePanel } from "@/components/settings/ProviderResourcePanel"
import { EscopoDoProjeto, useProjetoDasConfiguracoes } from "@/components/settings/projetoDasConfiguracoes"
import { sectionDef } from "@/components/settings/sections"
import { useApp } from "@/store/app"
import {
  discoverMcpServers,
  type McpServer,
  type ProviderMcpInventory,
} from "@/lib/mcp"
import { cn } from "@/lib/utils"

export function LocalResourcesSettings() {
  const setSettingsOpen = useApp((state) => state.setSettingsOpen)
  // O projeto vem do seletor único do rail (ADR-268).
  const { project } = useProjetoDasConfiguracoes()

  const [servers, setServers] = useState<McpServer[]>([])
  const [inventories, setInventories] = useState<ProviderMcpInventory[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const shownPathRef = useRef<string | null>(null)
  const browser = useProjectBrowser(project?.path ?? null)

  const load = useCallback(async () => {
    const path = project?.path ?? null
    shownPathRef.current = path
    if (!path) {
      setServers([])
      setInventories([])
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const found = await discoverMcpServers(path)
      if (shownPathRef.current !== path) return
      setServers(found.servers)
      setInventories(found.providerInventories)
    } catch (cause) {
      if (shownPathRef.current === path) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (shownPathRef.current === path) setLoading(false)
    }
  }, [project])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div>
      <SectionHeader
        title={sectionDef("resources").title}
        description={sectionDef("resources").question}
        escopo={project ? <EscopoDoProjeto nome={project.name} /> : null}
        action={
          <Button
            type="button"
            size="compacto"
            variant="ghost"
            onClick={() => void load()}
            disabled={loading || !project}
          >
            <RefreshCcw className={cn("size-3.5", loading && "animate-spin")} />
            Atualizar
          </Button>
        }
      />

      {project ? (
        <>
          {loading && (
            <p className="mb-3 flex items-center gap-2 text-[12px] text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              Lendo o que o projeto tem configurado…
            </p>
          )}

          <BlockTitle hint="A Frota é dona do processo e do perfil. Quem pode usá-lo em cada turno se decide pelo MCP ligado ao motor.">
            O navegador da Frota
          </BlockTitle>
          <ProjectBrowserCard
            browser={browser}
            servers={servers}
            onConfigureDelivery={() => setSettingsOpen(true, "integrations")}
            projectPath={project?.path ?? null}
          />

          <ProviderResourcePanel inventories={inventories} />

          {error && (
            <Card className="mt-3 border-st-error/30 bg-st-error/5">
              <CardBody>
                <p className="text-[12px] text-st-error">{error}</p>
              </CardBody>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <div className="p-4 text-[13px] text-muted-foreground">
            Adicione um projeto para ter um navegador da Frota nele.
          </div>
        </Card>
      )}
    </div>
  )
}
