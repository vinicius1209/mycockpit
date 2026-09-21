import type { PermissionMode } from "@/lib/types"

export type ContextPanelTab =
  | "arquivos"
  | "conversa"
  | "alteracoes"
  /** Trabalho em segundo plano da conversa ativa (ADR-200). */
  | "bastidores"
  | "contexto"

export interface TranscriptRevealRequest {
  conversationId: string
  itemId: string
  nonce: number
}

/** Config por projeto (espelho resolvido de .frota/config.toml, Fase 1). */
export interface ProjectConfig {
  exists: boolean
  /** Nome da pasta da Frota NESTE projeto, resolvido pelo Rust (pode ser o
   *  nome legado num projeto que ainda não migrou). A tela mostra o caminho
   *  real, nunca um literal que mentiria nesse caso. */
  pasta: string
  permission: PermissionMode
  helper: string | null
  mode: string
  extraDirs: string[]
}
