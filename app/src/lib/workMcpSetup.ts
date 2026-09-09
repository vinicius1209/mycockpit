import { invoke } from "@tauri-apps/api/core"

export interface WorkMcpSetup {
  agent: string
  state: "absent" | "configured" | "disabled" | "conflict" | "unavailable"
  checkedAt: number
  detail: string | null
}

export const workMcpStatus = (agent: string) =>
  invoke<WorkMcpSetup>("work_mcp_status", { agent })

export const setWorkMcpEnabled = (agent: string, enabled: boolean) =>
  invoke<WorkMcpSetup>("set_work_mcp_enabled", { agent, enabled })

export function workMcpAction(state: WorkMcpSetup["state"]): string | null {
  if (state === "absent") return "Conectar"
  if (state === "disabled") return "Ativar"
  if (state === "configured") return "Desconectar"
  return null
}

export function workMcpLabel(state: WorkMcpSetup["state"]): string {
  return {
    absent: "Acompanhamento não conectado",
    configured: "Cadastro confirmado no CLI",
    disabled: "Cadastro desativado no CLI",
    conflict: "Configuração diferente encontrada",
    unavailable: "Não foi possível verificar o cadastro",
  }[state] ?? "Estado desconhecido"
}
