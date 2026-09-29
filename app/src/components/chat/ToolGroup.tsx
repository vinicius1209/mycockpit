// O GRUPO de ações do fio (cabeçalho + árvore) e a lista de nós. Saiu do
// MessageList junto com a `ToolLine` (catraca de tamanho). A árvore desenha o
// trilho com cotovelo (ADR-241): a hierarquia vem do traço, não de recuo solto.
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { ChevronRight } from "lucide-react"
import { ToolGroupStatus } from "@/components/chat/statusGlyphs"
import { ActivityAge } from "@/components/chat/LiveTime"
import { editHunks } from "@/components/chat/InlineDiff"
import type { ToolItem } from "@/components/chat/messageNodes"
import {
  branchContains,
  branchHasFailure,
  branchHasLiveDeferred,
  branchSize,
  buildToolForest,
  NO_NAMED_WORK,
  type ToolTreeNode,
} from "@/components/chat/toolTree"
import {
  bornOpen,
  settledOkStubLabel,
  shouldAutoCollapseOnSettle,
} from "@/components/chat/toolGroupDisclosure"
import { ToolLine } from "@/components/chat/ToolLine"
import { controle } from "@/components/ui/controle"
import { fmtDuration } from "@/lib/format"
import { atrasosDaCascata } from "@/lib/nascimento"
import { describeToolGroup, summarizeToolGroup } from "@/lib/toolGroup"
import { cn } from "@/lib/utils"

/** Ancestral rolável do fio (o ChatPanel usa um div `overflow-x-hidden
 *  overflow-y-auto`; por isso a checagem olha SÓ o overflowY computado — o
 *  hidden do eixo X não interfere). null em testes/SSR: sem scroll não há
 *  leitor pra perder o tapete, o recolhimento segue o default. */
function scrollContainerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (p.scrollHeight > p.clientHeight + 1) {
      const overflowY = getComputedStyle(p).overflowY
      if (overflowY === "auto" || overflowY === "scroll") return p
    }
  }
  return null
}

/** Durante o voo, ações já resolvidas viram um único registro recolhido e só o
 * ramo ativo permanece exposto. Num grupo ASSENTADO com falha, a linha falhada
 * fica exposta (a falha não se esconde) e as concluídas viram o stub
 * "N concluídas · mostrar" (mock B ③/④). Aberto, cada shell/arquivo volta a
 * ser navegável individualmente pelas setas. */
