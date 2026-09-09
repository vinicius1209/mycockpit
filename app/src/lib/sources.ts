import { invoke } from "@tauri-apps/api/core"

/** Fase 2, fontes reais do projeto, indexadas (não copiadas). */
export interface Persona {
  name: string
  description: string | null
  model: string | null
  path: string
}

export interface Spec {
  slug: string
  stage: string | null
  title: string | null
  path: string
}

export interface MemoryInfo {
  exists: boolean
  count: number
  path: string | null
}

export interface Drift {
  copy: string
  source: string
  days_stale: number
}

export interface ProjectSources {
  personas: Persona[]
  specs: Spec[]
  memory: MemoryInfo
  drift: Drift[]
}

export async function readProjectSources(path: string): Promise<ProjectSources> {
  return invoke<ProjectSources>("read_project_sources", { path })
}

/** Lê o conteúdo de um arquivo (persona/spec/memória) p/ o detalhe. `root` =
 *  raiz permitida (pasta do projeto); o backend também aceita ~/.claude. */
export async function readTextFile(root: string, path: string): Promise<string> {
  return invoke<string>("read_text_file", { root, path })
}

/** Lê uma imagem sem serializar cada byte como um número JSON. */
export async function readProjectFileBytes(
  root: string,
  path: string,
): Promise<Uint8Array> {
  const raw = await invoke<ArrayBuffer | Uint8Array | number[]>(
    "read_project_file_bytes",
    { root, path },
  )
  if (raw instanceof Uint8Array) return raw
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw)
  if (Array.isArray(raw)) return Uint8Array.from(raw)
  throw new Error("O aplicativo devolveu um formato de arquivo inesperado.")
}

export interface SlashCommand {
  name: string
  description: string | null
  kind: string // "command" | "skill"
  origin: string // "project" | "global"
  /** De onde o comando veio: "mycockpit" | "claude" | "codex" | "plugin". */
  source: string
  /** Markdown inteiro do arquivo (frontmatter incluso) p/ a expansão
   *  app-side; null se o arquivo estava ilegível. */
  body: string | null
  /** Proveniência fechada de uma skill de plugin aprovada. */
  pluginKey?: string
  pluginName?: string
  pluginFingerprint?: string
  contributionId?: string
}

/** Inventário de comandos "/" POR AGENT da conversa: casa e skills de plugin
 *  aprovadas valem para todos; convenções nativas vêm do registry do agent. */
export async function readProjectCommands(
  path: string,
  agent: string,
): Promise<SlashCommand[]> {
  return invoke<SlashCommand[]>("read_project_commands", { path, agent })
}

export interface ProjectDirEntry {
  name: string
  relPath: string
  kind: "directory" | "file"
  isSymlink: boolean
}

export interface ProjectDirPage {
  parent: string
  entries: ProjectDirEntry[]
  nextCursor: string | null
  truncated: boolean
  rootRevision: string
}

export interface ProjectFileSearchPage {
  query: string
  entries: ProjectDirEntry[]
  nextCursor: string | null
  truncated: boolean
  source: "git" | "ignored-walk"
  rootRevision: string
}

export async function listDirChildren(input: {
  root: string
  relPath?: string
  cursor?: string | null
  limit?: number
}): Promise<ProjectDirPage> {
  return invoke<ProjectDirPage>("list_dir_children", {
    root: input.root,
    relPath: input.relPath ?? "",
    cursor: input.cursor ?? null,
    limit: input.limit,
  })
}

export async function searchProjectFiles(input: {
  root: string
  query: string
  cursor?: string | null
  limit?: number
}): Promise<ProjectFileSearchPage> {
  return invoke<ProjectFileSearchPage>("search_project_files", {
    root: input.root,
    query: input.query,
    cursor: input.cursor ?? null,
    limit: input.limit,
  })
}
