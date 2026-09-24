// O ícone de TIPO de arquivo (ADR-241): a mesma identidade no fio, na árvore
// do projeto e onde mais um arquivo aparecer. Lição do estudo do Zeron: o que
// faz a tela parecer um produto só é o arquivo ter o MESMO rosto em todo
// lugar. Artwork policromática do Symbols (MIT, `file-icons/README.md`).
//
// Cor aqui é IDENTIDADE do tipo, não estado (STYLEGUIDE §2): por isso não
// passa pelos tokens de papel, e por isso nunca pinta texto, fundo nem borda.

import { cn } from "@/lib/utils"

const SVGS = import.meta.glob("./file-icons/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

const porId = new Map(
  Object.entries(SVGS).map(([caminho, svg]) => [
    caminho.slice("./file-icons/".length, -".svg".length),
    svg,
  ]),
)

/** No escuro, os acentos mais fechados do Symbols somem no fundo: sobem de
 *  luz sem trocar de matiz. A mesma tabela que o Zeron aplica. */
const CLAREIA: ReadonlyArray<[string, string]> = [
  ["#64748B", "#CBD5E1"],
  ["#71717A", "#D4D4D8"],
  ["#2563EB", "#60A5FA"],
  ["#EA580C", "#FB923C"],
  ["#16A34A", "#4ADE80"],
  ["#8B5CF6", "#A78BFA"],
  ["#A855F7", "#C084FC"],
]
const escuro = new Map<string, string>()
function versaoEscura(id: string, svg: string): string {
  let s = escuro.get(id)
  if (s == null) {
    s = CLAREIA.reduce((acc, [de, para]) => acc.replaceAll(de, para).replaceAll(de.toLowerCase(), para), svg)
    escuro.set(id, s)
  }
  return s
}

const POR_NOME: Record<string, string> = {
  "package.json": "node",
  "tsconfig.json": "tsconfig",
  "bun.lock": "bun",
  "bun.lockb": "bun",
  ".gitignore": "git",
  "Cargo.toml": "rust",
  "Cargo.lock": "lock",
}

const POR_EXTENSAO: Record<string, string> = {
  ts: "ts", mts: "ts", cts: "ts", tsx: "react-ts", js: "js", mjs: "js", cjs: "js", jsx: "react",
  json: "brackets-yellow", jsonc: "brackets-yellow", css: "brackets-purple", scss: "sass",
  html: "code-orange", md: "markdown", mdx: "mdx", rs: "rust", toml: "gear", env: "gear",
  py: "python", go: "go", sh: "shell", zsh: "shell", bash: "shell", yml: "yaml", yaml: "yaml",
  sql: "database", db: "database", sqlite: "database", lock: "lock",
  png: "image", jpg: "image", jpeg: "image", webp: "image", ico: "image", gif: "gif", svg: "svg",
  mp4: "video", mov: "video", webm: "video", mp3: "audio", wav: "audio", m4a: "audio",
  pdf: "pdf", txt: "text", log: "text", swift: "swift", kt: "kotlin", java: "java", rb: "ruby",
  php: "php", c: "c", h: "h", cpp: "cplus", vue: "vue", svelte: "svelte", xml: "xml", csv: "csv",
  zip: "compressed", gz: "compressed", woff2: "font", ttf: "font", otf: "font", lua: "lua",
}

/** Id do ícone para um caminho: nome exato, depois `vite.config.*`, depois a
 *  extensão; sem casar, o documento genérico. Puro (teste ao lado). */
export function iconeDoArquivo(caminho: string, pasta = false): string {
  if (pasta) return "folder"
  const nome = caminho.split(/[\\/]/).filter(Boolean).pop() ?? caminho
  if (POR_NOME[nome]) return POR_NOME[nome]
  if (/^vite\.config\./.test(nome)) return "vite"
  const ext = nome.includes(".") ? nome.split(".").pop()!.toLowerCase() : ""
  return POR_EXTENSAO[ext] ?? "document"
}

/** `size` em px, na régua de glifo do §13 (12, 14 ou 16). */
export function FileIcon({
  path,
  folder = false,
  size = 14,
  className,
}: {
  path: string
  folder?: boolean
  size?: 12 | 14 | 16
  className?: string
}) {
  const id = iconeDoArquivo(path, folder)
  const svg = porId.get(id) ?? porId.get("document")!
  const caixa = cn(
    "shrink-0 [&>svg]:size-full",
    size === 12 ? "size-3" : size === 16 ? "size-4" : "size-3.5",
  )
  // Os dois temas no DOM e o CSS escolhe: trocar de tema não re-renderiza o fio.
  return (
    <span aria-hidden="true" data-file-icon={id} className={cn("inline-flex", className)}>
      <span className={cn(caixa, "inline-flex dark:hidden")} dangerouslySetInnerHTML={{ __html: svg }} />
      <span className={cn(caixa, "hidden dark:inline-flex")} dangerouslySetInnerHTML={{ __html: versaoEscura(id, svg) }} />
    </span>
  )
}
