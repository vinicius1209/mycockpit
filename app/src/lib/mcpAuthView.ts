// Vista do login de um MCP (ADR-201): quem autentica, se o cartão oferece
// "Entrar", e o resumo que abre o painel. Funções puras, testadas em
// mcp.test.ts. Separado de mcp.ts pela catraca de tamanho.

import type { McpAgentState, McpAuthStatus, McpServer } from "./mcp"
import { mcpAuthHint } from "./mcp"

/** O cartão pode oferecer login do app? Bloco `oauth` declarado (versões
 *  antigas do snapshot) ou elegibilidade dita pelo backend. */
export function mcpOfereceLogin(
  server: Pick<McpServer, "nativeReason" | "loginPeloApp" | "managed">,
): boolean {
  return server.managed && (server.loginPeloApp === true || server.nativeReason === "oauth")
}

/** A primeira pergunta de um MCP com autenticação: QUEM autentica. Três
 *  respostas honestas: o Frota (há token nosso), o CLI de origem (a config
 *  veio dele e ele guarda o próprio login), ou cada CLI por conta própria
 *  (servidor HTTP sem bloco de auth, que o Frota não verifica). Nunca afirma
 *  que o CLI está logado: isso não é observado, então a frase diz "no próprio
 *  CLI", não "conectado". */
export function mcpQuemAutentica(
  server: Pick<McpServer, "nativeReason" | "sourceAgent">,
  status: Pick<McpAuthStatus, "state" | "expiresAt">,
  /** Rótulo curto do CLI de origem, quando há (`agentDef(...).shortLabel`). */
  origem: string | null,
  now: number = Date.now(),
): { titulo: string; detalhe: string } {
  if (status.state === "conectado") {
    return { titulo: "o Frota", detalhe: mcpAuthHint(status, now) }
  }
  if (status.state === "expirado") {
    return { titulo: "o Frota, sessão expirada", detalhe: mcpAuthHint(status, now) }
  }
  if (server.nativeReason === "oauth" && origem) {
    return {
      titulo: `o ${origem}, no próprio CLI`,
      detalhe: "Vale só para turnos dele. O Frota pode fazer o login e liberar para os outros motores.",
    }
  }
  if (origem) {
    return {
      titulo: `o ${origem}, no próprio CLI (não verificado)`,
      detalhe: "O Frota pode fazer o login e usar a mesma sessão em todos os motores.",
    }
  }
  return {
    titulo: "ninguém ainda",
    detalhe: mcpAuthHint(status, now),
  }
}

export interface McpResumo {
  total: number
  ativos: number
  pedemLogin: number
  soNoCli: number
}

/** A linha de resumo do painel: responde "o que está funcionando?" antes de
 *  qualquer cartão. `ativos` conta servidores com pelo menos um motor ligado
 *  e utilizável; `pedemLogin` os que oferecem login e ainda não têm sessão;
 *  `soNoCli` os não portáveis sem saída pelo app. */
export function mcpResumo(
  servers: Array<
    Pick<McpServer, "managed" | "portable" | "nativeReason" | "loginPeloApp"> & {
      agentStates: Array<Pick<McpAgentState, "enabled" | "compatible" | "roteavelPeloApp">>
    }
  >,
  authByServer: Record<string, Pick<McpAuthStatus, "state">>,
  ids: string[],
): McpResumo {
  let ativos = 0
  let pedemLogin = 0
  let soNoCli = 0
  servers.forEach((server, i) => {
    const conectado = authByServer[ids[i]]?.state === "conectado"
    const algumAtivo = server.agentStates.some(
      (st) => st.enabled && (st.compatible || st.roteavelPeloApp === true),
    )
    if (algumAtivo) ativos += 1
    if (mcpOfereceLogin(server) && !conectado) pedemLogin += 1
    else if (server.managed && !server.portable && !conectado) soNoCli += 1
  })
  return { total: servers.length, ativos, pedemLogin, soNoCli }
}
