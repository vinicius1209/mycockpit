import { useMemo, useState } from "react"
import {
  ShieldQuestion,
  Check,
  X,
  Terminal,
  MessageCircleQuestion,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
} from "lucide-react"
import type {
  ApprovalData,
  InteractionRequest,
  QuestionAnswer,
  QuestionData,
} from "@/lib/interaction"
import {
  approvalSignature,
  currentOriginAnyKind,
  decideBatch,
  pendingGroup,
  useContextualSplit,
  useInteractions,
  type BatchAction,
  type BatchConfirm,
  type InteractionOrigin,
} from "@/store/interactions"
import { summarizeApproval, type ApprovalSummary } from "@/lib/approvalSummary"
import { AppDialog } from "@/components/ui/app-dialog"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { cn } from "@/lib/utils"

/** Leva você até a conversa dona do pedido (mesmo gesto do sino/tray): projeto
 *  ativo + conversa aberta + modo linear. Lá o card renderiza inline, com o
 *  contexto do turno em volta — que é onde dá pra decidir de verdade. */
async function goToOrigin(origin: InteractionOrigin) {
  const app = useApp.getState()
  app.setActiveProject(origin.projectId)
  await useChat.getState().openProject(origin.projectId)
  await useChat.getState().switchConversation(origin.convId)
  app.setViewMode("linear")
}

/** InteractionCard — card individual de UM pedido pendente (padrão unificado).
 *  Enquanto o agente espera VOCÊ no meio do turno, o turno fica PAUSADO e este
 *  card renderiza por `kind`:
 *   - approval: banner Aprovar/Negar com o comando exato.
 *   - question: card com um bloco por pergunta (radios/checkboxes + "Outro") + Responder.
 *
 *  Reutilizável nas DUAS superfícies das aprovações contextuais: toast global
 *  (canto) e inline no fluxo da conversa visível (MissionTimeline/ChatPanel).
 *  Responde SEMPRE via useInteractions.answer/dismiss (fonte única): responder
 *  em qualquer superfície remove da fila NA HORA — a outra nunca pisca. */
