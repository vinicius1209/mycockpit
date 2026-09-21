import { invoke } from "@tauri-apps/api/core"
import { isTauri } from "@/lib/db"
import { agentDef } from "@/lib/agents"
import type { McpAgentState, McpServer } from "@/lib/mcp"

/** Sessão VIVA de navegador de um projeto (B2.1 do docs/browser-plan.md).
 *  Só existe depois do `GET /json/version` responder: "ligado" aqui é estado
 *  real, nunca otimismo. */
export interface BrowserSession {
  projectId: string
  projectPath: string
  /** Id no registry de processos do app (mesmo eixo do frota-work). */
  processId: string
  pid: number
  /** O que o MCP recebe em `--cdp-endpoint`. */
  endpoint: string
  /** String reportada pelo próprio navegador (ex.: "Chrome/149.0.7827.55"). */
  browser: string | null
  userDataDir: string
  binary: string
  windowVisible: boolean
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
  windowVisible = false,
): Promise<BrowserSession> {
  return invoke<BrowserSession>("browser_start", { projectPath, windowVisible })
}

export async function stopProjectBrowser(projectPath: string): Promise<void> {
  await invoke("browser_stop", { projectPath })
}

export interface BrowserPage {
  id: string
  title: string
  url: string
  displayUrl: string
}

export interface BrowserPilotStatus {
  projectId: string
  mode: "idle" | "agent" | "plugin" | "human" | "unavailable"
  label: string
  since: number | null
  expiresAt: number | null
  canTakeOver: boolean
}

export interface HumanPilotGrant {
  token: string
  status: BrowserPilotStatus
}

export interface BrowserPreviewStatus {
  projectId: string
  targetId: string
  running: boolean
  revision: number
  error: string | null
}

export interface BrowserPreviewFrame {
  projectId: string
  targetId: string
  revision: number
  capturedAt: number
  data: string
  width: number | null
  height: number | null
}

export type BrowserInputAction =
  | { kind: "click"; x: number; y: number }
  | {
      kind: "scroll"
      x: number
      y: number
      deltaX: number
      deltaY: number
    }
  | { kind: "text"; text: string }
  | { kind: "key"; key: string; code: string }
  | { kind: "history"; direction: "back" | "forward" }
  | { kind: "navigate"; url: string }

export function listBrowserPages(projectPath: string): Promise<BrowserPage[]> {
  return invoke<BrowserPage[]>("browser_pages", { projectPath })
}

export function browserPilotStatus(
  projectPath: string,
): Promise<BrowserPilotStatus> {
  return invoke<BrowserPilotStatus>("browser_pilot_status", { projectPath })
}

export function acquireBrowserPilot(
  projectPath: string,
): Promise<HumanPilotGrant> {
  return invoke<HumanPilotGrant>("browser_pilot_acquire", { projectPath })
}

export function heartbeatBrowserPilot(
  projectPath: string,
  token: string,
): Promise<BrowserPilotStatus> {
  return invoke<BrowserPilotStatus>("browser_pilot_heartbeat", {
    projectPath,
    token,
  })
}

export function releaseBrowserPilot(
  projectPath: string,
  token: string,
): Promise<BrowserPilotStatus> {
  return invoke<BrowserPilotStatus>("browser_pilot_release", {
    projectPath,
    token,
  })
}

export function startBrowserPreview(
  projectPath: string,
  targetId: string,
): Promise<BrowserPreviewStatus> {
  return invoke<BrowserPreviewStatus>("browser_preview_start", {
    projectPath,
    targetId,
  })
}

export function browserPreviewFrame(
  projectPath: string,
  afterRevision?: number,
): Promise<BrowserPreviewFrame | null> {
  return invoke<BrowserPreviewFrame | null>("browser_preview_frame", {
    projectPath,
    afterRevision,
  })
}

export function stopBrowserPreview(projectPath: string): Promise<void> {
  return invoke("browser_preview_stop", { projectPath })
}

export function sendBrowserInput(
  projectPath: string,
  targetId: string,
  token: string,
  action: BrowserInputAction,
): Promise<void> {
  return invoke("browser_input", { projectPath, targetId, token, action })
}

