import { PanelLeft, PanelRight } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Wordmark } from "@/components/common/Wordmark"
import { useApp, useActiveProject } from "@/store/app"
import { useChat } from "@/store/chat"
import { agentLabel } from "@/lib/agent"
import { cn } from "@/lib/utils"

const MODES = [
  {
    id: "linear",
    label: "Linear",
    available: true,
    desc: "Fluxo simples com um agente principal",
  },
  {
    id: "fusion",
    label: "Fusion",
    available: true,
    desc: "Vários agents respondem, um juiz compara e você confirma o vencedor",
  },
  {
    id: "sdd",
    label: "SDD",
    available: true,
    desc: "Planeje, contrate e entregue uma feature com gates de verificação",
  },
] as const

/** Seletor de modo de trabalho. Linear ativo; Fusion/SDD chegam depois. */
function ModeSwitcher() {
  const viewMode = useApp((s) => s.viewMode)
  const setViewMode = useApp((s) => s.setViewMode)
  return (
    <div className="pointer-events-auto absolute left-1/2 hidden -translate-x-1/2 items-center gap-0.5 rounded-full border bg-secondary/50 p-0.5 sm:flex">
      {MODES.map((m) => (
        <button
          key={m.id}
          disabled={!m.available}
          onClick={() => {
            if (!m.available) {
              toast(`Modo ${m.label} chega depois`)
            } else {
              setViewMode(m.id)
            }
          }}
          title={m.desc}
          className={cn(
            "flex items-center gap-1 rounded-full px-3 py-1 text-[12px] transition-colors",
            m.id === viewMode
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
  // Seletores estreitos (não `useActiveConv()` inteiro): não re-renderiza a cada
  // text_delta do run — só quando o model/agent da conversa ativa muda (F13).
  const model = useChat((s) => (s.activeId ? s.byId[s.activeId]?.model : null) ?? null)
  const agent = useChat(
    (s) => (s.activeId ? s.byId[s.activeId]?.agent : null) ?? "claude-code",
  )
  // Sem dot de status aqui — o "rodando" já aparece na sidebar (spinner por
  // conversa + dot do projeto), no botão de stop e no "… trabalhando…".
  return (
    <div className="hidden items-center gap-2 md:flex">
      <span className="label-mono">{model ?? agentLabel(agent)}</span>
    </div>
  )
}

export function TitleBar() {
  const project = useActiveProject()
  const toggleSidebar = useApp((s) => s.toggleSidebar)
  const toggleContext = useApp((s) => s.toggleContext)

  // z-[110]: ACIMA do overlay de drag que o decorum injeta (um div fixed top:0
  // height:32px z-index:100 com data-tauri-drag-region). Sem isso, esse overlay
  // cobria o topo dos botões e o clique virava drag (só a fatia abaixo de 32px
  // funcionava). Com o header acima do overlay + data-tauri-drag-region nele, o
  // drag.js do Tauri reconhece o <button> (clicável) e NÃO arrasta — o clique passa.
  return (
    <header
      data-tauri-drag-region
      className="relative z-[110] flex h-11 shrink-0 items-center gap-2.5 bg-rail pr-2.5 pl-20"
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

      <ModeSwitcher />

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
