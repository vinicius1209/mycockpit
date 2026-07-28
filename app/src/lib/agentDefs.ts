// PERSONAS EM ARQUIVO — `.mycockpit/agents/<slug>.md`, o `.claude/agents` do
// próprio app. Antes as personas (agent_presets) viviam só no SQLite: não
// entravam no git, não eram revisáveis em PR, não viajavam no clone e eram
// GLOBAIS (a mesma lista em todo projeto, sem jeito de ter uma persona que só
// faz sentido num repo).
//
// Padrão da casa, o mesmo do `config.toml`: o ARQUIVO é a fonte de verdade.
// Dois escopos, como `.claude/commands`: do projeto (`<projeto>/.mycockpit/
// agents/`) e global do usuário (`~/.mycockpit/agents/`), com o do projeto
// vencendo no mesmo slug.
//
// O digest continua sendo a identidade comportamental (lib/presets.presetDigest)
// e é recomputado dos campos LIDOS — então editar o .md à mão também dispara o
// aviso de drift nas conversas carimbadas, que é exatamente o desejado.

import { invoke } from "@tauri-apps/api/core"
import { isTauri, type AgentPreset, type AgentPresetInput } from "@/lib/db"
import { presetDigest } from "@/lib/presets"

export type PresetScope = "projeto" | "global"

/** Persona lida de arquivo: um AgentPreset + de onde ele veio. Superset de
 *  propósito — todo consumidor de AgentPreset segue funcionando. */
export interface AgentDef extends AgentPreset {
  scope: PresetScope
  slug: string
  /** Caminho absoluto (só p/ exibir/abrir). */
  path: string
}

/** O que o Rust devolve por arquivo (mycockpit.rs::AgentDefFile). */
interface AgentDefFile {
  slug: string
  scope: PresetScope
  path: string
  content: string
  updated_at: number
}

// ---------------------------------------------------------------------------
// Núcleo puro: frontmatter, slug, serialização
// ---------------------------------------------------------------------------

/** Frontmatter minimalista (chave: valor por linha) + corpo. Sem dependência de
 *  YAML: os campos de persona são escalares de uma linha, e o corpo — a
 *  personalidade, que é markdown livre — fica FORA do frontmatter justamente
 *  pra não depender de parser. Valores podem vir entre aspas (JSON). */
export function parseFrontmatter(raw: string): {
  fields: Record<string, string>
  body: string
} {
  const linhas = raw.split("\n")
  if (linhas[0]?.trim() !== "---") return { fields: {}, body: raw.trim() }
  const fields: Record<string, string> = {}
  let i = 1
  for (; i < linhas.length; i++) {
    if (linhas[i].trim() === "---") {
      i++
      break
    }
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(linhas[i])
    if (!m) continue
    fields[m[1]] = desaspar(m[2].trim())
  }
  return { fields, body: linhas.slice(i).join("\n").trim() }
}

/** Tira as aspas de um valor escrito por nós (JSON.stringify) sem quebrar o
 *  valor escrito à mão (que normalmente vem cru). */
function desaspar(v: string): string {
  if (v.length > 1 && v.startsWith('"') && v.endsWith('"')) {
    try {
      return JSON.parse(v) as string
    } catch {
      return v.slice(1, -1)
    }
  }
  return v
}

/** Só cita quando precisa — arquivo escrito à mão fica legível. */
function citar(v: string): string {
  return /^[\w][\w .,;/()+-]*$/.test(v) ? v : JSON.stringify(v)
}

/** Nome → slug de arquivo: minúsculas sem acento, só [a-z0-9-_]. */
export function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return s || "persona"
}

/** Lista "a, b" ou "[a, b]" → nomes. Aceita as duas porque o arquivo é
 *  editável à mão e as duas formas são naturais em YAML. */
