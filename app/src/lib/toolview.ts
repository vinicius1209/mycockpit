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
  | "image"
  | "generic"

export type ToolCategory =
  | "inspect"
  | "validate"
  | "change"
  | "web"
  | "delegate"
  | "execute"
  /** Coordenação com a pessoa e com o plano (tools da própria Frota). */
  | "coordinate"

export type ToolEmphasis = "quiet" | "normal" | "warning"

/** Sobre O QUE a ação age (ADR-241). A linha do fio mostra VERBO + OBJETO:
 *  arquivo vira pílula com o ícone do tipo, comando vira mono, o resto é texto.
 *  `mais` conta os outros comandos do mesmo shell ("+2"). */
export type ToolObject =
  | { kind: "file"; path: string; range?: string | null; mais?: number }
  | { kind: "command"; text: string; mais?: number }
  /** `frase`: o texto já é uma frase com verbo próprio (a narração do agente),
   *  então a linha não antepõe o verbo. */
  | { kind: "text"; text: string; mais?: number; frase?: true }

export interface ToolView {
  kind: ToolKind
  /** Rótulo humano curto numa string só: é o que recibos, companion e missão
   *  citam. O FIO não o usa na linha; lá é `verb` + `object`. */
  label: string
  /** Verbo no infinitivo, em pt-BR ("Ler", "Testar", "Perguntar a você"). */
  verb: string
  object: ToolObject | null
  /** A frase que o próprio agente escreveu (`description` do Bash): vai para o
   *  hover. Não é rótulo: vem na língua do modelo e pode dizer outra coisa que
   *  o comando faz. */
  narration: string | null
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

import {
  bashEchoLabel,
  fraseDoShell,
  presentShell,
  unwrapShellCommand,
} from "@/lib/toolShell"
import { presentFrotaTool } from "@/lib/toolFrota"

export { unwrapShellCommand }

function safeJson(v: unknown): string | null {
  try {
    const s = JSON.stringify(v, null, 2)
    return s && s !== "{}" && s !== "null" ? s.slice(0, 1200) : null
  } catch {
    return null
  }
}

/** Tools nativas de navegador que motores expõem SEM passar pela Frota (o
 *  inventário real do agy 1.2.x, `testdata/agy-1.2.2/resume.jsonl`). É registry
 *  de NOME de tool do contrato, não comparação de motor: outro motor que
 *  exponha o mesmo nome entra pela mesma porta. */
const TOOLS_NATIVAS_DE_NAVEGADOR = new Set([
  "open_browser_url",
  "browser_subagent",
  "browser_click_element",
  "capture_browser_screenshot",
  "read_browser_page",
  "execute_browser_javascript",
  "list_browser_pages",
])

/** Comando de shell que sobe um navegador por conta própria. Playwright e
 *  Puppeteer abrem o Chromium deles; `open` no macOS e `xdg-open` no Linux
 *  entregam a URL ao navegador do sistema. Puppeteer só conta invocado por
 *  `npx`: solto, o `|` de uma alternação de regex parecia pipe de shell
 *  (sicredi, 22/09/2026: `grep -E "^(canvas|playwright|puppeteer)$"` virou
 *  "navegador fora da Frota"). */
const SHELL_ABRE_NAVEGADOR =
  /(^|[\s;&|(])(npx\s+(-y\s+)?(playwright|puppeteer)\b|playwright\s+(open|test|codegen)\b|open\s+(-a\s+["']?(Google Chrome|Safari|Firefox|Chromium)|https?:)|xdg-open\s+https?:)/i

/** O navegador da Frota chega ao agente pelo MCP do projeto ou pelo
 *  `frota-browser` (ADR-224). Tudo que abre navegador por fora é ESTADO que a
 *  pessoa precisa ver na linha da tool: não é bloqueável (tool nativa, shell),
 *  então é dito. Puro. */
export function abreNavegadorForaDaFrota(name: string, input: unknown): boolean {
  if (TOOLS_NATIVAS_DE_NAVEGADOR.has(name) || name.startsWith("browser_")) return true
  if (name === "Bash") {
    const i = (input && typeof input === "object" ? input : {}) as Record<string, unknown>
    const cmd = typeof i.command === "string" ? i.command : ""
    return SHELL_ABRE_NAVEGADOR.test(cmd)
  }
  return false
}

export const META_NAVEGADOR_EXTERNO = "navegador fora da Frota"

export function presentTool(name: string, input: unknown): ToolView {
  const view = presentToolBase(name, input)
  if (!abreNavegadorForaDaFrota(name, input)) return view
  return {
    ...view,
    meta: view.meta ? `${META_NAVEGADOR_EXTERNO} · ${view.meta}` : META_NAVEGADOR_EXTERNO,
  }
}

function presentToolBase(name: string, input: unknown): ToolView {
  const i = (input && typeof input === "object" ? input : {}) as Record<
    string,
    unknown
  >
  const arquivo = (p: string): ToolObject | null => (p ? { kind: "file", path: p } : null)
  const texto = (t: string | null, n = 72): ToolObject | null =>
    t ? { kind: "text", text: clip(t, n) } : null
  switch (name) {
    case "Bash": {
      const cmd = str(i, "command") ?? ""
      const semantic = presentShell(cmd)
      const narrated = str(i, "description") ?? bashEchoLabel(unwrapShellCommand(cmd))
      const frase = fraseDoShell(cmd, narrated ? clip(narrated) : null)
      return {
        kind: "bash",
        ...semantic,
        label: narrated ? clip(narrated) : semantic.label,
        verb: frase.verb,
        object: frase.object,
        narration: narrated ? clip(narrated, 200) : null,
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
        verb: "Ler",
        object: arquivo(p),
        narration: null,
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
        verb: "Editar",
        object: arquivo(p),
        narration: null,
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
        verb: "Criar",
        object: arquivo(p),
        narration: null,
        category: "change",
        emphasis: "normal",
        meta: dir,
        detail: p || null,
      }
    }
    case "Grep": {
      const pat = str(i, "pattern")
      const scope = str(i, "path")
      const onde = scope ? splitPath(scope).base : null
      return {
        kind: "search",
        label: pat ? `Buscar “${clip(pat, 54)}”` : "Buscar no projeto",
        verb: "Buscar",
        object: texto(pat ? (onde ? `${pat} em ${onde}` : pat) : null),
        narration: null,
        category: "inspect",
        emphasis: "quiet",
        meta: onde,
        detail: safeJson(input),
      }
    }
    case "Glob": {
      const pat = str(i, "pattern")
      return {
        kind: "search",
        label: pat ? `Listar “${clip(pat, 54)}”` : "Listar arquivos",
        verb: "Listar",
        object: pat ? { kind: "command", text: clip(pat, 72) } : null,
        narration: null,
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
        verb: "Consultar",
        object: texto(url || null, 62),
        narration: null,
        category: "web",
        emphasis: "quiet",
        meta: null,
        detail: str(i, "prompt"),
      }
    }
    case "WebSearch": {
      const q = str(i, "query")
      return {
        kind: "web",
        label: q ? `Pesquisar “${clip(q, 56)}”` : "Pesquisar na web",
        verb: "Pesquisar",
        object: texto(q, 56),
        narration: null,
        category: "web",
        emphasis: "quiet",
        meta: null,
        detail: safeJson(input),
      }
    }
    // Imagem que o próprio motor gerou (contrato `GenerateImage`). O prompt é
    // do motor, não da pessoa: vai para o hover e o expand, não para o rótulo.
    case "GenerateImage": {
      const prompt = str(i, "prompt")
      const primeira = prompt?.split("\n").find((l) => l.trim()) ?? null
      return {
        kind: "image",
        label: "Gerar imagem",
        verb: "Gerar imagem",
        object: texto(primeira, 60),
        narration: prompt ? clip(prompt, 200) : null,
        category: "execute",
        emphasis: "normal",
        meta: null,
        detail: prompt,
      }
    }
    case "Task":
    case "Agent": {
      const d = str(i, "description") ?? str(i, "prompt")
      return {
        kind: "agent",
        label: clip(d ?? "Delegar tarefa"),
        verb: "Delegar",
        object: texto(d),
        narration: null,
        category: "delegate",
        emphasis: "normal",
        meta: str(i, "subagent_type"),
        detail: str(i, "prompt"),
      }
    }
    // Nó sintético de trabalho DIFERIDO do provider (deferred-work-plan D1.2):
    // workflow/background task que vive além do turno. O estado (iniciado/
    // concluiu/interrompido) mora em item.deferred e vira meta na ToolLine;
    // aqui só o rótulo humano + o resumo no expand. Sem `meta` própria: o
    // `task_type` cru ("local_agent") vazava termo técnico pra tela e a meta do
    // estado já ocupa esse espaço (background-status B2.3).
    case "DeferredWork": {
      const name = str(i, "name") ?? str(i, "kind")
      return {
        kind: "agent",
        label: name
          ? `Trabalho em background: ${clip(name, 56)}`
          : "Trabalho em background",
        verb: "Trabalho em background",
        object: texto(name, 56),
        narration: null,
        category: "delegate",
        emphasis: "normal",
        meta: null,
        detail: str(i, "description"),
      }
    }
    case "ManagedProcess": {
      const l = clip(str(i, "label") ?? str(i, "command") ?? "Processo gerenciado", 72)
      return {
        kind: "bash",
        label: l,
        verb: "Processo",
        object: texto(l),
        narration: null,
        category: "execute",
        emphasis: "normal",
        meta: str(i, "cwd"),
        detail: str(i, "command"),
      }
    }
    // O motor carregando o esquema de tools sob demanda: bastidor, não trabalho.
    case "ToolSearch": {
      const q = str(i, "query")
      return {
        kind: "search",
        label: "Carregar ferramentas",
        verb: "Carregar ferramentas",
        object: texto(q?.replace(/^select:/, "") ?? null, 60),
        narration: null,
        category: "inspect",
        emphasis: "quiet",
        meta: null,
        detail: safeJson(input),
      }
    }
    default: {
      const detail = safeJson(input)
      const daFrota = presentFrotaTool(name, i, detail)
      if (daFrota) return daFrota
      const nome = clip(name.replace(/^mcp__/, "").replaceAll("__", " · "), 60)
      return {
        kind: "generic",
        label: "Executar ferramenta",
        verb: "Usar",
        object: { kind: "text", text: nome },
        narration: null,
        category: "execute",
        emphasis: "normal",
        meta: nome,
        detail,
      }
    }
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
  result: { ok: boolean; text: string; lines: number; interrupted?: true } | undefined,
): string | null {
  if (!result) return null
  if (result.interrupted) return "parou"
  // A geração de imagem diz por que falhou (limite, recusa): "erro" sozinho
  // esconderia a única informação útil.
  if (!result.ok) return name === "GenerateImage" && result.text ? clip(result.text, 64) : "erro"
  const linhas = (n: number) => `${n} ${n === 1 ? "linha" : "linhas"}`
  if (name === "Read") return result.lines > 0 ? linhas(result.lines) : null
  if (name === "Grep" || name === "Glob")
    return `${result.lines} ${result.lines === 1 ? "resultado" : "resultados"}`
  if (name === "Bash") return result.lines > 1 ? linhas(result.lines) : null
  return null
}

/** Meta da evidência VISUAL (browser-plan B1): quantas capturas o resultado
 *  trouxe, na régua da linha da tool. Sem imagem → null (linha idêntica à de
 *  sempre, fail-open). */
export function evidenceMeta(images: string[] | undefined, name?: string): string | null {
  if (!images || images.length === 0) return null
  if (name === "GenerateImage") return images.length === 1 ? "1 imagem" : `${images.length} imagens`
  return images.length === 1 ? "1 captura" : `${images.length} capturas`
}
