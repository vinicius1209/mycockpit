// As linhas por agent de um servidor MCP, extraídas de McpSettings.tsx (que
// estava no teto da catraca de tamanho). Aqui mora o SEGUNDO interruptor do
// navegador do projeto: a marca "navegador" é por (servidor, agent), e agora a
// própria linha diz quando o outro lado do elo falta, em vez de exigir que o
// usuário cruze duas telas de cabeça.

import { AlertTriangle, CheckCircle2, KeyRound, Loader2, RefreshCcw, Terminal, XCircle } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { Button } from "@/components/ui/button"
import {
  consequenciaDaAcao,
  gestoDaLinha,
  rotuloDaAcao,
  mcpAgentStatusLabel,
  mcpAgentUtilizavel,
  type McpAgentState,
  type McpFallback,
  type McpHealthStatus,
  type McpServer, CONEXOES_DO_NAVEGADOR, type BrowserConexao} from "@/lib/mcp"
import { AVISO_DO_NAVEGADOR_INTEIRO, browserRowNotice, type BrowserStatus } from "@/lib/browser"
import { agentDef } from "@/lib/agents"
import { cn } from "@/lib/utils"

const FALLBACKS: { value: McpFallback; label: string }[] = [
  { value: "ask", label: "Pedir decisão" },
  { value: "deny", label: "Não permitir" },
  { value: "allow-readonly", label: "Pedir só leitura" },
]

function statusIcon(status: McpHealthStatus) {
  if (status === "healthy" || status === "auth-delegated")
    return <CheckCircle2 className="size-3.5 text-st-success" />
  if (status === "auth-required")
    return <KeyRound className="size-3.5 text-st-warning" />
  if (status === "unavailable")
    return <XCircle className="size-3.5 text-st-error" />
  return <AlertTriangle className="size-3.5 text-muted-foreground/60" />
}

