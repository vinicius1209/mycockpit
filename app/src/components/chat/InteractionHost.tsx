import { useMemo, useState } from "react"
import {
  ShieldQuestion,
  Check,
  X,
  Terminal,
  MessageCircleQuestion,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import type {
  ApprovalData,
  InteractionRequest,
  QuestionAnswer,
  QuestionData,
} from "@/lib/interaction"
import {
  approvalSignature,
  decideBatch,
  pendingGroup,
  useContextualSplit,
  useInteractions,
  type BatchAction,
  type BatchConfirm,
} from "@/store/interactions"
import { cn } from "@/lib/utils"

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
}: {
  req: InteractionRequest
  /** Quantos pedidos aguardam atrás deste (hint "+N na fila"). */
  extra?: number
}) {
  const answer = useInteractions((s) => s.answer)
  const dismiss = useInteractions((s) => s.dismiss)
  const answerGroup = useInteractions((s) => s.answerGroup)
  // Lote por ASSINATURA (P4): quantas pendentes na fila INTEIRA são idênticas
  // a esta (mesmo tool_name + comando exato). Questions nunca agrupam.
  const queue = useInteractions((s) => s.queue)

  if (req.kind === "question") {
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
      data={req.data as ApprovalData}
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
 *  globais no import do módulo) — o office (bridge/derive) lê a MESMA fila,
 *  então o card daqui e a mão levantada na mesa nunca divergem. */
export function InteractionHost() {
  const { global } = useContextualSplit()
  if (global.length === 0) return null
  // mostra o pedido mais antigo (FIFO); os demais aguardam a vez.
  const req = global[0]
  return <InteractionCard key={req.id} req={req} extra={global.length - 1} />
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
  extra,
  batch,
  onDecide,
  onDismiss,
}: {
  data: ApprovalData
  extra: number
  batch?: BatchProps | null
  onDecide: (allow: boolean) => void
  onDismiss: () => void
}) {
  // Fluxo de confirmação do lote: estado local + decisão PURA (decideBatch) —
  // clicar em "todas" NUNCA executa direto. key={req.id} no pai reseta por card.
  const [confirming, setConfirming] = useState<BatchConfirm | null>(null)
  function dispatchBatch(action: BatchAction) {
    const { pending, execute } = decideBatch(confirming, action)
    setConfirming(pending)
    if (execute && batch) batch.onAll(execute.allow)
  }

  return (
    <div className="mb-2 rounded-lg border border-brass/40 bg-brass/[0.07] px-3 py-2.5">
      <div className="flex items-center gap-2">
        <ShieldQuestion className="size-4 shrink-0 text-brass" />
        <p className="min-w-0 flex-1 text-[12.5px] text-foreground">
          O agente pediu permissão para usar{" "}
          <span className="font-medium">{data.tool_name}</span>. O turno está{" "}
          <span className="font-medium text-brass">pausado</span> aguardando você.
          <QueueHint extra={extra} />
        </p>
        <DismissBtn onDismiss={onDismiss} />
      </div>
      {data.command ? (
        <div className="mt-2 flex items-start gap-2 rounded-md border bg-card/70 px-2.5 py-1.5">
          <Terminal className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          <code className="min-w-0 flex-1 whitespace-pre-wrap break-all font-mono text-[11.5px] text-foreground/90">
            {data.command}
          </code>
        </div>
      ) : (
        <pre className="mt-2 max-h-32 overflow-auto rounded-md border bg-card/70 px-2.5 py-1.5 font-mono text-[11px] text-foreground/80">
          {JSON.stringify(data.input, null, 2)}
        </pre>
      )}

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
          <code className="mt-1 block whitespace-pre-wrap break-all font-mono text-[11px] text-foreground/80">
            {data.command || JSON.stringify(data.input)}
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

/** Estado de seleção de uma pergunta: labels escolhidos + texto livre de "Outro". */
type QState = { selected: Set<string>; other: string }

/** Card de pergunta estruturada (kind="question"): um bloco por pergunta com radios
 *  (multiSelect=false) ou checkboxes (true), cada opção com label + description; um campo
 *  "Outro" discreto por pergunta. "Responder" habilita quando toda pergunta tem ≥1 seleção. */
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
