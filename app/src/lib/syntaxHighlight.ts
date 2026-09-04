// Syntax highlighting para o diff e visualizadores de código.
// Usa o highlight.js já empacotado no app (mesmo motor do Markdown.tsx).
//
// Regras do §2 e §9:
// - Fail-open: se a linguagem for desconhecida ou o lexer falhar, escapa o texto puro.
// - Cache LRU simples para evitar reprocessar linhas repetidas no scroll longo.

import hljs from "highlight.js"

const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  rs: "rust",
  py: "python",
  html: "xml",
  htm: "xml",
  svg: "xml",
  xml: "xml",
  css: "css",
  scss: "css",
  sass: "css",
  less: "css",
  json: "json",
  jsonc: "json",
  md: "markdown",
  markdown: "markdown",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  sql: "sql",
  go: "go",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cc: "cpp",
  diff: "diff",
  patch: "diff",
}

export function detectLanguage(path: string): string | null {
  const parts = path.split(".")
  if (parts.length <= 1) return null
  const ext = parts[parts.length - 1].toLowerCase()
  return EXT_TO_LANG[ext] ?? null
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

/**
 * Destaca um arquivo inteiro preservando quebras de linha. O retorno do
 * highlight.js é HTML escapado com spans de tokens; no fallback, todo o texto
 * também é escapado antes de chegar ao visualizador.
 */
export function highlightCode(text: string, language: string | null): string {
  if (!text) return ""
  if (!language || !hljs.getLanguage(language)) return escapeHtml(text)
  try {
    return hljs.highlight(text, { language, ignoreIllegals: true }).value
  } catch {
    return escapeHtml(text)
  }
}

const HIGHLIGHT_CACHE = new Map<string, string>()
const MAX_CACHE_SIZE = 2500

/**
 * Destaca a sintaxe de uma linha de código.
 * Se a linguagem for nula ou não suportada, devolve o texto escapado.
 */
export function highlightDiffLine(text: string, language: string | null): string {
  if (!text) return ""
  if (!language) return escapeHtml(text)

  const cacheKey = `${language}:${text}`
  const cached = HIGHLIGHT_CACHE.get(cacheKey)
  if (cached !== undefined) return cached

  let result: string
  try {
    if (hljs.getLanguage(language)) {
      result = hljs.highlight(text, { language, ignoreIllegals: true }).value
    } else {
      result = escapeHtml(text)
    }
  } catch {
    result = escapeHtml(text)
  }

  if (HIGHLIGHT_CACHE.size >= MAX_CACHE_SIZE) {
    // Descarta as entradas mais antigas
    const iter = HIGHLIGHT_CACHE.keys()
    for (let i = 0; i < 500; i++) {
      const next = iter.next()
      if (next.done) break
      HIGHLIGHT_CACHE.delete(next.value)
    }
  }

  HIGHLIGHT_CACHE.set(cacheKey, result)
  return result
}