export function InteractionCard({
  req,
  extra = 0,
  compact = false,
}: {
  req: InteractionRequest
  /** Quantos pedidos aguardam atrás deste (hint "+N na fila"). */
  extra?: number
  /** Modo COMPACTO (toast global): só o resumo de uma linha + "Abrir". O
   *  paredão de comando fica pro card inline, na conversa dona. */
  compact?: boolean
}) {
  const answer = useInteractions((s) => s.answer)
  const dismiss = useInteractions((s) => s.dismiss)
  const answerGroup = useInteractions((s) => s.answerGroup)
  // Lote por ASSINATURA (P4): quantas pendentes na fila INTEIRA são idênticas
  // a esta (mesmo tool_name + comando exato). Questions nunca agrupam.
  const queue = useInteractions((s) => s.queue)
  // Origem e resumo NÃO mudam durante a vida do pedido, e o pai passa
  // key={req.id} — memoizar por id evita recomputar a cada token de streaming
  // (e mantém a sidebar/chat fora do caminho de re-render deste card).
  const data = req.data as ApprovalData
  // Origem de QUALQUER kind: o `currentOrigin` é o recorte approval-only, e usá-lo
  // aqui deixava toda PERGUNTA sem cabeçalho "projeto · conversa" e sem "Abrir" —
  // justamente no toast global, que por definição é de conversa que você NÃO está
  // olhando e é onde saber a origem mais importa.
  const origin = useMemo(() => currentOriginAnyKind(req), [req.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const summary = useMemo(
    () => (req.kind === "approval" ? summarizeApproval(data) : null),
    [req.id], // eslint-disable-line react-hooks/exhaustive-deps
  )

  if (req.kind === "question") {
    // COMPACTO vale para pergunta também. Antes o QuestionCard retornava aqui
    // ANTES de olhar `compact`, então o toast do canto renderizava o formulário
    // INTEIRO (radios, checkbox, campo "Outro") de um turno que você não está
    // olhando — um ask_user de 3 perguntas tomava a tela enquanto você
    // trabalhava noutra coisa. Responder pergunta exige ler o contexto: o lugar
    // do paredão é o card inline, na conversa dona.
    if (compact) {
      return (
        <QuestionTeaser
          data={req.data as QuestionData}
          origin={origin}
          extra={extra}
          onDismiss={() => dismiss(req)}
        />
      )
    }
    return (
      <QuestionCard
        data={req.data as QuestionData}
        extra={extra}
        onAnswer={(a) => answer(req.id, a)}
        onDismiss={() => dismiss(req)}
      />
    )
  }

  const signature = approvalSignature(req)
  const groupCount = pendingGroup(queue, req).length
  const batch =
    signature && groupCount >= 2
      ? {
          signature,
          count: groupCount,
          onAll: (allow: boolean) => answerGroup(signature, allow),
        }
      : null

  return (
    <ApprovalCard
      data={data}
      summary={summary!}
      origin={origin}
      compact={compact}
      extra={extra}
      batch={batch}
      onDecide={(allow) => answer(req.id, { allow })}
      onDismiss={() => dismiss(req)}
    />
  )
}

/** InteractionHost — host GLOBAL (toast no canto, via GlobalInteractionHost).
 *  Aprovações CONTEXTUAIS: renderiza só o `split.global` — pedidos da conversa
 *  VISÍVEL saem daqui e aparecem inline no fluxo (InlineInteractions), nunca os
 *  dois ao mesmo tempo. Vários pedidos empilham (o agente pode encadear); a
 *  fila mostra um card por vez (FIFO), cada um respondido pelo seu `id`.
 *
 *  A fila mora no store/interactions (fonte ÚNICA, alimentada pelos eventos
 *  globais no import do módulo) — o office (lib/fleet/derive) lê a MESMA fila,
 *  então o card daqui e a mão levantada na mesa nunca divergem. */
export function InteractionHost() {
  const { global } = useContextualSplit()
  if (global.length === 0) return null
  // mostra o pedido mais antigo (FIFO); os demais aguardam a vez.
  // COMPACTO: aqui o pedido é, por definição, de algo que você NÃO está olhando
  // — mostrar o comando inteiro num toast de canto era o pior dos dois mundos
  // (interrompe e ainda por cima ilegível). Resumo + "Abrir"; o detalhe mora na
  // conversa dona. Negar/Aprovar continuam à mão: o turno está parado.
  const req = global[0]
  return (
    <InteractionCard key={req.id} req={req} extra={global.length - 1} compact />
  )
}

/** Pedidos INLINE da conversa `convId` (a visível na tela): primeiro da fila +
 *  hint dos demais. null quando nada pertence a ela — o host global cobre.
 *  Montado no fluxo: MissionTimeline (bloco da fase corrente) ou ChatPanel
 *  (acima do composer). */
export function InlineInteractions({ convId }: { convId: string }) {
  const { inline, inlineConvId } = useContextualSplit()
  if (inlineConvId !== convId || inline.length === 0) return null
  const req = inline[0]
  return <InteractionCard key={req.id} req={req} extra={inline.length - 1} />
}

function QueueHint({ extra }: { extra: number }) {
  if (extra <= 0) return null
  return <span className="text-muted-foreground"> (+{extra} na fila)</span>
}

/** X de dispensar: escape hatch p/ card órfão (run morto) ou pedido indesejado.
 *  Responde fail-closed best-effort e SEMPRE remove o card (nunca trava a UI). */
function DismissBtn({ onDismiss }: { onDismiss: () => void }) {
  return (
    <button
      onClick={onDismiss}
      title="Dispensar (nega/cancela)"
      aria-label="Dispensar interação"
      className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
    >
      <X className="size-3.5" />
    </button>
  )
}

/** Lote visível no card: contagem do grupo + executor (answerGroup do store). */
interface BatchProps {
  signature: string
  count: number
  onAll: (allow: boolean) => void
}

/** Card de aprovação (migrado 1:1 do ApprovalModal). Com `batch` (≥2 idênticas
 *  na fila), mostra a linha "+N idênticas · Aprovar/Negar todas" — que abre
 *  CONFIRMAÇÃO explícita (comando + contagem) antes de responder o lote. */
function ApprovalCard({
  data,
  summary,
  origin,
  compact,
  extra,
  batch,
  onDecide,
  onDismiss,
}: {
  data: ApprovalData
  summary: ApprovalSummary
  origin: InteractionOrigin | null
  compact: boolean
  extra: number
  batch?: BatchProps | null
  onDecide: (allow: boolean) => void
  onDismiss: () => void
}) {
  // Fluxo de confirmação do lote: estado local + decisão PURA (decideBatch) —
  // clicar em "todas" NUNCA executa direto. key={req.id} no pai reseta por card.
  const [confirming, setConfirming] = useState<BatchConfirm | null>(null)
  // "Ver tudo": o integral abre em dialog, nunca estica o card (era isso que
  // fazia um heredoc de 40 linhas ocupar a janela inteira).
  const [showAll, setShowAll] = useState(false)
  function dispatchBatch(action: BatchAction) {
    const { pending, execute } = decideBatch(confirming, action)
    setConfirming(pending)
    if (execute && batch) batch.onAll(execute.allow)
  }

  return (
    <div className="mb-2 rounded-lg border border-brass/40 bg-brass/[0.07] px-3 py-2.5">
      {/* De ONDE veio: sem isto, um pedido de outro projeto interrompe você sem
          dizer de onde — e o toast global é justamente o caso "não é daqui". */}
      {origin && (
        <p className="mb-1.5 truncate text-[11px] text-muted-foreground">
          {origin.projectName}
          <span className="mx-1 opacity-50">·</span>
          {origin.convTitle}
        </p>
      )}
      <div className="flex items-center gap-2">
        <ShieldQuestion className="size-4 shrink-0 text-brass" />
        <p className="min-w-0 flex-1 text-[12.5px] text-foreground">
          Permissão para{" "}
          <span className="font-medium">{data.tool_name}</span>. O turno está{" "}
          <span className="font-medium text-brass">pausado</span> aguardando você.
          <QueueHint extra={extra} />
        </p>
        <DismissBtn onDismiss={onDismiss} />
      </div>

      {/* A linha que decide: "deno run · v2-compat.smoke.ts". */}
      <div className="mt-2 flex items-center gap-2 rounded-md border bg-card/70 px-2.5 py-1.5">
        <Terminal className="size-3.5 shrink-0 text-muted-foreground" />
        <code
          title={summary.headline}
          className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground/90"
        >
          {summary.headline}
        </code>
      </div>

      {/* Detalhe: só no card INLINE (na conversa dona). Com teto de altura e
          scroll — o comando cru não manda mais na altura do card. */}
      {!compact && (
        <div className="mt-1.5">
          <pre className="max-h-40 overflow-auto rounded-md border bg-card/70 px-2.5 py-1.5 font-mono text-[11px] break-all whitespace-pre-wrap text-foreground/80">
            {summary.preview}
          </pre>
          {summary.truncated && (
            <button
              onClick={() => setShowAll(true)}
              className="mt-1 text-[11.5px] font-medium text-brass underline-offset-2 transition-colors hover:underline"
            >
              Ver tudo ({summary.lines} linhas)
            </button>
          )}
        </div>
      )}

      <DetailDialog
        open={showAll}
        onOpenChange={setShowAll}
        summary={summary}
        toolName={data.tool_name}
      />

      {/* Lote: hint das idênticas + atalho "todas" (abre confirmação). */}
      {batch && !confirming && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted-foreground">
          <span>+{batch.count - 1} idênticas na fila</span>
          <span aria-hidden>·</span>
          <button
            onClick={() =>
              dispatchBatch({
                type: "request",
                confirm: { signature: batch.signature, allow: true, count: batch.count },
              })
            }
            className="font-medium text-brass underline-offset-2 transition-colors hover:underline"
          >
            Aprovar todas ({batch.count})
          </button>
          <span aria-hidden>·</span>
          <button
            onClick={() =>
              dispatchBatch({
                type: "request",
                confirm: { signature: batch.signature, allow: false, count: batch.count },
              })
            }
            className="font-medium text-foreground/80 underline-offset-2 transition-colors hover:underline"
          >
            Negar todas ({batch.count})
          </button>
        </div>
      )}

      {/* Confirmação OBRIGATÓRIA do lote: comando exato + contagem, sem atalho. */}
      {batch && confirming && (
        <div className="mt-2 rounded-md border border-brass/50 bg-card/70 px-2.5 py-2">
          <p className="text-[12px] text-foreground">
            {confirming.allow ? "Aprovar" : "Negar"}{" "}
            <span className="font-medium">{batch.count} pedidos idênticos</span> de{" "}
            <span className="font-medium">{data.tool_name}</span>?
          </p>
          <code className="mt-1 block truncate font-mono text-[11px] text-foreground/80">
            {summary.headline}
          </code>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              onClick={() => dispatchBatch({ type: "cancel" })}
              className="rounded-md border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-accent"
            >
              Cancelar
            </button>
            <button
              onClick={() => dispatchBatch({ type: "confirm" })}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12px] font-medium transition-opacity hover:opacity-90",
                confirming.allow
                  ? "bg-brass text-background"
                  : "border border-destructive/50 text-destructive",
              )}
            >
              {confirming.allow ? (
                <Check className="size-3.5" />
              ) : (
                <X className="size-3.5" />
              )}
              {confirming.allow ? "Aprovar todas" : "Negar todas"} ({batch.count})
            </button>
          </div>
        </div>
      )}

      <div className="mt-2.5 flex items-center justify-end gap-2">
        {/* No compacto o detalhe não está na tela: dá pra abrir o integral aqui
            ou ir até a conversa, onde o card inline mostra tudo em contexto. */}
        {compact && (
          <button
            onClick={() => setShowAll(true)}
            className="mr-auto text-[11.5px] text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
          >
            Ver detalhe
          </button>
        )}
        {compact && origin && (
          <button
            onClick={() => void goToOrigin(origin)}
            title="Abrir a conversa que pediu"
            className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-accent"
          >
            Abrir <ArrowRight className="size-3.5" />
          </button>
        )}
        <button
          onClick={() => onDecide(false)}
          className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-accent"
        >
          <X className="size-3.5" /> Negar
        </button>
        <button
          onClick={() => onDecide(true)}
          className="flex items-center gap-1.5 rounded-md bg-brass px-2.5 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
        >
          <Check className="size-3.5" /> Aprovar
        </button>
      </div>
    </div>
  )
}

