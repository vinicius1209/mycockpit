// O QUE ACONTECE QUANDO O RESUME FALHA (revezamento PRD R5, D3).
//
// Voltar a um motor retoma a sessão que ele deixou nesta conversa. Sessão
// morre: o backend não fica preso, cai no fallback de memória e avisa por
// `resume://fallback`. Daqui em diante é regra de estado, e ela tem duas
// obrigações: parar de oferecer uma sessão que não existe mais, e DIZER no fio
// que a volta virou transplante, senão a linha anterior ("retomou a sessão que
// já tinha aqui") fica mentindo no histórico.

import { agentDef } from "@/lib/agents"
import { semSessaoGuardada } from "@/lib/retomadaDeMotor"
import type { ConvState } from "@/store/chat"

/** A linha honesta do fio quando a sessão guardada não existia mais. */
export function notaDeRetomadaFalhada(rotulo: string): string {
  return `Não deu para retomar a sessão anterior do ${rotulo}: o contexto foi transferido como num revezamento normal.`
}

/** Reducer PURO do `resume://fallback`. `motorQueFalhou` é o do run em voo (no
 *  revezamento, o destino ainda não assumiu a conversa). */
export function comResumeFalhado(
  cur: ConvState,
  motorQueFalhou: string,
  agora: number = Date.now(),
): ConvState {
  const rotulo = agentDef(motorQueFalhou)?.label ?? motorQueFalhou
  const tentavaRetomar = Boolean(cur.sessoesAnteriores?.[motorQueFalhou])
  return {
    ...cur,
    sessionId: null,
    sessoesAnteriores: semSessaoGuardada(cur.sessoesAnteriores, motorQueFalhou),
    items: tentavaRetomar
      ? [
          ...cur.items,
          {
            kind: "notice" as const,
            id: crypto.randomUUID(),
            message: notaDeRetomadaFalhada(rotulo),
            ts: agora,
          },
        ]
      : cur.items,
  }
}
