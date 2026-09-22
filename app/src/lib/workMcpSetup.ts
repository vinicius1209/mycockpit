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

/** `frota-browser` (ADR-224): mesma receita de cadastro global do trabalho. */
export const browserMcpStatus = (agent: string) =>
  invoke<WorkMcpSetup>("browser_mcp_status", { agent })

export const setBrowserMcpEnabled = (agent: string, enabled: boolean) =>
  invoke<WorkMcpSetup>("set_browser_mcp_enabled", { agent, enabled })

/** `frota-desktop` (ADR-225): o controle do computador da Frota, mesma receita. */
export const desktopMcpStatus = (agent: string) =>
  invoke<WorkMcpSetup>("desktop_mcp_status", { agent })

export const setDesktopMcpEnabled = (agent: string, enabled: boolean) =>
  invoke<WorkMcpSetup>("set_desktop_mcp_enabled", { agent, enabled })

export function workMcpAction(state: WorkMcpSetup["state"]): string | null {
  if (state === "absent") return "Conectar"
  if (state === "disabled") return "Ativar"
  if (state === "configured") return "Desconectar"
  return null
}

export function browserMcpLabel(state: WorkMcpSetup["state"]): string {
  return {
    absent: "Navegador da Frota não conectado",
    configured: "Cadastro confirmado no CLI",
    disabled: "Cadastro desativado no CLI",
    conflict: "Configuração diferente encontrada",
    unavailable: "Não foi possível verificar o cadastro",
  }[state] ?? "Estado desconhecido"
}

export function desktopMcpLabel(state: WorkMcpSetup["state"]): string {
  return {
    absent: "Controle do computador da Frota não conectado",
    configured: "Cadastro confirmado no CLI",
    disabled: "Cadastro desativado no CLI",
    conflict: "Configuração diferente encontrada",
    unavailable: "Não foi possível verificar o cadastro",
  }[state] ?? "Estado desconhecido"
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
