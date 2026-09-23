// O instante em que uma retomada automática dispara, em UM lugar só: o chat
// (`components/chat/autoResumeAgendar.ts`) e a Frota (`lib/fleet/send.ts`)
// agendavam cada um o seu timer e repetiam as mesmas checagens por dentro.
//
// Disparar marca `disparou` (ADR-238): o estado fica, porque conta as
// tentativas até o turno retomado terminar, mas deixa de estar agendado e
// nenhuma tela pode seguir dizendo "retoma às…".

import { resumePrompt } from "@/lib/autoResume"
import { useChat } from "@/store/chat"

/** Confere a corrida, marca o disparo, avisa no fio e devolve o prompt do
 *  reenvio. `null` = não reenviar (a pessoa cancelou, ou já há turno rodando). */
export function dispararRetomada(convId: string, tries: number, maxTries: number, reason: string): string | null {
  const c = useChat.getState().byId[convId]
  // corrida: a pessoa pode ter cancelado ou enviado algo antes do disparo.
  if (!c?.autoResume || c.running || c.finalizing) return null
  useChat.getState().setAutoResume(convId, { ...c.autoResume, disparou: true })
  useChat.getState().handleEvent(convId, {
    type: "notice",
    message: `auto-resume: retomando (tentativa ${tries}/${maxTries})`,
  })
  // o reenvio conta o gatilho REAL: afirmar "limite de uso" num resume
  // heurístico manda o agente caçar um limite que nunca existiu.
  return resumePrompt(reason)
}
