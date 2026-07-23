// Apresentação HUMANA de um tool call: o cartão cru (nome + payload) vira uma
// atividade curta e auditável. O comando/payload completo NUNCA é rótulo: fica
// em `detail`, no segundo nível de disclosure.

export type ToolKind =
  | "bash"
  | "read"
  | "edit"
  | "write"
  | "search"
  | "web"
  | "agent"
  | "generic"

export type ToolCategory =
  | "inspect"
  | "validate"
  | "change"
  | "web"
  | "delegate"
  | "execute"

export type ToolEmphasis = "quiet" | "normal" | "warning"

export interface ToolView {
  kind: ToolKind
  /** Rótulo humano curto (o que aparece na linha). */
  label: string
  /** Família semântica usada no resumo do burst. */
  category: ToolCategory
  /** Leitura fica quieta; mutação aparece; ação sensível nunca some. */
  emphasis: ToolEmphasis
  /** Meta à direita (dir do arquivo, tipo do subagent…). */
  meta: string | null
  /** Conteúdo cru pro expand (comando, path completo, prompt, JSON). */
  detail: string | null
}

function str(i: Record<string, unknown>, k: string): string | null {
  const v = i[k]
  return typeof v === "string" && v.trim() ? v : null
}

function clip(s: string, n = 72): string {
  const clean = s.replace(/\s+/g, " ").trim()
  return clean.length > n ? `${clean.slice(0, n - 1)}…` : clean
}

/** "/a/b/c/d/x.ts" → { base: "x.ts", dir: "…/c/d" } (corta o MEIO, não o fim). */
export function splitPath(p: string): { base: string; dir: string | null } {
  const cut = p.lastIndexOf("/")
  if (cut < 0) return { base: p, dir: null }
  const base = p.slice(cut + 1)
  const segs = p.slice(0, cut).split("/").filter(Boolean)
  if (segs.length === 0) return { base, dir: null }
  const tail = segs.slice(-2).join("/")
  return { base, dir: segs.length > 2 ? `…/${tail}` : `/${tail}` }
}

/** Extrai o rótulo que o próprio agent narrou: `echo "=== label ===" && resto`. */
function bashEchoLabel(cmd: string): string | null {
  const m = cmd.match(
    /^\s*echo\s+["']?\s*[=\-#*]*\s*([^"'|&;=]+?)\s*[=\-#*]*\s*["']?\s*(?:&&|;)/,
  )
  const label = m?.[1]?.trim()
  return label && label.length > 1 ? label : null
}

/** Remove só o launcher que o Codex inclui no campo `command`. Isso é
 * apresentação: `detail` continua guardando o comando EXATO para auditoria. */
