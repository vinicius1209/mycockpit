export type AgentStatus = "idle" | "running" | "queued" | "success" | "error"

/** Política de permissão por projeto (vira flags do claude, ver agent-runner.md §7). */
export type PermissionMode = "leitura" | "padrao" | "liberado"

export interface Project {
  id: string
  name: string
  path: string
  createdAt: number
  /** Contexto detectado na pasta. M2 popula de verdade; M1 só estrutura. */
  hasClaudeMd?: boolean
  hasAgentsMd?: boolean
  status?: AgentStatus
  permissionMode?: PermissionMode
  /** Rótulo de cor (hex) ou null/undefined = sem cor. */
  color?: string | null
}

/** Configuração de UM run: qual agent + modelo/effort (null = default do CLI). */
export interface AgentRunConfig {
  agent: string
  model: string | null
  effort: string | null
  /** "Planejar primeiro" (por turno): o motor segura os writes e o agent só
   *  propõe um plano; a execução vem num turno seguinte, após aprovação. */
  planFirst?: boolean
}

/** Destino do console de comando: um agent ou (futuro) um modelo direto. */
export interface Destination {
  id: string
  label: string
  kind: "agent" | "model"
  available: boolean
  hint?: string
  /** Descrição curta (linha secundária no seletor rico). */
  description?: string
}
