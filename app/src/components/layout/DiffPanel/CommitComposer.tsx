import { useState } from "react"
import { Check, ChevronDown, ChevronRight, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { gitCommit } from "@/lib/git"
import { generateCommitMessage } from "@/lib/commitAi"
import { useApp } from "@/store/app"
import { controle, iconeDeControle } from "@/components/ui/controle"
import { cn } from "@/lib/utils"

export function CommitComposer({
  cwd,
  stagedCount,
  totalChanges,
  onCommitted,
}: {
  cwd: string
  stagedCount: number
  totalChanges: number
  onCommitted: () => void
}) {
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [showBody, setShowBody] = useState(false)
  const [amend, setAmend] = useState(false)
  const [busy, setBusy] = useState(false)
  const [generating, setGenerating] = useState(false)

  const helperModel = useApp((s) => s.settings.helperModel)

  async function handleGenerateAi() {
    if (generating) return
    if (!helperModel) {
      toast.error("Ative o modelo auxiliar nas Configurações para sugerir a mensagem")
      return
    }
    setGenerating(true)
    try {
      const msg = await generateCommitMessage(cwd, helperModel)
      if (msg) {
        setTitle(msg.title)
        if (msg.body) {
          setBody(msg.body)
          setShowBody(true)
        }
        toast.success("Mensagem sugerida")
      } else {
        toast.error("Não foi possível sugerir a mensagem de commit")
      }
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha ao sugerir a mensagem")
    } finally {
      setGenerating(false)
    }
  }

  async function handleSubmit() {
    const cleanTitle = title.trim()
    if (!cleanTitle) {
      toast.error("Informe o título do commit")
      return
    }
    const cleanBody = body.trim()
    const fullMessage = cleanBody ? `${cleanTitle}\n\n${cleanBody}` : cleanTitle

    setBusy(true)
    try {
      // Se tiver arquivos em stage, comita apenas eles (stageAll: false).
      // Se não tiver nenhum em stage, faz stageAll: true automaticamente.
      const stageAll = stagedCount === 0
      const sha = await gitCommit(cwd, fullMessage, { amend, stageAll })
      toast.success(amend ? `Commit ${sha} retificado` : `Commit ${sha} criado`)
      setTitle("")
      setBody("")
      setShowBody(false)
      setAmend(false)
      onCommitted()
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha ao commitar")
    } finally {
      setBusy(false)
    }
  }

  const titleLen = title.length
  const isTitleLong = titleLen > 72
  const hasChanges = totalChanges > 0

  return (
    <div className="shrink-0 border-b border-border/40 bg-card/60 p-3">
      {/* Campo de título */}
      <div className="relative">
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void handleSubmit()
            }
          }}
          placeholder="Mensagem do commit (⌘Enter para criar)…"
          className={cn(
            "w-full rounded-md border bg-secondary/40 px-2.5 py-1.5 pr-14 text-[12px] text-foreground outline-none",
            "focus:border-brass/50 focus:bg-secondary/60",
            isTitleLong ? "border-st-warning/60" : "border",
          )}
        />
        <span
          className={cn(
            "pointer-events-none absolute top-1.5 right-2 font-mono text-[11px] tabular-nums",
            isTitleLong ? "text-st-warning" : "text-muted-foreground/60",
          )}
          title="Tamanho recomendado do título: até 72 caracteres"
        >
          {titleLen}/72
        </span>
      </div>

      {/* Descrição estendida colapsável */}
      {showBody && (
        <div className="mt-2">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void handleSubmit()
              }
            }}
            rows={3}
            placeholder="Descrição detalhada ou tópicos (opcional)…"
            className="w-full resize-none rounded-md border border-border/40 bg-secondary/40 p-2 font-mono text-[11px] text-foreground outline-none transition-colors focus:border-brass/50 focus:bg-secondary/60"
          />
        </div>
      )}

      {/* Barra de ações e opções */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Botão de gerar com IA */}
          <button
            type="button"
            onClick={() => void handleGenerateAi()}
            disabled={generating || busy || !hasChanges || !helperModel}
            title={
              helperModel
                ? "Sugerir mensagem a partir das alterações"
                : "Ative o modelo auxiliar nas Configurações"
            }
            className={cn(
              controle("chip"),
              "border border-brass/30 bg-brass/10 text-brass hover:bg-brass/20 disabled:opacity-40",
            )}
          >
            {generating ? (
              <Loader2 className={cn(iconeDeControle("chip"), "animate-spin")} />
            ) : (
              <Sparkles className={iconeDeControle("chip")} />
            )}
            <span>Sugerir</span>
          </button>

          {/* Alternador de corpo/descrição */}
          <button
            type="button"
            onClick={() => setShowBody(!showBody)}
            title={showBody ? "Ocultar descrição" : "Adicionar descrição estendida"}
            className={cn(
              controle("chip"),
              "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
          >
            {showBody ? (
              <ChevronDown className={iconeDeControle("chip")} />
            ) : (
              <ChevronRight className={iconeDeControle("chip")} />
            )}
            <span>Descrição</span>
          </button>

          {/* Retificação do commit anterior. */}
          <label className="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground select-none hover:text-foreground">
            <input
              type="checkbox"
              checked={amend}
              onChange={(e) => setAmend(e.target.checked)}
              className="size-3 rounded border-border accent-brass"
            />
            <span>Retificar</span>
          </label>
        </div>

        {/* Botão principal de comitar */}
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={busy || !title.trim() || !hasChanges}
          className={cn(
            controle("compacto"),
            "bg-primary font-medium text-primary-foreground shadow-xs transition-colors hover:bg-primary/90 disabled:opacity-40",
          )}
        >
          {busy ? (
            <Loader2 className={cn(iconeDeControle("compacto"), "animate-spin")} />
          ) : (
            <Check className={iconeDeControle("compacto")} />
          )}
          <span>
            {stagedCount > 0
              ? `Criar commit (${stagedCount})`
              : amend
                ? "Retificar commit"
                : "Criar commit"}
          </span>
        </button>
      </div>
    </div>
  )
}
