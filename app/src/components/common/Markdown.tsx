import { memo, useRef, useState, type ReactNode } from "react"
import ReactMarkdown, { defaultUrlTransform } from "react-markdown"
import type { Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { needsPlainText } from "./markdownBudget"
import { PlainTextPages } from "./PlainTextPages"
import { Check, Copy } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { openUrl } from "@tauri-apps/plugin-opener"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { copyRich, copyText } from "@/lib/clipboard"
import { conteudoDaTabela, lerTabela, type DestinoDaTabela } from "@/lib/tabelaClipboard"
import {
  formatFileOpenTooltip,
  isFileMention,
  isImagePath,
  isWebUrl,
  parseFileTarget,
} from "@/lib/fileLink"
import { useActiveProject } from "@/store/app"
import { abrirMencaoDeArquivo } from "@/components/common/abrirMencaoDeArquivo"
import { ImagemCitadaThumb } from "@/components/common/ImagemCitadaThumb"

/** Botão de copiar no canto, aparece no hover. `group` = classe do grupo pai
 *  (group/code, group/table…) pra só aparecer no hover DAQUELE bloco. */
function CopyButton({
  onCopy,
  group,
}: {
  onCopy: () => string
  group: string
}) {
  const [copied, setCopied] = useState(false)
  function copy() {
    const text = onCopy()
    void copyText(text).then((ok) => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  }
  return (
    <button
      type="button"
      onClick={copy}
      className={cn(
        "absolute top-2 right-2 z-10 rounded-md border bg-card/80 p-1 text-muted-foreground opacity-0 transition hover:text-foreground",
        group,
      )}
      aria-label="Copiar"
      title="Copiar"
    >
      {copied ? (
        <Check className="size-3 text-st-success" />
      ) : (
        <Copy className="size-3" />
      )}
    </button>
  )
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  return (
    <div className="group/code relative mb-2">
      <CopyButton
        group="group-hover/code:opacity-100"
        onCopy={() => ref.current?.textContent ?? ""}
      />
      <pre
        ref={ref}
        className="overflow-auto rounded-md border bg-background/50 p-3 text-[13px] leading-relaxed"
      >
        {children}
      </pre>
    </div>
  )
}

/** Tabela markdown com "copiar" no hover que pergunta o destino (capricho
 *  PRD R1): planilha leva TSV + HTML, Markdown leva GFM. */
function TableBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLTableElement>(null)
  const [copied, setCopied] = useState(false)
  const copiar = (destino: DestinoDaTabela) => {
    if (!ref.current) return
    const conteudo = conteudoDaTabela(lerTabela(ref.current), destino)
    void copyRich(conteudo, destino === "planilha" ? "Tabela copiada para planilha" : "Tabela copiada como Markdown").then(
      (ok) => {
        if (!ok) return
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
      },
    )
  }
  return (
    <div className="group/table relative mb-2 overflow-x-auto rounded-md border">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="absolute top-2 right-2 z-10 rounded-md border bg-card/80 p-1 text-muted-foreground opacity-0 transition group-hover/table:opacity-100 hover:text-foreground focus-visible:opacity-100 data-[state=open]:opacity-100"
            aria-label="Copiar tabela"
            title="Copiar tabela"
          >
            {copied ? <Check className="size-3 text-foreground" /> : <Copy className="size-3" />}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="border-border/40">
          <DropdownMenuItem onSelect={() => copiar("planilha")} className="text-[12px]">
            Para planilha
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copiar("markdown")} className="text-[12px]">
            Como Markdown
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <table ref={ref} className="w-full border-collapse text-[13px]">
        {children}
      </table>
    </div>
  )
}

/** Blockquote com copiar-o-texto no hover. */
function QuoteBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLQuoteElement>(null)
  return (
    <div className="group/quote relative mb-2">
      <CopyButton
        group="group-hover/quote:opacity-100"
        onCopy={() => ref.current?.textContent ?? ""}
      />
      <blockquote
        ref={ref}
        className="border-l-2 border-brass/40 pl-3 text-foreground/80"
      >
        {children}
      </blockquote>
    </div>
  )
}