export function openBrowserPanel(projectPath: string): Promise<void> {
  return invoke("browser_panel_open", { projectPath })
}

/** Estado do navegador em uma linha, sem inventar atividade: sem sessão o
 *  rótulo fala do BINÁRIO (o que dá pra ligar), não de um browser imaginário. */
export function browserStateLabel(status: BrowserStatus | null): string {
  if (!status) return "indisponível fora do app"
  if (status.session) {
    const browser = status.session.browser ?? "navegador"
    return `ligado · ${browser} · perfil deste projeto`
  }
  if (!status.binary) return status.detail ?? "nenhum Chromium encontrado"
  return status.version
    ? `desligado · Chromium ${status.version} pronto`
    : "desligado · Chromium pronto"
}

/** Nomes dos MCPs que este projeto marcou para dirigir o navegador do app. */
export function browserBoundServers(servers: McpServer[]): string[] {
  return servers
    .filter((server) =>
      server.agentStates.some((state) => state.enabled && state.browser),
    )
    .map((server) => server.name)
}

/** Consequência honesta dos bindings de navegador quando ele está desligado.
 *  A marca `browser` escolhe o transporte; só `required` impede o turno. */
export function browserBindingWarning(
  servers: McpServer[],
  status: BrowserStatus | null,
): string | null {
  if (status?.session) return null
  const names = browserBoundServers(servers)
  if (names.length === 0) return null
  const required = servers
    .filter((server) =>
      server.agentStates.some(
        (state) => state.enabled && state.browser && state.required,
      ),
    )
    .map((server) => server.name)
  if (required.length > 0) {
    return `${required.join(", ")} ${required.length > 1 ? "exigem" : "exige"} o navegador deste projeto, que está desligado. O próximo turno não inicia até você decidir.`
  }
  return `${names.join(", ")} ${names.length > 1 ? "usam" : "usa"} o navegador deste projeto, que está desligado. ${names.length > 1 ? "Esses MCPs ficam" : "Esse MCP fica"} fora do próximo turno.`
}

// ---- o encadeamento honesto (ligar o navegador NÃO basta) ------------------
//
// Quem recebe o `--cdp-endpoint` num run é decidido no backend por LINHA de
// `mcp_bindings`, que é por (projeto, servidor, agent): `plan_for_run` lê só as
// linhas do agent do run e injeta onde `browser = 1` (mcp_control.rs). "Ligado"
// é, portanto, DOIS interruptores: o binding daquele servidor para AQUELE agent
// e a marca `navegador` nele. A UI dizia só o estado do Chromium, e quem ligava
// só o navegador não tinha como saber que faltava metade.

/** Um agent e por quais MCPs ele recebe o navegador do projeto. */
export interface BrowserDelivery {
  /** Id do agent (registry `lib/agents.ts`, nunca comparado por nome aqui). */
  agent: string
  /** Nomes dos MCPs que entregam o navegador a ESTE agent. */
  servers: string[]
}

/** Rótulo curto do agent pelo registry. Id desconhecido vira ele mesmo em vez
 *  de sumir: binding órfão continua visível. */
function agentLabel(id: string): string {
  return agentDef(id)?.shortLabel ?? id
}

/** Quem REALMENTE recebe o navegador do projeto, por agent. Espelha a condição
 *  do backend (linha de binding presente = `enabled`, mais a marca `browser`);
 *  não considera a sessão viva, que é o outro elo e é dito à parte. */
export function browserDeliveries(servers: McpServer[]): BrowserDelivery[] {
  const porAgent = new Map<string, string[]>()
  for (const server of servers) {
    for (const state of server.agentStates) {
      if (!state.enabled || !state.browser) continue
      const atual = porAgent.get(state.agent)
      if (atual) atual.push(server.name)
      else porAgent.set(state.agent, [server.name])
    }
  }
  return [...porAgent].map(([agent, nomes]) => ({ agent, servers: nomes }))
}

/** Frase de quem recebe: "Claude via playwright · Codex via chrome-devtools".
 *  Vazio quando ninguém recebe (o chamador decide o que dizer no lugar). */
