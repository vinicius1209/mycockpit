import { PanelLeft, PanelRight, Search, Settings } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import { InboxBell } from "@/components/layout/InboxBell"
import { UsagePill } from "@/components/layout/UsagePill"
import { MODES } from "@/components/layout/titleBarModes"
import { useApp, useActiveProject } from "@/store/app"
import {
  commandMenuShortcut,
  currentPlatform,
  openCommandMenu,
} from "@/lib/commandMenu"
import { cn } from "@/lib/utils"

/** Seletor de superfície (F4): Painel | Trabalho | Features. O Fusion virou o
 *  ⚔️ do composer — a disputa vive dentro da conversa, não numa superfície.
 *  Com um workspace global aberto (fora do switcher), NENHUMA aba fica
 *  ativa — marcar "Painel" seria mentir. Clicar numa aba fecha o Agendado
 *  (setViewMode já zera scheduledOpen no store) e ativa normalmente. */
function ModeSwitcher() {
  const viewMode = useApp((s) => s.viewMode)
  const setViewMode = useApp((s) => s.setViewMode)
  const scheduledOpen = useApp((s) => s.scheduledOpen)
  const flightPlansOpen = useApp((s) => s.flightPlansOpen)
  return (
    <div className="pointer-events-auto hidden items-center gap-0.5 rounded-full border bg-secondary/50 p-0.5 sm:flex">
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
            !scheduledOpen && !flightPlansOpen && m.id === viewMode
              ? "bg-card text-foreground shadow-[var(--shadow-sm)]"
              : "text-muted-foreground enabled:hover:text-foreground disabled:opacity-50",
          )}
        >
          {m.label}
          {!m.available && (
            <span className="text-[11px] tracking-wide text-muted-foreground/70">
              soon
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

/** Alvo visível do ⌘K: a paleta existia só no teclado. Não é busca nova, é a
 *  MESMA paleta (busca no histórico + comandos) por um gesto de mouse. */
function SearchChip() {
  const atalho = commandMenuShortcut(currentPlatform())
  return (
    <button
      type="button"
      onClick={openCommandMenu}
      title={`Buscar e comandos (${atalho})`}
      aria-label={`Buscar e comandos, atalho ${atalho}`}
      className="pointer-events-auto hidden items-center gap-1.5 rounded-full border bg-secondary/50 py-1 pr-1.5 pl-2.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 sm:flex"
    >
      <Search className="size-3.5" aria-hidden />
      <span className="hidden lg:inline">Buscar</span>
      <Kbd aria-hidden>{atalho}</Kbd>
    </button>
  )
}

export function TitleBar() {
  const project = useActiveProject()
  const toggleSidebar = useApp((s) => s.toggleSidebar)
  const toggleContext = useApp((s) => s.toggleContext)
  const setSettingsOpen = useApp((s) => s.setSettingsOpen)

  // z-[110]: ACIMA do overlay de drag que o decorum injeta (um div fixed top:0
  // height:32px z-index:100 com data-tauri-drag-region). Sem isso, esse overlay
  // cobria o topo dos botões e o clique virava drag (só a fatia abaixo de 32px
  // funcionava). Com o header acima do overlay + data-tauri-drag-region nele, o
  // drag.js do Tauri reconhece o <button> (clicável) e NÃO arrasta, o clique passa.
  return (
    <header
      data-tauri-drag-region
      className="relative z-[110] grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center bg-rail"
    >
      {/* Grid de 3 zonas: o seletor central fica EM FLUXO (não mais absolute) →
          o pill fica no centro exato da janela e nunca colide com o nome do
          projeto (que trunca na zona esquerda). pl-20 reserva os semáforos.
          As zonas são pointer-events-none e só os controles voltam a receber
          clique: o vazio entre eles continua sendo área de arrastar a janela.
          Cada controle mora do lado do que ele controla — o painel ESQUERDO
          abre/fecha daqui, o direito lá na ponta oposta. */}
      <div className="pointer-events-none flex min-w-0 items-center gap-1.5 pl-20">
        <Button
          variant="ghost"
          size="icon-sm"
          className="pointer-events-auto shrink-0 text-muted-foreground hover:text-foreground"
          onClick={toggleSidebar}
          title="Alternar projetos"
          aria-label="Alternar o painel de projetos"
        >
          <PanelLeft className="size-4" />
        </Button>
        {project && (
          <>
            <Separator orientation="vertical" className="h-4!" />
            {/* Nome do projeto sem prefixo do app: é o alvo de troca. Clicar
                abre a MESMA paleta ⌘K, onde mora a lista de projetos (nenhum
                switcher novo foi inventado aqui). */}
            <button
              type="button"
              onClick={openCommandMenu}
              title="Trocar de projeto"
              aria-label={`Projeto ${project.name}, trocar de projeto`}
              className="pointer-events-auto min-w-0 truncate rounded-md px-1.5 py-0.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              {project.name}
            </button>
          </>
        )}
      </div>

      <ModeSwitcher />

      <div className="pointer-events-none flex items-center justify-end gap-1.5 pr-2.5">
        {/* Medidor de janela de uso (rate limit do plano): pill agregada,
            some sozinha sem dado (4 camadas de esconder, ver UsagePill). */}
        <UsagePill />
        <SearchChip />
        <InboxBell />
        <Button
          variant="ghost"
          size="icon-sm"
          className="pointer-events-auto text-muted-foreground hover:text-foreground"
          onClick={() => setSettingsOpen(true)}
          title="Configurações"
          aria-label="Configurações"
        >
          <Settings className="size-4" />
        </Button>
        <Separator orientation="vertical" className="h-4!" />
        <Button
          variant="ghost"
          size="icon-sm"
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
