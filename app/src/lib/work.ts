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

export interface DeferredWork {
  /** task_id do CLI. */
  id: string
  /** tool_use_id do tool_use `Workflow` que o criou (parentesco no Fio Vivo). */
  toolUseId: string | null
  /** task_type do CLI (ex. local_workflow). */
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
    session?: BrowserSession | null
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