export function McpAgentRows({
  server,
  browser,
  busyKeys,
  checkingKeys,
  onUpdate,
  onCheck,
  onInstalarNoCli,
  instalandoKeys,
}: {
  server: McpServer
  browser: BrowserStatus | null
  busyKeys: ReadonlySet<string>
  checkingKeys: ReadonlySet<string>
  onUpdate: (
    server: McpServer,
    state: McpAgentState,
    patch: Partial<
      Pick<McpAgentState, "enabled" | "required" | "browser" | "browserConexao" | "fallback">
    >,
  ) => void
  onCheck: (server: McpServer, state: McpAgentState) => void
  /** Gesto humano do escopo global: roda o comando do CLI do agent. */
  onInstalarNoCli: (server: McpServer, state: McpAgentState) => void
  instalandoKeys: ReadonlySet<string>
}) {
  return (
    <div className="mt-3 divide-y divide-border/40 rounded-lg border bg-background/30">
      {server.agentStates.map((state) => {
        // A ordem e a presença vêm do registry Rust. O espelho TS só resolve
        // identidade visual; id ainda desconhecido continua aparecendo.
        const agent = agentDef(state.agent)
        const label = agent?.shortLabel ?? state.agent
        const key = `${server.id}:${state.agent}`
        const writeBusy = busyKeys.has(key)
        const checkBusy = busyKeys.has(`check:${key}`)
        const verifying = checkingKeys.has(key)
        const browserNotice = browserRowNotice(state, browser)
        // Um gate só pra linha inteira: interruptor, botão de testar e rótulo
        // saem do MESMO fato. Era a divergência entre eles que fazia a tela
        // prometer "roteado pelo Frota" com o controle travado.
        const utilizavel = mcpAgentUtilizavel(state)
        // O vínculo do run e a entrada global são fatos diferentes.
        const gesto = gestoDaLinha(state)
        const instalando = instalandoKeys.has(key)
        const acao = rotuloDaAcao(gesto)
        const consequencia = consequenciaDaAcao(gesto)
        return (
          <div key={state.agent} className="px-2.5 py-1.5">
            <div className="flex min-h-10 items-center gap-2">
              {state.escopo === "global" ? (
                <span className="grid w-8 shrink-0 place-items-center" title="Configuração global do CLI">
                  <Terminal className="size-3.5 text-muted-foreground" />
                </span>
              ) : (
                <Switch
                  checked={state.enabled}
                  onCheckedChange={(enabled) => onUpdate(server, state, { enabled })}
                  disabled={!utilizavel || writeBusy}
                  aria-label={`Usar ${server.name} no ${label}`}
                />
              )}
              <span className="w-20 truncate text-[12px] text-foreground" title={label}>
                {label}
              </span>
              <span
                className="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-muted-foreground"
                title={state.detail ?? undefined}
              >
                {verifying ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  state.escopo === "global" ? null : statusIcon(state.health)
                )}
                <span className="truncate">
                  {verifying
                    ? "verificando…"
                    : [
                        mcpAgentStatusLabel(server, state),
                        utilizavel && state.checkedAt != null && state.toolNames
                          ? `${state.toolNames.length} tools`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                </span>
              </span>
              {utilizavel && state.enabled && (
                <>
                  <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={state.required}
                      onChange={(event) =>
                        onUpdate(server, state, {
                          required: event.target.checked,
                        })
                      }
                      disabled={writeBusy}
                      className="accent-[var(--brass)]"
                    />
                    exigir
                  </label>
                  <label
                    className="flex items-center gap-1 text-[11px] text-muted-foreground"
                    title={`Usar somente o navegador deste projeto neste MCP. ${AVISO_DO_NAVEGADOR_INTEIRO}`}
                  >
                    <input
                      type="checkbox"
                      checked={state.browser}
                      onChange={(event) =>
                        onUpdate(server, state, {
                          browser: event.target.checked,
                        })
                      }
                      disabled={writeBusy}
                      className="accent-[var(--brass)]"
                    />
                    usar navegador
                  </label>
                  {state.browser && (
                    <select
                      value={state.browserConexao ?? "cdp-endpoint"}
                      onChange={(event) =>
                        onUpdate(server, state, {
                          browserConexao: event.target.value as BrowserConexao,
                        })
                      }
                      disabled={writeBusy}
                      title="Como este MCP recebe o navegador do projeto"
                      className="h-6 rounded border bg-background px-1 font-mono text-[11px] text-foreground"
                      aria-label={`Como ${server.name} se conecta ao navegador no ${label}`}
                    >
                      {CONEXOES_DO_NAVEGADOR.map((item) => (
                        <option key={item.value} value={item.value} title={item.title}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {state.required && (
                    <select
                      value={state.fallback}
                      onChange={(event) =>
                        onUpdate(server, state, {
                          fallback: event.target.value as McpFallback,
                        })
                      }
                      disabled={writeBusy}
                      className="h-6 rounded border border-border/60 bg-background px-1 text-[11px] text-foreground"
                      aria-label={`Se faltar ${server.name} no ${label}`}
                    >
                      {FALLBACKS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  )}
                </>
              )}
              {acao && (
                <Button
                  size="chip"
                  variant="ghost"
                  onClick={() => onInstalarNoCli(server, state)}
                  disabled={instalando || (state.escopo === "global" && state.cliInstallation == null)}
                  title={consequencia ?? undefined}
                  className="shrink-0"
                >
                  {instalando ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    acao
                  )}
                </Button>
              )}
              {utilizavel && (
                <button
                  onClick={() => onCheck(server, state)}
                  disabled={writeBusy || checkBusy || verifying}
                  className="grid size-6 place-items-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
                  title={`Testar a conexão antes de usar no ${label}`}
                  aria-label={`Testar ${server.name} no ${label}`}
                >
                  {checkBusy ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCcw className="size-3.5" />
                  )}
                </button>
              )}
            </div>
            {browserNotice && (
              <div
                className={cn(
                  "flex items-start gap-1.5 pb-1 pl-[3.25rem] text-[11px] leading-snug",
                  browserNotice.tone === "warning"
                    ? "text-st-warning"
                    : "text-muted-foreground",
                )}
              >
                {browserNotice.tone === "warning" && (
                  <AlertTriangle className="mt-px size-3.5 shrink-0" />
                )}
                <span>{browserNotice.text}</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
