import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, RefreshCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PillSelect } from "@/components/ui/PillSelect"
import { BlockTitle, Card, CardBody, SectionHeader } from "@/components/settings/parts"
import {
  ProjectBrowserCard,
  useProjectBrowser,
} from "@/components/settings/ProjectBrowserCard"
import { ProviderResourcePanel } from "@/components/settings/ProviderResourcePanel"
import { DesktopResourceCard } from "@/components/settings/DesktopResourceCard"
import { useApp } from "@/store/app"
import {
  discoverMcpServers,
  initialMcpProjectId,
  type McpServer,
  type ProviderMcpInventory,
} from "@/lib/mcp"
import { cn } from "@/lib/utils"

export function LocalResourcesSettings() {
  const projects = useApp((state) => state.projects)
  const activeProjectId = useApp((state) => state.activeProjectId)
  const setSettingsOpen = useApp((state) => state.setSettingsOpen)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const project = useMemo(() => {
    const id =
      selectedProjectId && projects.some((item) => item.id === selectedProjectId)
        ? selectedProjectId
        : initialMcpProjectId(projects, activeProjectId)
    return projects.find((item) => item.id === id) ?? null
  }, [activeProjectId, projects, selectedProjectId])

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
        title="Navegador e desktop"
        description="Quais recursos locais podem ser operados, quem os possui e se a Frota consegue controlá-los por run."
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
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-medium text-foreground">Projeto:</span>
            <PillSelect
              value={project.id}
              onValueChange={setSelectedProjectId}
              options={projects.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
              triggerClassName="h-7 gap-1.5 px-2.5 text-[12px] text-foreground"
              title="Escopo deste painel; não muda o projeto ativo do app"
              aria-label="Projeto dos recursos locais"
            />
            {loading && (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            )}
          </div>

          <BlockTitle hint="Processo, perfil e endpoint pertencem à Frota; o binding decide qual run recebe o acesso.">
            Possuído pela Frota
          </BlockTitle>
          <ProjectBrowserCard
            browser={browser}
            servers={servers}
            onConfigureDelivery={() => setSettingsOpen(true, "integrations")}
            projectPath={project?.path ?? null}
          />

          <div className="mt-5">
            <BlockTitle hint="O sistema concede permissões à Frota; acesso para agents continua bloqueado até existir materialização forte por run.">
              Permissões do computador
            </BlockTitle>
            <DesktopResourceCard />
          </div>

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
            Adicione um projeto para inspecionar seus recursos locais.
          </div>
        </Card>
      )}
    </div>
  )
}