/** Integral do pedido, em dialog — o único lugar onde o texto pode ser grande.
 *  Mantém o card com altura previsível sem esconder nada de você. */
function DetailDialog({
  open,
  onOpenChange,
  summary,
  toolName,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  summary: ApprovalSummary
  toolName: string
}) {
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      className="max-w-2xl"
      title={<>Pedido de permissão · {toolName}</>}
      description={
        <>
          {summary.headline}
          {summary.lines > 1 ? ` — ${summary.lines} linhas` : ""}
        </>
      }
    >
      <pre className="max-h-[60vh] overflow-auto rounded-md border bg-card/70 px-3 py-2 font-mono text-[11.5px] break-all whitespace-pre-wrap text-foreground/90">
        {summary.detail}
      </pre>
    </AppDialog>
  )
}

/** Estado de seleção de uma pergunta: labels escolhidos + texto livre de "Outro". */
type QState = { selected: Set<string>; other: string }

/** Card de pergunta estruturada (kind="question"): um bloco por pergunta com radios
 *  (multiSelect=false) ou checkboxes (true), cada opção com label + description; um campo
 *  "Outro" discreto por pergunta. "Responder" habilita quando toda pergunta tem ≥1 seleção. */
/** Versão COMPACTA do pedido de pergunta (toast global): diz de onde veio, o que
 *  foi perguntado em uma linha, e leva você até a conversa — onde o formulário
 *  aparece em contexto. Espelha o contrato que o ApprovalCard já cumpria no
 *  compacto; responder no canto da tela, sem o fio à vista, seria decidir no
 *  escuro. Sem "Responder" aqui de propósito. */
