// Resolução e detecção de links de arquivos e URLs no chat (M1 / ADEs).
//
// Regra pura, testável em Node/Vitest sem DOM nem runtime do Tauri.
// Converte URIs file://, caminhos relativos/absolutos e sufixos de linha
// (#L10, :42) em alvos navegáveis para o editor do usuário.

const EXTENSOES_ARQUIVO = new Set([
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "rs",
  "py",
  "json",
  "toml",
  "yaml",
  "yml",
  "css",
  "scss",
  "html",
  "md",
  "sql",
  "sh",
  "zsh",
  "bash",
  "go",
  "c",
  "cpp",
  "h",
  "hpp",
  "swift",
  "kt",
  "rb",
  "proto",
  "vue",
  "svelte",
  "lock",
  "diff",
  "patch",
  "xml",
  "svg",
])

const NOMES_ARQUIVO_EXATOS = new Set([
  "dockerfile",
  "makefile",
  "gemfile",
  "rakefile",
  "procfile",
  "cargo.toml",
  "package.json",
  "bun.lock",
  "pnpm-lock.yaml",
  "yarn.lock",
  "tsconfig.json",
  "vite.config.ts",
  "vitest.config.ts",
  "tailwind.config.js",
  "eslint.config.js",
  "playwright.config.ts",
  ".gitignore",
  ".env",
  ".env.example",
  ".env.local",
])

/**
 * Extensões que também são NOME DE PROPRIEDADE em código corrido, e por isso
 * não bastam sozinhas pra dizer "isto é um arquivo".
 *
 * Sem esta lista, `process.env`, `import.meta.env`, `Next.js`, `node.js` e
 * `this.h` viravam chip clicável com tooltip prometendo abrir no editor — e o
 * clique morria no `contained()` do Rust ("não achei X no projeto"). Promessa
 * que o produto não cumpre é pior que texto sem link.
 *
 * Aqui a menção só conta como arquivo se vier com CAMINHO (tem `/`) ou se for
 * um nome exato conhecido — `src/hooks/use.h` passa, `this.h` não.
 */
const EXTENSOES_AMBIGUAS = new Set(["js", "jsx", "mjs", "cjs", "h", "c", "go", "rb"])

export interface FileTarget {
  /** Caminho relativo ao projeto ativo (ex.: "src/lib/agents.ts"). */
  rel: string
  /** Caminho absoluto se disponível na URI. */
  abs?: string
  /** Linha de código para posicionar o cursor (1-indexed). */
  line: number | null
}

/** Verifica se a string é uma URL web (http/https). */
export function isWebUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return /^https?:\/\//i.test(url.trim())
}

/** Normaliza separadores de caminho (/ e \) e remove barras duplicadas. */
function normalizarSeparadores(p: string): string {
  const isAbs = p.startsWith("/") || p.startsWith("\\")
  const limpo = p.replace(/\\/g, "/").replace(/\/+/g, "/")
  return isAbs && !limpo.startsWith("/") ? `/${limpo}` : limpo
}

/** Raízes externas que o backend também autoriza para leitura. Manter esta
 * lista estreita evita transformar qualquer `.md` citado por um agent em uma
 * promessa de abertura que a fronteira Rust recusará depois. */
function markdownExternoAutorizado(path: string): boolean {
  return (
    /\/\.claude(?:\/|$)/.test(path) ||
    /\/\.gemini\/antigravity-cli\/brain(?:\/|$)/.test(path) ||
    /\/(?:Library\/Application Support|\.local\/share)\/dev\.vinicius\.mycockpit\/attachments(?:\/|$)/.test(
      path,
    )
  )
}

/**
 * Faz o parse de uma URI `file://`, caminho relativo ou texto com sufixo de linha.
 * Se o caminho for absoluto e estiver dentro de `projectPath`, converte para relativo.
 */
