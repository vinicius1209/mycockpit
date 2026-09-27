// Os fatos que "Precisa de você" e o ponto do rail leem (ADR-268), lidos ao
// ABRIR as Configurações e ao trocar o projeto do rail. Tudo aqui é leitura
// da máquina: `gh`, o cadastro do acompanhamento nos motores de cadastro
// global e o login dos MCPs ligados no projeto. Começa vazio, e vazio é
// "ainda não olhei", que nunca pinta alarme.

import { useCallback, useEffect, useMemo, useState } from "react"
import { lerGhStatus } from "@/lib/github"
import { motoresDaMaquina } from "@/lib/agentRoster"
import { discoverMcpServers, mcpAgentUtilizavel, mcpOauthStatus, mcpOfereceLogin } from "@/lib/mcp"
import { workMcpStatus, type WorkMcpSetup } from "@/lib/workMcpSetup"
import { mcpsPedindoLogin, type FatosDoRail } from "@/components/settings/pendencias"
import { useApp } from "@/store/app"

/** Login pedido pelos MCPs LIGADOS neste projeto. Falha de leitura não vira
 *  pendência: a página de MCPs continua dizendo o estado real. */
async function lerMcpsPedindoLogin(path: string): Promise<string[]> {
  const { servers } = await discoverMcpServers(path)
  const candidatos = servers
    .filter((s) => s.managed)
    .map((s) => ({
      id: s.id,
      name: s.name,
      ofereceLogin: mcpOfereceLogin(s),
      ligado: s.agentStates.some((st) => st.enabled && mcpAgentUtilizavel(st)),
    }))
  const conectados = new Set<string>()
  await Promise.all(
    candidatos
      .filter((c) => c.ofereceLogin && c.ligado)
      .map(async (c) => {
        const status = await mcpOauthStatus(path, c.id).catch((cause: unknown) => {
          console.warn(`[configurações] login de ${c.name} não verificado:`, cause)
          return null
        })
        // Sem resposta, não afirma que pede login: trata como conectado.
        if (!status || status.state === "conectado") conectados.add(c.id)
      }),
  )
  return mcpsPedindoLogin(candidatos, conectados)
}

export function useFatosDoRail(aberto: boolean, projectPath: string | null) {
  const detected = useApp((s) => s.settings.detected)
  const [gh, setGh] = useState<FatosDoRail["gh"]>(undefined)
  const [trabalho, setTrabalho] = useState<FatosDoRail["trabalho"]>(undefined)
  const [trabalhoNaoVerificado, setNaoVerificado] = useState<string[]>([])
  const [mcpPedemLogin, setMcpPedemLogin] = useState<string[] | undefined>(undefined)
  const [versao, setVersao] = useState(0)
  const recarregar = useCallback(() => setVersao((v) => v + 1), [])

  useEffect(() => {
    if (!aberto) return
    let vivo = true
    void lerGhStatus().then((g) => {
      if (vivo) setGh({ installed: g.installed, contas: g.accounts.length })
    })
    const globais = motoresDaMaquina().filter((a) => a.workMcp && a.workMcpGlobalEnv)
    void Promise.all(
      globais.map(async (a): Promise<[string, WorkMcpSetup["state"] | null]> => {
        try {
          return [a.id, (await workMcpStatus(a.id)).state]
        } catch (cause) {
          console.warn(`[configurações] acompanhamento do ${a.label} não verificado:`, cause)
          return [a.id, null]
        }
      }),
    ).then((pares) => {
      if (!vivo) return
      const lidos = pares.filter((p): p is [string, WorkMcpSetup["state"]] => p[1] !== null)
      setTrabalho(Object.fromEntries(lidos))
      setNaoVerificado(pares.filter((p) => p[1] === null).map((p) => p[0]))
    })
    return () => {
      vivo = false
    }
  }, [aberto, versao])

  useEffect(() => {
    if (!aberto || !projectPath) {
      setMcpPedemLogin(undefined)
      return
    }
    let vivo = true
    lerMcpsPedindoLogin(projectPath)
      .then((nomes) => {
        if (vivo) setMcpPedemLogin(nomes)
      })
      .catch((cause: unknown) => {
        console.warn("[configurações] MCPs do projeto não verificados:", cause)
        if (vivo) setMcpPedemLogin(undefined)
      })
    return () => {
      vivo = false
    }
  }, [aberto, projectPath, versao])

  const fatos = useMemo<FatosDoRail>(
    () => ({ detected, gh, trabalho, mcpPedemLogin, trabalhoNaoVerificado }),
    [detected, gh, trabalho, mcpPedemLogin, trabalhoNaoVerificado],
  )
  return { fatos, recarregar }
}
