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

/** Lista arquivos do projeto (respeita .gitignore) p/ o "@". */
export async function listProjectFiles(path: string): Promise<string[]> {
  return invoke<string[]>("list_project_files", { path })
}
