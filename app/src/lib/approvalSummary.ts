// Resumo LEGÍVEL de um pedido de permissão. O card mostrava o input cru — um
// `deno run ... <<'PY' …40 linhas de python… PY` virava um paredão de texto de
// altura ilimitada, e a pergunta que importa ("posso rodar isto?") ficava
// ilegível. Aqui a decisão vira uma linha ("deno run · v2-compat.smoke.ts") e o
// texto integral fica a um clique. Funções PURAS: testáveis sem UI.

import type { ApprovalData } from "@/lib/interaction"

/** Linhas do detalhe que cabem no card antes de virar "ver tudo". */
export const PREVIEW_LINES = 10

export interface ApprovalSummary {
  /** A ação, curta ("deno run", "Editar arquivo"). Nunca vazia. */
  action: string
  /** O alvo, curto (basename do arquivo/path). null = sem alvo óbvio. */
  target: string | null
  /** `action · target` — a linha única que o card mostra em destaque. */
  headline: string
  /** Conteúdo integral (comando cru ou input formatado) p/ o "ver tudo". */
  detail: string
  /** Total de linhas do `detail`. */
  lines: number
  /** As primeiras PREVIEW_LINES do detail (=== detail quando cabe). */
  preview: string
  /** true = `preview` cortou o `detail` ⇒ o card oferece abrir integral. */
  truncated: boolean
}

/** Último segmento de um path (sem barra final). Devolve o próprio texto quando
 *  não é path. */
function basename(p: string): string {
  const clean = p.replace(/\/+$/, "")
  const i = clean.lastIndexOf("/")
  return i >= 0 ? clean.slice(i + 1) : clean
}

/** Parece um caminho de arquivo? (tem barra, ou tem extensão curta). */
function looksLikePath(token: string): boolean {
  if (token.startsWith("-")) return false
  if (token.includes("/")) return true
  return /\.[a-z0-9]{1,5}$/i.test(token)
}

/** Operadores que ENCERRAM o comando principal: o que vem depois é outra coisa
 *  (pipe, redirecionamento, encadeamento). Sem cortar aqui, um
 *  `deno run x.ts | sed -n '/^11\./,$p'` resumia como "deno run · ,$p'" — o
 *  parser pegava um pedaço do script do sed achando que era o arquivo. */
const OPERADORES = /^(\||\|\||&&|;|>|>>|<|2>&1|&)$/

/** Tokens do comando PRINCIPAL, sem o que não ajuda a entender a ação:
 *  atribuições de env no início (`FOO=1 cmd`), o corpo do heredoc e tudo que
 *  vem depois de um operador de shell. */
function commandTokens(command: string): string[] {
  // só a primeira linha: o resto de um heredoc é o CORPO, não a invocação.
  const head = command.split("\n", 1)[0] ?? ""
  const bruto = head.split(/\s+/).filter(Boolean)
  let i = 0
  while (i < bruto.length && /^[A-Z_][A-Z0-9_]*=/.test(bruto[i])) i++
  const tokens: string[] = []
  for (const t of bruto.slice(i)) {
    if (OPERADORES.test(t)) break
    tokens.push(t)
  }
  return tokens
}

/** Subcomandos que fazem parte da AÇÃO (`git commit`, `deno run`) — sem eles o
 *  resumo viraria só "git", que não diz nada. */
const SUBCOMMANDS = new Set([
  "run", "test", "build", "install", "add", "remove", "exec", "start", "dev",
  "lint", "fmt", "format", "push", "pull", "commit", "status", "checkout",
  "clone", "fetch", "merge", "rebase", "diff", "log", "init", "publish",
  "deploy", "migrate", "serve", "watch", "typecheck", "check",
])

/** Delimitador de heredoc (`<<'PY'`, `<<-EOF`) — sinal de script embutido. */
function heredocTag(command: string): string | null {
  const m = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/.exec(command)
  return m ? m[1] : null
}

/** Ação + alvo de um comando de shell. */
function summarizeCommand(command: string): { action: string; target: string | null } {
  const tokens = commandTokens(command)
  if (tokens.length === 0) return { action: "Rodar comando", target: null }

  const bin = basename(tokens[0])
  const next = tokens[1]
  const action =
    next && !next.startsWith("-") && SUBCOMMANDS.has(next) ? `${bin} ${next}` : bin

  // alvo = o PRIMEIRO path citado depois da ação (o assunto do comando: o
  // arquivo que roda, a origem que se copia). O último seria o destino de um
  // redirect ou um resto de argumento de outro programa.
  const consumed = action.split(" ").length
  let target: string | null = null
  for (const t of tokens.slice(consumed)) {
    if (looksLikePath(t)) {
      target = basename(t)
      break
    }
  }

  // sem path: um heredoc quer dizer "tem um script embutido aqui" — dizer isso
  // é mais honesto do que não dizer nada.
  if (!target && heredocTag(command)) target = "script inline"

  return { action, target }
}

/** Rótulo humano por tool (as de arquivo ganham verbo próprio). */
const TOOL_ACTIONS: Record<string, string> = {
  Write: "Escrever arquivo",
  Edit: "Editar arquivo",
  MultiEdit: "Editar arquivo",
  NotebookEdit: "Editar notebook",
  Read: "Ler arquivo",
  Glob: "Buscar arquivos",
  Grep: "Buscar no código",
  WebFetch: "Buscar na web",
  WebSearch: "Pesquisar na web",
}

/** Caminho citado no input de uma tool de arquivo (as chaves que o SDK usa). */
function pathFromInput(input: unknown): string | null {
  if (!input || typeof input !== "object") return null
  const o = input as Record<string, unknown>
  for (const k of ["file_path", "path", "notebook_path", "url", "pattern"]) {
    const v = o[k]
    if (typeof v === "string" && v.trim()) return v.trim()
  }
  return null
}

/** Serializa o input p/ o bloco de detalhe. Input cíclico não derruba o card. */
function formatInput(input: unknown): string {
  try {
    return JSON.stringify(input, null, 2) ?? String(input)
  } catch {
    return String(input)
  }
}

/** Resumo de UM pedido de permissão: uma linha pra decidir, o integral pra
 *  conferir. Nunca lança — o card precisa renderizar mesmo com input estranho. */
export function summarizeApproval(data: ApprovalData): ApprovalSummary {
  const tool = (data.tool_name ?? "").trim() || "tool"
  const command = typeof data.command === "string" ? data.command.trim() : ""

  let action: string
  let target: string | null
  let detail: string

  if (command) {
    ;({ action, target } = summarizeCommand(command))
    detail = command
  } else {
    const p = pathFromInput(data.input)
    action = TOOL_ACTIONS[tool] ?? `Usar ${tool}`
    target = p ? basename(p) : null
    detail = formatInput(data.input)
  }

  const allLines = detail.split("\n")
  const truncated = allLines.length > PREVIEW_LINES
  return {
    action,
    target,
    headline: target ? `${action} · ${target}` : action,
    detail,
    lines: allLines.length,
    preview: truncated ? allLines.slice(0, PREVIEW_LINES).join("\n") : detail,
    truncated,
  }
}
