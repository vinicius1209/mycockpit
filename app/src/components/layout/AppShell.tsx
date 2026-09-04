// O ESQUELETO da janela: sidebar · conteúdo · painel direito, e as alças entre
// eles. Saiu do `App.tsx` (que ficou com boot, efeitos globais e hosts) porque
// ele estava no teto da catraca do §10 e a regra é dividir, nunca subir o teto.
// O corte é natural: aqui só mora layout, e é aqui que a Fase 3 do ADR-043
// mexeu (o inset de 8px). Estado vem do store, então não há prop drilling.
import { lazy, Suspense } from "react"
import { Sidebar } from "@/components/layout/Sidebar"
import { ContextPanel } from "@/components/layout/ContextPanel"
import { MainTabs } from "@/components/layout/MainTabs"
import { DiffTab } from "@/components/layout/DiffTab"
import { FileTab } from "@/components/layout/FileTab"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { MissionControl } from "@/components/panel/MissionControl"
import { SddView } from "@/components/sdd/SddView"
import { ScheduledView } from "@/components/scheduled/ScheduledView"
import { FleetView } from "@/components/fleet/FleetView"
import { BranchSplitView } from "@/components/layout/BranchSplitView"
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

/**
 * Caixa de UMA superfície dentro do cartão do centro. Constante, e não a
 * string repetida em cada host, porque as quatro partes têm que estar juntas —
 * e faltar UMA quebrou o app no build #241.
 *
 * `flex flex-col` é o que costuma ser esquecido: sem ele o filho que se declara
 * `flex-1` não é item de flex nenhum, o `flex-1` vira inerte, a altura dele
 * passa a ser a do CONTEÚDO, e o diff de 1.400 linhas vaza pra fora do host.
 * O cartão até esconde o vazamento, mas ele deixa cartão e painel `#main` com
 * `scrollHeight > clientHeight` — ou seja, roláveis por script. Aí bastou um
 * `scrollIntoView` pra empurrar a janela inteira pra fora da vista, sem barra
 * nenhuma pra trazer de volta (`overflow: hidden` esconde a barra, não impede
 * o scroll programático).
 */
export const HOST_SUPERFICIE = "flex min-h-0 flex-1 flex-col"

