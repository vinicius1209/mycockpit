// A cor do editor por extensão (spec §7.7). Parte do MESMO mapa do
// visualizador estático (`detectLanguage`), para existir uma lista de extensão
// só. Cada linguagem é um `import()` próprio: quem nunca abre Python não paga.

import type { Extension } from "@codemirror/state"
import { detectLanguage } from "@/lib/syntaxHighlight"

export type PacoteDeLinguagem =
  | { pacote: "javascript"; typescript: boolean; jsx: boolean }
  | { pacote: "json" | "markdown" | "rust" | "python" | "css" | "html" }

/** Qual pacote colore o arquivo, ou `null` (texto puro). Puro. */
export function pacoteDaLinguagem(caminho: string): PacoteDeLinguagem | null {
  const ext = caminho.split(".").pop()?.toLowerCase() ?? ""
  switch (detectLanguage(caminho)) {
    case "typescript":
      return { pacote: "javascript", typescript: true, jsx: ext === "tsx" }
    case "javascript":
      return { pacote: "javascript", typescript: false, jsx: ext === "jsx" }
    case "json":
      return { pacote: "json" }
    case "markdown":
      return { pacote: "markdown" }
    case "rust":
      return { pacote: "rust" }
    case "python":
      return { pacote: "python" }
    case "css":
      return { pacote: "css" }
    case "xml":
      return ext === "html" || ext === "htm" ? { pacote: "html" } : null
    default:
      return null
  }
}

/** Carrega a linguagem. Falha no `import()` volta `null`: o texto segue, sem cor. */
export async function carregarLinguagem(caminho: string): Promise<Extension | null> {
  const p = pacoteDaLinguagem(caminho)
  if (!p) return null
  try {
    switch (p.pacote) {
      case "javascript":
        return (await import("@codemirror/lang-javascript")).javascript({
          typescript: p.typescript,
          jsx: p.jsx,
        })
      case "json":
        return (await import("@codemirror/lang-json")).json()
      case "markdown":
        return (await import("@codemirror/lang-markdown")).markdown()
      case "rust":
        return (await import("@codemirror/lang-rust")).rust()
      case "python":
        return (await import("@codemirror/lang-python")).python()
      case "css":
        return (await import("@codemirror/lang-css")).css()
      case "html":
        return (await import("@codemirror/lang-html")).html()
    }
  } catch (e) {
    console.warn(`edição: não consegui carregar a linguagem de ${caminho}`, e)
    return null
  }
}
