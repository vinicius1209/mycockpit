import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2, LockKeyhole, RefreshCcw } from "lucide-react"
import { avisar, mensagemDe } from "@/lib/avisos"
import { invoke } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import {
  applyAgentPatch,
  checkMcpServer,
  discoverMcpServers,
  mcpHealthLabel,
  mcpOauthLogin,
  mcpOauthLogout,
  mcpOauthStatus,
  mcpOfereceLogin,
  mcpResumo,
  optimisticBindingUpdate,
  setMcpBinding,
  type McpAgentState,
  type McpAuthStatus,
  type McpHealthStatus,
  type McpServer,
  type ProviderMcpInventory,
} from "@/lib/mcp"
import { useProjectBrowser } from "@/components/settings/ProjectBrowserCard"
import { McpServerRow } from "@/components/settings/McpServerRow"
import { ProviderMcpInventoryPanel } from "@/components/settings/ProviderMcpInventoryPanel"
import { EscopoDoProjeto, useProjetoDasConfiguracoes } from "@/components/settings/projetoDasConfiguracoes"
import { SectionHeader } from "@/components/settings/parts"
import { cn } from "@/lib/utils"

function toggleKey(
  set: ReadonlySet<string>,
  key: string,
  on: boolean,
): Set<string> {
  const next = new Set(set)
  if (on) next.add(key)
  else next.delete(key)
  return next
}

