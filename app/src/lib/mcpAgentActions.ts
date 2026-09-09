import type { McpAgentState, McpServer } from "./mcp"
import { mcpHealthLabel } from "./mcp"

/** O agent pode usar este servidor? Nativamente OU pelo proxy do app.
 *
 *  É o ÚNICO gate da linha: interruptor e botão de testar saem daqui. Antes o
 *  interruptor lia `compatible` cru enquanto o rótulo já contava com o login,
 *  então a tela dizia "roteado pelo Frota" com o controle preso. Um elemento
 *  dizia uma coisa e o vizinho fazia outra. */
export function mcpAgentUtilizavel(
  state: Pick<McpAgentState, "compatible" | "roteavelPeloApp">,
): boolean {
  return state.compatible || state.roteavelPeloApp === true
}

/** O gesto que a linha oferece.
 *
 *  `interruptor` = o app controla o estado e sabe qual é (escopo por run).
 *  `acao-no-cli` / `remover-do-cli` = muda a entrada global por gesto explícito.
 *  O inventário decide a direção; estado desconhecido não autoriza escrita.
 *  `nada` = sem receita conhecida; a linha só informa. */
export type GestoDaLinha =
  | "interruptor"
  | "acao-no-cli"
  | "remover-do-cli"
  | "acao-no-projeto"
  | "nada"

export function gestoDaLinha(
  state: Pick<McpAgentState, "compatible" | "roteavelPeloApp" | "escopo" | "cliInstallation">,
): GestoDaLinha {
  if (mcpAgentUtilizavel(state)) return "interruptor"
  if (state.escopo === "global") {
    if (state.cliInstallation === "unknown") return "nada"
    if (state.cliInstallation === "enabled" || state.cliInstallation === "disabled")
      return "remover-do-cli"
    return "acao-no-cli"
  }
  if (state.escopo === "por-projeto") return "acao-no-projeto"
  return "nada"
}

/** A frase da ação, e a consequência dela, por gesto. São DIFERENTES de
 *  propósito: escrever na config global do CLI e escrever num arquivo do
 *  repositório do usuário não são o mesmo risco, e quem lê decide melhor
 *  sabendo qual dos dois vai acontecer. */
export function rotuloDaAcao(gesto: GestoDaLinha): string | null {
  if (gesto === "acao-no-cli") return "Instalar no CLI"
  if (gesto === "remover-do-cli") return "Remover do CLI"
  if (gesto === "acao-no-projeto") return "Instalar no projeto"
  return null
}

export function consequenciaDaAcao(gesto: GestoDaLinha): string | null {
  if (gesto === "acao-no-cli") return CONSEQUENCIA_ESCOPO_GLOBAL
  if (gesto === "remover-do-cli")
    return "Remove a entrada de mesmo nome do CLI, para todos os projetos."
  if (gesto === "acao-no-projeto") return CONSEQUENCIA_ESCOPO_PROJETO
  return null
}

/** O que muda no mundo quando a pessoa aceita a ação. Aparece ANTES do clique,
 *  porque escopo global não se desfaz sozinho no fim do run. */
export const CONSEQUENCIA_ESCOPO_GLOBAL =
  "Vale para todos os projetos e continua depois da missão. Quem escreve é o " +
  "CLI do agent, no lugar que ele escolher nesta máquina."

/** Escrever aqui mexe num arquivo que é do REPOSITÓRIO de quem usa, e que
 *  pode estar versionado. Isso precisa estar dito antes do clique: o commit
 *  seguinte carrega a mudança junto, e ninguém gosta de descobrir isso no
 *  `git diff`. */
export const CONSEQUENCIA_ESCOPO_PROJETO =
  "Escreve no opencode.json deste projeto, que é um arquivo do seu " +
  "repositório e pode estar versionado. Só a entrada do Frota é tocada."

/** Rótulo da linha por agent. "não suportado" sozinho mente num servidor
 *  nativo-apenas: ele funciona no CLI que o definiu, o que não existe é o
 *  roteamento gerenciado para os outros agents. */
export function mcpAgentStatusLabel(
  server: Pick<McpServer, "nativeReason">,
  state: Pick<
    McpAgentState,
    "compatible" | "roteavelPeloApp" | "roteiaMcpGerenciado" | "health" | "cliInstallation"
  >,
): string {
  if (state.compatible) return mcpHealthLabel(state.health)
  // "roteado pelo Frota" agora sai do MESMO campo que libera o interruptor,
  // e não de uma regra paralela no front. A antiga olhava só
  // `nativeReason === "oauth"` + login, sem saber de transporte SSE nem de
  // segredo literal: dizia "roteado" para casos que o proxy recusa.
  if (state.roteavelPeloApp) return "roteado pelo Frota"
  if (state.cliInstallation === "enabled") return "habilitado no CLI (global)"
  if (state.cliInstallation === "disabled") return "instalado no CLI, desabilitado (global)"
  if (state.cliInstallation === "absent") return "não instalado no CLI"
  if (state.cliInstallation === "unknown") return "inventário do CLI não confirmado, reverifique"
  // O motor que não aceita MCP gerenciado NÃO é "não suportado": o CLI dele
  // fala MCP muito bem, o que falta é o app conseguir escopar por run. Chamar
  // isso de "não suportado" foi o próprio agy que desmentiu, dizendo ao
  // usuário que tem suporte completo. A frase agora diz de quem é o limite.
  if (state.roteiaMcpGerenciado === false) {
    return "sem roteamento do Frota (configure no CLI)"
  }
  return server.nativeReason ? "sem roteamento (nativo do CLI)" : "não suportado"
}
