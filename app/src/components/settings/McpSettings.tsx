import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Loader2, RefreshCcw, Server, ShieldCheck } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { PillSelect } from "@/components/ui/PillSelect"
import { useApp } from "@/store/app"
import {
  applyAgentPatch,
  checkMcpServer,
  discoverMcpServers,
  initialMcpProjectId,
  mcpBindingsSummary,
  mcpAuthActionLabel,
  mcpAuthHint,
  mcpAuthLabel,
  mcpHealthLabel,
  mcpOauthLogin,
  mcpOauthLogout,
  mcpOauthStatus,
  mcpPortabilityNotices,
  mcpProjectOptionLabel,
  optimisticBindingUpdate,
  setMcpBinding,
  type McpAgentState,
  type McpAuthStatus,
  type McpHealthStatus,
  type McpServer,
} from "@/lib/mcp"
import { browserBoundServers, shouldShowBrowserCard } from "@/lib/browser"
import {
  ProjectBrowserCard,
  useProjectBrowser,
} from "@/components/settings/ProjectBrowserCard"
import { McpAgentRows } from "@/components/settings/McpAgentRows"
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

function sourceLabel(server: McpServer): string {
  if (server.source === "mycockpit") return "interno"
  if (server.source === "project") return ".mcp.json"
  return `${server.source} · ${server.scope}`
}

