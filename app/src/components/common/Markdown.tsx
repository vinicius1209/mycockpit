import { memo, useRef, useState, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import type { Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { Check, Copy } from "lucide-react"

function CodeBlock({ children }: { children?: ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  function copy() {
    const text = ref.current?.textContent ?? ""
    if (!text) return
    void navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }
  return (
    <div className="group/code relative mb-2">
      <button
        type="button"
        onClick={copy}
        className="absolute top-2 right-2 z-10 rounded-md border bg-card/80 p-1 text-muted-foreground opacity-0 transition hover:text-foreground group-hover/code:opacity-100"
        aria-label="Copiar"
        title="Copiar"
      >
        {copied ? (
          <Check className="size-3 text-st-success" />
        ) : (
          <Copy className="size-3" />
        )}
      </button>
      <pre
        ref={ref}
        className="overflow-auto rounded-md border bg-background/50 p-3 text-[12.5px] leading-relaxed"
      >
        {children}
      </pre>
    </div>
  )
}

const mdComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => (
    <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-brass underline underline-offset-2"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  h1: ({ children }) => (
    <h3 className="mt-2 mb-1 text-[15px] font-semibold">{children}</h3>
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
      String(children).includes("\n") || /language-/.test(className ?? "")
    if (block) return <code className="font-mono">{children}</code>
    return (
      <code className="rounded bg-secondary px-1 py-0.5 font-mono text-[12.5px]">
        {children}
      </code>
    )
  },
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-brass/40 pl-3 text-foreground/80">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-border/60" />,
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto rounded-md border">
      <table className="w-full border-collapse text-[13px]">{children}</table>
    </div>
  ),
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
  return (
    <div data-selectable className="text-[14px] leading-relaxed text-foreground">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={mdComponents}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
