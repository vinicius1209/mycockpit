export type AgentStatus = "idle" | "running" | "queued" | "success" | "error"

export interface Project {
  id: string
  name: string
  path: string
  createdAt: number
  /** Contexto detectado na pasta. M2 popula de verdade; M1 só estrutura. */
  hasClaudeMd?: boolean
  hasAgentsMd?: boolean
  status?: AgentStatus
}

/** Destino do console de comando: um agent ou (futuro) um modelo direto. */
export interface Destination {
  id: string
  label: string
  kind: "agent" | "model"
  available: boolean
  hint?: string
}
