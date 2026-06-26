import { PanelLeft, PanelRight } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Wordmark } from "@/components/common/Wordmark"
import { StatusDot } from "@/components/common/StatusDot"
import { useApp, useActiveProject } from "@/store/app"
import { useChat } from "@/store/chat"
import { cn } from "@/lib/utils"

const MODES = [
  { id: "linear", label: "Linear", available: true },
  { id: "fusion", label: "Fusion", available: false },
  { id: "sdd", label: "SDD", available: false },
] as const

/** Seletor de modo de trabalho. Linear ativo; Fusion/SDD chegam depois. */
function ModeSwitcher() {
  const active = "linear"
  return (
    <div className="pointer-events-auto absolute left-1/2 z-10 hidden -translate-x-1/2 items-center gap-0.5 rounded-full border bg-secondary/50 p-0.5 sm:flex">
      {MODES.map((m) => (
        <button
          key={m.id}
          disabled={!m.available}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => {
            if (!m.available)
              toast(`Modo ${m.label} chega depois de endurecer o Linear`)
          }}
          title={m.available ? undefined : "Em breve"}
          className={cn(
            "flex items-center gap-1 rounded-full px-3 py-1 text-[12px] transition-colors",
            m.id === active
              ? "bg-card text-foreground shadow-[var(--shadow-sm)]"
              : "text-muted-foreground enabled:hover:text-foreground disabled:opacity-50",
          )}
        >
          {m.label}
          {!m.available && (
            <span className="text-[9px] tracking-wide text-muted-foreground/60">
              soon
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

function InstrumentStrip() {
  const project = useActiveProject()
  const running = useChat((s) => s.running)
  const model = useChat((s) => s.model)
  return (
    <div className="hidden items-center gap-2 md:flex">
      <span className="label-mono">{project ? project.name : "sem projeto"}</span>
      <span className="text-muted-foreground/35">·</span>
      <span className="label-mono">{model ?? "Claude Code"}</span>
      <StatusDot status={running ? "running" : "idle"} className="ml-0.5" />
    </div>
  )
}

export function TitleBar() {
  const project = useActiveProject()
  const toggleSidebar = useApp((s) => s.toggleSidebar)
  const toggleContext = useApp((s) => s.toggleContext)

  return (
    <header className="relative z-20 flex h-11 shrink-0 items-center gap-2.5 bg-rail pr-2.5 pl-20">
      {/* Drag region só nesta camada de fundo — assim os botões (acima) não têm
          ancestral draggable e o clique neles nunca vira drag (closest() não acha). */}
      <div data-tauri-drag-region className="absolute inset-0 z-0" />
      <Wordmark className="pointer-events-none relative z-10" />
      {project && (
        <>
          <span className="pointer-events-none relative z-10 text-muted-foreground/35">
            /
          </span>
          <span className="pointer-events-none relative z-10 truncate text-[13px] text-muted-foreground">
            {project.name}
          </span>
        </>
      )}

      <ModeSwitcher />

      <div className="pointer-events-none relative z-10 ml-auto flex items-center gap-2">
        <InstrumentStrip />
        <Separator orientation="vertical" className="h-4!" />
        <Button
          variant="ghost"
          size="icon-sm"
          className="pointer-events-auto text-muted-foreground hover:text-foreground"
          onPointerDown={(e) => {
            e.stopPropagation()
            toggleSidebar()
          }}
          title="Alternar projetos"
          aria-label="Alternar projetos"
        >
          <PanelLeft className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="pointer-events-auto text-muted-foreground hover:text-foreground"
          onPointerDown={(e) => {
            e.stopPropagation()
            toggleContext()
          }}
          title="Alternar contexto"
          aria-label="Alternar contexto"
        >
          <PanelRight className="size-4" />
        </Button>
      </div>
    </header>
  )
}
