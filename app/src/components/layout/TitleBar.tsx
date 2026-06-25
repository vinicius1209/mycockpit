import { PanelLeft, PanelRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Wordmark } from "@/components/common/Wordmark"
import { StatusDot } from "@/components/common/StatusDot"
import { useApp, useActiveProject } from "@/store/app"

function InstrumentStrip() {
  const project = useActiveProject()
  return (
    <div className="hidden items-center gap-2 md:flex">
      <span className="label-mono">{project ? project.name : "sem projeto"}</span>
      <span className="text-muted-foreground/35">·</span>
      <span className="label-mono">Claude Code</span>
      <StatusDot status="idle" className="ml-0.5" />
    </div>
  )
}

export function TitleBar() {
  const project = useActiveProject()
  const toggleSidebar = useApp((s) => s.toggleSidebar)
  const toggleContext = useApp((s) => s.toggleContext)

  return (
    <header
      data-tauri-drag-region
      className="relative z-20 flex h-11 shrink-0 items-center gap-2.5 border-b bg-rail pr-2.5 pl-20"
    >
      <Wordmark className="pointer-events-none" />
      {project && (
        <>
          <span className="pointer-events-none text-muted-foreground/35">/</span>
          <span className="pointer-events-none truncate text-[13px] text-muted-foreground">
            {project.name}
          </span>
        </>
      )}

      <div className="pointer-events-none ml-auto flex items-center gap-2">
        <InstrumentStrip />
        <Separator orientation="vertical" className="h-4!" />
        <Button
          variant="ghost"
          size="icon-sm"
          className="pointer-events-auto text-muted-foreground hover:text-foreground"
          onClick={toggleSidebar}
          title="Alternar projetos"
          aria-label="Alternar projetos"
        >
          <PanelLeft className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="pointer-events-auto text-muted-foreground hover:text-foreground"
          onClick={toggleContext}
          title="Alternar contexto"
          aria-label="Alternar contexto"
        >
          <PanelRight className="size-4" />
        </Button>
      </div>
    </header>
  )
}
