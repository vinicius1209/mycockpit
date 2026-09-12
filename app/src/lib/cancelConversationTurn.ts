import { cancelLinearTurn, fecharTurnoLocalmente } from "@/lib/cancelLinearTurn"
import { tomarCausaDoCorte, type CausaDoCorte } from "@/lib/corte"
import { stopManagedProcessesByConv } from "@/lib/work"
import { useFusion } from "@/store/fusion"

/** Cancela o trabalho efetivo da conversa, inclusive disputa sem runId.
 *  Devolve `true` quando o que parou foi uma disputa. */
export async function cancelConversationTurn(
  convId: string,
  causa?: CausaDoCorte,
): Promise<boolean> {
  const fusion = useFusion.getState().byConv[convId]
  if (fusion && (fusion.phase === "running" || fusion.phase === "judging")) {
    await abortarDisputa(convId)
    return true
  }
  await cancelLinearTurn(convId, causa)
  return false
}

/** Aborta a disputa e deixa o marco no fio. Antes o abort descartava o painel e
 *  o único rastro era um toast que sumia (ADR-180). O abort já cancela cada
 *  candidato e encerra a conversa; aqui só entra o registro do corte. */
export async function abortarDisputa(convId: string): Promise<void> {
  useFusion.getState().abort(convId)
  void stopManagedProcessesByConv(convId).catch(() => {})
  // Um carimbo anterior (envio forçado durante a disputa) não descreve este
  // corte: quem parou foi a disputa.
  tomarCausaDoCorte(convId)
  await fecharTurnoLocalmente(convId, "disputa")
}
