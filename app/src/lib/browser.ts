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

/** Nomes dos MCPs que este projeto marcou para dirigir o navegador do app. */
export function browserBoundServers(servers: McpServer[]): string[] {
  return servers
    .filter((server) =>
      server.agentStates.some((state) => state.enabled && state.browser),
    )
    .map((server) => server.name)
}

/** Aviso honesto quando algum binding pede o navegador do projeto e ele não
 *  está ligado: o run não trava por isso, mas o MCP vai abrir um navegador
 *  próprio, e o usuário precisa saber ANTES de gastar o turno. `null` quando
 *  não há o que avisar. */
export function browserBindingWarning(
  servers: McpServer[],
  status: BrowserStatus | null,
): string | null {
  if (status?.session) return null
  const names = browserBoundServers(servers)
  if (names.length === 0) return null
  return `${names.join(", ")} ${names.length > 1 ? "pedem" : "pede"} o navegador do projeto, que está desligado. Nos runs deste projeto o MCP vai abrir um navegador próprio.`
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
    return aviso ? { tom: "aviso", texto: aviso } : null
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
      ? "Nenhum agent vai usar este navegador. Nos MCPs abaixo, marque 'navegador' na linha do agent que deve pilotá-lo; só assim o run recebe o endpoint."
      : "Nenhum agent vai usar este navegador: nenhum MCP está ligado neste projeto. Abaixo, ligue o MCP de navegador para o agent que você usa e marque 'navegador' na linha dele.",
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
export function browserRowNotice(
  state: Pick<McpAgentState, "enabled" | "browser">,
  status: BrowserStatus | null,
): string | null {
  if (!state.enabled || !state.browser) return null
  if (status?.session) return null
  // `null` cobre fora do app E falha de leitura (que já foi ao toast): não
  // escolhe uma das causas, só para de prometer o que não sabe.
  if (!status) return "estado do navegador do projeto indisponível"
  if (!status.binary) {
    return "não há Chromium nesta máquina, este agent vai abrir um navegador próprio"
  }
  return "navegador do projeto desligado, este agent vai abrir um navegador próprio"
}
