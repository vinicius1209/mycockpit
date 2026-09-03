import { useEffect, useState } from "react"
import { Copy, Check, ExternalLink } from "lucide-react"
import { toast } from "sonner"
import { AppDialog } from "@/components/ui/app-dialog"
import { Button } from "@/components/ui/button"
import { Markdown } from "@/components/common/Markdown"
import { readTextFile } from "@/lib/sources"
import { copyText } from "@/lib/clipboard"
import { openInEditor, pickEditor } from "@/lib/editors"
import { useEditors } from "@/store/editors"
import { useActiveProject, useApp } from "@/store/app"
import { useMarkdownViewer } from "@/store/markdownViewer"

function caminhoRelativoAoProjeto(root: string, path: string | null): string | null {
  if (!path) return null
  const alvo = path.replace(/\\/g, "/")
  if (!alvo.startsWith("/")) return alvo
  const base = root.replace(/\\/g, "/").replace(/\/+$/, "")
  if (!base || !alvo.startsWith(`${base}/`)) return null
  return alvo.slice(base.length + 1)
}

export function MarkdownViewerDialog() {
  const { open, path, title, projectPath, closeViewer } = useMarkdownViewer()
  const activeProject = useActiveProject()
  const [content, setContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const detected = useEditors((s) => s.detected)
  const ensure = useEditors((s) => s.ensure)
  const preferred = useApp((s) => s.settings.preferredEditor)

  useEffect(() => {
    if (open) ensure()
  }, [open, ensure])

  const root = projectPath || activeProject?.path || ""
  const editor = pickEditor(detected ?? [], preferred)
  const editorTarget = caminhoRelativoAoProjeto(root, path)

  useEffect(() => {
    if (!open || !path) {
      setContent(null)
      return
    }
    let cancelled = false
    setContent(null)
    setLoading(true)
    readTextFile(root, path)
      .then((text) => {
        if (!cancelled) setContent(text)
      })
      .catch((err) => {
        if (!cancelled) {
          console.error("[markdown-viewer] erro ao ler arquivo", err)
          setContent(null)
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, path, root])

  const handleCopy = async () => {
    if (content === null) return
    const ok = await copyText(content)
    if (ok) {
      setCopied(true)
      toast.success("Conteúdo copiado")
      setTimeout(() => setCopied(false), 1400)
    }
  }

  const handleOpenInEditor = async () => {
    if (!editor || !editorTarget) return
    try {
      await openInEditor({
        editor: editor.id,
        projectPath: root,
        rel: editorTarget,
      })
    } catch (err) {
      console.error("[markdown-viewer] erro ao abrir no editor", err)
      toast.error(typeof err === "string" ? err : "Não consegui abrir no editor")
    }
  }

  return (
    <AppDialog
      open={open}
      onOpenChange={(o) => !o && closeViewer()}
      size="xl"
      className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0"
      title={
        <span className="block truncate px-6 pt-5 pr-12 font-mono text-[14px]">
          {title || "Documento"}
        </span>
      }
      description={
        path ? (
          <span className="block truncate px-6 pb-3 font-mono text-[11px] text-muted-foreground">
            {path}
          </span>
        ) : undefined
      }
    >
      <div className="flex shrink-0 items-center justify-end gap-1.5 border-b border-border/40 px-6 py-2">
        <Button
          variant="outline"
          size="compacto"
          onClick={() => void handleCopy()}
          disabled={content === null}
          title="Copiar texto do documento"
        >
          {copied ? (
            <Check className="size-3.5" />
          ) : (
            <Copy className="size-3.5" />
          )}
          <span>{copied ? "Copiado" : "Copiar"}</span>
        </Button>
        {editor && editorTarget && (
          <Button
            variant="outline"
            size="compacto"
            onClick={() => void handleOpenInEditor()}
            title={`Abrir no ${editor.label}`}
          >
            <ExternalLink className="size-3.5" />
            <span>{editor.label}</span>
          </Button>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <p className="text-[13px] text-muted-foreground">carregando…</p>
        ) : content !== null ? (
          <div className="prose dark:prose-invert max-w-none text-[13px] leading-relaxed">
            <Markdown text={content} />
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Não foi possível carregar o conteúdo do arquivo.
          </p>
        )}
      </div>
    </AppDialog>
  )
}
