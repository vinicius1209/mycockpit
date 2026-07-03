// Apresentação HUMANA de um tool call: o cartão cru (nome + payload) vira uma
// linha "ícone + rótulo + meta". O rótulo vem da melhor fonte disponível
// (description do Bash > echo "=== label ===" > basename > comando cru).

export type ToolKind =
  | "bash"
  | "read"
  | "edit"
  | "write"
  | "search"
  | "web"
  | "agent"
  | "generic"

export interface ToolView {
  kind: ToolKind
  /** Rótulo humano curto (o que aparece na linha). */
  label: string
  /** Meta à direita (dir do arquivo, tipo do subagent…). */
  meta: string | null
  /** Conteúdo cru pro expand (comando, path completo, prompt, JSON). */
  detail: string | null
}

function str(i: Record<string, unknown>, k: string): string | null {
  const v = i[k]
  return typeof v === "string" && v.trim() ? v : null
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
      const label =
        str(i, "description") ??
        bashEchoLabel(cmd) ??
        (cmd.split("\n")[0]?.slice(0, 90) || "comando")
      return { kind: "bash", label, meta: null, detail: cmd || null }
    }
    case "Read": {
      const p = str(i, "file_path") ?? str(i, "path") ?? ""
      const { base, dir } = splitPath(p)
      return { kind: "read", label: base || "arquivo", meta: dir, detail: p || null }
    }
    case "Edit":
    case "MultiEdit": {
      const p = str(i, "file_path") ?? ""
      const { base, dir } = splitPath(p)
      return { kind: "edit", label: base || name, meta: dir, detail: p || null }
    }
    case "Write":
    case "NotebookEdit": {
      const p = str(i, "file_path") ?? str(i, "notebook_path") ?? ""
      const { base, dir } = splitPath(p)
      return { kind: "write", label: base || name, meta: dir, detail: p || null }
    }
    case "Grep": {
      const pat = str(i, "pattern")
      const scope = str(i, "path")
      return {
        kind: "search",
        label: pat ? `grep ${pat.slice(0, 60)}` : "grep",
        meta: scope ? splitPath(scope).base : null,
        detail: safeJson(input),
      }
    }
    case "Glob": {
      const pat = str(i, "pattern")
      return {
        kind: "search",
        label: pat ? `glob ${pat.slice(0, 60)}` : "glob",
        meta: null,
        detail: safeJson(input),
      }
    }
    case "WebFetch": {
      const url = (str(i, "url") ?? "").replace(/^https?:\/\//, "")
      return {
        kind: "web",
        label: url.slice(0, 70) || "fetch",
        meta: null,
        detail: str(i, "prompt"),
      }
    }
    case "WebSearch": {
      return {
        kind: "web",
        label: str(i, "query")?.slice(0, 70) ?? "busca na web",
        meta: null,
        detail: safeJson(input),
      }
    }
    case "Task":
    case "Agent": {
      return {
        kind: "agent",
        label:
          str(i, "description") ?? str(i, "prompt")?.slice(0, 70) ?? "subagent",
        meta: str(i, "subagent_type"),
        detail: str(i, "prompt"),
      }
    }
    default: {
      const first = Object.values(i).find(
        (v): v is string => typeof v === "string" && v.trim().length > 0,
      )
      return {
        kind: "generic",
        label: name,
        meta: first ? first.slice(0, 60) : null,
        detail: safeJson(input),
      }
    }
  }
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
  if (name === "Bash") return result.lines > 1 ? `${result.lines} linhas` : "ok"
  return null
}
