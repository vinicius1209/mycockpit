// O GATE DO TURNO EM VOO: o que acontece com um envio que chegou enquanto o
// agente ainda trabalha nesta conversa.
//
// Mora fora do `ChatPanel` por dois motivos, os dois medidos:
//
// 1. **Era código gêmeo.** O `handleSend` tinha DUAS cópias da mesma decisão (a
//    guarda de entrada e a re-checagem de corrida depois do preflight, "D2"), e
//    as duas faziam `enqueue` cru. Ramo gêmeo que diverge é como um envio de
//    mecanismo entra na fila de gente por uma porta e não pela outra.
// 2. **Era o gate que não tinha teste.** O incidente 2026-08-16 passou por aqui
//    e a única coisa que o descrevia era um comentário. Agora a decisão roda em
//    teste com o store REAL (`sendGate.test.ts`), não num espelho do gate.
//
// A regra em uma frase: **a fila do composer é do humano** (ADR-046). O que o
// app dispara sozinho não espera nela; espera o turno acabar ou não acontece.

import { avisar } from "@/lib/avisos"
import type { Attachment } from "@/lib/attachments"
import {
  avisoDeDescarte,
  entraNaFilaDoHumano,
  type OrigemDoEnvio,
} from "@/lib/sendOrigin"
import { useChat } from "@/store/chat"

/**
 * Turno em voo nesta conversa? Então este envio para aqui.
 *
 * - **Humano**: vai pra fila do composer, visível, e sai coalescido no fim do
 *   turno. É a única saída honesta: sessão e permissão são fixas no spawn, não
 *   dá pra emendar no turno corrente.
 * - **Sistema**: NÃO entra na fila (ela é do humano, e o `×` dela apaga anexos
 *   do disco). Vira um aviso do que ficou de pé e de quando vale.
 *
 * Lê estado FRESCO do store de propósito: quem chama pode estar segurando um
 * snapshot de antes de um `await`.
 *
 * @returns `true` quando reteve o envio (o chamador deve retornar).
 */
export function retidoPorTurnoEmVoo(
  convId: string,
  text: string,
  attachments: Attachment[],
  origem: OrigemDoEnvio,
): boolean {
  const conv = useChat.getState().byId[convId]
  if (!conv) return false
  if (!conv.running && !conv.finalizing) return false
  if (entraNaFilaDoHumano(origem)) {
    // `origem` já está narrowed: o compilador é quem garante que só gente
    // alcança a fila de gente.
    useChat.getState().enqueue(convId, text, attachments, origem)
    return true
  }
  avisar.nota(avisoDeDescarte(origem))
  return true
}