export function unwrapShellCommand(command: string): string {
  const cmd = command.trim()
  const m = cmd.match(
    /^(?:\/bin\/)?(?:zsh|bash|sh)\s+-[a-z]*c\s+(["'])([\s\S]*)\1$/i,
  )
  if (!m) return cmd
  const body = m[2]
  return m[1] === '"'
    ? body.replace(/\\"/g, '"').replace(/\\\\/g, "\\")
    : body
}

type SemanticTool = Pick<ToolView, "label" | "category" | "emphasis">

/** Classificador determinístico e barato: não tenta "entender" o shell, só
 * reconhece famílias que importam na UI. Fallback nunca vaza o comando. */
function presentShell(command: string): SemanticTool {
  const cmd = unwrapShellCommand(command)
  const lower = cmd.toLowerCase()

  // Ações sensíveis primeiro: não podem ser diluídas como "verificação" só
  // porque o mesmo comando também contém um `git status` ou `find`.
  if (/\bgit\s+push\b/.test(lower))
    return {
      label: "Enviar alterações ao repositório",
      category: "change",
      emphasis: "warning",
    }
  if (/(?:^|[;&|]\s*)rm\s+(?:-[^\s]+\s+)*\S+/.test(lower))
    return {
      label: "Remover arquivos",
      category: "change",
      emphasis: "warning",
    }
  if (/\bgit\s+(?:reset|clean)\b/.test(lower))
    return {
      label: "Reorganizar o estado do repositório",
      category: "change",
      emphasis: "warning",
    }

  if (
    /\b(?:vitest|pytest)\b/.test(lower) ||
    /\bcargo\s+test\b/.test(lower) ||
    /\b(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?test\b/.test(lower)
  )
    return {
      label: "Executar testes",
      category: "validate",
      emphasis: "normal",
    }
  if (/\b(?:typecheck|type-check)\b/.test(lower) || /\btsc(?:\s|$)/.test(lower))
    return {
      label: "Verificar tipos",
      category: "validate",
      emphasis: "normal",
    }
  if (/\b(?:oxlint|eslint|biome|ruff)\b/.test(lower) || /\brun\s+lint\b/.test(lower))
    return {
      label: "Validar o código",
      category: "validate",
      emphasis: "normal",
    }
  if (/\bcargo\s+check\b/.test(lower))
    return {
      label: "Verificar o projeto Rust",
      category: "validate",
      emphasis: "normal",
    }
  if (/\b(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?build\b/.test(lower))
    return {
      label: "Gerar o build",
      category: "validate",
      emphasis: "normal",
    }

  if (/\bgit\s+commit\b/.test(lower))
    return { label: "Criar commit", category: "change", emphasis: "normal" }
  if (/\bgit\s+(?:switch|checkout|branch|merge|rebase)\b/.test(lower))
    return {
      label: "Atualizar a branch de trabalho",
      category: "change",
      emphasis: "normal",
    }
  if (/\b(?:npm|pnpm|yarn|bun)\s+(?:install|add)\b/.test(lower))
    return {
      label: "Instalar dependências",
      category: "change",
      emphasis: "normal",
    }
  if (/\bsqlite3\b/.test(lower) && /\b(?:insert|update|delete|drop|alter)\b/.test(lower))
    return {
      label: "Atualizar dados locais",
      category: "change",
      emphasis: "warning",
    }

  if (/\bsqlite3\b/.test(lower))
    return {
      label: "Consultar dados locais",
      category: "inspect",
      emphasis: "quiet",
    }
  if (/\bgit\s+status\b/.test(lower))
    return {
      label: "Verificar o estado do repositório",
      category: "inspect",
      emphasis: "quiet",
    }
  if (/\bgit\s+diff\b/.test(lower))
    return {
      label: "Inspecionar alterações",
      category: "inspect",
      emphasis: "quiet",
    }
  if (/\bgit\s+(?:log|show|blame)\b/.test(lower))
    return {
      label: "Consultar o histórico do Git",
      category: "inspect",
      emphasis: "quiet",
    }
  if (/(?:^|[\s;&|$(])(?:rg|grep)\b/.test(lower))
    return {
      label: "Buscar no projeto",
      category: "inspect",
      emphasis: "quiet",
    }
  if (
    /(?:^|[\s;&|$(])(?:sed|nl|cat|head|tail|wc|find|ls|pwd)\b/.test(lower)
  )
    return {
      label: "Inspecionar arquivos",
      category: "inspect",
      emphasis: "quiet",
    }
  if (/\b(?:curl|wget)\b/.test(lower))
    return {
      label: "Consultar um serviço externo",
      category: "web",
      emphasis: "normal",
    }
  if (/(?:^|[;&|]\s*)(?:cp|mv|mkdir|touch)\b/.test(lower))
    return {
      label: "Alterar arquivos",
      category: "change",
      emphasis: "normal",
    }
  return {
    label: "Executar comando",
    category: "execute",
    emphasis: "normal",
  }
}

function safeJson(v: unknown): string | null {
  try {
    const s = JSON.stringify(v, null, 2)
    return s && s !== "{}" && s !== "null" ? s.slice(0, 1200) : null
  } catch {
    return null
  }
}

export function presentTool(name: string, input: unknown): ToolView {
  const i = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >
  switch (name) {
    case "Bash": {
      const cmd = str(i, "command") ?? ""
      const semantic = presentShell(cmd)
      const narrated = str(i, "description") ?? bashEchoLabel(unwrapShellCommand(cmd))
      return {
        kind: "bash",
        ...semantic,
        label: narrated ? clip(narrated) : semantic.label,
        meta: null,
        detail: cmd || null,
      }
    }
    case "Read": {
      const p = str(i, "file_path") ?? str(i, "path") ?? ""
      const { base, dir } = splitPath(p)
      return {
        kind: "read",
        label: base ? `Ler ${base}` : "Ler arquivo",
        category: "inspect",
        emphasis: "quiet",
        meta: dir,
        detail: p || null,
      }
    }
    case "Edit":
    case "MultiEdit": {
      const p = str(i, "file_path") ?? ""
      const { base, dir } = splitPath(p)
      return {
        kind: "edit",
        label: base ? `Editar ${base}` : "Editar arquivo",
        category: "change",
        emphasis: "normal",
        meta: dir,
        detail: p || null,
      }
    }
    case "Write":
    case "NotebookEdit": {
      const p = str(i, "file_path") ?? str(i, "notebook_path") ?? ""
      const { base, dir } = splitPath(p)
      return {
        kind: "write",
        label: base ? `Criar ${base}` : "Criar arquivo",
        category: "change",
        emphasis: "normal",
        meta: dir,
        detail: p || null,
      }
    }
    case "Grep": {
      const pat = str(i, "pattern")
      const scope = str(i, "path")
      return {
        kind: "search",
        label: pat ? `Buscar “${clip(pat, 54)}”` : "Buscar no projeto",
        category: "inspect",
        emphasis: "quiet",
        meta: scope ? splitPath(scope).base : null,
        detail: safeJson(input),
      }
    }
    case "Glob": {
      const pat = str(i, "pattern")
      return {
        kind: "search",
        label: pat ? `Listar “${clip(pat, 54)}”` : "Listar arquivos",
        category: "inspect",
        emphasis: "quiet",
        meta: null,
        detail: safeJson(input),
      }
    }
    case "WebFetch": {
      const url = (str(i, "url") ?? "").replace(/^https?:\/\//, "")
      return {
        kind: "web",
        label: url ? `Consultar ${clip(url, 62)}` : "Consultar página",
        category: "web",
        emphasis: "quiet",
        meta: null,
        detail: str(i, "prompt"),
      }
    }
    case "WebSearch": {
      return {
        kind: "web",
        label: str(i, "query")
          ? `Pesquisar “${clip(str(i, "query")!, 56)}”`
          : "Pesquisar na web",
        category: "web",
        emphasis: "quiet",
        meta: null,
        detail: safeJson(input),
      }
    }
    case "Task":
    case "Agent": {
      return {
        kind: "agent",
        label: clip(
          str(i, "description") ?? str(i, "prompt") ?? "Delegar tarefa",
        ),
        category: "delegate",
        emphasis: "normal",
        meta: str(i, "subagent_type"),
        detail: str(i, "prompt"),
      }
    }
    default: {
      return {
        kind: "generic",
        label: "Executar ferramenta",
        category: "execute",
        emphasis: "normal",
        meta: clip(name.replace(/^mcp__/, "").replaceAll("__", " · "), 60),
        detail: safeJson(input),
      }
    }
  }
}

export interface ToolActivityInput {
  name: string
  input: unknown
  result?: { ok: boolean } | null
}

export interface ToolGroupView {
  label: string
  emphasis: ToolEmphasis
  state: "running" | "ok" | "error" | "recorded"
}

/** Resume um burst sem olhar o comando cru. O grupo descreve a natureza do
 * trabalho; a lista expandida explica cada ação; o raw fica no nível técnico. */
export function summarizeToolGroup(
  tools: readonly ToolActivityInput[],
  active = false,
): ToolGroupView {
  if (tools.length === 0)
    return { label: "Atividade técnica", emphasis: "quiet", state: "recorded" }
  const views = tools.map((t) => presentTool(t.name, t.input))
  const emphasis: ToolEmphasis = views.some((v) => v.emphasis === "warning")
    ? "warning"
    : views.some((v) => v.emphasis === "normal")
      ? "normal"
      : "quiet"
  const failed = tools.filter((t) => t.result?.ok === false).length
  if (failed > 0) {
    return {
      label: failed === 1 ? "Uma ação falhou" : `${failed} ações falharam`,
      emphasis: "warning",
      state: "error",
    }
  }
  if (active) {
    const current = tools.findLast((t) => !t.result) ?? tools.at(-1)!
    return {
      label: presentTool(current.name, current.input).label,
      emphasis,
      state: "running",
    }
  }
  const allFinished = tools.every((t) => t.result != null)
  if (!allFinished) {
    const categories = new Set(views.map((v) => v.category))
    const n = tools.length
    if (n === 1)
      return { label: views[0].label, emphasis, state: "recorded" }
    if ([...categories].every((c) => c === "inspect" || c === "web"))
      return {
        label: `${n} verificações registradas`,
        emphasis,
        state: "recorded",
      }
    if (categories.size === 1 && categories.has("validate"))
      return {
        label: `${n} validações registradas`,
        emphasis,
        state: "recorded",
      }
    if (categories.size === 1 && categories.has("change"))
      return {
        label: `${n} alterações registradas`,
        emphasis,
        state: "recorded",
      }
    return {
      label: `${n} ações registradas`,
      emphasis,
      state: "recorded",
    }
  }
  const categories = new Set(views.map((v) => v.category))
  const n = tools.length
  if (n === 1)
    return {
      label: views[0].label,
      emphasis,
      state: "ok",
    }
  if ([...categories].every((c) => c === "inspect" || c === "web"))
    return {
      label: n === 1 ? "Verificação concluída" : `${n} verificações concluídas`,
      emphasis,
      state: "ok",
    }
  if (categories.size === 1 && categories.has("validate"))
    return {
      label: n === 1 ? "Validação concluída" : `${n} validações concluídas`,
      emphasis,
      state: "ok",
    }
  if (categories.size === 1 && categories.has("change"))
    return {
      label: n === 1 ? "Alteração realizada" : `${n} alterações realizadas`,
      emphasis,
      state: "ok",
    }
  if (categories.size === 1 && categories.has("delegate"))
    return {
      label: n === 1 ? "Delegação concluída" : `${n} delegações concluídas`,
      emphasis,
      state: "ok",
    }
  return {
    label: n === 1 ? "Ação concluída" : `${n} ações concluídas`,
    emphasis,
    state: "ok",
  }
}

/** Boilerplate de sucesso do write/edit que a CLI injeta no result — não é
 *  conteúdo útil (o cartão já mostra nome do arquivo + diff), então some do
 *  render. Cobre "File created successfully at: …", "The file … has been
 *  updated successfully." e o sufixo "(file state is current…no need to Read
 *  it back)". NÃO mexe em erro nem em output de outras tools (Bash etc). */
const WRITE_EDIT_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"])
const SUCCESS_BOILERPLATE = [
  /^\s*File created successfully at:.*$/i,
  /^\s*(?:The file .*? has been (?:updated|created|edited) successfully\.?|.*?has been updated(?: successfully)?\.?)\s*$/i,
]
const STATE_SUFFIX = /\(file state is current[^)]*no need to Read it back\)/gi

/** Limpa o result de write/edit: remove o boilerplate de sucesso e o sufixo
 *  "(file state is current…)". Retorna o texto restante (ou "" se só sobrou
 *  boilerplate). Para outras tools/erros, devolve o texto intacto. */
export function cleanResultText(
  name: string,
  result: { ok: boolean; text: string } | undefined,
): string {
  const text = result?.text ?? ""
  if (!text || result?.ok === false || !WRITE_EDIT_TOOLS.has(name)) return text
  const cleaned = text
    .replace(STATE_SUFFIX, "")
    .split("\n")
    .filter((line) => !SUCCESS_BOILERPLATE.some((re) => re.test(line)))
    .join("\n")
    .trim()
  return cleaned
}

/** Meta do RESULTADO (a metade que faltava): "42 linhas", "erro", "ok". */
export function resultMeta(
  name: string,
  result: { ok: boolean; text: string; lines: number } | undefined,
): string | null {
  if (!result) return null
  if (!result.ok) return "erro"
  if (name === "Read") return result.lines > 0 ? `${result.lines} linhas` : null
  if (name === "Grep" || name === "Glob")
    return `${result.lines} ${result.lines === 1 ? "resultado" : "resultados"}`
  if (name === "Bash") return result.lines > 1 ? `${result.lines} linhas` : null
  return null
}
