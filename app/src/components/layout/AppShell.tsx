// O ESQUELETO da janela: sidebar · conteúdo · painel direito, e as alças entre
// eles. Saiu do `App.tsx` (que ficou com boot, efeitos globais e hosts) porque
// ele estava no teto da catraca do §10 e a regra é dividir, nunca subir o teto.
// O corte é natural: aqui só mora layout, e é aqui que a Fase 3 do ADR-043
// mexeu (o inset de 8px). Estado vem do store, então não há prop drilling.
import { lazy, Suspense } from "react"
import { Sidebar } from "@/components/layout/Sidebar"
import { ContextPanel } from "@/components/layout/ContextPanel"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { MissionControl } from "@/components/panel/MissionControl"
import { SddView } from "@/components/sdd/SddView"
import { ScheduledView } from "@/components/scheduled/ScheduledView"
import { FleetView } from "@/components/fleet/FleetView"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { addProjectViaDialog } from "@/lib/projects"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"

const FlightPlansView = lazy(() =>
  import("@/components/mission/FlightPlansView").then((module) => ({
    default: module.FlightPlansView,
  })),
)

/** Alça de arrastar como VÃO, não como traço: o espaço já separa, e a alça só
 *  se pinta enquanto você a usa. Brass saiu daqui porque brass é gesto, não
 *  borda de arrastar (ADR-043). */
const HANDLE =
  "w-2 bg-transparent transition-colors after:w-4 data-[resize-handle-state=hover]:bg-border/50 data-[resize-handle-state=drag]:bg-border/70"

export function AppShell() {
  const sidebarOpen = useApp((s) => s.sidebarOpen)
  const contextOpen = useApp((s) => s.contextOpen)
  const viewMode = useApp((s) => s.viewMode)
  const scheduledOpen = useApp((s) => s.scheduledOpen)
  const flightPlansOpen = useApp((s) => s.flightPlansOpen)
  const fleetOpen = useApp((s) => s.fleetOpen)
  const coberto = scheduledOpen || flightPlansOpen || fleetOpen

  return (
    // `pb-2`: o INSET de 8px do conteúdo (ADR-043, Fase 3). Vale pras DUAS
    // colunas, não só pro cartão — a sidebar encostava na faixa de status, e o
    // que separa as duas agora é este vão, não um hairline. É ele também que
    // deixa 8px de rail entre o conteúdo e o arco da janela.
    <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1 pb-2">
      {sidebarOpen && (
        <>
          <ResizablePanel
            id="sidebar"
            defaultSize="19%"
            minSize="190px"
            maxSize="32%"
          >
            <Sidebar onAddProject={() => void addProjectViaDialog()} />
          </ResizablePanel>
          <ResizableHandle className={HANDLE} />
        </>
      )}
      {/* Conteúdo: dois cartões IRMÃOS flutuando no rail, com um vão de 8px
          entre eles (o da direita mora no ContextPanel, E1) — antes era um
          cartão só com um hairline no meio. */}
      <ResizablePanel id="main" defaultSize="81%" minSize="40%">
        <div className="relative h-full pt-2 pr-2">
          <ResizablePanelGroup orientation="horizontal" className="h-full">
            <ResizablePanel id="chat" defaultSize="70%" minSize="42%">
              <div className="h-full overflow-hidden rounded-xl border bg-background shadow-[var(--shadow-pop)]">
                {/* F7: as views globais (Agendado, Planos de voo, Frota) cobrem o
                    conteúdo via estado próprio — o switcher de superfícies fica como está.
                    Painel e Trabalho ficam SEMPRE MONTADOS (toggle por CSS):
                    desmontar/remontar a árvore do chat (markdown gigante) a
                    cada troca de aba travava o main thread — o memo dos itens
                    não sobrevive a remount. SDD/Agendado seguem condicionais
                    (menos frequentes, e o SddView recarrega planos ao montar
                    de propósito). */}
                <div
                  className={cn("h-full", (coberto || viewMode !== "painel") && "hidden")}
                >
                  <MissionControl />
                </div>
                <div
                  className={cn("h-full", (coberto || viewMode !== "linear") && "hidden")}
                >
                  <ChatPanel />
                </div>
                {flightPlansOpen ? (
                  <Suspense
                    fallback={
                      <div className="grid h-full place-items-center text-[12px] text-muted-foreground">
                        Preparando a prancheta…
                      </div>
                    }
                  >
                    <FlightPlansView />
                  </Suspense>
                ) : scheduledOpen ? (
                  <ScheduledView />
                ) : fleetOpen ? (
                  <FleetView />
                ) : viewMode === "sdd" ? (
                  <SddView />
                ) : null}
              </div>
            </ResizablePanel>
            {contextOpen && viewMode === "linear" && !coberto && (
              <>
                <ResizableHandle className={HANDLE} />
                <ResizablePanel
                  id="context"
                  defaultSize="30%"
                  minSize="240px"
                  maxSize="42%"
                >
                  <ContextPanel />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  )
}
