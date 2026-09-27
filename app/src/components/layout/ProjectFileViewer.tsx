import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Copy, Eye, FileWarning, FolderOpen, LoaderCircle, Lock, Pencil, SquareArrowOutUpRight } from "lucide-react"
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener"
import { avisar } from "@/lib/avisos"
import { Markdown } from "@/components/common/Markdown"
import { OpenInEditor } from "@/components/common/OpenInEditor"
import { Button } from "@/components/ui/button"
import { controle } from "@/components/ui/controle"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { copyText } from "@/lib/clipboard"
import { isTauri } from "@/lib/db"
import {
  arquivoSumiu,
  assertSafeRasterImage,
  imageMimeType,
  projectFilePreviewKind,
  sondaDoProtocolo,
  urlDoArquivo,
  type RasterDimensions,
} from "@/lib/projectFilePreview"
import { PlayerDeVideo, fmtTempo, type InfoDoVideo } from "@/components/layout/PlayerDeVideo"
import { readProjectFileBytes, readTextFile } from "@/lib/sources"
import { detectLanguage, highlightCode } from "@/lib/syntaxHighlight"
import { obterDaAba, textoAtual } from "@/lib/edicao/buffers"
import { useEdicao } from "@/store/edicao"

/** O editor (CodeMirror) só carrega quando um arquivo de texto abre. Enquanto
 *  isso, e se ele falhar, a tela é o `CodePreview` estático. */
const CodeEditor = lazy(() => import("@/components/editor/CodeEditor"))

type PreviewState =
  | { status: "loading" }
  | { status: "unsupported" }
  | { status: "error"; message: string }
  /** O arquivo não está mais no disco (ADR-243): a aba fica, e diz isso. */
  | { status: "sumiu" }
  | { status: "text"; content: string }
  /** Vídeo, áudio, PDF e SVG: servidos pelo protocolo, em partes (ADR-240). */
  | { status: "midia"; url: string }
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

