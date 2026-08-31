import { cancelAgent, runAgent, type CostSource } from "@/lib/agent"
import type { Attachment } from "@/lib/attachments"
import type { InstructionSourceClaim } from "@/lib/tooling"
import type { ChatItem } from "@/store/chat"

/** Campos de custo de um result; preço ausente continua sendo desconhecido. */
export interface PhaseCostEvent {
  costUsd: number | null
  costSource: CostSource | undefined
  input: number
  output: number
  cache: number
}

/** Contrato de execução de uma fase, separado do reducer operacional. */
export interface RunPhaseArgs {
  runId: string
  convId: string
  agent: string
  model: string | null
  effort: string | null
  prompt: string
  cwd: string
  permission: string
  instructionSources?: InstructionSourceClaim[]
  maxRetries: number
  /** Anexos do launcher na primeira fase ou das respostas ricas de um gate. */
  attachments?: Attachment[]
  /** Espelha tentativa e itens reduzidos na timeline. */
  onProgress?: (attempt: number, items: ChatItem[]) => void
  /** Recebe cada result, inclusive de tentativa descartada. */
  onCost?: (attempt: number, event: PhaseCostEvent) => void
  /** Teto restante; null ou ausente desliga o corte intra-fase. */
  stopAtCostUsd?: number | null
  /** Dependências injetáveis para provas sem processo real. */
  run?: typeof runAgent
  cancel?: typeof cancelAgent
}