export function ToolNodeList({
  nodes,
  activeToolId,
  agent,
  depth,
  parentId,
  live,
  deferredPending,
  namedWork,
  onStop,
  onRetry,
}: {
  nodes: ToolTreeNode[]
  activeToolId?: string | null
  agent: string
  depth: number
  parentId?: string
  live: boolean
  deferredPending?: boolean
  /** Trabalhos cujo nome já foi mostrado acima — repassado INTEGRALMENTE a cada
   *  filho (e daí pra baixo pela ToolLine): a posse não para num nível. */
  namedWork?: ReadonlySet<string>
  onStop?: (tool: ToolItem) => void
  onRetry?: (tool: ToolItem) => void
  onApprovePlan?: (id: string) => void
}) {
  const [historyOpen, setHistoryOpen] = useState(false)
  const activeNodes = live
    ? nodes.filter(
        (node) =>
          branchContains(node, activeToolId) ||
          node.item.managedProcess?.status === "running" ||
          node.item.managedProcess?.status === "stopping" ||
          branchHasLiveDeferred(node),
      )
    : []
  const settledNodes = nodes.filter((node) => !activeNodes.includes(node))
  // Ramo com falha fica EXPOSTO; só as concluídas se recolhem atrás do stub.
  // A culpada rende ANTES do stub mesmo quando cronologicamente veio depois
  // das ok (decisão do mock B ③: quem expandiu quer a falha, não a linha do
  // tempo — a cronologia completa volta ao abrir o stub).
  const failedNodes = settledNodes.filter(branchHasFailure)
  const okNodes = settledNodes.filter((node) => !failedNodes.includes(node))
  // Em voo, recolhe só com nó ATIVO; sem nó ativo, todas rendem direto (sem acordeão duplo).
  const foldOk = live
    ? okNodes.length >= 2 && activeNodes.length > 0
    : failedNodes.length > 0 && okNodes.length >= 1
  const summary = summarizeToolGroup(
    okNodes.map((node) => node.item),
    false,
  )
  const okCount = okNodes.reduce((acc, node) => acc + branchSize(node), 0)
  const historyId = `history:${parentId ?? "root"}:${depth}`
  // Ações pedidas juntas entram uma a uma (ADR-290). Calculado na ordem em
  // que nasceram, não na de exibição: a cascata conta a chegada.
  const atrasos = useMemo(() => {
    const porLinha = atrasosDaCascata(nodes.map((node) => node.item.ts))
    return new Map(nodes.map((node, i) => [node.item.id, porLinha[i]]))
  }, [nodes])

  const renderNode = (node: ToolTreeNode) => (
    <ToolLine
      key={node.item.id}
      node={node}
      atraso={atrasos.get(node.item.id)}
      activeToolId={activeToolId}
      agent={agent}
      depth={depth}
      deferredPending={deferredPending}
      namedWork={namedWork}
      onStop={onStop}
      onRetry={onRetry}
    />
  )

  if (!foldOk) {
    return (
      <div role="group" className="fio-trilho">
        {nodes.map(renderNode)}
      </div>
    )
  }

  return (
    <div role="group" className="fio-trilho">
      {failedNodes.map(renderNode)}
      <button
        type="button"
        onClick={() => setHistoryOpen((value) => !value)}
        data-work-node
        data-node-id={historyId}
        data-parent-id={parentId}
        role="treeitem"
        aria-level={depth}
        aria-expanded={historyOpen}
        tabIndex={-1}
        className="group/history flex w-full items-center gap-2.5 rounded-md px-2 py-[5px] text-left text-[12px] text-muted-foreground/75 transition-colors hover:bg-accent/35 hover:text-foreground"
      >
        {live ? (
          <>
            <span className="grid size-3.5 shrink-0 place-items-center">
              <ToolGroupStatus state={summary.state} />
            </span>
            <span className="truncate">{summary.label}</span>
            <ChevronRight
              className={cn(
                "ml-auto size-3 text-muted-foreground/40 transition-transform group-hover/history:text-muted-foreground/70",
                historyOpen && "rotate-90",
              )}
            />
          </>
        ) : (
          // stub quieto do grupo falhado: as ok existiram, mas não pagam o
          // pato — visíveis só a pedido (o verbo é o affordance, sem chevron).
          <span className="truncate underline-offset-4 group-hover/history:underline">
            {settledOkStubLabel(okCount, historyOpen)}
          </span>
        )}
      </button>
      {historyOpen && (
        // As concluídas entram no MESMO trilho (sem caixa própria): cada uma
        // ganha o seu cotovelo, e a árvore continua uma só.
        <>{okNodes.map(renderNode)}</>
      )}
      {activeNodes.map(renderNode)}
    </div>
  )
}


/** Registro de voo: UMA caption por burst — e, assentado, UMA linha por grupo:
 * o resumo é a informação (contagem, duração congelada, culpada na falha); o
 * detalhe fica a um clique. `memo` só vale porque `tools` chega com identidade
 * preservada (`reuseNodes`) e `onStop`/`onRetry` estáveis (`useStableHandler`)
 * — sem os dois, o `memo` seria decoração, o defeito já diagnosticado antes. */
