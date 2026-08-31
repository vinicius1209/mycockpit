// As linhas por agent de um servidor MCP, extraídas de McpSettings.tsx (que
// estava no teto da catraca de tamanho). Aqui mora o SEGUNDO interruptor do
// navegador do projeto: a marca "navegador" é por (servidor, agent), e agora a
// própria linha diz quando o outro lado do elo falta, em vez de exigir que o
// usuário cruze duas telas de cabeça.

import { AlertTriangle, CheckCircle2, KeyRound, Loader2, RefreshCcw, XCircle } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import {
  consequenciaDaAcao,
  gestoDaLinha,
  rotuloDaAcao,
  mcpAgentStatusLabel,
  mcpAgentUtilizavel,
  type McpAgentState,
  type McpFallback,
  type McpHealthStatus,
  type McpServer,
} from "@/lib/mcp"
import { browserRowNotice, type BrowserStatus } from "@/lib/browser"
import { agentDef } from "@/lib/agents"

const FALLBACKS: { value: McpFallback; label: string }[] = [
  { value: "ask", label: "Pausar e avisar" },
  { value: "deny", label: "Sem fallback" },
  { value: "allow-readonly", label: "Fallback leitura" },
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
      Pick<McpAgentState, "enabled" | "required" | "browser" | "fallback">
    >,
  ) => void
  onCheck: (server: McpServer, state: McpAgentState) => void
  /** Gesto humano do escopo global: roda o comando do CLI do agent. */
  onInstalarNoCli: (server: McpServer, state: McpAgentState) => void
  instalandoKeys: ReadonlySet<string>
}) {
  return (
    <div className="mt-3 divide-y divide-border/40 rounded-lg border border-border/50 bg-background/30">
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
        // Escopo global não ganha interruptor: o app não sabe o que já existe
        // no CLI do usuário, e interruptor comunica "eu sei e controlo".
        const gesto = gestoDaLinha(state)
        const instalando = instalandoKeys.has(key)
        const acao = rotuloDaAcao(gesto)
        const consequencia = consequenciaDaAcao(gesto)
        return (
          <div key={state.agent} className="px-2.5 py-1.5">
            <div className="flex min-h-10 items-center gap-2">
              <Switch
                checked={state.enabled}
                onCheckedChange={(enabled) => onUpdate(server, state, { enabled })}
                disabled={!utilizavel || writeBusy}
                aria-label={`Usar ${server.name} no ${label}`}
              />
              <span className="w-16 truncate text-[12px] text-foreground" title={label}>
                {label}
              </span>
              <span
                className="flex min-w-0 flex-1 items-center gap-1 text-[11px] text-muted-foreground"
                title={state.detail ?? undefined}
              >
                {verifying ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  statusIcon(state.health)
                )}
                <span className="truncate">
                  {verifying
                    ? "verificando…"
                    : [
                        mcpAgentStatusLabel(server, state),
                        state.checkedAt != null && state.toolNames
                          ? `${state.toolNames.length} tools`
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                </span>
              </span>
              {state.enabled && (
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
                    title="Este MCP pilota o navegador do projeto (o run recebe --cdp-endpoint)"
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
                    navegador
                  </label>
                  <select
                    value={state.fallback}
                    onChange={(event) =>
                      onUpdate(server, state, {
                        fallback: event.target.value as McpFallback,
                      })
                    }
                    disabled={writeBusy}
                    className="h-6 rounded border border-border/60 bg-background px-1 text-[11px] text-foreground"
                    aria-label={`Fallback de ${server.name} no ${label}`}
                  >
                    {FALLBACKS.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {acao && (
                <button
                  onClick={() => onInstalarNoCli(server, state)}
                  disabled={instalando}
                  title={consequencia ?? undefined}
                  className="shrink-0 rounded bg-background/60 px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                >
                  {instalando ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    acao
                  )}
                </button>
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
            {consequencia && (
              <div className="pb-1 pl-[3.25rem] text-[11px] leading-snug text-muted-foreground">
                {consequencia}
              </div>
            )}
            {browserNotice && (
              <div className="flex items-start gap-1.5 pb-1 pl-[3.25rem] text-[11px] leading-snug text-st-warning">
                <AlertTriangle className="mt-px size-3.5 shrink-0" />
                <span>{browserNotice}</span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
