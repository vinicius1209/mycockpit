import { PanelLeft, PanelRight, Search, Settings } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Separator } from "@/components/ui/separator"
import { InboxBell } from "@/components/layout/InboxBell"
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
    // `shrink-0`: o comutador é a largura RESERVADA da barra (ver o header).
    // Quem cede espaço é o nome do projeto, nunca a navegação.
    <div className="pointer-events-auto hidden shrink-0 items-center gap-0.5 rounded-full border bg-secondary/50 p-0.5 sm:flex">
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
            // `whitespace-nowrap`: sem isso a largura MÍNIMA do comutador é a
            // do rótulo quebrado em duas linhas, e a reserva do header (que sai
            // do min-content) mediria menos do que ele ocupa de verdade.
            "flex items-center gap-1 rounded-full px-3 py-1 text-[12px] whitespace-nowrap transition-colors",
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

/** Divisor da barra — UM componente para as duas ocorrências (marca ▸ projeto e
 *  ícones globais ▸ painel direito). Existia duas vezes o mesmo JSX solto e o
 *  par lia com pesos diferentes: à direita o traço fica entre botões de ícone,
 *  que carregam 8px de respiro por dentro, e à esquerda encostava no texto (6px
 *  do gap e nada mais). O `mx-1` dá esse respiro ao traço, não ao vizinho — daí
 *  os dois passam a respirar por igual sem depender de quem está do lado. */
function BarDivider() {
  return <Separator orientation="vertical" className="mx-1 h-4!" />
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
      className="relative z-[110] flex h-14 shrink-0 items-center bg-rail"
    >
      {/* Três zonas em FLUXO (nada absolute) e o comutador centrado no VÃO,
          não na janela. Era `grid-cols-[1fr_auto_1fr]`, que centra na janela: o
          bloco da direita (Buscar + 3 ícones) é ~2x o da esquerda, e
          com o mesmo 1fr dos dois lados sobrava ar à esquerda enquanto o
          comutador quase encostava na direita. Agora a zona do meio é o vão:
          `flex-1` sem `min-w-0`, então o min-content dela É a largura do
          comutador (+ px-3 de folga), e a folga é RESERVADA — o comutador nunca
          é empurrado nem espremido.
          Ordem de quem cede, sob pressão de largura: o nome do projeto (único
          item com `min-w-0 truncate` na esquerda), e nunca a navegação.
          `pl-20` reserva os semáforos.
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
        {/* A MARCA SAIU DAQUI (build 202). O nome do app dentro da própria
            janela do app não é estado nem decisão — você sabe onde está, foi
            você que abriu — e ocupava a faixa horizontal mais cara da janela
            pra dizer o óbvio (§1 do STYLEGUIDE: o que não é estado nem decisão
            recua). O que fica é o nome do PROJETO, que é estado de verdade.
            A identidade da marca continua onde ela trabalha: ícone do app no
            Dock, na Tray e no About. */}
        {project && (
          <>
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

      <div className="pointer-events-none flex flex-1 justify-center px-3">
        <ModeSwitcher />
      </div>

      <div className="pointer-events-none flex shrink-0 items-center justify-end gap-1.5 pr-2.5">
        {/* O medidor de janela de uso DESCEU pra faixa de status (StatusBar):
            telemetria ambiente tem uma casa só, e a barra do topo fica com
            navegação e gesto. */}
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
        <BarDivider />
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
