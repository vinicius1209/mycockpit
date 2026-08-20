// Ações de fim de turno (fork · anotar · diff · 👍/👎 · 🎓) — a régua de ícones
// que mora lado a lado com a `TurnTelemetry`, na MESMA linha (mock B de
// docs/mocks/turno-resumo-README.md).
//
// Saiu do MessageList porque aquele arquivo está no teto da catraca e esta é
// uma peça fechada: tudo aqui é "o que eu faço COM um turno terminado". Cada
// ação tem um gate diferente, de propósito:
//   • fork e diff agem direto (reversíveis, não gravam memória);
//   • 👍/👎 é sinal leve, persistido no próprio item;
//   • nota do humano vira item do fio e VIAJA pro agente (modelo A);
//   • 🎓 exige nota → proposta destilada → confirmação, porque vira memória
//     permanente injetada em turnos futuros.

import { useState } from "react"
import {
  AlertTriangle,
  Check,
  FileDiff,
  GitFork,
  Globe2,
  GraduationCap,
  Loader2,
  PenLine,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { TurnNoteComposer } from "@/components/chat/TurnNote"
import { openDeliveryDiff } from "@/lib/deliveryDiff"
import { SELECTED_FILL } from "@/lib/selection"
import { cn } from "@/lib/utils"
import { useChat, type ChatItem } from "@/store/chat"
import type { FeedbackApi } from "@/components/chat/MessageList"

const THUMB_UP = "👍"
const THUMB_DOWN = "👎"

/** Aviso leve de duplicata: dedup preferível a ruído (nunca grava 2 iguais). */
function toastDuplicate() {
  toast("Já existe uma regra parecida, não salvei de novo.")
}

/** Ações de fim de turno — fork, diff, reação e "virar aprendizado" — ícone-só,
 *  lado a lado com `TurnTelemetry` (mock B). Aprendizado exige nota → proposta
 *  editável → confirmação humana; fork e diff agem direto, sem gate. */
export function TurnActions({
  it,
  feedbackText,
  api,
}: {
  it: Extract<ChatItem, { kind: "result" }>
  feedbackText?: string
  api: FeedbackApi
}) {
  const resultId = it.id
  const agentTurn = feedbackText ?? it.text ?? ""
  const reactions = it.reactions ?? []
  // "idle" | "ask" (input inline) | "card" (propor regra) | "done"
  const [mode, setMode] = useState<"idle" | "ask" | "card" | "done" | "note">("idle")
  const [selectedReaction, setSelectedReaction] = useState<string | null>(
    reactions.at(-1) ?? null,
  )
  const [note, setNote] = useState("")
  const [rule, setRule] = useState("")
  // veredito do juiz de learnability: false = pouco generalizável (avisa, não bloqueia).
  const [learnable, setLearnable] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  async function react(reaction: string) {
    const added = await api.onReact(resultId, reaction)
    setSelectedReaction(added ? reaction : null)
  }

  function openAsk() {
    const negative = selectedReaction === "👎"
    setNote(
      negative
        ? ""
        : selectedReaction
          ? `O que funcionou com ${selectedReaction} e deve se repetir: `
          : "",
    )
    setMode("ask")
  }

  // input enviado → destila (Haiku ou cru) e mostra o card editável (gate humano).
  async function propose() {
    const n = note.trim()
    if (!n) return
    setBusy(true)
    try {
      const candidate = await api.distill(agentTurn, n)
      setRule(candidate.rule)
      setLearnable(candidate.learnable)
      setMode("card")
    } finally {
      setBusy(false)
    }
  }

  async function commit(scope: "global" | "project") {
    const r = rule.trim()
    if (!r) return
    setBusy(true)
    try {
      const r2 = await api.save(r, scope, selectedReaction)
      setMode(r2 === "salva" ? "done" : "idle")
      if (r2 === "duplicata") toastDuplicate()
      if (r2 === "erro") {
        toast.error("Não consegui salvar a regra.", {
          description: "O detalhe está no console. Sua regra NÃO foi gravada.",
        })
      }
    } finally {
      setBusy(false)
    }
  }

  // Diff e Fork agem no convId ATIVO no clique (o card pode estar num turno
  // de conversa em background; é a ativa no clique que importa).
  function onActiveConv(fn: (convId: string) => void) {
    return () => {
      const convId = useChat.getState().activeId
      if (convId) fn(convId)
    }
  }

  return (
    <>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          onClick={() => setMode(mode === "note" ? "idle" : "note")}
          title="Anotar sobre este turno (o agente lê)"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <PenLine className="size-3.5" />
          <span className="sr-only">Anotar sobre este turno</span>
        </button>
        <button
          type="button"
          onClick={onActiveConv((convId) =>
            void useChat.getState().forkConversationAt(convId, resultId),
          )}
          title="Fork: nova conversa a partir daqui"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <GitFork className="size-3.5" />
          <span className="sr-only">Fork: nova conversa a partir daqui</span>
        </button>
        {it.ok && (
          <button
            type="button"
            onClick={onActiveConv(
              (convId) => void openDeliveryDiff({ convId, text: it.text ?? "" }),
            )}
            title="Ver o diff desta entrega"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <FileDiff className="size-3.5" />
            <span className="sr-only">Ver o diff desta entrega</span>
          </button>
        )}
        <span className="mx-0.5 h-3.5 w-px bg-border/60" aria-hidden />
        <button
          type="button"
          onClick={() => void react(THUMB_UP)}
          aria-pressed={reactions.includes(THUMB_UP)}
          title="Gostei"
          className={cn(
            "rounded-md p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            reactions.includes(THUMB_UP)
              ? SELECTED_FILL
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <ThumbsUp className="size-3.5" />
          <span className="sr-only">Gostei</span>
        </button>
        <button
          type="button"
          onClick={() => void react(THUMB_DOWN)}
          aria-pressed={reactions.includes(THUMB_DOWN)}
          title="Precisa melhorar"
          className={cn(
            "rounded-md p-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            reactions.includes(THUMB_DOWN)
              ? SELECTED_FILL
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <ThumbsDown className="size-3.5" />
          <span className="sr-only">Precisa melhorar</span>
        </button>
        <button
          type="button"
          onClick={openAsk}
          title="Transformar em aprendizado"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-brass focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <GraduationCap className="size-3.5" />
          <span className="sr-only">Transformar em aprendizado</span>
        </button>
        {mode === "done" && (
          <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-st-success">
            <Check className="size-3" /> Regra salva
          </span>
        )}
      </div>

      {/* muda de propriedade (legenda de leitura → formulário editável): a
          hairline é permitida aqui pelo §4 do STYLEGUIDE mesmo sem ela ser o
          padrão do resto da barra. `basis-full` força a nova linha dentro do
          mesmo flex-wrap da legenda, sem precisar subir estado pro pai. */}
      {mode === "note" && (
        <TurnNoteComposer
          onCancel={() => setMode("idle")}
          onSave={(text) => {
            const convId = useChat.getState().activeId
            if (convId) {
              void useChat.getState().appendItems(convId, [
                { kind: "note", id: crypto.randomUUID(), text, anchorId: resultId,
                  ts: Date.now() },
              ])
            }
            setMode("idle")
          }}
        />
      )}
      {mode === "ask" && (
        <div className="mt-1.5 flex w-full basis-full items-center gap-1.5 border-t border-border/40 pt-2">
          <input
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void propose()
              if (e.key === "Escape") setMode("idle")
            }}
            placeholder={
              selectedReaction === "👎"
                ? "O que faltou ou deveria mudar?"
                : "O que funcionou e deve se repetir?"
            }
            className="min-w-0 flex-1 rounded-md border bg-background/60 px-2 py-1 text-[12px] outline-none focus:border-brass/60"
          />
          <button
            onClick={() => void propose()}
            disabled={busy || !note.trim()}
            className="shrink-0 rounded-md bg-brass px-2 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              "Propor aprendizado"
            )}
          </button>
          <button
            onClick={() => setMode("idle")}
            aria-label="Cancelar"
            className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {mode === "card" && (
        <div
          className={cn(
            "mt-1.5 flex w-full basis-full flex-col gap-2 rounded-lg border p-2.5",
            learnable === false
              ? "border-st-warning/40 bg-st-warning/5"
              : "border-brass/40 bg-brass/5",
          )}
        >
          {learnable === false ? (
            <div className="flex items-start gap-1.5 text-[11px] text-st-warning">
              <AlertTriangle className="mt-px size-3.5 shrink-0" /> Isso parece
              pouco generalizável, nada óbvio pra virar regra. Salve só se for
              mesmo uma preferência durável.
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <GraduationCap className="size-3.5 text-brass" /> Aprendizado
              proposto, confirme antes de tornar permanente
            </div>
          )}
          <textarea
            value={rule}
            onChange={(e) => setRule(e.target.value)}
            rows={2}
            className="w-full resize-none rounded-md border bg-background/60 px-2 py-1.5 text-[13px] leading-snug outline-none focus:border-brass/60"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => void commit("project")}
              disabled={busy || !rule.trim()}
              className="rounded-md bg-brass px-2.5 py-1 text-[12px] font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              Salvar regra
            </button>
            <button
              onClick={() => void commit("global")}
              disabled={busy || !rule.trim()}
              className="flex items-center gap-1 rounded-md border px-2.5 py-1 text-[12px] transition-colors hover:bg-accent disabled:opacity-40"
            >
              <Globe2 className="size-3.5" /> Salvar como global
            </button>
            <button
              onClick={() => setMode("idle")}
              className="rounded-md px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
            >
              Descartar
            </button>
            {busy && <Loader2 className="size-3.5 animate-spin text-brass" />}
          </div>
        </div>
      )}
    </>
  )
}