export function McpSettings() {
  const projects = useApp((s) => s.projects)
  const activeProjectId = useApp((s) => s.activeProjectId)
  // Escopo do PAINEL, não do app: trocar aqui nunca muda o projeto ativo da
  // sidebar. null = seguir o default (projeto ativo).
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  )
  const project = useMemo(() => {
    const id =
      selectedProjectId &&
      projects.some((item) => item.id === selectedProjectId)
        ? selectedProjectId
        : initialMcpProjectId(projects, activeProjectId)
    return projects.find((item) => item.id === id) ?? null
  }, [activeProjectId, projects, selectedProjectId])
  const [servers, setServers] = useState<McpServer[]>([])
  const [bindingCounts, setBindingCounts] = useState<Record<string, number>>(
    {},
  )
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
  const [error, setError] = useState<string | null>(null)
  // Login do PRÓPRIO app nos MCPs com OAuth (A1). Só existe para servidores
  // cuja config declara o bloco `oauth`; os demais nem mostram a linha.
  const [authByServer, setAuthByServer] = useState<
    Record<string, McpAuthStatus>
  >({})
  const [authBusy, setAuthBusy] = useState<ReadonlySet<string>>(new Set())

  const setKeyBusy = useCallback((key: string, on: boolean) => {
    if (on) busyKeysRef.current.add(key)
    else busyKeysRef.current.delete(key)
    setBusyKeys(new Set(busyKeysRef.current))
  }, [])
  // Path cuja descoberta está na tela. Ao trocar de projeto, a lista anterior
  // sai imediatamente (nada de tela velha fingindo ser o projeto novo) e uma
  // descoberta atrasada do projeto anterior não sobrescreve a atual.
  const shownPathRef = useRef<string | null>(null)

  const refreshCounts = useCallback(async () => {
    try {
      const summary = await mcpBindingsSummary()
      setBindingCounts(
        Object.fromEntries(
          summary.map((entry) => [entry.projectId, entry.count]),
        ),
      )
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  const load = useCallback(async () => {
    if (!project) {
      shownPathRef.current = null
      setServers([])
      return
    }
    const path = project.path
    if (shownPathRef.current !== path) {
      shownPathRef.current = path
      setServers([])
      setError(null)
    }
    setLoading(true)
    setError(null)
    try {
      const found = await discoverMcpServers(path)
      if (shownPathRef.current === path) setServers(found)
    } catch (cause) {
      if (shownPathRef.current === path) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (shownPathRef.current === path) setLoading(false)
    }
  }, [project])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void refreshCounts()
  }, [refreshCounts])

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
    const alvos = servers.filter((server) => server.nativeReason === "oauth")
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
        toast.success(`Login concluído em ${server.name}.`)
      } catch (cause) {
        // Motivo legível vindo do backend (issuer divergente, sem PKCE, porta
        // ocupada, recusa do servidor). Nunca engolido.
        toast.error(cause instanceof Error ? cause.message : String(cause))
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
        toast.success(resultado)
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause))
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
      result: { status: McpHealthStatus; detail: string | null; checkedAt: number },
    ) => {
      if (shownPathRef.current !== path) return
      setServers((prev) =>
        applyAgentPatch(prev, serverId, agent, {
          health: result.status,
          detail: result.detail,
          checkedAt: result.checkedAt,
        }),
      )
    },
    [],
  )

  async function update(
    server: McpServer,
    state: McpAgentState,
    patch: Partial<
      Pick<McpAgentState, "enabled" | "required" | "browser" | "fallback">
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
        }),
      onError: (message) => toast.error(message),
    })
    setKeyBusy(key, false)
    if (!confirmed) return
    void refreshCounts()
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
          toast.warning(`${server.name}: ${mcpHealthLabel(result.status)}`, {
            description: result.detail ?? undefined,
          })
        }
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause))
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
        toast.success(
          `${server.name}: saudável${result.toolCount ? ` · ${result.toolCount} tools` : ""}`,
        )
      } else {
        toast.warning(`${server.name}: ${mcpHealthLabel(result.status)}`, {
          description: result.detail ?? undefined,
        })
      }
      applyHealthResult(path, server.id, state.agent, result)
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setKeyBusy(key, false)
    }
  }

  if (!project) {
    return (
      <div className="rounded-lg border border-border/60 bg-secondary/20 p-4 text-[13px] text-muted-foreground">
        Selecione um projeto para gerenciar seus MCPs.
      </div>
    )
  }

  return (
    <div>
      <div className="mb-1 flex items-start justify-between gap-3 pr-9">
        <div>
          <h2 className="text-[14px] font-semibold text-foreground">
            Integrações MCP
          </h2>
          <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
            Cada projeto decide quais MCPs seus agents enxergam; sem binding, o
            CLI mantém o comportamento nativo.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void load()}
          disabled={loading}
          className="h-7 gap-1.5 px-2 text-[12px]"
        >
          <RefreshCcw className={cn("size-3.5", loading && "animate-spin")} />
          Redescobrir
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-[12px] font-medium text-foreground">
          Bindings do projeto:
        </span>
        <PillSelect
          value={project.id}
          onValueChange={setSelectedProjectId}
          options={projects.map((item) => ({
            value: item.id,
            label: mcpProjectOptionLabel(
              item.name,
              bindingCounts[item.id] ?? 0,
            ),
          }))}
          triggerClassName="h-7 gap-1.5 px-2.5 text-[12px] text-foreground"
          title="Escopo deste painel; não muda o projeto ativo do app"
          aria-label="Projeto dos bindings MCP"
        />
      </div>

      <div className="mt-3 rounded-lg border border-brass/20 bg-brass/5 px-3 py-2 text-[12px] leading-snug text-muted-foreground">
        <ShieldCheck className="mr-1 inline size-3.5 text-brass" />
        Valores de tokens e headers nunca são persistidos. Configurações com
        credencial literal precisam usar Keychain, wrapper ou referência de env
        antes de poderem ser roteadas.
      </div>

      {shouldShowBrowserCard(
        browser.status,
        browserBoundServers(servers).length > 0,
      ) && <ProjectBrowserCard browser={browser} servers={servers} />}

      {error && (
        <div className="mt-3 rounded-lg border border-st-error/30 bg-st-error/5 p-3 text-[12px] text-st-error">
          {error}
        </div>
      )}

      {loading && servers.length === 0 ? (
        <div className="grid min-h-40 place-items-center text-muted-foreground">
          <div className="flex flex-col items-center gap-2 text-[12px]">
            <Loader2 className="size-5 animate-spin" />
            <span>
              Descobrindo os MCPs de{" "}
              <span className="text-foreground/80">{project.name}</span>…
            </span>
          </div>
        </div>
      ) : servers.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-border/60 p-5 text-center text-[12px] text-muted-foreground">
          Nenhum MCP foi encontrado no Claude, Codex ou `.mcp.json`.
        </div>
      ) : (
        <div className="mt-3 space-y-2.5">
          {servers.map((server) => (
            <article
              key={server.id}
              className="rounded-xl border border-border/60 bg-secondary/15 p-3"
            >
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-border/60 bg-background/60">
                  <Server className="size-3.5 text-brass" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[13px] font-medium text-foreground">
                      {server.name}
                    </span>
                    <span className="rounded border border-border/60 bg-background/50 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {sourceLabel(server)}
                    </span>
                    <span className="rounded border border-border/60 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {server.transport}
                    </span>
                  </div>
                  <div
                    className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground/75"
                    title={server.locator}
                  >
                    {server.locator}
                  </div>
                  {server.runtimeName && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      nome na sessão:{" "}
                      <span className="rounded border border-border/60 bg-background/50 px-1 py-0.5 font-mono text-[11px] text-foreground/80">
                        {server.runtimeName}
                      </span>{" "}
                      (cite este nome no prompt)
                    </div>
                  )}
                  {server.envKeys.length > 0 && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      env refs: {server.envKeys.join(", ")}
                    </div>
                  )}
                  {server.nativeReason === "oauth" && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border/50 bg-background/40 px-2.5 py-1.5">
                      <span className="text-[11px] text-foreground">
                        {mcpAuthLabel(
                          authByServer[server.id]?.state ?? "sem-login",
                        )}
                      </span>
                      <span className="flex-1 text-[11px] leading-snug text-muted-foreground">
                        {mcpAuthHint(
                          authByServer[server.id] ?? {
                            state: "sem-login",
                            expiresAt: null,
                          },
                        )}
                      </span>
                      <Button
                        size="sm"
                        variant={
                          authByServer[server.id]?.state === "conectado"
                            ? "ghost"
                            : "secondary"
                        }
                        disabled={authBusy.has(server.id)}
                        onClick={() =>
                          void (authByServer[server.id]?.state === "conectado"
                            ? doLogout(server)
                            : doLogin(server))
                        }
                        className="h-7 shrink-0 px-2.5 text-[12px]"
                      >
                        {authBusy.has(server.id) && (
                          <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                        )}
                        {mcpAuthActionLabel(
                          authByServer[server.id]?.state ?? "sem-login",
                        )}
                      </Button>
                    </div>
                  )}
                  {mcpPortabilityNotices(
                    server,
                    authByServer[server.id]?.state === "conectado",
                  ).map((notice) => (
                    <div
                      key={notice.kind}
                      className={cn(
                        "mt-1 text-[11px] leading-snug",
                        // Fato estrutural em tom neutro; pendência que o
                        // usuário resolve (segredo literal) em aviso.
                        notice.kind === "native-only"
                          ? "text-muted-foreground"
                          : "text-st-warning",
                      )}
                    >
                      {notice.text}
                    </div>
                  ))}
                  {!server.sourceEnabled && server.managed && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Desativado na origem; um binding explícito o ativa somente
                      no run gerenciado.
                    </div>
                  )}
                </div>
              </div>

              {server.managed ? (
                <McpAgentRows
                  server={server}
                  browser={browser.status}
                  busyKeys={busyKeys}
                  checkingKeys={checkingKeys}
                  autenticadoPeloApp={
                    authByServer[server.id]?.state === "conectado"
                  }
                  onUpdate={(s, st, patch) => void update(s, st, patch)}
                  onCheck={(s, st) => void check(s, st)}
                />
              ) : (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  MCP interno, criado e limitado por run pelo MyCockpit.
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
