// De onde o cartão do arquivo solto tira o que ele promete (ADR-252): o
// projeto da conversa, as pastas que ele já libera e se o motor recebe pasta
// extra por envio. Separado do cartão para ele seguir puro nos testes.

import { useMemo } from "react"
import { pastasAbsolutas, type ContextoDoCartao } from "@/components/chat/CartaoDeArquivo"
import { agentLabel } from "@/lib/agent"
import { agentDef } from "@/lib/agents"
import { useApp } from "@/store/app"
import { useChat } from "@/store/chat"

export function useContextoDoCartao(convId: string | null): ContextoDoCartao {
  const agente = useChat((s) => (convId ? s.byId[convId]?.agent : undefined))
  const project = useApp((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null)
  const extraDirs = useApp((s) => (project ? s.projectConfigs[project.id]?.extraDirs : undefined))
  return useMemo(
    () => ({
      projectPath: project?.path ?? null,
      pastasLiberadas: pastasAbsolutas(extraDirs ?? [], project?.path ?? null),
      pastasExtras: !!(agente && agentDef(agente)?.pastasExtras),
      motor: agente ? agentLabel(agente) : "motor",
    }),
    [agente, project?.path, extraDirs],
  )
}
