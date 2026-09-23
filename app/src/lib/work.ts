import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import type { BrowserSession } from "@/lib/browser"

export type ManagedProcessStatus =
  | "running"
  | "stopping"
  | "stopped"
  | "exited"
  | "failed"
  | "orphaned"

export interface ManagedProcess {
  id: string
  runId: string
  convId: string
  label: string
  command: string
  cwd: string
  pid: number
  status: ManagedProcessStatus
  exitCode: number | null
  output: string
  /** Caminho do arquivo de saída em disco (direct-to-disk, ADR-183). */
  outputFile?: string | null
  /** Última linha incremental aplicada; ausente em snapshots legados. */
  outputSeq?: number
  startedAt: number
  updatedAt: number
}

/** Ciclo de vida de um trabalho DIFERIDO do provider no fio (deferred-work-plan
 *  D1.2): `running` = vivo dentro do processo do CLI; `completed` = concluiu
 *  limpo; `interrupted` = o processo morreu/foi parado sem conclusão (o
 *  `stopped` da task-notification, o Done sem conclusão e o replay caem aqui). */
export type DeferredWorkStatus = "running" | "completed" | "interrupted"

/** O QUE é um trabalho diferido, no vocabulário do contrato. Espelho de
 *  `DeferredKind` em `src-tauri/src/agent.rs`: quem traduz o termo do motor
 *  (`local_bash`, `local_agent`...) é o adapter, nunca código genérico. */
export type DeferredKind = "terminal" | "subagent" | "workflow" | "other"

const DEFERRED_KINDS: ReadonlySet<string> = new Set(["terminal", "subagent", "workflow", "other"])

/** Conversas gravadas ANTES do contrato (até 21/09/2026) guardaram o
 *  `task_type` cru do motor da época. Só esta leitura conhece esses valores, e
 *  só para não reclassificar o que já está no banco. */
const KIND_GRAVADO_ANTES: Record<string, DeferredKind> = {
  local_bash: "terminal",
  bash: "terminal",
  local_agent: "subagent",
  local_workflow: "workflow",
}

/** O tipo de um trabalho diferido, venha ele do stream ou do banco. Valor que
 *  ninguém conhece vira `other`: degradação honesta, nunca um chute. */
export function deferredKind(d: { kind: string | null }): DeferredKind | null {
  if (!d.kind) return null
  if (DEFERRED_KINDS.has(d.kind)) return d.kind as DeferredKind
  return KIND_GRAVADO_ANTES[d.kind] ?? "other"
}

export interface DeferredWork {
  /** task_id do CLI. */
  id: string
  /** tool_use_id do tool_use `Workflow` que o criou (parentesco no Fio Vivo). */
  toolUseId: string | null
  /** Tipo normalizado pelo adapter (`DeferredKind`). É `string` porque item
   *  gravado antes do contrato traz o termo cru do motor da época: leia SEMPRE
   *  por `deferredKind(d)`, nunca compare este campo. */
  kind: string | null
  /** Nome humano (workflow_name/description). */
  name: string | null
  status: DeferredWorkStatus
  /** Último resumo observável (passo corrente / resumo final). */
  summary: string | null
  /** Caminho do resultado em DISCO (task_notification.output_file) — mostrado
   *  no nó quando o trabalho conclui/interrompe; o resultado nunca some. */
  outputFile: string | null
  /** Contador de progresso (usage.total_tokens do último task_progress): uma
   *  fase longa com o MESMO summary continua provando vida pro watchdog. */
  tokens: number | null
  startedAt: number
  updatedAt: number
}

export interface WorkEvent {
  kind:
    | "process_started"
    | "process_output"
    | "process_stopping"
    | "process_exited"
    | "work_plan"
    | "work_update"
    /** Navegador do projeto ligou/desligou/morreu (B2.1). Não tem `convId`:
     *  o eixo de posse é o PROJETO, então o reducer do chat o ignora. */
    | "browser_state"
    /** O agente pediu o navegador e ele está desligado (ADR-224): a Frota
     *  pergunta à pessoa; ligar continua gesto humano. */
    | "browser_needed"
    /** O agente ligou o navegador do projeto porque a pessoa autorizou isso
     *  neste projeto (ADR-228): a tela diz que foi ele. */
    | "browser_autostarted"
    /** O agente acabou de usar o navegador do projeto (qualquer ação menos o
     *  status): a tela abre a vista ao vivo, uma vez por turno (ADR-229). */
    | "browser_agent_active"
    /** O agente pediu o computador e a pessoa ainda não liberou (ADR-225):
     *  vale para ESTE run, até ele terminar. */
    | "desktop_needed"
    /** Liberação do computador mudou para um run: `granted` true ao liberar,
     *  false ao revogar ou quando o run termina. */
    | "desktop_state"
  data: {
    process?: ManagedProcess
    processId?: string
    stream?: "stdout" | "stderr"
    seq?: number
    line?: string
    updatedAt?: number
    runId?: string
    convId?: string
    projectId?: string
    projectPath?: string
    session?: BrowserSession | null
    granted?: boolean
    tasks?: Array<{
      id: string
      title: string
      description?: string
      status?: "pending" | "in_progress" | "completed"
    }>
    task?: {
      id: string
      title?: string
      description?: string
      status: "pending" | "in_progress" | "completed"
    }
  }
}

export function listenWorkEvents(
  onEvent: (event: WorkEvent) => void,
): Promise<UnlistenFn> {
  return listen<WorkEvent>("work://event", (event) => onEvent(event.payload))
}

export function stopManagedProcess(
  processId: string,
): Promise<ManagedProcess> {
  return invoke("managed_process_stop", { processId })
}

export function stopManagedProcessesByConv(
  convId: string,
): Promise<ManagedProcess[]> {
  return invoke("managed_process_stop_by_conv", { convId })
}

export function retryManagedProcess(
  processId: string,
): Promise<ManagedProcess> {
  return invoke("managed_process_retry", { processId })
}

export function startManagedProcess(
  process: Pick<ManagedProcess, "convId" | "command" | "cwd" | "label">,
): Promise<ManagedProcess> {
  return invoke("managed_process_start", {
    convId: process.convId,
    command: process.command,
    cwd: process.cwd,
    label: process.label,
  })
}
