// O gate de plano como PEDIDO PENDENTE, não como cartão solto.
//
// Por que existe: o gate ficou fora da fila de interações desde sempre, e por
// isso podia te esperar em silêncio — não acendia o ponto da sidebar, não ia
// pro sino, pra tray, pra nativa nem pro Companion. Uma busca por `planGate` em
// `store/interactions`, `notify.ts`, `InboxBell` e `companion.ts` não achava
// NADA. Construímos a infraestrutura de "precisa de você" e deixamos de fora
// justamente a aprovação mais cara.
//
// O Paseo chegou na mesma conclusão por outro caminho: lá plano é um
// `AgentPermissionRequestKind`, irmão de `tool` e `question`.
//
// O que NÃO dá pra igualar aos CLIs, e é decisão consciente: o bloqueio. No
// Claude Code interativo o `ExitPlanMode` é modal — você responde antes de
// digitar. Em headless (`-p`) o turno de plano TERMINA antes de existir alguém
// pra perguntar; o próprio `adapters.rs` registra que "ExitPlanMode não existe
// no headless". Então aqui o gate é assíncrono: fica na fila até você decidir,
// e digitar outra coisa é "continuei planejando" — que é a opção 3 do Claude
// Code, só que implícita.

import type { PlanData } from "@/lib/interaction"
import { buildExecutionPrompt, pendingPlanGate } from "@/lib/planMode"
import { useChat } from "@/store/chat"
import { useInteractions } from "@/store/interactions"

/** Id do pedido derivado do item: um gate, um pedido. Determinístico pra que
 *  reabrir/re-enfileirar não crie um segundo pedido do mesmo plano. */
export function planRequestId(gateId: string): string {
  return `plan:${gateId}`
}

/** Enfileira o gate recém-criado. Chamado logo depois do `pushPlanGate`. */
export function enqueuePlanGate(convId: string, gateId: string, text: string) {
  useInteractions.getState().push({
    id: planRequestId(gateId),
    kind: "plan",
    data: { convId, gateId, text } satisfies PlanData,
  })
}

/** Tira o pedido da fila SEM responder — pra quando a decisão já foi executada
 *  por outro caminho (o botão no fio) ou o gate foi superado. */
export function dequeuePlanGate(gateId: string) {
  useInteractions.getState().resolve(planRequestId(gateId))
}

/**
 * Prompt da recusa que CONTINUA o planejamento (opção 3 do Claude Code).
 *
 * Puro e enquadrado: o agente precisa saber que a recusa é do humano, que o
 * plano anterior não vale mais, e que ele segue em modo de planejamento — sem
 * isso ele tende a reexecutar o plano recusado achando que a mensagem é um
 * ajuste qualquer.
 */
export function keepPlanningPrompt(reason?: string): string {
  const motivo = reason?.trim()
  return [
    "O plano acima NÃO foi aprovado. Continue no modo de planejamento:",
    "reveja a proposta e apresente um plano novo. Não execute nada ainda.",
    ...(motivo ? ["", `Motivo do usuário: ${motivo}`] : []),
  ].join("\n")
}

/** Gates ainda enfileirados desta conversa que já não são o gate corrente —
 *  o turno seguinte propôs outro plano, então o antigo foi SUPERADO. */
export function stalePlanGateIds(convId: string, currentGateId: string | null): string[] {
  return useInteractions
    .getState()
    .queue.filter((r) => {
      if (r.kind !== "plan") return false
      const d = r.data as PlanData
      return d.convId === convId && d.gateId !== currentGateId
    })
    .map((r) => (r.data as PlanData).gateId)
}

/** Carimba `superseded` nos gates que o fio deixou para trás e tira da fila.
 *  "Você continuou planejando" é um desfecho REAL — deixar o item pendurado
 *  como não-decidido para sempre seria guardar uma pergunta que já passou. */
export function supersedeOldGates(convId: string, currentGateId: string | null) {
  for (const gateId of stalePlanGateIds(convId, currentGateId)) {
    dequeuePlanGate(gateId)
    useChat.getState().decidePlanGate(convId, gateId, "superseded")
  }
}

/**
 * Executa a decisão sobre o gate que está NA MESA.
 *
 * Mora aqui, e não no ChatPanel, porque é regra de domínio e não de tela: as
 * duas decisões carimbam o item, tiram o pedido da fila e disparam UM turno —
 * a única coisa que a tela tem é o `send`, que ela injeta.
 *
 * Aprovar carimba ANTES de enviar: o envio empurra um `user` no fio e, a partir
 * dele, o gate deixaria de estar pendente sem nunca dizer que foi aprovado.
 *
 * `false` = não havia nada na mesa com esse id (turno novo chegou entre o
 * clique e aqui, ou o gate já foi decidido). Silencioso de propósito: não é
 * erro, é corrida perdida.
 */
export function decidePlanGateAndSend(
  convId: string,
  gateId: string,
  decision: "approve" | "keepPlanning",
  send: (prompt: string) => void,
  reason?: string,
): boolean {
  const c = useChat.getState().byId[convId]
  if (!c || c.running || c.finalizing) return false
  const gate = pendingPlanGate(c.items)
  if (!gate || gate.id !== gateId) return false
  if (decision === "approve") {
    useChat.getState().decidePlanGate(convId, gateId, "approved")
    // Aprovar SAI do modo plano — igual ao Claude Code, onde autorizar a saída
    // do planejamento muda o modo da sessão. `null` devolve a conversa ao modo
    // do PROJETO em vez de chutar um valor: quem trabalha em "Só lê" não pode
    // sair do plano em "Pede" sem ter pedido. Recusar mantém o plano.
    useChat.getState().setSessionMode(convId, null)
    send(buildExecutionPrompt(c.agent, gate.text))
  } else {
    useChat.getState().decidePlanGate(convId, gateId, "discarded")
    send(keepPlanningPrompt(reason))
  }
  return true
}