export function browserDeliveryLabel(entregas: BrowserDelivery[]): string {
  return entregas
    .map((item) => `${agentLabel(item.agent)} via ${item.servers.join(", ")}`)
    .join(" · ")
}

export interface BrowserChainLine {
  /** `aviso` = âmbar (falta um gesto seu). `ok` = cinza: estado assentado não
   *  ganha tinta (STYLEGUIDE §2, verde é marco, não estado ambiente). */
  tom: "ok" | "aviso"
  texto: string
}

/** O estado REAL do navegador do projeto em uma linha, com o elo que falta.
 *
 *  Quatro casos, todos derivados de dado (nenhum nome de fornecedor no meio):
 *  ligado e entregando, ligado sem ninguém para receber (o buraco que prendeu o
 *  usuário), desligado com alguém pedindo, e o silêncio de quem não configurou
 *  nada. `null` = nada a dizer. */
export function browserChainLine(
  servers: McpServer[],
  status: BrowserStatus | null,
): BrowserChainLine | null {
  const entregas = browserDeliveries(servers)
  if (!status?.session) {
    const aviso = browserBindingWarning(servers, status)
    const exigido = servers.some((server) =>
      server.agentStates.some(
        (state) => state.enabled && state.browser && state.required,
      ),
    )
    return aviso ? { tom: exigido ? "aviso" : "ok", texto: aviso } : null
  }
  if (entregas.length > 0) {
    return {
      tom: "ok",
      texto: `Recebem este navegador: ${browserDeliveryLabel(entregas)}.`,
    }
  }
  // Ligado e inútil: o caso que não tinha voz nenhuma na UI. O caminho muda
  // conforme já existir binding no projeto (marcar) ou não existir (ligar).
  const temBinding = servers.some((server) =>
    server.agentStates.some((state) => state.enabled),
  )
  return {
    tom: "aviso",
    texto: temBinding
      ? "Nenhum agent vai usar este navegador. Em MCPs, marque 'navegador' na linha do agent que deve pilotá-lo; só assim o run recebe o endpoint."
      : "Nenhum agent vai usar este navegador: nenhum MCP está ligado neste projeto. Em MCPs, ligue a integração para o agent que você usa e marque 'navegador' na linha dele.",
  }
}

/** O cartão do navegador aparece? Camadas 1 e 2 do STYLEGUIDE §5: sem Chromium
 *  na máquina não há capability nenhuma, então some com o toggle em vez de
 *  deixar um botão morto. A exceção é o usuário JÁ ter marcado algum MCP como
 *  navegador: isso é configurado-com-erro, e configurado-com-erro FICA, dizendo
 *  o motivo (senão o elo quebrado vira invisível). */
export function shouldShowBrowserCard(
  status: BrowserStatus | null,
  temMarcaDeNavegador: boolean,
): boolean {
  if (!status) return temMarcaDeNavegador
  return Boolean(status.session || status.binary) || temMarcaDeNavegador
}

/** O que falta na LINHA de um agent que pediu o navegador do projeto, para o
 *  usuário não ter que cruzar duas telas de cabeça. `null` quando o elo desta
 *  linha está inteiro (ou quando ela não pediu nada). */
export interface BrowserRowNotice {
  tone: "neutral" | "warning"
  text: string
}

export function browserRowNotice(
  state: Pick<McpAgentState, "enabled" | "browser" | "required">,
  status: BrowserStatus | null,
): BrowserRowNotice | null {
  if (!state.enabled || !state.browser) return null
  if (status?.session) return null
  // `null` cobre fora do app E falha de leitura (que já foi ao toast): não
  // escolhe uma das causas, só para de prometer o que não sabe.
  const tone = state.required ? "warning" : "neutral"
  const consequence = state.required
    ? "o próximo turno não inicia até você decidir"
    : "este MCP fica fora do próximo turno"
  if (!status) return { tone, text: `estado indisponível; ${consequence}` }
  if (!status.binary) {
    return { tone, text: `não há Chromium nesta máquina; ${consequence}` }
  }
  return { tone, text: `navegador desligado; ${consequence}` }
}