function QuestionTeaser({
  data,
  origin,
  extra,
  onDismiss,
}: {
  data: QuestionData
  origin: InteractionOrigin | null
  extra: number
  onDismiss: () => void
}) {
  const questions = data.questions ?? []
  const first = questions[0]
  const headline =
    (first?.header ?? "").trim() || (first?.question ?? "").trim() || "uma decisão"
  return (
    <div className="mb-2 rounded-lg border border-brass/40 bg-brass/[0.07] px-3 py-2.5">
      {origin && (
        <p className="mb-1.5 truncate text-[11px] text-muted-foreground">
          {origin.projectName}
          <span className="mx-1 opacity-50">·</span>
          {origin.convTitle}
        </p>
      )}
      <div className="flex items-center gap-2">
        <MessageCircleQuestion className="size-4 shrink-0 text-brass" />
        <p className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
          O agente perguntou: <span className="font-medium">{headline}</span>
          {questions.length > 1 && (
            <span className="text-muted-foreground"> (+{questions.length - 1})</span>
          )}
        </p>
      </div>
      <div className="mt-2.5 flex items-center justify-end gap-2">
        {extra > 0 && (
          <span className="mr-auto text-[11px] text-muted-foreground">
            +{extra} na fila
          </span>
        )}
        <button
          onClick={onDismiss}
          className="rounded-md border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-accent"
        >
          Dispensar
        </button>
        {origin && (
          <button
            onClick={() => void goToOrigin(origin)}
            title="Abrir a conversa que perguntou"
            className="flex items-center gap-1.5 rounded-md bg-brass px-2.5 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90"
          >
            Responder <ArrowRight className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

function QuestionCard({
  data,
  extra,
  onAnswer,
  onDismiss,
}: {
  data: QuestionData
  extra: number
  onAnswer: (a: QuestionAnswer) => void
  onDismiss: () => void
}) {
  const questions = data.questions ?? []
  const [state, setState] = useState<QState[]>(() =>
    questions.map(() => ({ selected: new Set<string>(), other: "" })),
  )
  // UMA pergunta por vez (stepper): mantém o card compacto e o chat visível, e
  // valida só a pergunta atual (não exige todas de uma vez).
  const [qi, setQi] = useState(0)

  function toggle(qi: number, label: string, multi: boolean) {
    setState((prev) =>
      prev.map((s, i) => {
        if (i !== qi) return s
        const next = new Set(multi ? s.selected : [])
        if (next.has(label)) next.delete(label)
        else next.add(label)
        return { ...s, selected: next }
      }),
    )
  }

  function setOther(qi: number, other: string) {
    setState((prev) => prev.map((s, i) => (i === qi ? { ...s, other } : s)))
  }

  // "Outro" preenchido conta como uma seleção; toda pergunta precisa de ≥1.
  const answered = (i: number) =>
    state[i].selected.size > 0 || state[i].other.trim().length > 0
  const complete = useMemo(
    () => state.every((_, i) => answered(i)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state],
  )
  const total = questions.length
  const last = qi >= total - 1
  const curAnswered = total > 0 && answered(qi)

  function respond() {
    if (!complete) return
    const answers = questions.map((q, i) => {
      const s = state[i]
      const selected = [...s.selected]
      const other = s.other.trim()
      if (other) selected.push(other)
      return { header: q.header, selected }
    })
    onAnswer({ answers })
  }

  const q = questions[qi]

  return (
    <div className="mb-2 rounded-lg border border-brass/40 bg-brass/[0.07] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <MessageCircleQuestion className="size-4 shrink-0 text-brass" />
        <p className="min-w-0 flex-1 text-[12.5px] text-foreground">
          O agente fez uma pergunta. O turno está{" "}
          <span className="font-medium text-brass">pausado</span> aguardando você.
          <QueueHint extra={extra} />
        </p>
        {total > 1 && (
          <span className="shrink-0 text-[11px] font-medium text-muted-foreground tabular-nums">
            {qi + 1} de {total}
          </span>
        )}
        <DismissBtn onDismiss={onDismiss} />
      </div>

      {q && (
        <div className="mt-2 max-h-[52vh] overflow-y-auto rounded-md border bg-card/70 px-2.5 py-2">
          <p className="text-[12.5px] font-medium text-foreground">{q.question}</p>
          <div className="mt-1.5 flex flex-col gap-1">
            {q.options.map((o) => {
              const on = state[qi].selected.has(o.label)
              return (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => toggle(qi, o.label, q.multiSelect)}
                  className={cn(
                    "flex items-start gap-2 rounded-md border px-2 py-1.5 text-left transition-colors hover:bg-accent",
                    on ? "border-brass/60 bg-brass/[0.08]" : "border-border/60",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center border",
                      q.multiSelect ? "rounded-[4px]" : "rounded-full",
                      on ? "border-brass bg-brass text-background" : "border-muted-foreground/50",
                    )}
                  >
                    {on && <Check className="size-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] text-foreground">{o.label}</span>
                    {o.description && (
                      <span className="block text-[11.5px] leading-snug text-muted-foreground">
                        {o.description}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
          <input
            type="text"
            value={state[qi].other}
            onChange={(e) => setOther(qi, e.target.value)}
            placeholder={
              q.multiSelect ? "Outro (opcional)…" : "Ou responda com suas palavras…"
            }
            className="mt-1.5 w-full rounded-md border border-border/60 bg-transparent px-2 py-1 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus-visible:border-brass/60 focus-visible:outline-none"
          />
        </div>
      )}

      {/* Navegação: setinha p/ passar pelas perguntas; chat continua visível. */}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <button
          onClick={() => setQi((i) => Math.max(0, i - 1))}
          disabled={qi === 0}
          className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-[12px] text-foreground transition-colors hover:bg-accent disabled:opacity-40"
        >
          <ChevronLeft className="size-3.5" /> Anterior
        </button>
        {last ? (
          <button
            onClick={respond}
            disabled={!complete}
            title={!complete ? "Responda todas as perguntas" : undefined}
            className="flex items-center gap-1.5 rounded-md bg-brass px-2.5 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <Check className="size-3.5" /> Responder
          </button>
        ) : (
          <button
            onClick={() => setQi((i) => Math.min(total - 1, i + 1))}
            disabled={!curAnswered}
            className="flex items-center gap-1 rounded-md bg-brass px-2.5 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            Próxima <ChevronRight className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
