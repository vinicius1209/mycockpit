// Inventário de contexto do projeto (o que o agent enxerga no cwd): arquivos de
// instrução, .claude/ e .mcp.json. Espelha read_project_context no Rust (context.rs).

import { invoke } from "@tauri-apps/api/core"

export interface ContextFile {
  name: string
  exists: boolean
  content: string | null
  bytes: number
}

export interface ClaudeDir {
  exists: boolean
  agents: number
  commands: number
  skills: number
  plans: number
  hooks: number
  settings: boolean
}

export interface ProjectContext {
  files: ContextFile[]
  claude_dir: ClaudeDir
  mcp_servers: number | null
}

export async function readProjectContext(path: string): Promise<ProjectContext> {
  return invoke<ProjectContext>("read_project_context", { path })
}
