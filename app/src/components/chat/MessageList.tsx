import {
  Fragment,
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react"
import { MarcoDeCorte } from "@/components/chat/MarcoDeCorte"
import { AvisoDoFio } from "@/components/chat/AvisoDoFio"
import { NoDoFio } from "@/components/chat/NoDoFio"
import { DivisorNovasMensagens } from "@/components/chat/DivisorNovasMensagens"
import { tsDaCauda } from "@/lib/nascimento"
import { attachmentReadsByItem, type ReadLabels } from "@/lib/attachmentRead"
import { AttachmentThumb } from "@/components/chat/MiniaturasDoFio"
import { useLightbox, type LightboxImage } from "@/store/lightbox"
import { taskPlansOf, type AgentPlan } from "@/lib/tasks"
import { TurnNoteBlock } from "@/components/chat/TurnNote"
import type { FeedbackApi } from "@/components/chat/TurnActions"
import { TurnReceipt } from "@/components/chat/TurnReceipt"
import { EntregasDoTurno } from "@/components/chat/EntregasDoTurno"
import { entregasPorResultado, type Entrega } from "@/lib/entregas"
import { vozDoNo, vozesPlanas, vozesPorTurno, type VozDaFala } from "@/lib/vozDoTurno"
import { imagensCitadas, imagensDoEnvio } from "@/lib/imagemNoTexto"
import { IncidentSequence } from "@/components/chat/IncidentSequence"
import { PlanMilestone } from "@/components/chat/PlanMilestone"
import { WorkingIndicator } from "@/components/chat/WorkingIndicator"
import { GroupRow } from "@/components/chat/GroupRow"
import { ToolGroup } from "@/components/chat/ToolGroup"
import { type Node, type ToolItem } from "@/components/chat/messageNodes"
import { hiddenNodeCount, useJanelaProgressiva, useStableNodes } from "@/components/chat/useStableNodes"
import { groupByAuthor, groupTs, corteNasceu, estreiasDeEspecialista, type MessageGroup } from "@/components/chat/messageGroups"
import {
  feedbackTextByResult,
  turnStartIndex,
  tsForGroups,
  visibleThreadItems,
  windowStartIndex,
} from "@/components/chat/threadWindow"
import { AdviceCard } from "@/components/chat/AdviceInThread"
import { ChegadaDoEspecialista, EntrouNaConversa, ParecerEmMensagem } from "@/components/chat/ParecerEmMensagem"
import { shortDigest } from "@/lib/presets"
import { LinhaDoParecerLevado } from "@/components/chat/RastroDoParecer"
import { EnderecoDoConselheiro } from "@/components/chat/EnderecoDoConselheiro"
import { PlanGateCard } from "@/components/chat/PlanGateCard"
import { UserMessageBubble } from "@/components/chat/UserMessageBubble"
import type { Consultado } from "@/lib/parecerAoVivo"
import { cn } from "@/lib/utils"
import { Markdown } from "@/components/common/Markdown"
import {
  pendingDeferred,
  useChat,
  type ChatItem,
  type RunLiveness,
} from "@/store/chat"
import { useTranscriptReveal } from "@/components/chat/useTranscriptReveal"
import type { TranscriptRevealRequest } from "@/store/appTypes"

export type { FeedbackApi } from "@/components/chat/TurnActions"

/** Um item NÃO-tool da conversa. `memo`: só re-renderiza quando a REFERÊNCIA do
 *  item muda (itens não-streaming têm ref estável), não re-pinta a cada delta (F12). */
const MessageItem = memo(function MessageItem({
  item: it,
  feedback,
  feedbackText,
  final,
  lastTurn,
  reads,
  voz,
  vivo,
  onApprovePlan,
  onKeepPlanning,
}: {
  item: ChatItem
  /** Resultado mais recente do pedido / da conversa (recibo, ADR-199). */
  final?: boolean
  lastTurn?: boolean
  /** Decidir o gate de plano. Ausentes = não dá pra agir agora. */
  onApprovePlan?: (id: string) => void
  onKeepPlanning?: (id: string) => void
  feedback?: FeedbackApi | null
  feedbackText?: string
  /** Selo de leitura por PATH de anexo, SÓ os deste item (só itens do usuário
   *  usam). Vem pronto do MessageList: calcular aqui exigiria o fio inteiro
   *  dentro de um `memo` por item, o que mataria a memoização a cada delta do
   *  streaming. A referência é estável enquanto os rótulos deste item não
   *  mudam — é o que faz o `memo` acima valer alguma coisa. */
  reads?: ReadLabels
  /** Narração de um turno que já tem resposta (G8). */
  voz?: "narracao"
  /** O texto ainda está chegando: o trecho novo dissolve (ADR-290). */
  vivo?: boolean
}) {
  if (it.kind === "user") {
    // Slack-style: alinhado à esquerda sob o gutter "Você" (o autor está no
    // cabeçalho do grupo), não mais bolha à direita.
    // Galeria do lightbox = só as IMAGENS desta mensagem (PDF segue chip).
    const gallery: LightboxImage[] = (it.attachments ?? [])
      .filter((a) => a.kind === "image")
      .map((a) => ({
        path: a.path,
        name: a.name,
        source: "anexo" as const,
        mime: a.mime,
      }))
    // Imagem citada no texto aparece no ponto dela (G3); a fileira mostra o resto.
    const imagens = imagensDoEnvio(it.attachments ?? [])
    const citadas = imagensCitadas(it.text ?? "", it.attachments ?? [])
    const fileira = (it.attachments ?? []).filter((a) => !citadas.has(a.path))
    return (
      <div className={cn("flex flex-col gap-1.5", it.advisorTo ? "items-end" : "items-start")}>
        {/* Endereçamento (Especialistas E1): esta fala foi PARA um conselheiro,
            não pro piloto — quem responde é outra pessoa. Metadado em sussurro
            cinza (STYLEGUIDE §2: brass é gesto, não ênfase genérica). */}
        {it.advisorTo && <EnderecoDoConselheiro destinatario={it.advisorTo} />}
        {/* O rastro do parecer que este pedido levou (ADR-267). */}
        {it.pareceres?.map((p) => <LinhaDoParecerLevado key={p.itemId} levado={p} />)}
        {fileira.length > 0 && (
          <div className="flex max-w-full flex-wrap gap-1.5">
            {fileira.map((a) => (
              <AttachmentThumb
                key={a.path}
                att={a}
                read={reads?.[a.path] ?? null}
                onOpen={
                  a.kind === "image"
                    ? () =>
                        useLightbox
                          .getState()
                          .open(
                            gallery,
                            gallery.findIndex((g) => g.path === a.path),
                          )
                    : undefined
                }
              />
            ))}
          </div>
        )}
        {it.text && <UserMessageBubble itemId={it.id} text={it.text} aDireita={!!it.advisorTo} imagens={imagens} />}
      </div>
    )
  }

  if (it.kind === "text") {
    return <div data-citavel={it.id} className="min-w-0"><Markdown text={it.text} voz={voz} vivo={vivo} /></div>
  }

  // Tools agrupadas por buildNodes/ToolGroup; este guard só fecha a união.
  if (it.kind === "tool") return null

  if (it.kind === "error") {
    return (
      <IncidentSequence
        incident={{
          type: "incident",
          key: it.id,
          severity: "error",
          message: it.message,
          details: [it.message],
        }}
      />
    )
  }

  if (it.kind === "limit") {
    return (
      <IncidentSequence
        incident={{
          type: "incident",
          key: it.id,
          severity: "limit",
          message: it.message,
          resetHint: it.resetHint,
          details: [it.message],
        }}
      />
    )
  }

  if (it.kind === "cancelled") return <MarcoDeCorte item={it} />

  if (it.kind === "notice") return <AvisoDoFio message={it.message} tom={it.tom} ts={it.ts} />

  if (it.kind === "advice") {
    return it.estilo === "mensagem" ? <ParecerEmMensagem item={it} /> : <AdviceCard item={it} />
  }

  if (it.kind === "note") {
    const convId = useChat.getState().activeId
    return convId ? (
      <TurnNoteBlock convId={convId} id={it.id} text={it.text} sent={it.sent} />
    ) : null
  }

  if (it.kind === "planGate") {
    // As duas decisões ENVIAM um turno (lib/planGate), daí as callbacks.
    return (
      <PlanGateCard
        item={it}
        onApprove={onApprovePlan && (() => onApprovePlan(it.id))}
        onDiscard={onKeepPlanning && (() => onKeepPlanning(it.id))}
      />
    )
  }

  if (it.kind !== "result") return null
  return <TurnReceipt it={it} feedback={feedback} feedbackText={feedbackText} final={!!final} lastTurn={!!lastTurn} />
})

// Modelo de nós (buildNodes/continuesProse) mora em ./messageNodes — puro e
// testável, sem estragar o fast-refresh deste arquivo de componentes.

interface NodeCtx {
  isLast: boolean
  running: boolean
  finalizing: boolean
  taskPlans: AgentPlan[]
  activePlanAnchor: string | null
  feedback?: FeedbackApi | null
  /** Selos de leitura POR ITEM (id do item → rótulos por path). Por item, e não
   *  um mapa global, porque a prop do `MessageItem` (que é `memo`) não pode
   *  trocar de identidade quando o conteúdo daquele item não mudou. */
  attReads: Map<string, ReadLabels>
  agent: string
  stalledSince?: number
  feedbackByResult: Map<string, string>
  /** Voz de cada fala de turno terminado: narração ou resposta (G8). */
  vozes: Map<string, VozDaFala>
  /** Arquivos que cada turno entregou, pelo id do `result` que o fecha (G1). */
  entregasByResult: Map<string, Entrega[]>
  lastResultId: string | null
  onStop?: (tool: ToolItem) => void
  onRetry?: (tool: ToolItem) => void
  /** Aprovar o plano proposto: precisa ENVIAR, e quem sabe enviar nesta
   *  conversa é o ChatPanel. Ausente = o cartão do gate só informa. */
  onApprovePlan?: (id: string) => void
  onKeepPlanning?: (id: string) => void
}

/** Corpo de UM nó de render (sem gutter/cabeçalho — isso é do grupo). Mantém
 *  intactos os caminhos existentes: prose costurada + ToolGroup, burst de tools,
 *  checklist e os cartões de item (user/result/erro/limite/advice…). */
function renderNode(n: Node, ctx: NodeCtx): React.ReactNode {
  if (n.type === "incident") {
    const resultId = n.result?.id
    return (
      <IncidentSequence
        incident={n}
        feedback={
          resultId && ctx.feedbackByResult.has(resultId) ? ctx.feedback : null
        }
        feedbackText={resultId ? ctx.feedbackByResult.get(resultId) : undefined}
      />
    )
  }
  if (n.type === "plan") {
    const plan = ctx.taskPlans.find((candidate) => candidate.anchorId === n.anchorId)
    if (!plan) return null
    return (
      <PlanMilestone
        plan={plan}
        live={ctx.running && ctx.activePlanAnchor === n.anchorId}
      />
    )
  }
  if (n.type === "prose") {
    // narração do turno (costurada) + as tools que ela disparou, juntas e
    // apertadas (gap-1.5). O grupo só "roda" quando é o último nó do run.
    const active = ctx.running && ctx.isLast
    const hasText = n.text.trim().length > 0
    return (
      <div className="group/msg flex flex-col gap-1.5" data-citavel={n.itemIds?.[0] ?? n.key}>
        {hasText && <Markdown text={n.text} voz={vozDoNo(n.itemIds ?? [n.key], ctx.vozes) === "narracao" ? "narracao" : undefined} vivo={active} />}
        {n.tools.length > 0 && (
          <ToolGroup
            tools={n.tools}
            active={active}
            agent={ctx.agent}
            stalledSince={ctx.stalledSince}
            onStop={ctx.onStop}
            onRetry={ctx.onRetry}
          />
        )}
      </div>
    )
  }
  if (n.type === "tools") {
    const active = ctx.running && ctx.isLast
    return (
      <ToolGroup
        tools={n.tools}
        active={active}
        agent={ctx.agent}
        stalledSince={ctx.stalledSince}
        onStop={ctx.onStop}
        onRetry={ctx.onRetry}
      />
    )
  }
  const entregas = n.item.kind === "result" ? ctx.entregasByResult.get(n.item.id) : undefined
  return (
    <>
      {entregas && entregas.length > 0 && <EntregasDoTurno entregas={entregas} />}
      <MessageItem
        item={n.item}
        feedback={ctx.feedbackByResult.has(n.item.id) ? ctx.feedback : null}
        feedbackText={ctx.feedbackByResult.get(n.item.id)}
        final={ctx.feedbackByResult.has(n.item.id)}
        lastTurn={n.item.id === ctx.lastResultId}
        onApprovePlan={ctx.onApprovePlan}
        onKeepPlanning={ctx.onKeepPlanning}
        reads={ctx.attReads.get(n.item.id)}
        voz={n.item.kind === "text" && ctx.vozes.get(n.item.id) === "narracao" ? "narracao" : undefined}
        vivo={ctx.running && ctx.isLast}
      />
    </>
  )
}

function nodeItemIds(node: Node): string[] {
  if (node.type === "item") return [node.item.id]
  return node.itemIds?.length ? node.itemIds : [node.key]
}



/** Selos de leitura por item, com identidade preservada (ver
 *  `attachmentReadsByItem`) e escopados à fatia que a janela mostra. */
function useStableAttReads(
  items: ChatItem[],
  agent: string,
  running: boolean,
  from: number,
): Map<string, ReadLabels> {
  const prev = useRef<Map<string, ReadLabels>>(new Map())
  return useMemo(() => {
    const next = attachmentReadsByItem(items, agent, running, prev.current, from)
    prev.current = next
    return next
  }, [items, agent, running, from])
}

/** Callback com IDENTIDADE fixa que sempre chama a versão mais recente. Os
 *  handlers chegam do ChatPanel como literais inline (identidade nova a cada
 *  render do pai) e atravessam o `memo` do `ToolLine`/`ToolGroup`; como só são
 *  invocados por gesto do usuário, ler a versão corrente de um ref é idêntico
 *  em comportamento. `undefined` continua `undefined` (não vira função de mentira). */
function useStableHandler<T>(
  fn: ((arg: T) => void) | undefined,
): ((arg: T) => void) | undefined {
  const ref = useRef(fn)
  ref.current = fn
  const stable = useCallback((arg: T) => ref.current?.(arg), [])
  return fn ? stable : undefined
}

export function MessageList({
  items,
  running,
  finalizing,
  startedAt,
  agent,
  presetId,
  advising,
  stalledSince,
  runLiveness,
  unseenDividerId,
  onStop,
  onRetry,
  onApprovePlan,
  onKeepPlanning,
  feedback,
  reveal,
}: {
  items: ChatItem[]
  running: boolean
  finalizing: boolean
  startedAt: number | null
  agent: string
  /** Preset (persona-piloto) carimbado na conversa — resolve o avatar/nome do
   *  autor "executor" no gutter. null/undefined = sem piloto (usa o logo do agent). */
  presetId?: string | null
  /** Especialistas E1: conselheiro em consulta (id+nome) — enquanto setado, a
   *  linha de chegada aparece no fim do fio; some quando o item `advice` cai. */
  advising?: Consultado | null
  /** Watchdog do turno: presente quando o provider está vivo, mas sem eventos
   *  observáveis desde este instante. */
  stalledSince?: number
  /** Diagnóstico da árvore do processo, mostrado só quando o watchdog acusa silêncio. */
  runLiveness?: RunLiveness
  /** S1.1 — id do primeiro item NÃO-VISTO (capturado ao abrir uma conversa com
   *  finishedUnseen): o divisor "novas mensagens" entra antes do grupo que
   *  começa nele. undefined = sem divisor nesta visita. */
  unseenDividerId?: string
  /** Controle capability-aware: hoje interrompe o run principal; processos
   *  gerenciados podem especializar este callback depois. */
  onStop?: (tool: ToolItem) => void
  /** Repetição explícita vira um novo turno, nunca reexecuta efeito escondido. */
  onRetry?: (tool: ToolItem) => void
  /** Aprovar o plano proposto (id do item `planGate`): o gesto ENVIA, e quem
   *  sabe enviar nesta conversa é o ChatPanel. */
  onApprovePlan?: (id: string) => void
  onKeepPlanning?: (id: string) => void
  /** Loop de feedback do Linear (M2). null/undefined fora do Linear. */
  feedback?: FeedbackApi | null
  /** Fonte pedida pela aba Conversa. O nonce permite revelar o mesmo item de
   *  novo; a lista calcula o scroll relativo ao wrapper real do transcript. */
  reveal?: TranscriptRevealRequest | null
}) {
  const threadItems = useMemo(() => visibleThreadItems(items, finalizing), [items, finalizing])
  const nodes = useStableNodes(threadItems)
  // Mesma derivação memoizada que o ChatPanel consome.
  const planView = useMemo(() => taskPlansOf(threadItems), [threadItems])
  const taskPlans = planView.plans
  const activePlanAnchor = running ? (planView.live?.anchorId ?? null) : null
  // Trabalho diferido VIVO alimenta a LINHA VIVA e deriva de items:
  // replay-safe, sem estado paralelo; no restore vira interrompido e some.
  const liveDeferred = useMemo(() => pendingDeferred(threadItems), [threadItems])

  // Janela de renderização (política e porquês em `useStableNodes`): a cauda
  // primeiro, o teto depois, e `showAll` revela o histórico inteiro.
  const [showAll, setShowAll] = useState(false)
  const janela = useJanelaProgressiva()
  const hiddenCount = hiddenNodeCount(nodes.length, showAll, janela)
  const visible = useMemo(
    () => (hiddenCount > 0 ? nodes.slice(hiddenCount) : nodes),
    [nodes, hiddenCount],
  )
  // Agrupamento estilo Slack: nós contíguos do mesmo autor viram um grupo
  // (avatar/cabeçalho uma vez), casado por key e não por índice. Memoizado:
  // `groups` é dependência de `tsById`, e array novo por RENDER refazia a busca.
  const groups = useMemo(() => groupByAuthor(visible), [visible])
  const lastKey = visible.length ? visible[visible.length - 1].key : null

  // A janela corta NÓS; as derivações abaixo consomem ITENS. `windowStart` é a
  // ponte: o índice do 1º item que um nó visível pode citar (ver threadWindow).
  // Sem isso elas varriam os 1.885 itens do fio por token pra servir 150 nós.
  const firstVisibleKey = visible.length ? visible[0].key : null
  const windowStart = useMemo(
    // Nada escondido (fio curto ou "mostrar anteriores" clicado) = a janela
    // começa no 1º item; não há o que procurar.
    () => (hiddenCount > 0 ? windowStartIndex(threadItems, firstVisibleKey) : 0),
    [threadItems, firstVisibleKey, hiddenCount],
  )
  const { listRef, revealedItemId } = useTranscriptReveal({
    reveal,
    items,
    threadItems,
    hiddenCount,
    windowStart,
    setShowAll,
  })
  const feedbackByResult = useMemo(
    () => feedbackTextByResult(threadItems, turnStartIndex(threadItems, windowStart)),
    [threadItems, windowStart],
  )
  // Turno fechado reaproveita o array anterior: o `memo` do item não quebra por token.
  const entregasAnteriores = useRef<Map<string, Entrega[]>>(new Map())
  const entregasByResult = useMemo(() => {
    const next = entregasPorResultado(threadItems, turnStartIndex(threadItems, windowStart), entregasAnteriores.current)
    entregasAnteriores.current = next
    return next
  }, [threadItems, windowStart])
  const vozesAnteriores = useRef<Map<string, Map<string, VozDaFala>>>(new Map())
  const vozes = useMemo(() => {
    const porTurno = vozesPorTurno(threadItems, turnStartIndex(threadItems, windowStart), vozesAnteriores.current)
    vozesAnteriores.current = porTurno
    return vozesPlanas(porTurno)
  }, [threadItems, windowStart])
  const lastResultId = useMemo(
    () => threadItems.findLast((item) => item.kind === "result")?.id ?? null,
    [threadItems],
  )
  // Selo "lido / não foi aberto" por anexo. Calculado UMA vez aqui e entregue
  // pronto ao MessageItem: fazer dentro do item quebraria o memo dele a cada
  // delta do streaming. Indexado POR ITEM e com a referência preservada enquanto
  // os rótulos daquele item não mudam — sem isso o `memo` do MessageItem
  // recebia um objeto novo por token e não memoizava nada.
  const attReads = useStableAttReads(threadItems, agent, running, windowStart)
  // id → ts APENAS dos itens que abrem grupo visível (o cabeçalho lê o ts do 1º
  // item via a key do 1º nó, que buildNodes deriva do id desse item). Itens
  // antigos sem `ts` → undefined, e o grupo omite a hora.
  const tsById = useMemo(() => tsForGroups(threadItems, groups), [threadItems, groups])
  const tsCauda = useMemo(() => tsDaCauda(threadItems), [threadItems])
  const estreias = useMemo(() => estreiasDeEspecialista(groups), [groups])
  // Identidade fixa: estes cruzam o `memo` do ToolGroup/ToolLine.
  const stableStop = useStableHandler(onStop)
  const stableRetry = useStableHandler(onRetry)
  const ctxBase: Omit<NodeCtx, "isLast"> = {
    running,
    finalizing,
    taskPlans,
    activePlanAnchor,
    feedback,
    attReads,
    agent,
    stalledSince,
    feedbackByResult,
    entregasByResult,
    vozes,
    lastResultId,
    onStop: stableStop,
    onRetry: stableRetry,
    onApprovePlan,
    onKeepPlanning,
  }
  return (
    <div ref={listRef} className="mx-auto flex w-full max-w-[760px] min-w-0 flex-col gap-5 px-8 py-8">
      {hiddenCount > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="mx-auto rounded-full border bg-card/60 px-3 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Mostrar {hiddenCount} itens anteriores
        </button>
      )}
      {groups.map((g, idx) => {
        const canCoalesceWorking = (running || finalizing) && !advising && idx === groups.length - 1 && g.author.kind === "executor"
        return (
          <Fragment key={g.key}>
            {/* Divisor "novas mensagens" (unseen-divider-plan D1): a key do 1º nó
                de um grupo é o id do item que o abriu (buildNodes), e a fronteira
                vem logo após uma mensagem SUA — troca de autor abre grupo novo,
                então o divisor cai sempre ENTRE grupos. */}
            {unseenDividerId != null && g.nodes[0]?.key === unseenDividerId && <DivisorNovasMensagens />}
            {g.author.kind === "especialista" && estreias.has(g.key) && (
              <EntrouNaConversa personaId={g.author.personaId} nome={g.author.personaName} />
            )}
            <GroupRow
              groupKey={g.key}
              author={g.author}
              brasa={g.author.kind === "executor" && corteNasceu(groups[idx + 1])}
              agent={agent}
              presetId={presetId ?? null}
              ts={groupTs(g, tsById)}
              auditoria={auditoriaDoGrupo(g)}
              workingTail={
                canCoalesceWorking ? (
                  <WorkingIndicator
                    agent={agent}
                    presetId={presetId ?? null}
                    finalizing={finalizing}
                    running={running}
                    startedAt={startedAt}
                    deferred={liveDeferred}
                    stalledSince={stalledSince}
                    runLiveness={runLiveness}
                    nodes={g.nodes}
                    inline
                  />
                ) : undefined
              }
            >
              {g.nodes.map((n, i) => (
                <NoDoFio
                  key={n.key}
                  ids={nodeItemIds(n)}
                  revelado={revealedItemId}
                  ts={i > 0 && n.type !== "tools" && n.type !== "plan" ? tsCauda.get(n.key) : undefined}
                >
                  {renderNode(n, { ...ctxBase, isLast: n.key === lastKey })}
                </NoDoFio>
              ))}
            </GroupRow>
          </Fragment>
        )
      })}
      {advising && (
        <ChegadaDoEspecialista
          advising={advising}
          estreia={!threadItems.some((i) => i.kind === "advice" && i.personaId === advising.id)}
        />
      )}
      {/* Sem `nodes`: é decisão, e o porquê está no contrato da prop. */}
      {(running || finalizing) && (advising || groups[groups.length - 1]?.author.kind !== "executor") && (
        <WorkingIndicator
          agent={agent}
          presetId={presetId ?? null}
          finalizing={finalizing}
          running={running}
          startedAt={startedAt}
          deferred={liveDeferred}
          stalledSince={stalledSince}
          runLiveness={runLiveness}
        />
      )}
    </div>
  )
}

/** "Íris · v3 · 04ab091d" no hover da hora de um parecer em mensagem. */
function auditoriaDoGrupo(g: MessageGroup): string | undefined {
  const n = g.nodes[0]
  if (n?.type !== "item" || n.item.kind !== "advice" || n.item.estilo !== "mensagem") return undefined
  return `${n.item.personaName} · v${n.item.personaVersion} · ${shortDigest(n.item.digest)}`
}
