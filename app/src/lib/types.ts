export type AgentStatus = "idle" | "running" | "queued" | "success" | "error"

/** Política de permissão por projeto (vira flags do claude, ver agent-runner.md §7). */
/** Modo de permissão do PROJETO. `auto` entrou em 21/08/2026 (M2 dos modos de
 *  sessão): o Rust já o aceitava e o agendamento já o usava, mas a conversa não
 *  tinha como escolher — era o mesmo eixo com vocabulários diferentes por
 *  superfície. Acrescentar valor é compatível: config.toml e banco antigos
 *  continuam válidos, e `auto` só aparece se você escolher. */
export type PermissionMode = "leitura" | "padrao" | "auto" | "liberado"

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
  /** SAÍDA DE EMERGÊNCIA: este envio carrega uma troca DELIBERADA de modelo
   *  numa conversa já travada. A identidade de uma conversa fixa no 1º envio, e
   *  quando é o próprio MODELO que mata o turno (slug inválido, modelo sem
   *  acesso, teto da conta) reenviar só repetia o erro: a única saída era trocar
   *  de AGENT no card do incidente, perdendo a escolha de modelo. Com a flag, o
   *  `model` acima vence a trava (inclusive `null` = "deixa o CLI escolher",
   *  que é escape legítimo de um pin ruim).
   *
   *  Flag EXPLÍCITA de propósito: o despacho não afrouxa a trava por conta
   *  própria, ele obedece a um pedido que o composer só monta depois de um
   *  turno que falhou (`lastExecutorTurnFailed`, lib/turnOutcome.ts). Ausente =
   *  nada muda — ⌘K, fila coalescida e todo caller antigo seguem travados. */
  modelSwitched?: boolean
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