export function ProjectFileViewer({
  root,
  path,
  convId = null,
  acoes,
  onSumiu,
  aoFecharSumido,
}: {
  root: string
  path: string
  /** A conversa que tem esta aba: vira dona do texto em edição. */
  convId?: string | null
  /** Botões da aba no fim do cabeçalho (lado a lado, trazer para a tira). */
  acoes?: ReactNode
  /** Avisa, a cada leitura, se o arquivo saiu do disco. */
  onSumiu?: (sumiu: boolean) => void
  aoFecharSumido?: () => void
}) {
  const kind = projectFilePreviewKind(path)
  // O editor abre por caminho relativo ao projeto; fora dele não há o que
  // prometer, então o botão não existe (degradação honesta).
  const externo = path.startsWith("/")
  const [state, setState] = useState<PreviewState>(() =>
    kind === "unsupported" ? { status: "unsupported" } : { status: "loading" },
  )
  const [infoDoVideo, setInfoDoVideo] = useState<InfoDoVideo | null>(null)
  const [tamanho, setTamanho] = useState<number | null>(null)
  /** Motivo de só leitura que o editor informou; `null` = grava. */
  const [soLeitura, setSoLeitura] = useState<string | null>(null)
  const abaDoModo = `${root}\0${path}`
  const modo = useEdicao((s) => s.modo[abaDoModo] ?? "previa")
  const noEditor = state.status === "text" && (kind !== "markdown" || modo === "editor")
  const midia = kind === "video" || kind === "audio" || kind === "pdf" || kind === "svg"
  // O aviso vai por ref para o efeito depender só do status: o `onSumiu` chega
  // como função nova a cada render, e nas dependências relançaria o aviso.
  const avisarSumico = useRef(onSumiu)
  useEffect(() => {
    avisarSumico.current = onSumiu
  })
  useEffect(() => {
    if (state.status !== "loading") avisarSumico.current?.(state.status === "sumiu")
  }, [state.status])

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    if (kind === "unsupported") {
      setState({ status: "unsupported" })
      if (isTauri()) {
        void sondaDoProtocolo(urlDoArquivo(root, absolutePath(root, path))).then((r) => {
          if (cancelled) return
          setTamanho(r.tamanho)
          if (r.sumiu) setState({ status: "sumiu" })
        })
      }
      return () => {
        cancelled = true
      }
    }
    if (!isTauri()) {
      setState({ status: "error", message: "A leitura de arquivos está disponível no aplicativo." })
      return
    }
    setState({ status: "loading" })
    setSoLeitura(null)
    const fullPath = absolutePath(root, path)
    setInfoDoVideo(null)
    setTamanho(null)
    if (midia) {
      const url = urlDoArquivo(root, fullPath)
      void sondaDoProtocolo(url).then((r) => {
        if (cancelled) return
        setTamanho(r.tamanho)
        if (r.sumiu) setState({ status: "sumiu" })
      })
      setState({ status: "midia", url })
      return () => {
        cancelled = true
      }
    }

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
        if (cancelled) return
        const message = errorMessage(error)
        setState(arquivoSumiu(message) ? { status: "sumiu" } : { status: "error", message })
      }
    }

    void load()
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [kind, midia, path, root])

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
        {state.status === "midia" && (infoDoVideo || tamanho != null) && (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/55">
            {[
              infoDoVideo ? `${infoDoVideo.largura} × ${infoDoVideo.altura}` : null,
              infoDoVideo ? fmtTempo(infoDoVideo.duracao) : null,
              tamanho != null ? formatBytes(tamanho) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icone-compacto"
          onClick={() => {
            void copyText(path).then((copied) => {
              if (copied) avisar.feito(`Caminho de ${path.split("/").pop() || path} copiado.`)
            })
          }}
          aria-label="Copiar caminho"
          title="Copiar caminho"
        >
          <Copy className="size-3.5" />
        </Button>
        {noEditor && soLeitura && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className={`${controle("chip")} bg-secondary text-muted-foreground`}>
                <Lock className="size-3" />
                Só leitura
              </span>
            </TooltipTrigger>
            <TooltipContent>{soLeitura}</TooltipContent>
          </Tooltip>
        )}
        {kind === "markdown" && state.status === "text" && (
          <Button
            type="button"
            variant="ghost"
            size="compacto"
            onClick={() => useEdicao.getState().setModo(abaDoModo, modo === "editor" ? "previa" : "editor")}
          >
            {modo === "editor" ? <Eye /> : <Pencil />}
            {modo === "editor" ? "Ver prévia" : "Editar"}
          </Button>
        )}
        {!externo && <OpenInEditor projectPath={root} rel={path} alvo="o arquivo" />}
        {acoes}
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
      ) : state.status === "sumiu" ? (
        <div className="grid min-h-0 flex-1 place-items-center px-8">
          <div className="max-w-md text-center">
            <FileWarning className="mx-auto mb-3 size-5 text-muted-foreground/60" />
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Este arquivo não está mais em <span className="font-mono text-[12px] text-foreground/80">{path}</span>. Pode ter
              sido movido, renomeado ou apagado.
            </p>
            {aoFecharSumido && (
              <Button size="compacto" variant="secondary" className="mt-3" onClick={aoFecharSumido}>
                Fechar a aba
              </Button>
            )}
          </div>
        </div>
      ) : state.status === "unsupported" ? (
        <SemPrevia caminho={path} completo={absolutePath(root, path)} tamanho={tamanho} />
      ) : state.status === "midia" ? (
        kind === "video" ? (
          <PlayerDeVideo url={state.url} caminho={path} onInfo={setInfoDoVideo} />
        ) : kind === "audio" ? (
          <div className="grid min-h-0 flex-1 place-items-center px-8">
            <audio src={state.url} controls preload="metadata" className="w-full max-w-xl" />
          </div>
        ) : kind === "pdf" ? (
          <iframe src={state.url} title={path} className="min-h-0 w-full flex-1 bg-background" />
        ) : (
          <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-background/50 p-6">
            <img src={state.url} alt={path.split("/").pop() || path} draggable={false} className="max-h-full max-w-full object-contain" />
          </div>
        )
      ) : state.status === "image" ? (
        <div className="grid min-h-0 flex-1 place-items-center overflow-auto bg-background/50 p-6">
          <img
            src={state.url}
            alt={path.split("/").pop() || path}
            draggable={false}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      ) : !noEditor ? (
        <div data-selectable className="min-h-0 flex-1 overflow-auto select-text">
          <div className="mx-auto max-w-4xl px-6 py-5">
            {/* Com texto em edição, a prévia mostra o texto, não o disco. */}
            <Markdown text={textoDoBuffer(root, path) ?? state.content} />
          </div>
        </div>
      ) : (
        <Suspense fallback={<CodePreview path={path} content={state.content} />}>
          <CodeEditor
            root={root}
            chave={path}
            convId={convId}
            reserva={<CodePreview path={path} content={state.content} />}
            aoFechar={aoFecharSumido}
            aoMotivo={setSoLeitura}
          />
        </Suspense>
      )}
    </div>
  )
}

function textoDoBuffer(root: string, path: string): string | null {
  const b = obterDaAba(root, path)
  return b ? textoAtual(b) : null
}

/** Formato sem leitor na tela (zip, docx…): em vez de beco sem saída, o que é,
 *  o tamanho, e os dois caminhos para seguir (ADR-240). */
function SemPrevia({ caminho, completo, tamanho }: { caminho: string; completo: string; tamanho: number | null }) {
  const nome = caminho.split("/").pop() || caminho
  const ext = nome.includes(".") ? nome.split(".").pop()!.toUpperCase().slice(0, 4) : "?"
  const falhou = (erro: unknown) => avisar.erro(`Não consegui abrir ${nome}.`, { detalhe: errorMessage(erro) })
  return (
    <div className="grid min-h-0 flex-1 place-items-center px-8">
      <div className="w-full max-w-sm rounded-xl border bg-card p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-13 w-11 shrink-0 place-items-center rounded-md bg-secondary font-mono text-[11px] font-semibold text-muted-foreground">
            {ext}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] text-foreground">{nome}</p>
            <p className="font-mono text-[11px] text-muted-foreground tabular-nums">
              Sem prévia na Frota{tamanho != null ? ` · ${formatBytes(tamanho)}` : ""}
            </p>
          </div>
        </div>
        {isTauri() && (
          <div className="mt-3 flex gap-2">
            <Button size="compacto" onClick={() => void openPath(completo).catch(falhou)}>
              <SquareArrowOutUpRight />
              Abrir no app padrão
            </Button>
            <Button size="compacto" variant="secondary" onClick={() => void revealItemInDir(completo).catch(falhou)}>
              <FolderOpen />
              Mostrar na pasta
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
