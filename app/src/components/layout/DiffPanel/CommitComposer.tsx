import { useState } from "react"
import { Check, ChevronDown, FileText, Loader2, Sparkles } from "lucide-react"
import { toast } from "sonner"
import { gitCommit } from "@/lib/git"
import { generateCommitMessage } from "@/lib/commitAi"
import { mensagemDaFalhaUtilitaria } from "@/lib/utility/falha"
import { useApp } from "@/store/app"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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
  const hasChanges = totalChanges > 0

  async function handleGenerateAi() {
    if (generating || busy || !hasChanges) return
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
      toast.error(mensagemDaFalhaUtilitaria(e, "Falha ao sugerir a mensagem"))
    } finally {
      setGenerating(false)
    }
  }

  async function handleSubmit() {
    if (busy || !hasChanges) return
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

  // Sem alterações não existe decisão de commit a tomar. O estado limpo já é
  // comunicado pela área de arquivos, então manter o formulário aqui só cria
  // uma falsa ação e domina visualmente o painel.
  if (!hasChanges) return null

  const commitLabel = amend
    ? "Retificar commit"
    : stagedCount > 0
      ? `Criar commit (${stagedCount})`
      : "Criar commit"

  return (
    <div className="shrink-0 border-b border-border/40 px-3 py-2.5">
      <div className="relative">
        <Input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              void handleSubmit()
            }
          }}
          placeholder="Mensagem do commit"
          aria-label="Mensagem do commit"
          aria-invalid={isTitleLong}
          className={cn(
            "h-8 bg-secondary/40 px-2.5 pr-10 text-[12px] shadow-none",
            "focus-visible:bg-secondary/60",
            isTitleLong && "border-st-warning/60 focus-visible:border-st-warning",
          )}
        />

        <Tooltip>
          <TooltipTrigger asChild>
            <span className="absolute top-1 right-1">
              <Button
                type="button"
                variant="ghost"
                size="icone-chip"
                onClick={() => void handleGenerateAi()}
                disabled={generating || busy || !helperModel}
                aria-label="Sugerir mensagem"
              >
                {generating ? (
                  <Loader2 className="animate-spin" />
                ) : (
                  <Sparkles />
                )}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={6}>
            {helperModel
              ? "Sugerir mensagem a partir das alterações"
              : "Ative o modelo auxiliar nas Configurações"}
          </TooltipContent>
        </Tooltip>
      </div>

      {showBody && (
        <div className="mt-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void handleSubmit()
              }
            }}
            rows={3}
            placeholder="Descrição do commit (opcional)"
            aria-label="Descrição do commit"
            className="min-h-20 resize-none bg-secondary/40 px-2.5 py-2 font-mono text-[11px] shadow-none focus-visible:bg-secondary/60"
          />
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        <div className="min-w-0 flex-1">
          {titleLen > 0 && (
            <span
              className={cn(
                "font-mono text-[11px] tabular-nums",
                isTitleLong ? "text-st-warning" : "text-muted-foreground",
              )}
              title="Tamanho recomendado do título: até 72 caracteres"
            >
              {titleLen}/72
            </span>
          )}
        </div>

        <div className="flex items-stretch">
          <Button
            type="button"
            variant="outline"
            size="compacto"
            onClick={() => void handleSubmit()}
            disabled={busy || !title.trim()}
            title={`${commitLabel} (⌘Enter)`}
            className={cn(
              "rounded-r-none px-3",
              amend && "border-st-warning/60 text-st-warning",
            )}
          >
            {busy ? <Loader2 className="animate-spin" /> : <Check />}
            <span>{commitLabel}</span>
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icone-compacto"
                className={cn(
                  "rounded-l-none border-l-0",
                  amend && "border-st-warning/60 text-st-warning",
                )}
                aria-label="Mais opções de commit"
                title="Mais opções de commit"
              >
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-56">
              <DropdownMenuItem
                onSelect={() => {
                  if (showBody) setBody("")
                  setShowBody(!showBody)
                }}
              >
                <FileText />
                {showBody ? "Remover descrição" : "Adicionar descrição"}
              </DropdownMenuItem>
              <DropdownMenuCheckboxItem
                checked={amend}
                onCheckedChange={(checked) => setAmend(checked === true)}
              >
                Retificar o último commit
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  )
}