export function parseSkillsList(v: string): string[] {
  return v
    .replace(/^\[|\]$/g, "")
    .split(",")
    .map((s) => s.trim().replace(/^\//, ""))
    .filter(Boolean)
}

/** Markdown final da persona. `version` é carimbada por nós a cada save; edição
 *  à mão não a incrementa — e não precisa, porque quem detecta mudança de
 *  comportamento é o DIGEST, recomputado do conteúdo. */
export function serializeAgentDef(
  p: AgentPresetInput & { version: number; id?: string; slug?: string },
): string {
  const fm: string[] = ["---"]
  // `id` só existe nas personas MIGRADAS do SQLite: preserva o UUID que as
  // conversas antigas carimbaram, senão elas apontariam pro vazio.
  if (p.id) fm.push(`id: ${p.id}`)
  fm.push(`name: ${citar(p.name)}`)
  fm.push(`backend: ${p.backend}`)
  if (p.model) fm.push(`model: ${citar(p.model)}`)
  if (p.effort) fm.push(`effort: ${citar(p.effort)}`)
  if (p.skills.length) fm.push(`skills: ${p.skills.join(", ")}`)
  if (p.policy) fm.push(`policy: ${citar(p.policy)}`)
  // E2 — só escreve os campos novos quando carregam informação além do default,
  // pra não poluir arquivos existentes nem inventar linha mentirosa. category
  // "Geral" e avatar_style "thumbs" são os defaults; avatar_seed = slug idem.
  if (p.category && p.category !== "Geral") {
    fm.push(`category: ${citar(p.category)}`)
  }
  // rubrica: itens têm vírgula/pontuação, então array JSON de UMA linha (não a
  // lista "a, b" das skills) — o parse desambigua pelo "[" inicial.
  if (p.rubric.length) fm.push(`rubric: ${JSON.stringify(p.rubric)}`)
  // avatar_style só quando é OVERRIDE (!= default do sistema). A UI não pica
  // mais estilo; isto cobre a edição à mão do arquivo.
  if (p.avatarStyle && p.avatarStyle !== "thumbs") {
    fm.push(`avatar_style: ${citar(p.avatarStyle)}`)
  }
  if (p.avatarSeed && p.avatarSeed !== p.slug) {
    fm.push(`avatar_seed: ${citar(p.avatarSeed)}`)
  }
  fm.push(`version: ${p.version}`)
  fm.push("---", "")
  return `${fm.join("\n")}${p.personalityMd.trim()}\n`
}

/** Rubrica do frontmatter → lista. Array JSON de uma linha (o que a gente
 *  escreve) OU a forma "a, b" (editada à mão) — o "[" inicial desambigua. */
export function parseRubric(v: string): string[] {
  const t = v.trim()
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t)
      if (Array.isArray(arr)) {
        return arr.filter((x): x is string => typeof x === "string")
      }
    } catch {
      // JSON quebrado (editado à mão sem fechar) — cai no fallback de lista.
    }
  }
  return parseSkillsList(v)
}

/** Campos crus do arquivo → preset (sem o digest, que é assíncrono). */
export function defFieldsFrom(file: AgentDefFile): Omit<AgentDef, "digest"> {
  const { fields, body } = parseFrontmatter(file.content)
  const v = Number.parseInt(fields.version ?? "1", 10)
  return {
    // Sem `id:` no arquivo, a identidade é escopo+slug: estável, legível e
    // rastreável (bem melhor que UUID pra algo que agora vive no git).
    id: fields.id || `${file.scope}:${file.slug}`,
    name: fields.name || file.slug,
    personalityMd: body,
    skills: fields.skills ? parseSkillsList(fields.skills) : [],
    policy: fields.policy || null,
    backend: fields.backend || "claude-code",
    model: fields.model || null,
    effort: fields.effort || null,
    // E2 — defaults na ausência (persona antiga carrega sem quebrar): category
    // "Geral", rubric [], avatar_style "thumbs" (default do sistema), seed = slug.
    category: fields.category || "Geral",
    rubric: fields.rubric ? parseRubric(fields.rubric) : [],
    avatarStyle: fields.avatar_style || "thumbs",
    avatarSeed: fields.avatar_seed || file.slug,
    version: Number.isFinite(v) && v > 0 ? v : 1,
    createdAt: file.updated_at,
    updatedAt: file.updated_at,
    scope: file.scope,
    slug: file.slug,
    path: file.path,
  }
}