export const ToolGroup = memo(function ToolGroup({
  tools,
  active = false,
  agent,
  stalledSince,
  onStop,
  onRetry,
}: {
  tools: ToolItem[]
  /** turno rodando E este é o grupo corrente → o passo sem result "roda". */
  active?: boolean
  agent: string
  stalledSince?: number
  onStop?: (tool: ToolItem) => void
  onRetry?: (tool: ToolItem) => void
  onApprovePlan?: (id: string) => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const manuallyToggled = useRef(false)
  // Compensação anti-salto: quando o auto-recolhimento atinge um grupo ACIMA
  // da viewport, o conteúdo de cima encolhe e o texto que o leitor está lendo
  // pularia (WKWebView não tem overflow-anchor; o autoscroll do ChatPanel só
  // compensa quem está no fundo). Guarda o container + a altura pré-colapso e
  // o layout effect abaixo desconta a diferença do scrollTop ANTES do paint.
  const scrollComp = useRef<{ container: HTMLElement; height: number } | null>(
    null,
  )
  const processLive = tools.some(
    (tool) =>
      tool.managedProcess?.status === "running" ||
      tool.managedProcess?.status === "stopping",
  )
  // Trabalho diferido VIVO mantém o grupo aceso (D1.2): ele roda dentro do CLI
  // mesmo com o texto do turno já parado.
  const deferredLive = tools.some(
    (tool) => tool.deferred?.status === "running",
  )
  const live = active || processLive || deferredLive
  const forest = useMemo(() => buildToolForest(tools), [tools])
  const activeToolId = live
    ? [...tools]
        .reverse()
        .find(
          (tool) =>
            !tool.result ||
            tool.managedProcess?.status === "running" ||
            tool.managedProcess?.status === "stopping" ||
            tool.deferred?.status === "running",
        )?.id ?? null
    : null
  // Entre tool_result e tool_use o turno vive, mas não há atividade presente.
  const executing = live && activeToolId != null
  const wasActive = useRef(executing)
  // Digest do cabeçalho numa passada só, memoizado por grupo: este é o
  // componente mais quente do app — nada de varredura extra por render.
  const digest = useMemo(() => describeToolGroup(tools, live && activeToolId != null), [tools, live, activeToolId])
  // O cabeçalho é o primeiro dono do nome: a entidade que o `digest.label`
  // apresenta já está nomeada quando a árvore abre (e a posse desce daí).
  const namedWork = useMemo(
    () =>
      digest.labelWorkId
        ? (new Set([digest.labelWorkId]) as ReadonlySet<string>)
        : NO_NAMED_WORK,
    [digest.labelWorkId],
  )
  const failedInGroup = digest.failed > 0
  // Só atividade PRESENTE e falha nascem abertas (toolGroupDisclosure.ts).
  const [open, setOpen] = useState(() =>
    bornOpen({ live: executing, failed: failedInGroup }),
  )
  const lastActivity = tools.reduce(
    (latest, tool) =>
      Math.max(
        latest,
        tool.managedProcess?.updatedAt ?? tool.activityAt ?? tool.ts ?? 0,
      ),
    0,
  )
  const diffTotal = useMemo(
    () =>
      tools.reduce(
        (acc, t) => {
          const d = editHunks(t.name, (t.input ?? {}) as Record<string, unknown>)
          if (d) {
            acc.added += d.added
            acc.removed += d.removed
          }
          return acc
        },
        { added: 0, removed: 0 },
      ),
    [tools],
  )

  // Atividade presente abre; ao terminar, recolhe sem contrariar toggle,
  // falha ou leitor desancorado (regra exata em toolGroupDisclosure.ts).
  useEffect(() => {
    if (executing && !manuallyToggled.current) setOpen(true)
    if (wasActive.current && !executing) {
      const el = rootRef.current
      const container = el ? scrollContainerOf(el) : null
      const rect = el?.getBoundingClientRect()
      const crect = container?.getBoundingClientRect()
      const groupInViewport =
        rect != null &&
        crect != null &&
        rect.bottom > crect.top &&
        rect.top < crect.bottom
      // A intenção vem do mesmo dono do autoscroll; reflow não vira gesto.
      const followingBottom = container?.dataset.threadFollowing !== "false"
      if (
        shouldAutoCollapseOnSettle({
          manuallyToggled: manuallyToggled.current,
          failed: failedInGroup,
          groupInViewport,
          followingBottom,
        })
      ) {
        // Grupo inteiramente ACIMA da viewport: arma a compensação de scroll
        // (o leitor está lendo abaixo dele; sem isso o texto salta).
        if (el && container && rect != null && crect != null && rect.bottom <= crect.top) {
          scrollComp.current = { container, height: rect.height }
        }
        setOpen(false)
      }
    }
    wasActive.current = executing
  }, [executing, failedInGroup])

  // Aplica a compensação no MESMO frame do colapso (antes do paint): desconta
  // do scrollTop exatamente o quanto o grupo encolheu, e o que o leitor vê não
  // se move. Só roda quando o auto-recolhimento acima da viewport a armou.
  useLayoutEffect(() => {
    if (open || !scrollComp.current) return
    const { container, height } = scrollComp.current
    scrollComp.current = null
    const newHeight = rootRef.current?.getBoundingClientRect().height ?? 0
    const delta = height - newHeight
    if (delta > 0) container.scrollTop = Math.max(0, container.scrollTop - delta)
  }, [open])

  function onTreeKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const target = (e.target as HTMLElement).closest<HTMLElement>(
      "[data-work-root], [data-work-node]",
    )
    if (!target) return
    const focusables = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>(
        "[data-work-root], [data-work-node]",
      ),
    ).filter((el) => el.offsetParent !== null)
    const index = focusables.indexOf(target)
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const delta = e.key === "ArrowDown" ? 1 : -1
      focusables[Math.max(0, Math.min(focusables.length - 1, index + delta))]?.focus()
      return
    }
    if (e.key === "ArrowRight") {
      e.preventDefault()
      if (target.getAttribute("aria-expanded") === "false") target.click()
      else focusables[index + 1]?.focus()
      return
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault()
      if (target.getAttribute("aria-expanded") === "true") {
        target.click()
        return
      }
      const parentId = target.dataset.parentId
      const parent = focusables.find((el) => el.dataset.nodeId === parentId)
      ;(parent ?? focusables[0])?.focus()
    }
  }

  return (
    <div ref={rootRef} className="min-w-0" onKeyDown={onTreeKeyDown}>
      <button
        onClick={() => {
          manuallyToggled.current = true
          setOpen((o) => !o)
        }}
        data-work-root
        aria-expanded={open}
        className={cn(
          controle("compacto"),
          "group/activity flex w-full text-left transition-colors hover:bg-sel-hover focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
          digest.state === "error"
            ? "text-st-error"
            : digest.state === "running"
              ? "text-foreground"
              : digest.emphasis === "warning"
                ? "text-st-warning"
                : digest.emphasis === "quiet"
                  ? "text-muted-foreground/75"
                  : "text-muted-foreground",
        )}
      >
        <span className="grid size-4 shrink-0 place-items-center" aria-hidden="true">
          <ToolGroupStatus state={digest.state} />
        </span>
        {/* Resumo contado de um grupo vivo ganha a faixa de luz (ADR-241);
            trabalho delegado segue nomeado e quieto, como sempre. */}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            digest.state === "running" && digest.labelWorkId == null && "fio-cintila",
          )}
        >
          {digest.label}
        </span>
        <span className="hidden shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground sm:flex">
          {digest.agents > 0 && (
            <span>
              {digest.agents} agente{digest.agents === 1 ? "" : "s"}
            </span>
          )}
          {digest.agents > 0 && digest.shells > 0 && (
            <span aria-hidden="true">·</span>
          )}
          {digest.shells > 0 && (
            <span>
              {digest.shells} shell{digest.shells === 1 ? "" : "s"}
            </span>
          )}
          {live && (
            <>
              {(digest.agents > 0 || digest.shells > 0) && (
                <span aria-hidden="true">·</span>
              )}
              <ActivityAge
                at={stalledSince ?? lastActivity}
                stalled={stalledSince != null}
              />
            </>
          )}
        </span>
        {(diffTotal.added > 0 || diffTotal.removed > 0) && (
          // sussurro (paleta A): o total de diff informa sem virar semáforo.
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70">
            {diffTotal.added > 0 && `+${diffTotal.added}`}
            {diffTotal.added > 0 && diffTotal.removed > 0 && " "}
            {diffTotal.removed > 0 && `−${diffTotal.removed}`}
          </span>
        )}
        {/* Duração TOTAL congelada do grupo assentado (pretérito, regra do
            Warp: tabular, coluna fixa à direita, quem trunca é o nome). O vivo
            não ganha relógio aqui — o "agora" é da linha viva do rodapé. */}
        {!live && digest.durationMs != null && (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70">
            {fmtDuration(digest.durationMs)}
          </span>
        )}
        <ChevronRight
          className={cn(
            "size-3 shrink-0 text-muted-foreground/35 transition-transform group-hover/activity:text-muted-foreground/70",
            open && "rotate-90",
          )}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div
          role="tree"
          aria-label="Fio Vivo da execução"
          className="mt-0.5"
        >
          <ToolNodeList
            nodes={forest}
            activeToolId={activeToolId}
            agent={agent}
            depth={1}
            live={live}
            deferredPending={deferredLive}
            namedWork={namedWork}
            onStop={onStop}
            onRetry={onRetry}
          />
        </div>
      )}
    </div>
  )
})
