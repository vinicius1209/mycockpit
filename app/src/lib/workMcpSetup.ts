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

// Os três canais têm os mesmos cinco estados, e a pessoa lê o mesmo idioma
// nos três (ADR-268): o estado, não o mecanismo ("Conectado", nunca
// "Cadastro confirmado no CLI"). O que o canal faz vem escrito na linha.
const ROTULO_DO_ESTADO: Record<WorkMcpSetup["state"], string> = {
  absent: "Não conectado",
  configured: "Conectado",
  disabled: "Desativado no CLI",
  conflict: "Há outra entrada com o mesmo nome no CLI",
  unavailable: "Não foi possível verificar",
}

const rotuloDoEstado = (state: WorkMcpSetup["state"]): string =>
  ROTULO_DO_ESTADO[state] ?? "Estado desconhecido"

export const browserMcpLabel = rotuloDoEstado
export const desktopMcpLabel = rotuloDoEstado
export const workMcpLabel = rotuloDoEstado
