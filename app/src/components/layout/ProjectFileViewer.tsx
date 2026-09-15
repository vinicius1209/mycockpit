import { useEffect, useMemo, useState } from "react"
import { Copy, FileWarning, LoaderCircle } from "lucide-react"
import { toast } from "sonner"
import { Markdown } from "@/components/common/Markdown"
import { OpenInEditor } from "@/components/common/OpenInEditor"
import { Button } from "@/components/ui/button"
import { copyText } from "@/lib/clipboard"
import { isTauri } from "@/lib/db"
import {
  assertSafeRasterImage,
  imageMimeType,
  projectFilePreviewKind,
  type RasterDimensions,
} from "@/lib/projectFilePreview"
import { readProjectFileBytes, readTextFile } from "@/lib/sources"
import { detectLanguage, highlightCode } from "@/lib/syntaxHighlight"

type PreviewState =
  | { status: "loading" }
  | { status: "unsupported" }
  | { status: "error"; message: string }
  | { status: "text"; content: string }
  | {
      status: "image"
      url: string
      dimensions: RasterDimensions
      bytes: number
    }

/** Caminho absoluto chega quando o fio cita um arquivo fora do projeto, numa
 *  raiz que o Rust autoriza (a captura no brain do agy). Ele segue como está;
 *  a contenção continua no `scoped_file_path`. */
function absolutePath(root: string, path: string): string {
  if (path.startsWith("/")) return path
  return `${root.replace(/\/$/, "")}/${path}`
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === "string" && error.trim()) return error
  return "Não foi possível abrir este arquivo."
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function CodePreview({ path, content }: { path: string; content: string }) {
  const language = detectLanguage(path)
  const html = useMemo(() => highlightCode(content, language), [content, language])
  const lineNumbers = useMemo(
    () => Array.from({ length: content.split("\n").length }, (_, index) => index + 1).join("\n"),
    [content],
  )

  return (
    <div data-selectable className="min-h-0 flex-1 overflow-auto bg-background/40 select-text">
      <div className="flex min-w-max items-stretch">
        <pre
          aria-hidden="true"
          className="sticky left-0 z-10 min-h-full border-r border-border/40 bg-card px-3 py-4 text-right font-mono text-[12px] leading-[1.55] tabular-nums text-muted-foreground/40 select-none"
        >
          {lineNumbers}
        </pre>
        <pre className="min-h-full flex-1 px-4 py-4 font-mono text-[12px] leading-[1.55] text-foreground/90">
          <code
            className="hljs bg-transparent p-0"
            // `highlightCode` escapa o fallback e o highlight.js devolve só
            // spans de tokens. Texto do arquivo nunca entra como HTML cru.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        </pre>
      </div>
    </div>
  )
}

export function ProjectFileViewer({ root, path }: { root: string; path: string }) {
  const kind = projectFilePreviewKind(path)
  // O editor abre por caminho relativo ao projeto; fora dele não há o que
  // prometer, então o botão não existe (degradação honesta).
  const externo = path.startsWith("/")
  const [state, setState] = useState<PreviewState>(() =>
    kind === "unsupported" ? { status: "unsupported" } : { status: "loading" },
  )

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    if (kind === "unsupported") {
      setState({ status: "unsupported" })
      return
    }
    if (!isTauri()) {
      setState({ status: "error", message: "A leitura de arquivos está disponível no aplicativo." })
      return
    }
    setState({ status: "loading" })
    const fullPath = absolutePath(root, path)

    async function load() {
      try {
        if (kind === "image") {
          const mime = imageMimeType(path)
          if (!mime) throw new Error("Este formato de imagem não é compatível.")
          const bytes = await readProjectFileBytes(root, fullPath)
          const dimensions = assertSafeRasterImage(bytes, mime)
          if (cancelled) return
          // A resposta IPC pode ser tipada como `ArrayBufferLike`; a cópia
          // torna o buffer inequivocamente próprio antes de entregá-lo ao Blob.
          const ownedBuffer = Uint8Array.from(bytes).buffer
          objectUrl = URL.createObjectURL(new Blob([ownedBuffer], { type: mime }))
          setState({ status: "image", url: objectUrl, dimensions, bytes: bytes.byteLength })
          return
        }
        const content = await readTextFile(root, fullPath)
        if (!cancelled) setState({ status: "text", content })
      } catch (error) {
        if (!cancelled) setState({ status: "error", message: errorMessage(error) })
      }
    }

    void load()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [kind, path, root])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border/40 bg-card px-4">
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/80" title={path}>
          {path}
        </span>
        {state.status === "image" && (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/55">
            {state.dimensions.width} × {state.dimensions.height} · {formatBytes(state.bytes)}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icone-compacto"
          onClick={() => {
            void copyText(path).then((copied) => {
              if (copied) toast.success("Caminho copiado")
            })
          }}
          aria-label="Copiar caminho"
          title="Copiar caminho"
        >
          <Copy className="size-3.5" />
        </Button>
        {!externo && <OpenInEditor projectPath={root} rel={path} alvo="o arquivo" />}
      </div>

      {state.status === "loading" ? (
        <div className="grid min-h-0 flex-1 place-items-center text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-label="Abrindo arquivo" />
        </div>
      ) : state.status === "error" ? (
        <div className="grid min-h-0 flex-1 place-items-center px-8">
          <div className="max-w-md text-center">
            <FileWarning className="mx-auto mb-3 size-5 text-muted-foreground/60" />
            <p className="text-[13px] text-foreground">Não foi possível visualizar o arquivo</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{state.message}</p>
          </div>
        </div>
      ) : state.status === "unsupported" ? (
        <div className="grid min-h-0 flex-1 place-items-center px-8">
          <div className="max-w-md text-center">
            <FileWarning className="mx-auto mb-3 size-5 text-muted-foreground/60" />
            <p className="text-[13px] text-foreground">Pré-visualização indisponível</p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Este formato continua disponível para abrir no editor do sistema.
            </p>
          </div>
        </div>
      ) : state.status === "image" ? (
        <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-background/50 p-6">
          <img
            src={state.url}
            alt={path.split("/").pop() || path}
            draggable={false}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      ) : kind === "markdown" ? (
        <div data-selectable className="min-h-0 flex-1 overflow-auto select-text">
          <div className="mx-auto max-w-4xl px-6 py-5">
            <Markdown text={state.content} />
          </div>
        </div>
      ) : (
        <CodePreview path={path} content={state.content} />
      )}
    </div>
  )
}
