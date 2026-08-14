// Desfecho do ÚLTIMO turno de executor de uma conversa.
//
// Existe separado do store porque é uma régua PURA, lida por duas superfícies
// que precisam concordar: o composer (destrava o seletor de modelo) e o
// despacho (aceita o modelo trocado). Régua duplicada aqui significaria a UI
// oferecendo uma escolha que o envio descartaria em silêncio.

import { executorItems, type ChatItem } from "@/store/chat"

/** O último turno de EXECUTOR terminou em falha (erro do CLI/adapter ou teto de
 *  uso)? É a condição da SAÍDA DE EMERGÊNCIA: a identidade da conversa trava no
 *  1º envio, e quando é o próprio MODELO que mata o turno (slug inválido,
 *  modelo sem acesso, teto da conta) a conversa virava um beco — reenviar
 *  repetia o mesmo erro e a única saída era trocar de AGENT no card do
 *  incidente, jogando fora a escolha de modelo. Turno que falhou destrava o
 *  MODELO; o agent segue travado (trocar de motor é handoff, com sessão nova).
 *
 *  Olha só o ÚLTIMO: conversa que se recuperou não está em emergência. Pareceres
 *  de conselheiro não contam (não são turno de executor, Especialistas E1), então
 *  consultar alguém sobre o erro não fecha a saída. */
export function lastExecutorTurnFailed(items: ChatItem[]): boolean {
  const last = executorItems(items).at(-1)
  return last?.kind === "error" || last?.kind === "limit"
}
