import { invoke } from "@tauri-apps/api/core"

/** Fase 2 — fontes reais do projeto, indexadas (não copiadas). */
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

/** Lê o conteúdo de um arquivo (persona/spec/memória) p/ o detalhe. */
export async function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path })
}

export interface SlashCommand {
  name: string
  description: string | null
  kind: string // "command" | "skill"
  origin: string // "project" | "global"
}

export async function readProjectCommands(
  path: string,
): Promise<SlashCommand[]> {
  return invoke<SlashCommand[]>("read_project_commands", { path })
}

/** Lista arquivos do projeto (respeita .gitignore) p/ o "@". */
export async function listProjectFiles(path: string): Promise<string[]> {
  return invoke<string[]>("list_project_files", { path })
}
