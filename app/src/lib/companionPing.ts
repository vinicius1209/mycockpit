// O ping de "esta conversa mudou", com o throttle que o torna barato.
//
// Módulo próprio por um motivo estrutural, não estético: as DUAS metades do
// Companion pingam — a de leitura (a ponte, quando o store se mexe) e a de
// escrita (companionAction, ao aceitar uma mensagem do celular). O throttle
// mora em `Map`s de módulo, ou seja, é ESTADO compartilhado; deixá-lo em
// qualquer uma das duas faria a outra importar de volta e fecharia um ciclo —
// a mesma armadilha que já custou um `window is not defined` em teste aqui.
// Sem dono entre as duas, ninguém importa ninguém.

import { invoke } from "@tauri-apps/api/core"

/** Ping de conversa atualizada: no máx. 1/s por conversa. */
const PING_MIN_INTERVAL_MS = 1_000

const pingTimers = new Map<string, ReturnType<typeof setTimeout>>()
const lastPingAt = new Map<string, number>()

/** Ping throttled (1s/conversa): a webview avisa que a conversa mudou e o
 *  celular refetcha o histórico (o Rust lê a linha do SQLite read-only). */
export function pingConvUpdated(convId: string): void {
  if (pingTimers.has(convId)) return
  const wait = Math.max(
    0,
    (lastPingAt.get(convId) ?? 0) + PING_MIN_INTERVAL_MS - Date.now(),
  )
  pingTimers.set(
    convId,
    setTimeout(() => {
      pingTimers.delete(convId)
      lastPingAt.set(convId, Date.now())
      invoke("companion_conv_updated", { convId }).catch(() => {})
    }, wait),
  )
}

/** Desliga os pings pendentes (a ponte parando). */
export function clearPings(): void {
  for (const t of pingTimers.values()) clearTimeout(t)
  pingTimers.clear()
  lastPingAt.clear()
}