export function McpSettings() {
  // Escopo do PAINEL, não do app: o projeto vem do seletor único do rail
  // (ADR-268) e nunca muda o projeto ativo da sidebar.
  const { project } = useProjetoDasConfiguracoes()
  const [servers, setServers] = useState<McpServer[]>([])
  const [providerInventories, setProviderInventories] = useState<
    ProviderMcpInventory[]
  >([])
  const [loading, setLoading] = useState(false)
  // Writes/checks em voo, por chave `serverId:agent` (e `check:` no teste
  // explícito). O ref é a fonte da guarda síncrona: nunca dois writes
  // concorrentes pro MESMO par servidor×agent; pares diferentes em paralelo.
  const busyKeysRef = useRef<Set<string>>(new Set())
  const [busyKeys, setBusyKeys] = useState<ReadonlySet<string>>(new Set())
  // Health checks em segundo plano (primeiro enable): a linha mostra
  // "verificando…" até o resultado real chegar.
  const [checkingKeys, setCheckingKeys] = useState<ReadonlySet<string>>(
    new Set(),
  )
  // Instalação no CLI do agent em voo (escopo global). Separado do busyKeys
  // porque não é write de binding: é comando externo, e o desfecho é a frase
  // que o CLI devolver.
  const [instalando, setInstalando] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  // Login do PRÓPRIO app nos MCPs com OAuth (A1). Só existe para servidores
  // cuja config declara o bloco `oauth`; os demais nem mostram a linha.
  const [authByServer, setAuthByServer] = useState<
    Record<string, McpAuthStatus>
  >({})
  const [authBusy, setAuthBusy] = useState<ReadonlySet<string>>(new Set())
  // Linhas abertas. Fechadas por padrão: a lista responde "o que está
  // funcionando?" sem rolagem, e só o que a pessoa toca mostra os controles.
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(new Set())

  const setKeyBusy = useCallback((key: string, on: boolean) => {
    if (on) busyKeysRef.current.add(key)
    else busyKeysRef.current.delete(key)
    setBusyKeys(new Set(busyKeysRef.current))
  }, [])
  // Path cuja descoberta está na tela. Ao trocar de projeto, a lista anterior
  // sai imediatamente (nada de tela velha fingindo ser o projeto novo) e uma
  // descoberta atrasada do projeto anterior não sobrescreve a atual.
  const shownPathRef = useRef<string | null>(null)

  const load = useCallback(async (force = false) => {
    if (!project) {
      shownPathRef.current = null
      setServers([])
      setProviderInventories([])
      return
    }
    const path = project.path
    if (shownPathRef.current !== path) {
      shownPathRef.current = path
      setServers([])
      setProviderInventories([])
      setError(null)
    }
    setLoading(true)
    setError(null)
    try {
      const found = await discoverMcpServers(path, { force })
      if (shownPathRef.current === path) {
        setServers(found.servers)
        setProviderInventories(found.providerInventories)
      }
    } catch (cause) {
      if (shownPathRef.current === path) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (shownPathRef.current === path) setLoading(false)
    }
  }, [project])

  useEffect(() => {
    void load(false)
  }, [load])

  // Navegador do projeto (B2.1): o app é dono do Chromium. O estado vem do hook
  // porque a linha de cada agent também precisa dele para dizer o que falta.
  const browser = useProjectBrowser(project?.path ?? null)

  // Estado do login por servidor OAuth. Falha aqui não vira toast: a linha
  // simplesmente não promete nada, e o botão "Entrar" continua disponível.
  useEffect(() => {
    const path = project?.path
    if (!path) {
      setAuthByServer({})
      return
    }
    let vivo = true
    const alvos = servers.filter((server) => mcpOfereceLogin(server))
    void Promise.all(
      alvos.map(async (server) => {
        try {
          return await mcpOauthStatus(path, server.id)
        } catch {
          return null
        }
      }),
    ).then((resultados) => {
      if (!vivo || shownPathRef.current !== path) return
      setAuthByServer(
        Object.fromEntries(
          resultados
            .filter((status): status is McpAuthStatus => status !== null)
            .map((status) => [status.serverId, status]),
        ),
      )
    })
    return () => {
      vivo = false
    }
  }, [project, servers])

  const setAuthKeyBusy = useCallback((serverId: string, on: boolean) => {
    setAuthBusy((atual) => {
      const proximo = new Set(atual)
      if (on) proximo.add(serverId)
      else proximo.delete(serverId)
      return proximo
    })
  }, [])

  const doLogin = useCallback(
    async (server: McpServer) => {
      const path = project?.path
      if (!path) return
      setAuthKeyBusy(server.id, true)
      try {
        const status = await mcpOauthLogin(path, server.id)
        setAuthByServer((atual) => ({ ...atual, [server.id]: status }))
        avisar.feito(`Login concluído em ${server.name}.`)
      } catch (cause) {
        // Motivo legível vindo do backend (issuer divergente, sem PKCE, porta
        // ocupada, recusa do servidor). Nunca engolido.
        avisar.erro(`Não consegui entrar em ${server.name}.`, { detalhe: mensagemDe(cause) })
      } finally {
        setAuthKeyBusy(server.id, false)
      }
    },
    [project, setAuthKeyBusy],
  )

  const doLogout = useCallback(
    async (server: McpServer) => {
      const path = project?.path
      if (!path) return
      setAuthKeyBusy(server.id, true)
      try {
        // A frase diz o que REALMENTE aconteceu: revogou no servidor ou só
        // apagou deste Mac (o AS pode não expor revogação).
        const resultado = await mcpOauthLogout(path, server.id)
        setAuthByServer((atual) => ({
          ...atual,
          [server.id]: {
            serverId: server.id,
            state: "sem-login",
            expiresAt: null,
            scope: null,
            revogavel: atual[server.id]?.revogavel ?? false,
          },
        }))
        avisar.feito(resultado)
      } catch (cause) {
        avisar.erro(`Não consegui sair de ${server.name}.`, { detalhe: mensagemDe(cause) })
      } finally {
        setAuthKeyBusy(server.id, false)
      }
    },
    [project, setAuthKeyBusy],
  )

  /** Aplica o resultado de um health check na linha, se o painel ainda mostra
   *  o mesmo projeto (descoberta de outro projeto substitui a lista). */
  const applyHealthResult = useCallback(
    (
      path: string,
      serverId: string,
      agent: McpAgentState["agent"],
      result: {
        status: McpHealthStatus
        detail: string | null
        checkedAt: number
        toolNames: string[]
      },
    ) => {
      if (shownPathRef.current !== path) return
      setServers((prev) =>
        applyAgentPatch(prev, serverId, agent, {
          health: result.status,
          detail: result.detail,
          checkedAt: result.checkedAt,
          toolNames: result.toolNames,
        }),
      )
    },
    [],
  )

  async function update(
    server: McpServer,
    state: McpAgentState,
    patch: Partial<
      Pick<McpAgentState, "enabled" | "required" | "browser" | "browserConexao" | "fallback">
    >,
  ) {
    if (!project) return
    const key = `${server.id}:${state.agent}`
    if (busyKeysRef.current.has(key)) return
    const path = project.path
    const next = { ...state, ...patch }
    setKeyBusy(key, true)
    // Otimista: o Switch marca na hora; o backend confirma em silêncio ou
    // reverte com o motivo. Nunca fica marcado com o backend tendo recusado.
    const confirmed = await optimisticBindingUpdate({
      apply: () =>
        setServers((prev) =>
          applyAgentPatch(prev, server.id, state.agent, patch),
        ),
      revert: () =>
        setServers((prev) =>
          applyAgentPatch(prev, server.id, state.agent, {
            enabled: state.enabled,
            required: state.required,
            browser: state.browser,
            browserConexao: state.browserConexao,
            fallback: state.fallback,
          }),
        ),
      commit: () =>
        setMcpBinding({
          projectPath: path,
          serverId: server.id,
          agent: state.agent,
          enabled: next.enabled,
          required: next.required,
          fallback: next.fallback,
          browser: next.browser,
          browserConexao: next.browserConexao,
        }),
      onError: (message) => avisar.erro(message),
    })
    setKeyBusy(key, false)
    if (!confirmed) return
    if (next.enabled && !state.enabled) {
      // Primeiro enable: health em segundo plano; a linha diz "verificando…"
      // até o resultado real, sem segurar o toggle.
      setCheckingKeys((prev) => toggleKey(prev, key, true))
      try {
        const result = await checkMcpServer({
          projectPath: path,
          serverId: server.id,
          agent: state.agent,
        })
        applyHealthResult(path, server.id, state.agent, result)
        if (result.status !== "healthy" && result.status !== "auth-delegated") {
          avisar.nota(`${server.name}: ${mcpHealthLabel(result.status)}`, {
            detalhe: result.detail ?? undefined,
          })
        }
      } catch (cause) {
        avisar.erro(`Não consegui testar ${server.name}.`, { detalhe: mensagemDe(cause) })
      } finally {
        setCheckingKeys((prev) => toggleKey(prev, key, false))
      }
    }
  }

  async function check(server: McpServer, state: McpAgentState) {
    if (!project) return
    const key = `check:${server.id}:${state.agent}`
    if (busyKeysRef.current.has(key)) return
    const path = project.path
    setKeyBusy(key, true)
    try {
      const result = await checkMcpServer({
        projectPath: path,
        serverId: server.id,
        agent: state.agent,
      })
      if (result.status === "healthy") {
        avisar.feito(
          `${server.name}: saudável${result.toolCount ? ` · ${result.toolCount} tools` : ""}`,
        )
      } else {
        avisar.nota(`${server.name}: ${mcpHealthLabel(result.status)}`, {
          detalhe: result.detail ?? undefined,
        })
      }
      applyHealthResult(path, server.id, state.agent, result)
    } catch (cause) {
      avisar.erro(`Não consegui testar ${server.name}.`, { detalhe: mensagemDe(cause) })
    } finally {
      setKeyBusy(key, false)
    }
  }

  /** A ação usa o inventário observado; a confirmação vem de nova descoberta.
   * Também reconsulta na falha: um timeout pode ocorrer depois da escrita. */
  async function instalarNoCli(server: McpServer, state: McpAgentState) {
    if (!project) return
    const key = `${server.id}:${state.agent}`
    const busyKey = `cli:${key}`
    if (busyKeysRef.current.has(busyKey)) return
    if (state.escopo === "global" && (!state.cliInstallation || state.cliInstallation === "unknown")) {
      avisar.erro("Reverifique o inventário do CLI antes de alterar")
      return
    }
    const path = project.path
    const instalar = state.cliInstallation !== "enabled" && state.cliInstallation !== "disabled"
    busyKeysRef.current.add(busyKey)
    setInstalando((s) => new Set(s).add(key))
    try {
      const dito = await invoke<string>("install_mcp_in_agent", {
        projectPath: path,
        serverId: server.id,
        agent: state.agent,
        instalar,
      })
      // A voz do CLI é a evidência; o app não reescreve o que ele disse.
      avisar.feito(dito || `${server.name} ${instalar ? "instalado" : "removido"} no ${state.agent}`)
    } catch (cause) {
      avisar.erro(`Não consegui ${instalar ? "instalar" : "remover"} ${server.name}.`, { detalhe: mensagemDe(cause) })
    } finally {
      try {
        const found = await discoverMcpServers(path, { force: true })
        if (shownPathRef.current === path) {
          setServers(found.servers)
          setProviderInventories(found.providerInventories)
        }
      } catch (cause) {
        if (shownPathRef.current === path) {
          setServers((previous) => previous.map((item) => ({
            ...item,
            agentStates: item.agentStates.map((row) => row.escopo === "global"
              ? { ...row, cliInstallation: "unknown" } : row),
          })))
          setError(`Não foi possível confirmar o inventário: ${String(cause)}`)
        }
      }
      busyKeysRef.current.delete(busyKey)
      setInstalando((s) => {
        const n = new Set(s)
        n.delete(key)
        return n
      })
    }
  }

  if (!project) {
    return (
      <div className="rounded-lg border bg-secondary/20 p-4 text-[13px] text-muted-foreground">
        Selecione um projeto para gerenciar seus MCPs.
      </div>
    )
  }

  // Os MCPs internos da Frota (aprovação, contexto) não são da pessoa: são
  // por turno e ninguém liga ou desliga. Saem da lista e do resumo (ADR-268).
  const daPessoa = servers.filter((s) => s.managed)
  const resumo = mcpResumo(daPessoa, authByServer, daPessoa.map((s) => s.id))
  const toggleAberto = (id: string) =>
    setAbertos((atual) => toggleKey(atual, id, !atual.has(id)))

  return (
    <div>
      <SectionHeader
        title="MCPs"
        description="Os servidores MCP que você instalou, e em quais motores cada um vale neste projeto. As ferramentas da própria Frota ficam na página de cada motor."
        escopo={<EscopoDoProjeto nome={project.name} />}
        action={
          <Button size="compacto" variant="ghost" onClick={() => void load(true)} disabled={loading}>
            <RefreshCcw className={cn("size-3.5", loading && "animate-spin")} />
            Redescobrir
          </Button>
        }
      />

      {error && (
        <div className="mb-3 rounded-lg border border-st-error/30 bg-st-error/5 p-3 text-[12px] text-st-error">
          {error}
        </div>
      )}

      {loading && daPessoa.length === 0 ? (
        <div className="grid min-h-40 place-items-center text-muted-foreground">
          <div className="flex flex-col items-center gap-2 text-[12px]">
            <Loader2 className="size-5 animate-spin" />
            <span>
              Descobrindo os MCPs de <span className="text-foreground/80">{project.name}</span>…
            </span>
          </div>
        </div>
      ) : daPessoa.length === 0 ? (
        <div className="mt-4 rounded-lg border border-dashed p-5 text-center text-[12px] text-muted-foreground">
          Nenhum MCP foi encontrado nas fontes deste projeto.
        </div>
      ) : (
        <>
          {/* A linha de resumo responde a primeira pergunta antes de qualquer
              cartão. Cada número só aparece quando é maior que zero. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{resumo.total}</span>{" "}
              {resumo.total === 1 ? "MCP" : "MCPs"} neste projeto
            </span>
            {resumo.ativos > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-foreground/70" />
                <span className="font-medium text-foreground">{resumo.ativos}</span>{" "}
                {resumo.ativos === 1 ? "ativo" : "ativos"}
              </span>
            )}
            {resumo.pedemLogin > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full bg-st-warning" />
                <span className="font-medium text-foreground">{resumo.pedemLogin}</span>{" "}
                {resumo.pedemLogin === 1 ? "pede login" : "pedem login"}
              </span>
            )}
            {resumo.soNoCli > 0 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="size-1.5 rounded-full ring-1 ring-inset ring-muted-foreground/60" />
                <span className="font-medium text-foreground">{resumo.soNoCli}</span> só no CLI de origem
              </span>
            )}
          </div>

          <div className="mt-2.5 overflow-hidden rounded-lg border">
            {daPessoa.map((server) => (
              <McpServerRow
                key={server.id}
                server={server}
                aberto={abertos.has(server.id)}
                onToggle={() => toggleAberto(server.id)}
                auth={authByServer[server.id]}
                authBusy={authBusy.has(server.id)}
                onLogin={() => void doLogin(server)}
                onLogout={() => void doLogout(server)}
                browser={browser.status}
                busyKeys={busyKeys}
                checkingKeys={checkingKeys}
                instalandoKeys={instalando}
                onUpdate={(s, st, patch) => void update(s, st, patch)}
                onCheck={(s, st) => void check(s, st)}
                onInstalarNoCli={(s, st) => void instalarNoCli(s, st)}
              />
            ))}
          </div>
        </>
      )}

      {/* Contexto vem DEPOIS da lista: o que cada motor tem no próprio CLI
          (recolhido: repete a lista por outro ângulo) e a garantia do
          Keychain em uma linha. O acompanhamento saiu daqui para a página do
          motor (ADR-268). */}
      <ProviderMcpInventoryPanel inventories={providerInventories} />
      <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-muted-foreground">
        <LockKeyhole className="mt-px size-3 shrink-0" />
        <span>
          Tokens e headers nunca são persistidos fora do Keychain deste Mac. Configuração com
          credencial literal fica no CLI de origem.
        </span>
      </p>
    </div>
  )
}
