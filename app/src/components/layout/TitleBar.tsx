import { ChevronsUpDown, PanelLeft, PanelRight, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import { InboxBell } from "@/components/layout/InboxBell"
import { useApp, useActiveProject } from "@/store/app"
import {
  commandMenuShortcut,
  currentPlatform,
  openCommandMenu,
} from "@/lib/commandMenu"

export function TitleBar() {
  const project = useActiveProject()
  const toggleSidebar = useApp((s) => s.toggleSidebar)
  const toggleContext = useApp((s) => s.toggleContext)
  const atalho = commandMenuShortcut(currentPlatform())
  return (
    // Acima do overlay de drag do decorum; só controles recebem ponteiro.
    <header
      data-tauri-drag-region
      className="relative z-[110] flex h-14 shrink-0 items-center bg-rail"
    >
      <div className="pointer-events-none flex min-w-0 items-center gap-1.5 pl-20">
        <Button
          variant="ghost"
          size="icone-padrao"
          className="pointer-events-auto shrink-0 text-muted-foreground hover:text-foreground"
          onClick={toggleSidebar}
          title="Alternar projetos"
          aria-label="Alternar o painel de projetos"
        >
          <PanelLeft className="size-4" />
        </Button>
        {project && (
          <Button
            variant="ghost"
            size="compacto"
            onClick={openCommandMenu}
            title="Trocar de projeto"
            aria-label={`Projeto ${project.name}, trocar de projeto`}
            className="pointer-events-auto min-w-0 shrink font-medium"
          >
            <span data-project-name className="truncate">
              {project.name}
            </span>
            <ChevronsUpDown className="size-3 shrink-0 text-faint" />
          </Button>
        )}
      </div>
      {/* Centrado no vão. Reserva 440px mais as folgas; o projeto cede primeiro. */}
      <div className="pointer-events-none flex flex-1 justify-center px-3">
        <Button
          data-testid="centro-de-comando"
          variant="outline"
          size="compacto"
          onClick={openCommandMenu}
          title={`Buscar e comandos (${atalho})`}
          aria-label={`Buscar e comandos, atalho ${atalho}`}
          className="pointer-events-auto w-[440px] shrink-0 justify-start bg-secondary/50 font-normal text-muted-foreground shadow-none"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">
            Buscar{project ? ` em ${project.name}` : ""}: conversas, projetos e
            comandos
          </span>
          <Kbd aria-hidden>{atalho}</Kbd>
        </Button>
      </div>
      <div className="pointer-events-none flex shrink-0 items-center justify-end gap-1.5 pr-2.5">
        <InboxBell />
        <Separator orientation="vertical" className="mx-1 h-4!" />
        <Button
          variant="ghost"
          size="icone-padrao"
          className="pointer-events-auto text-muted-foreground hover:text-foreground"
          onClick={toggleContext}
          title="Alternar contexto"
          aria-label="Alternar o painel de contexto"
        >
          <PanelRight className="size-4" />
        </Button>
      </div>
    </header>
  )
}
