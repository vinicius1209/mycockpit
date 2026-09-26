// Os cartões de PERGUNTA estruturada (kind="question"): o compacto do canto e
// o formulário inline. Saíram do `InteractionHost.tsx` pela catraca de
// tamanho (ADR-261).

import { useMemo, useState } from "react"
import { ArrowRight, Check, ChevronLeft, ChevronRight, MessageCircleQuestion } from "lucide-react"
import type { QuestionAnswer, QuestionData } from "@/lib/interaction"
import type { InteractionOrigin } from "@/store/interactions"
import { cn } from "@/lib/utils"
import { controle } from "@/components/ui/controle"
import { LinhaDeLista } from "@/components/ui/linha-de-lista"
import { SELECTED_FILL } from "@/lib/selection"
import { PENDING_DECISION } from "@/lib/attention"
import { DismissBtn, goToOrigin, QueueHint } from "@/components/chat/pecasDoPedido"

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
export function QuestionTeaser({
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
    <div className={cn("mb-2 rounded-lg border px-3 py-2.5", PENDING_DECISION)}>
      {origin && (
        <p className="mb-1.5 truncate text-[11px] text-muted-foreground">
          {origin.projectName}
          <span className="mx-1 opacity-50">·</span>
          {origin.convTitle}
        </p>
      )}
      <div className="flex items-center gap-2">
        <MessageCircleQuestion className="size-4 shrink-0 text-st-warning" />
        <p className="min-w-0 flex-1 truncate text-[13px] text-foreground">
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
          className={cn(controle("compacto"), "border text-foreground transition-colors hover:bg-accent")}
        >
          Dispensar
        </button>
        {origin && (
          <button
            onClick={() => void goToOrigin(origin)}
            title="Abrir a conversa que perguntou"
            className={cn(controle("compacto"), "bg-brass font-medium text-background transition-opacity hover:opacity-90")}
          >
            Responder <ArrowRight className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

export function QuestionCard({
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
    <div className={cn("mb-2 rounded-lg border px-3 py-2.5", PENDING_DECISION)}>
      <div className="flex items-center gap-2">
        <MessageCircleQuestion className="size-4 shrink-0 text-st-warning" />
        <p className="min-w-0 flex-1 text-[13px] text-foreground">
          O agente fez uma pergunta. O turno está{" "}
          <span className="font-medium">pausado</span> aguardando você.
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
          <p className="text-[13px] font-medium text-foreground">{q.question}</p>
          <div className="mt-1.5 flex flex-col gap-1">
            {q.options.map((o) => {
              const on = state[qi].selected.has(o.label)
              return (
                <LinhaDeLista
                  key={o.label}
                  aria-pressed={on}
                  onClick={() => toggle(qi, o.label, q.multiSelect)}
                  className={cn("flex items-start gap-2 border", on ? SELECTED_FILL : "border-border")}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-4 shrink-0 items-center justify-center ring-1 ring-inset",
                      q.multiSelect ? "rounded-[4px]" : "rounded-full",
                      // A marca do escolhido é PIP NEUTRO (§2): tinta aqui
                      // era seleção pintada de gesto. Anel, não borda: é
                      // glifo de controle, não filete de superfície (§4).
                      on
                        ? "bg-foreground text-background ring-foreground"
                        : "ring-muted-foreground/50",
                    )}
                  >
                    {on && <Check className="size-3" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] text-foreground">{o.label}</span>
                    {o.description && (
                      <span className="block text-[12px] leading-snug text-muted-foreground">
                        {o.description}
                      </span>
                    )}
                  </span>
                </LinhaDeLista>
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
            className="mt-1.5 w-full rounded-md border border-border bg-transparent px-2 py-1 text-[12px] text-foreground placeholder:text-muted-foreground/70 focus-visible:border-brass/60 focus-visible:outline-none"
          />
        </div>
      )}

      {/* Navegação: setinha p/ passar pelas perguntas; chat continua visível. */}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <button
          onClick={() => setQi((i) => Math.max(0, i - 1))}
          disabled={qi === 0}
          className={cn(controle("compacto"), "border text-foreground transition-colors hover:bg-accent disabled:opacity-40")}
        >
          <ChevronLeft className="size-3.5" /> Anterior
        </button>
        {last ? (
          <button
            onClick={respond}
            disabled={!complete}
            title={!complete ? "Responda todas as perguntas" : undefined}
            className={cn(controle("compacto"), "bg-brass font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50")}
          >
            <Check className="size-3.5" /> Responder
          </button>
        ) : (
          <button
            onClick={() => setQi((i) => Math.min(total - 1, i + 1))}
            disabled={!curAnswered}
            className={cn(controle("compacto"), "bg-brass font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-50")}
          >
            Próxima <ChevronRight className="size-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}