/** Projeto vence global no mesmo slug (mesma precedência do
 *  read_project_commands). Ordena por nome pra UI. */
export function dedupeByScope(defs: AgentDef[]): AgentDef[] {
  const porSlug = new Map<string, AgentDef>()
  for (const d of defs) {
    const atual = porSlug.get(d.slug)
    if (!atual || (atual.scope === "global" && d.scope === "projeto")) {
      porSlug.set(d.slug, d)
    }
  }
  return [...porSlug.values()].sort((a, b) =>
    a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
  )
}

// ---------------------------------------------------------------------------
// Disco
// ---------------------------------------------------------------------------

/** TODAS as personas dos dois escopos, SEM deduplicar e SEM engolir erro.
 *  Sem dedup porque quem aloca slug precisa enxergar até a persona global que
 *  está sombreada por uma do projeto — senão criar uma nova com o mesmo nome
 *  sobrescreveria o arquivo escondido. Sem catch porque quem resolve UMA
 *  persona precisa distinguir "não existe" de "não consegui ler". */
export async function readAllAgentDefs(
  projectPath: string | null,
): Promise<AgentDef[]> {
  if (!isTauri()) return []
  const files = await invoke<AgentDefFile[]>("read_agent_defs", { projectPath })
  return Promise.all(
    files.map(async (f) => {
      const base = defFieldsFrom(f)
      return { ...base, digest: await presetDigest(base) }
    }),
  )
}

/** Personas visíveis num projeto (deduplicadas, projeto > global). Falha vira
 *  lista vazia — é a leitura de EXIBIÇÃO, e persona é opcional. */
export async function listAgentDefs(
  projectPath: string | null,
): Promise<AgentDef[]> {
  try {
    return dedupeByScope(await readAllAgentDefs(projectPath))
  } catch (e) {
    console.warn("[personas] falha ao listar", e)
    return []
  }
}

/** Grava (cria ou substitui) uma persona. `slug` fixo na edição — renomear o
 *  arquivo mudaria a identidade; renomear a persona só muda o `name`. */
export async function saveAgentDef(opts: {
  projectPath: string | null
  scope: PresetScope
  slug: string
  input: AgentPresetInput
  version: number
  /** UUID legado, quando a persona veio do SQLite. */
  id?: string
}): Promise<AgentDef> {
  const content = serializeAgentDef({
    ...opts.input,
    version: opts.version,
    id: opts.id,
    // slug: permite omitir avatar_seed quando é o default (= slug).
    slug: opts.slug,
  })
  const path = await invoke<string>("write_agent_def", {
    projectPath: opts.projectPath,
    scope: opts.scope,
    slug: opts.slug,
    content,
  })
  const base = defFieldsFrom({
    slug: opts.slug,
    scope: opts.scope,
    path,
    content,
    updated_at: Date.now(),
  })
  return { ...base, digest: await presetDigest(base) }
}

export async function deleteAgentDef(
  projectPath: string | null,
  scope: PresetScope,
  slug: string,
): Promise<void> {
  await invoke("delete_agent_def", { projectPath, scope, slug })
}

/** Uma persona pelo id (o que as conversas carimbam). Varre os dois escopos —
 *  é barato (poucos arquivos pequenos) e evita um índice paralelo pra manter
 *  sincronizado.
 *
 *  LANÇA se o disco falhar, de propósito: quem chama (resolveFirstTurnPersona)
 *  é fail-closed e tem mensagens diferentes pra "a persona não existe mais" e
 *  "não consegui carregar". Engolir aqui faria um erro de leitura chegar ao
 *  usuário como "essa persona foi apagada" — mentira, sobre um arquivo intacto. */
export async function getAgentDef(
  projectPath: string | null,
  id: string,
): Promise<AgentDef | null> {
  const todas = await readAllAgentDefs(projectPath)
  return dedupeByScope(todas).find((d) => d.id === id) ?? null
}
