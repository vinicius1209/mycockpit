import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"

/** Sessão VIVA de navegador de um projeto (B2.1 do docs/browser-plan.md).
 *  Só existe depois do `GET /json/version` responder: "ligado" aqui é estado
 *  real, nunca otimismo. */
export interface BrowserSession {
  projectId: string
  projectPath: string
  /** Id no registry de processos do app (mesmo eixo do mc-work). */
  processId: string
  pid: number
  /** O que o MCP recebe em `--cdp-endpoint`. */
  endpoint: string
  /** String reportada pelo próprio navegador (ex.: "Chrome/149.0.7827.55"). */
  browser: string | null
  userDataDir: string
  binary: string
  startedAt: number
}

export interface BrowserStatus {
  projectId: string
  session: BrowserSession | null
  /** Binário descoberto (Playwright primeiro, Chrome do sistema depois). */
  binary: string | null
  version: string | null
  /** Motivo honesto quando não há binário (aponta o comando de instalação). */
  detail: string | null
}

export async function browserStatus(
  projectPath: string,
): Promise<BrowserStatus | null> {
  if (!isTauri()) return null
  return invoke<BrowserStatus>("browser_status", { projectPath })
}

export async function startProjectBrowser(
  projectPath: string,
): Promise<BrowserSession> {
  return invoke<BrowserSession>("browser_start", { projectPath })
}

export async function stopProjectBrowser(projectPath: string): Promise<void> {
  await invoke("browser_stop", { projectPath })
}

/** Estado do navegador em uma linha, sem inventar atividade: sem sessão o
 *  rótulo fala do BINÁRIO (o que dá pra ligar), não de um browser imaginário. */
export function browserStateLabel(status: BrowserStatus | null): string {
  if (!status) return "indisponível fora do app"
  if (status.session) {
    const browser = status.session.browser ?? "navegador"
    return `ligado · ${browser} · ${status.session.endpoint}`
  }
  if (!status.binary) return status.detail ?? "nenhum Chromium encontrado"
  return status.version
    ? `desligado · Chromium ${status.version} pronto`
    : "desligado · Chromium pronto"
}