export function AppShell() {
  const sidebarOpen = useApp((s) => s.sidebarOpen)
  const contextOpen = useApp((s) => s.contextOpen)
  const viewMode = useApp((s) => s.viewMode)
  const mainTab = useApp((s) => s.mainTab)
  const branchSplitOpen = useApp((s) => s.branchSplitOpen)
  const openDiffTab = useApp((s) => s.openDiffTab)
  const closeMainTab = useApp((s) => s.closeMainTab)
  const scheduledOpen = useApp((s) => s.scheduledOpen)
  const flightPlansOpen = useApp((s) => s.flightPlansOpen)
  const fleetOpen = useApp((s) => s.fleetOpen)
  const coberto = scheduledOpen || flightPlansOpen || fleetOpen
  // As views que COBREM o centro. Extraídas pra variável porque agora precisam
  // de uma caixa `flex-1` própria: o cartão virou coluna flex (a tira de abas
  // mora nele), e nesse regime um filho sem `flex-1` cresce até a altura do
  // conteúdo e vaza pra fora — foi exatamente o bug do build #241.
  const cobertura = flightPlansOpen ? (
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
  ) : null

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
      <ResizablePanel
        id="main"
        defaultSize="81%"
        minSize="40%"
      >
        <div className="relative h-full overflow-clip pt-2 pr-2">
          {/* `react-resizable-panels` injeta `overflow:hidden` inline. Hidden
              ainda é scroll container: no #242 o WebView rolou ESTE grupo sem
              barra e levou centro + contexto juntos, deixando o vazio abaixo.
              `clip` é a fronteira correta — corta overflow e nem aceita
              `scrollTop`. O `!` vence o inline da biblioteca. */}
          <ResizablePanelGroup
            orientation="horizontal"
            className="h-full !overflow-clip"
          >
            <ResizablePanel id="chat" defaultSize="70%" minSize="42%">
              <div
                // Alvo do e2e que mede o vazamento do #241 (layout-cartao.spec).
                data-testid="cartao-centro"
                // Fronteira de colisão da gaveta de notas (frente N, N1): o
                // popover do chip "Notas" pode flutuar sobre o FIO (custo
                // assumido do desenho A), mas não sobre o painel direito. Este
                // cartão é exatamente "tudo menos o painel", e é a única fonte
                // honesta da largura: o painel é redimensionável, então
                // constante nenhuma serviria (é a mesma lição da frente R —
                // mede-se o CONTÊINER, nunca o viewport).
                data-notes-boundary=""
                // `clip` e não `hidden` pela regra do esqueleto (index.css): moldura
                // corta, nunca rola. `hidden` aceitaria `scrollTop` e deixaria a
                // tira de abas ser empurrada pra fora por um scroll de dentro.
                className="flex h-full flex-col overflow-clip rounded-xl border bg-background shadow-[var(--shadow-pop)]"
              >
                {/* Tira de abas do Trabalho (F1.1). Conversa é a âncora fixa e
                    hospeda o + de ações; Alterações entra e sai sem levar a
                    navegação junto. `viewMode` ainda decide, senão a tira
                    apareceria por cima do Painel e das Features. */}
                {viewMode === "linear" && !coberto && (
                  <MainTabs
                    tab={mainTab}
                    onSelect={(kind) => {
                      if (kind === "diff") openDiffTab(undefined)
                      else if (kind === "conversa") closeMainTab()
                    }}
                    onClose={() => closeMainTab()}
                  />
                )}
                {/* F7: as views globais (Agendado, Planos de voo, Frota) cobrem o
                    conteúdo via estado próprio — o switcher de superfícies fica como está.
                    Painel e Trabalho ficam SEMPRE MONTADOS (toggle por CSS):
                    desmontar/remontar a árvore do chat (markdown gigante) a
                    cada troca de aba travava o main thread — o memo dos itens
                    não sobrevive a remount. SDD/Agendado seguem condicionais
                    (menos frequentes, e o SddView recarrega planos ao montar
                    de propósito). */}
                <div
                  className={cn(
                    HOST_SUPERFICIE,
                    (coberto || viewMode !== "painel") && "hidden",
                  )}
                >
                  <MissionControl />
                </div>
                {/* A aba de diff entra na MESMA regra do parágrafo acima: some
                    por CSS, nunca por desmontagem. Trocar de aba e voltar tem
                    que devolver o fio no mesmo scroll e o composer com o mesmo
                    rascunho — remontar perderia os dois, além de travar. */}
                <div
                  className={cn(
                    HOST_SUPERFICIE,
                    (coberto ||
                      viewMode !== "linear" ||
                      mainTab.kind !== "conversa" ||
                      branchSplitOpen) &&
                      "hidden",
                  )}
                >
                  <ChatPanel />
                </div>
                {viewMode === "linear" &&
                  !coberto &&
                  mainTab.kind === "conversa" &&
                  branchSplitOpen && (
                    <div className={HOST_SUPERFICIE}>
                      <BranchSplitView />
                    </div>
                  )}
                {viewMode === "linear" && !coberto && mainTab.kind === "diff" && (
                  <div className={HOST_SUPERFICIE}>
                    <DiffTab focusPath={mainTab.focusPath} focusSeq={mainTab.focusSeq} />
                  </div>
                )}
                {viewMode === "linear" && !coberto && mainTab.kind === "arquivo" && (
                  <div className={HOST_SUPERFICIE}>
                    <FileTab path={mainTab.path} />
                  </div>
                )}
                {cobertura && (
                  <div className={HOST_SUPERFICIE}>{cobertura}</div>
                )}
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
