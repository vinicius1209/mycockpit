// SALA DE DECISÃO — formulário RICO do gate humano, compartilhado pelas duas
// superfícies (Trabalho: inline na MissionTimeline; Escritório: GateCard do
// missionPanel no dock alargado). Por pergunta: textarea auto-grow (2–~10
// linhas), ditado injetado por prop (MicButton no Trabalho, bridge/voice no
// office — este arquivo NÃO acopla em nenhum dos dois) e ANEXOS pelo pipeline
// existente do composer (colar imagem/PDF, arrastar/soltar e file picker via
// lib/attachments). Submit entrega GateAnswer[] rico pro answerGate — o filtro
// REAL de capacidade acontece lá (splitGateAttachments); aqui o chip só avisa
// (mesmo visual do AttachmentChips do composer). A lógica de rascunho é pura,
// vive em ./gateAnswerDraft e é testada sem DOM.
import { useEffect, useRef, useState, type ReactNode } from "react"
import { Paperclip } from "lucide-react"
import { toast } from "sonner"
import { open } from "@tauri-apps/plugin-dialog"
import { AttachmentChips } from "@/components/chat/ComposerParts"
import { isTauri } from "@/lib/db"
import type { GateAnswer } from "@/lib/missionTypes"
import {
  MAX_ATTACH_COUNT,
  attachPath,
  deleteAttachment,
  revokeAttachmentUrl,
  saveAttachment,
  type Attachment,
} from "@/lib/attachments"
import {
  answeredCount,
  attachableFile,
  clipboardAttachables,
  draftAddAttachments,
  draftAppendText,
  draftRemoveAttachment,
  draftSetText,
  draftsToAnswers,
  initGateDrafts,
  saveFilesAsAttachments,
  type GateDraft,
} from "./gateAnswerDraft"
import { cn } from "@/lib/utils"

/** Teto do auto-grow (~10 linhas de texto @ 20px). Acima disso, scroll. */
const GATE_TA_MAX_PX = 200

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto"
  el.style.height = `${Math.min(el.scrollHeight, GATE_TA_MAX_PX)}px`
}

