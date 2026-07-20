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
  QuestionAnswer,
  QuestionData,
} from "@/lib/interaction"
import { useInteractions } from "@/store/interactions"
import { cn } from "@/lib/utils"

/** InteractionHost — card das "interações pendentes" (padrão unificado). Enquanto
 *  o agente espera VOCÊ no meio do turno, o turno fica PAUSADO e este bloco
 *  renderiza o card certo por `kind`:
 *   - approval: banner Aprovar/Negar com o comando exato.
 *   - question: card com um bloco por pergunta (radios/checkboxes + "Outro") + Responder.
 *  Vários pedidos empilham (o agente pode encadear); a fila mostra um card por vez
 *  (FIFO), cada um respondido pelo seu `id`.
 *
 *  A fila mora no store/interactions (fonte ÚNICA, alimentada pelos eventos
 *  globais no import do módulo) — o office (bridge/derive) lê a MESMA fila,
 *  então o card daqui e a mão levantada na mesa nunca divergem. Responder
 *  remove o card na hora: o backend não confirma resposta via resolved (só o
 *  Drop fail-closed emite; ver o store). */
export function InteractionHost() {
  const queue = useInteractions((s) => s.queue)
  const answer = useInteractions((s) => s.answer)
  const dismiss = useInteractions((s) => s.dismiss)

  if (queue.length === 0) return null
  // mostra o pedido mais antigo (FIFO); os demais aguardam a vez.
  const req = queue[0]
  const extra = queue.length - 1

  if (req.kind === "question") {
    return (
      <QuestionCard
        key={req.id}
        data={req.data as QuestionData}
        extra={extra}
        onAnswer={(a) => answer(req.id, a)}
        onDismiss={() => dismiss(req)}
      />
    )
  }

  return (
    <ApprovalCard
      key={req.id}
      data={req.data as ApprovalData}
      extra={extra}
      onDecide={(allow) => answer(req.id, { allow })}
      onDismiss={() => dismiss(req)}
    />
  )
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

/** Card de aprovação (migrado 1:1 do ApprovalModal). */
function ApprovalCard({
  data,
  extra,
  onDecide,
  onDismiss,
}: {
  data: ApprovalData
  extra: number
  onDecide: (allow: boolean) => void
  onDismiss: () => void
}) {
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
