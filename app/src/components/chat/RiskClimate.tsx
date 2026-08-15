// <RiskClimate> — a moldura ambiente do modo Liberado, na área de conteúdo.
//
// Só desenha; a regra de QUANDO é pura e mora em lib/climate (com teste). Lê os
// stores por conta própria pra não engordar o ChatPanel (o maior arquivo do
// app) com mais derivação.
//
// A permissão é do PROJETO, não da conversa (ExecutionRow diz isso na cara) —
// então o clima é da CONVERSA ATIVA por herança: o modo efetivo é o do projeto
// dela. Mesma precedência do `effectivePermission` (config do .mycockpit vence
// o cache do SQLite), aqui assinada pra re-renderizar quando alguém troca.

import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"
import { useAwaiting } from "@/store/interactions"
import { CLIMATE_FRAME_CLASS, riskClimateOn } from "@/lib/climate"

export function RiskClimate() {
  const activeId = useChat((s) => s.activeId)
  const projectId = useChat((s) => (s.activeId ? s.byId[s.activeId]?.projectId : null))
  const mode = useApp((s) =>
    projectId
      ? (s.mycockpit[projectId]?.permission ??
        s.projects.find((p) => p.id === projectId)?.permissionMode ??
        "padrao")
      : "padrao",
  )
  const awaiting = useAwaiting()

  const on = riskClimateOn({
    hasConversation: !!activeId,
    mode,
    awaitingDecision: !!activeId && awaiting.convIds.has(activeId),
  })
  if (!on) return null

  // aria-hidden: o leitor de tela não ganha nada com uma moldura, e a afirmação
  // do modo já é texto de verdade na linha de Execução ("Liberado", com o
  // triângulo). Sinal ambiente redundante em leitura vira ruído.
  return <div aria-hidden className={CLIMATE_FRAME_CLASS} />
}