function MarkdownLink({
  children,
  href,
}: {
  children?: ReactNode
  href?: string
}) {
  const project = useActiveProject()
  const target = parseFileTarget(href, project?.path)
  const isWeb = isWebUrl(href)

  const handleClick = (e: React.MouseEvent) => {
    // Guarda de seleção: se o usuário estava arrastando pra selecionar texto, não navega
    const sel = window.getSelection()?.toString()
    if (sel && sel.trim().length > 0) return

    // Nada que não seja http/https segue o comportamento padrão do anchor.
    //
    // Este markdown vem do AGENTE, e o `customUrlTransform` deixa `file://`
    // passar de propósito (é como o caminho de arquivo chega até aqui). Sem
    // esta linha, um `[x](file:///etc/passwd)` — ou qualquer caminho FORA do
    // projeto, que o `parseFileTarget` corretamente recusa — não caía em
    // nenhum dos dois ramos abaixo, ninguém chamava `preventDefault`, e a
    // webview recebia a URL pra abrir sozinha (o app não declara CSP nem
    // guarda de navegação). Quem abre arquivo aqui somos nós, sempre; quando
    // não dá pra abrir, o desfecho é não fazer nada.
    if (!isWeb) e.preventDefault()

    if (isWeb && href) {
      e.preventDefault()
      void openUrl(href).catch((err) => {
        console.error("[markdown] não consegui abrir url", err)
        toast.error("Não consegui abrir o link no navegador")
      })
      return
    }

    if (target) {
      e.preventDefault()
      void abrirMencaoDeArquivo(target, project?.path)
    }
  }

  const title = target
    ? formatFileOpenTooltip(target.rel)
    : isWeb
      ? `Abrir ${href} no navegador`
      : undefined

  // Imagem com caminho concreto ganha miniatura logo abaixo do link. Nome
  // solto (`captura.png`) não: sem pasta seria chute, e o clique já resolve.
  const imagem =
    target && isImagePath(target.rel) && (target.abs || target.rel.includes("/"))
      ? (target.abs ?? target.rel)
      : null

  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={handleClick}
        title={title}
        data-ctx-arquivo={target?.rel}
        data-ctx-arquivo-abs={target?.abs}
        data-ctx-arquivo-linha={target?.line ?? undefined}
        className="cursor-pointer text-brass underline underline-offset-2 transition-opacity hover:opacity-80"
      >
        {children}
      </a>
      {imagem && <ImagemCitadaThumb root={project?.path ?? ""} path={imagem} />}
    </>
  )
}

function MarkdownInlineCode({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  const text = typeof children === "string" ? children : String(children ?? "")
  const isFile = isFileMention(text)
  const project = useActiveProject()
  const target = isFile ? parseFileTarget(text, project?.path) : null

  if (target) {
    const handleClick = (e: React.MouseEvent) => {
      const sel = window.getSelection()?.toString()
      if (sel && sel.trim().length > 0) return
      e.preventDefault()
      void abrirMencaoDeArquivo(target, project?.path)
    }

    const title = formatFileOpenTooltip(target.rel)

    return (
      <code
        onClick={handleClick}
        title={title}
        data-ctx-arquivo={target.rel}
        data-ctx-arquivo-abs={target.abs}
        data-ctx-arquivo-linha={target.line ?? undefined}
        className={cn(
          "cursor-pointer rounded bg-brass/10 px-1 py-0.5 font-mono text-[13px] text-brass underline-offset-2 transition-colors hover:bg-brass/20 hover:underline",
          className,
        )}
      >
        {children}
      </code>
    )
  }

  return (
    <code
      className={cn(
        "rounded bg-secondary px-1 py-0.5 font-mono text-[13px]",
        className,
      )}
    >
      {children}
    </code>
  )
}

/** Permite esquemas seguros como file:// além dos defaults do react-markdown. */
function customUrlTransform(url: string): string {
  if (/^file:\/\//i.test(url)) return url
  return defaultUrlTransform(url)
}

const mdComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>
  ),
  a: ({ children, href }) => <MarkdownLink href={href}>{children}</MarkdownLink>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  h1: ({ children }) => (
    <h3 className="mt-2 mb-1 text-[14px] font-semibold">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mt-2 mb-1 text-[14px] font-semibold">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="mt-2 mb-1 text-[13px] font-semibold">{children}</h4>
  ),
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  code: ({ className, children }) => {
    const block =
      String(children).includes("\n") || /language-|hljs/.test(className ?? "")
    // Preserva a className do rehype-highlight (hljs / language-*) senão o
    // âncora .hljs do tema não aplica e o bloco fica sem cor.
    if (block) return <code className={cn("font-mono", className)}>{children}</code>
    return <MarkdownInlineCode className={className}>{children}</MarkdownInlineCode>
  },
  blockquote: ({ children }) => <QuoteBlock>{children}</QuoteBlock>,
  hr: () => <hr className="my-3 border-border/60" />,
  table: ({ children }) => <TableBlock>{children}</TableBlock>,
  thead: ({ children }) => <thead className="bg-secondary/40">{children}</thead>,
  tr: ({ children }) => (
    <tr className="border-b border-border/50 last:border-0">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-1.5 text-left font-semibold text-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-1.5 align-top text-foreground/85">{children}</td>
  ),
}

/** Render de markdown (GFM + highlight) reusado no chat e no detalhe de contexto.
 *  `memo`: blocos antigos não re-rodam react-markdown+highlight a cada token (F12). */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  if (needsPlainText(text)) return <PlainTextPages text={text} />
  return (
    <div
      data-selectable
      className="min-w-0 text-[14px] leading-relaxed break-words [overflow-wrap:anywhere] text-foreground"
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={customUrlTransform}
        // detect: highlight também blocos SEM linguagem (```) — agents muitas
        // vezes não anotam a linguagem e ficariam monocromáticos sem isto.
        rehypePlugins={[[rehypeHighlight, { detect: true }]]}
        components={mdComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
