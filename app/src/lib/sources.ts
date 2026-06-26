import { invoke } from "@tauri-apps/api/core"

/** Fase 2 — fontes reais do projeto, indexadas (não copiadas). */
export interface Persona {
  name: string
  description: string | null
  model: string | null
}

export interface Spec {
  slug: string
  stage: string | null
  title: string | null
}

export interface MemoryInfo {
  exists: boolean
  count: number
  path: string | null
}

export interface ProjectSources {
  personas: Persona[]
  specs: Spec[]
  memory: MemoryInfo
}

export async function readProjectSources(path: string): Promise<ProjectSources> {
  return invoke<ProjectSources>("read_project_sources", { path })
}