export function GateAnswerForm({
  convId,
  questions,
  caps,
  destLabel,
  onSubmit,
  submitLabel = "Responder e retomar",
  renderMic,
  compact = false,
}: {
  /** Conversa da missão — os blobs dos anexos moram em attachments/<convId>. */
  convId: string
  questions: string[]
  /** Capacidade de anexo do agent da PRÓXIMA fase (aviso visual no chip; o
   *  filtro real é do answerGate — descartar vira notice, nunca erro). */
  caps: { image: boolean; pdf: boolean }
  /** Rótulo do agent destino pro tooltip do chip não suportado. */
  destLabel: string
  onSubmit: (answers: GateAnswer[]) => void
  submitLabel?: string
  /** Botão de ditado por resposta, injetado pela superfície (Trabalho:
   *  MicButton/stt; Escritório: bridge/voice) — o form não acopla em nenhum. */
  renderMic?: (insert: (text: string) => void) => ReactNode
  /** Dock do office (380→560px): paddings mais justos. */
  compact?: boolean
}) {
  const [drafts, setDrafts] = useState<GateDraft[]>(() =>
    initGateDrafts(questions.length),
  )
  // Gate novo (outra fase/perguntas) ⇒ zera o rascunho.
  useEffect(() => setDrafts(initGateDrafts(questions.length)), [questions])
  const [dragOver, setDragOver] = useState<number | null>(null)
  const taRefs = useRef<(HTMLTextAreaElement | null)[]>([])

  // Auto-grow também quando o texto entra por fora do teclado (ditado/colar).
  useEffect(() => {
    for (const el of taRefs.current) if (el) autoGrow(el)
  }, [drafts])

  async function addFiles(i: number, files: File[]) {
    if (!files.length) return
    const existing = drafts[i]?.attachments.length ?? 0
    const atts = await saveFilesAsAttachments(
      convId,
      files,
      existing,
      saveAttachment,
      (msg) => toast.error(msg),
    )
    if (atts.length) setDrafts((cur) => draftAddAttachments(cur, i, atts))
  }

  // Colar imagem/PDF na resposta: captura os File SÍNCRONO antes do await
  // (F21), preserva o texto colado junto (F20) — mesmo caminho do composer.
  function handlePaste(i: number, e: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (!isTauri() || !convId) return
    const files = clipboardAttachables(e.clipboardData.items)
    if (!files.length) return // texto puro → comportamento default
    e.preventDefault()
    const text = e.clipboardData.getData("text/plain")
    if (text) setDrafts((cur) => draftAppendText(cur, i, text))
    void addFiles(i, files)
  }

  function handleDrop(i: number, e: React.DragEvent) {
    setDragOver(null)
    if (!isTauri() || !convId) return
    const files = [...e.dataTransfer.files].filter(attachableFile)
    if (!files.length) return
    e.preventDefault()
    void addFiles(i, files)
  }

  // File picker (mesmo diálogo do composer) → attachPath vira Attachment real.
  async function pickFiles(i: number) {
    if (!isTauri()) {
      toast("Anexos disponíveis no app (tauri dev)")
      return
    }
    const sel = await open({ multiple: true, title: "Anexar à resposta" })
    if (!sel) return
    const paths = (Array.isArray(sel) ? sel : [sel]).filter(Boolean) as string[]
    const atts: Attachment[] = []
    let count = drafts[i]?.attachments.length ?? 0
    for (const p of paths) {
      if (count >= MAX_ATTACH_COUNT) {
        toast.error(`máx. ${MAX_ATTACH_COUNT} anexos por resposta`)
        break
      }
      try {
        atts.push(await attachPath(convId, p))
        count++
      } catch (err) {
        toast.error(typeof err === "string" ? err : "falha ao anexar")
      }
    }
    if (atts.length) setDrafts((cur) => draftAddAttachments(cur, i, atts))
  }

  function removeAtt(i: number, path: string) {
    setDrafts((cur) => draftRemoveAttachment(cur, i, path))
    revokeAttachmentUrl(path) // ciclo de vida do object URL acompanha o blob
    void deleteAttachment(path)
  }

  const padX = compact ? "px-2.5" : "px-4"

  return (
    <div className="flex flex-col">
      {questions.map((q, i) => (
        <div
          key={i}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(i)
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(e) => handleDrop(i, e)}
          className={cn(
            "border-t border-border py-3 transition-colors first:border-t-0",
            padX,
            dragOver === i && "bg-brass/[0.06]",
          )}
        >
          <p
            id={`gate-q-${convId}-${i}`}
            className="text-[13px] leading-relaxed"
          >
            <span className="mr-1.5 font-mono text-[11px] text-brass">
              {i + 1}.
            </span>
            {q}
          </p>
          <div className="mt-2 rounded-lg border bg-background transition-colors focus-within:border-brass/60">
            <AttachmentChips
              attachments={drafts[i]?.attachments ?? []}
              caps={caps}
              destLabel={destLabel}
              onRemove={(path) => removeAtt(i, path)}
            />
            <textarea
              ref={(el) => {
                taRefs.current[i] = el
              }}
              value={drafts[i]?.text ?? ""}
              onChange={(e) => {
                autoGrow(e.currentTarget)
                setDrafts((cur) => draftSetText(cur, i, e.target.value))
              }}
              onPaste={(e) => handlePaste(i, e)}
              rows={2}
              placeholder="Em branco = o agente decide… (cole imagem/PDF; arraste arquivos)"
              aria-labelledby={`gate-q-${convId}-${i}`}
              className="max-h-[200px] w-full resize-none bg-transparent px-3 pt-2 text-[12.5px] leading-relaxed outline-none placeholder:text-muted-foreground/60"
            />
            <div className="flex items-center gap-0.5 px-1.5 pb-1.5">
              <button
                type="button"
                onClick={() => void pickFiles(i)}
                title="Anexar arquivo à resposta (imagem/PDF)"
                aria-label={`Anexar arquivo à resposta ${i + 1}`}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Paperclip className="size-3.5" />
              </button>
              {renderMic?.((text) =>
                setDrafts((cur) => draftAppendText(cur, i, text)),
              )}
            </div>
          </div>
        </div>
      ))}
      <div
        className={cn(
          "flex items-center gap-3 border-t border-brass/20 bg-brass/[0.03] py-3",
          padX,
        )}
      >
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {answeredCount(drafts)} de {questions.length} respondidas
        </span>
        <button
          type="button"
          onClick={() => onSubmit(draftsToAnswers(drafts))}
          className="ml-auto rounded-lg bg-brass px-4 py-2 text-[12.5px] font-semibold text-brass-foreground transition-opacity hover:opacity-90"
        >
          {submitLabel}
        </button>
      </div>
    </div>
  )
}
