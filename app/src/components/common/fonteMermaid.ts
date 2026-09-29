// O texto de um bloco ```mermaid na árvore do Markdown, ou null se o bloco é
// de outra linguagem. Lê o hast, e não o React, porque o realce de código
// pode ter partido o texto em pedaços.

interface NoHast {
  type: string
  tagName?: string
  value?: string
  properties?: { className?: unknown }
  children?: NoHast[]
}

function texto(no: NoHast): string {
  if (no.type === "text") return no.value ?? ""
  return (no.children ?? []).map(texto).join("")
}

/** Puro. */
export function fonteMermaid(pre: unknown): string | null {
  const code = (pre as NoHast | undefined)?.children?.find((c) => c.type === "element" && c.tagName === "code")
  const classes = code?.properties?.className
  if (!Array.isArray(classes) || !classes.includes("language-mermaid")) return null
  return texto(code as NoHast)
}