export function parseFileTarget(
  hrefOrText: string | null | undefined,
  projectPath?: string | null,
): FileTarget | null {
  if (!hrefOrText) return null
  const cru = hrefOrText.trim()
  if (!cru || isWebUrl(cru)) return null

  let limpo = cru

  // Decodifica esquema file:// se presente
  if (/^file:\/\//i.test(limpo)) {
    try {
      limpo = decodeURIComponent(limpo.replace(/^file:\/\//i, ""))
    } catch {
      limpo = limpo.replace(/^file:\/\//i, "")
    }
  }

  // Remove fragmento de linha (#L10 ou #L10-L20) ou extrai linha
  let line: number | null = null
  const hashMatch = /#L?(\d+)(?:-L?\d+)?$/i.exec(limpo)
  if (hashMatch) {
    line = parseInt(hashMatch[1], 10)
    limpo = limpo.slice(0, hashMatch.index)
  }

  // Extrai sufixo de linha no estilo :123 ou :123:45
  const colonMatch = /:(\d+)(?::\d+)?$/.exec(limpo)
  if (colonMatch && !limpo.includes("://")) {
    line = parseInt(colonMatch[1], 10)
    limpo = limpo.slice(0, colonMatch.index)
  }

  limpo = normalizarSeparadores(limpo)
  let abs: string | undefined

  if (limpo.startsWith("/")) {
    // Absoluto: ou está DENTRO do projeto ativo (e vira relativo), ou não é
    // alvo nosso. Antes o `replace` lá embaixo só derrubava a barra, e
    // `/etc/passwd` virava `etc/passwd` — "Abrir no editor" ia atrás de um
    // fantasma dentro do projeto enquanto "Mostrar na pasta" (que usa `abs`)
    // revelava o arquivo real, fora. Duas ações no mesmo alvo, dois lugares.
    const projNorm = projectPath
      ? normalizarSeparadores(projectPath).replace(/\/+$/, "")
      : ""
    // A fronteira precisa da barra: projeto `/Users/v/proj` NÃO contém
    // `/Users/v/proj-old/a.ts` (sem isto o `rel` saía como `-old/a.ts`).
    if (projNorm && (limpo === projNorm || limpo.startsWith(`${projNorm}/`))) {
      abs = limpo
      limpo = limpo.slice(projNorm.length)
    } else if (
      limpo.toLowerCase().endsWith(".md") &&
      markdownExternoAutorizado(limpo)
    ) {
      // Markdown externo com raiz autorizada também no backend.
      abs = limpo
      const lastSlash = limpo.lastIndexOf("/")
      limpo = lastSlash >= 0 ? limpo.slice(lastSlash + 1) : limpo
    } else {
      return null
    }
  }

  // Limpa barras iniciais e ./
  limpo = limpo.replace(/^(\.\/|\/)+/, "").trim()
  if (!limpo) return null

  return {
    rel: limpo,
    abs,
    line: line && !isNaN(line) && line > 0 ? line : null,
  }
}

/**
 * Avalia se um trecho de código inline (ex: `cacheDoTurno.ts` ou `src/lib/agents.ts:42`)
 * representa uma menção válida a um arquivo e não a código/expressão/comando.
 */
export function isFileMention(code: string | null | undefined): boolean {
  if (!code) return false
  const s = code.trim()
  if (!s || s.includes("\n")) return false

  // Comandos CLI com flags, strings com aspas ou operadores comuns de linguagem
  if (
    s.includes(" ") ||
    s.includes('"') ||
    s.includes("'") ||
    s.includes("`") ||
    s.includes("==") ||
    s.includes("=>") ||
    s.includes("&&") ||
    s.includes("||") ||
    s.includes(";") ||
    s.includes("{") ||
    s.includes("}") ||
    s.includes("(") ||
    s.includes(")") ||
    s.startsWith("--") ||
    s.startsWith("-")
  ) {
    return false
  }

  // Extrai sem linha (#L... ou :...)
  const semLinha = s.replace(/#L?\d+(?:-L?\d+)?$/i, "").replace(/:\d+(?::\d+)?$/, "")
  if (!semLinha) return false

  const temCaminho = semLinha.includes("/")
  const base = semLinha.split("/").pop()?.toLowerCase() ?? ""
  if (!base) return false

  if (NOMES_ARQUIVO_EXATOS.has(base)) return true

  const partes = base.split(".")
  if (partes.length < 2) return false

  const ext = partes.pop()?.toLowerCase() ?? ""
  if (!EXTENSOES_ARQUIVO.has(ext)) return false
  // Extensão que também é nome de propriedade só vale com caminho junto.
  return temCaminho || !EXTENSOES_AMBIGUAS.has(ext)
}

/** Formata texto de ajuda / tooltip honesto para abertura no editor. */
export function formatFileTooltip(
  rel: string,
  line: number | null,
  editorLabel?: string | null,
): string {
  const alvo = editorLabel ? `no ${editorLabel}` : "no editor"
  const sufixoLinha = line ? ` (linha ${line})` : ""
  return `Abrir ${rel} ${alvo}${sufixoLinha}`
}
