import type { PermissionMode } from "@/lib/types"

export type ContextPanelTab =
  | "arquivos"
  | "conversa"
  | "alteracoes"
  | "contexto"

export interface TranscriptRevealRequest {
  conversationId: string
  itemId: string
  nonce: number
}

/** Config por projeto (espelho resolvido de .mycockpit/config.toml, Fase 1). */
export interface ProjectConfig {
  exists: boolean
  permission: PermissionMode
  helper: string | null
  mode: string
  extraDirs: string[]
}
