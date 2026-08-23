// RETOMADA AUTOMÁTICA de um turno que morreu por limite.
//
// Saiu do ChatPanel pela catraca, e o recorte é fechado: tudo aqui lê
// `getState()`, e a única coisa que vem do componente é o `enviar` — que entra
// como PARÂMETRO em vez de import, pra este módulo não conhecer o composer.
//
// A regra que o arquivo carrega: cada retomada é um run PAGO. Por isso existe
// teto (`autoResumeMaxTries`) e por isso o prompt é mínimo — o resume nativo já
// carrega o fio, e repetir o handoff inteiro aqui só queimava tokens.

import { notifyTurnEnd } from "@/lib/notify"
import { resumePrompt, wantsAutoResume } from "@/lib/autoResume"
import { AUTO_RESUME, type OrigemDoEnvio } from "@/lib/sendOrigin"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

/** O `handleSend` do ChatPanel. Entra como parâmetro pra este módulo não
 *  conhecer o composer — a dependência anda no sentido certo. */
type Enviar = (
  texto: string,
  cfg: undefined,
  anexos: never[],
  origem: OrigemDoEnvio,
  originConvId?: string,
) => unknown

// Auto-revive: se o turno recém-encerrado pede resume (limite da CLI OU o texto
// final combina padrões de retry/espera) E a opção está ligada, agenda um
// reenvio automático via setTimeout. O prompt é mínimo: o resume nativo já
// carrega o fio; se ele expirou, o memoryFallback injeta recap + ponteiro.
// Repetir o handoff inteiro aqui só queimava tokens. Cada resume é um run PAGO → o cap
// (autoResumeMaxTries) protege; o banner mostra quantas tentativas restam.
// Retorna true se agendou (o caller pula notify/sugestões).
export function maybeScheduleAutoResume(
convId: string,
agent: string,
enviar: Enviar,
): boolean {
  const settings = useApp.getState().settings
  if (!settings.autoResume) return false
  const conv = useChat.getState().byId[convId]
  if (!conv || conv.corrupt) return false
  // já esgotou o cap num loop anterior deste turno → para.
  const prevTries = conv.autoResume?.tries ?? 0
  if (prevTries >= settings.autoResumeMaxTries) {
    useChat.getState().cancelAutoResume(convId)
    return false
  }
  const verdict = wantsAutoResume(
    conv.items,
    { hit: !!conv.limitHitThisTurn, resetHint: conv.resetHint },
    prevTries,
  )
  if (!verdict.resume) {
    // turno concluiu SEM sinal de resume → sucesso: encerra o loop.
    useChat.getState().cancelAutoResume(convId)
    return false
  }
  const tries = prevTries + 1
  const timer = setTimeout(() => {
    const c = useChat.getState().byId[convId]
    // corrida: usuário pode ter cancelado/enviado algo antes do disparo.
    if (!c?.autoResume) return
    if (c.running || c.finalizing) return
    // o reenvio conta o gatilho REAL: afirmar "limite de uso" num resume
    // heurístico manda o agente caçar um limite que nunca existiu.
    const prompt = resumePrompt(verdict.reason)
    useChat.getState().handleEvent(convId, {
      type: "notice",
      message: `auto-resume: retomando (tentativa ${tries}/${settings.autoResumeMaxTries})`,
    })
    // alvo explícito: o timer dispara minutos depois, o foco já pode ser outro.
    void enviar(prompt, undefined, [], AUTO_RESUME, convId)
  }, verdict.delayMs)
  useChat.getState().setAutoResume(convId, {
    tries,
    maxTries: settings.autoResumeMaxTries,
    nextAt: Date.now() + verdict.delayMs,
    reason: verdict.reason,
    timer,
  })
  void notifyTurnEnd(convId, agent)
  return true
}
