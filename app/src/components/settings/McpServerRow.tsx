// Uma linha por MCP (ADR-201). A lista mostra o que decide: nome, origem,
// transporte, estado curto e um chip por motor. Só o cartão que a pessoa
// toca abre, e aí a primeira coisa é QUEM autentica, depois as linhas por
// motor, e por último os detalhes técnicos atrás de um disclosure. Antes cada
// MCP era um cartão de ~250px sempre aberto, com quatro interruptores e a
// mesma prosa repetida: cinco MCPs davam três telas de rolagem.

import { ChevronDown, ChevronRight, Loader2, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { McpAgentRows } from "@/components/settings/McpAgentRows";
import {
  mcpAgentUtilizavel,
  mcpAuthActionLabel,
  mcpOfereceLogin,
  mcpPortabilityNotices,
  mcpQuemAutentica,
  type McpAgentState,
  type McpAuthStatus,
  type McpServer,
} from "@/lib/mcp";
import type { BrowserStatus } from "@/lib/browser";
import { agentDef } from "@/lib/agents";
import { controle } from "@/components/ui/controle";
import { cn } from "@/lib/utils";

export function mcpSourceLabel(
  server: Pick<McpServer, "source" | "scope">,
): string {
  if (server.source === "mycockpit") return "interno";
  if (server.source === "project") return ".mcp.json";
  return `${server.source} · ${server.scope}`;
}

type Tom = "ok" | "aviso" | "neutro";

/** O estado curto da linha fechada: uma frase, um tom. Conectado e "pede
 *  login" vêm do login do app; o resto deriva dos vínculos. */
export function mcpEstadoCurto(
  server: Pick<
    McpServer,
    | "managed"
    | "portable"
    | "nativeReason"
    | "loginPeloApp"
    | "agentStates"
    | "literalSecret"
  >,
  auth: Pick<McpAuthStatus, "state"> | undefined,
  origem: string | null,
): { texto: string; tom: Tom } {
  if (!server.managed) return { texto: "interno, por turno", tom: "neutro" };
  if (auth?.state === "conectado") return { texto: "conectado", tom: "ok" };
  if (auth?.state === "expirado")
    return { texto: "sessão expirada", tom: "aviso" };
  if (mcpOfereceLogin(server)) return { texto: "pede login", tom: "aviso" };
  if (!server.portable) {
    const motivo = server.literalSecret
      ? "contém valor literal"
      : "nativo do CLI";
    return {
      texto: `só no ${origem ?? "CLI de origem"} (${motivo})`,
      tom: "neutro",
    };
  }
  const ativos = server.agentStates.filter(
    (st) => st.enabled && mcpAgentUtilizavel(st),
  ).length;
  if (ativos === 0) return { texto: "desligado", tom: "neutro" };
  return { texto: ativos === 1 ? "1 motor" : `${ativos} motores`, tom: "ok" };
}

function ChipDoMotor({ state }: { state: McpAgentState }) {
  const label = agentDef(state.agent)?.shortLabel ?? state.agent;
  const utilizavel = mcpAgentUtilizavel(state);
  const ligado = utilizavel && state.enabled;
  return (
    <span
      className={cn(
        // Degrau `chip` (24px) da escada de controle; só o raio vira pílula.
        controle("chip"),
        "rounded-full border",
        ligado ? "border-border text-foreground" : "text-muted-foreground",
        !utilizavel && "border-dashed opacity-60",
      )}
      title={
        utilizavel
          ? ligado
            ? `${label}: ligado`
            : `${label}: desligado`
          : `${label}: só pelo CLI`
      }
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          ligado
            ? "bg-foreground/70"
            : utilizavel
              ? "ring-1 ring-inset ring-muted-foreground/60"
              : "bg-muted-foreground/40",
        )}
      />
      {label}
    </span>
  );
}

export function McpServerRow({
  server,
  aberto,
  onToggle,
  auth,
  authBusy,
  onLogin,
  onLogout,
  browser,
  busyKeys,
  checkingKeys,
  instalandoKeys,
  onUpdate,
  onCheck,
  onInstalarNoCli,
}: {
  server: McpServer;
  aberto: boolean;
  onToggle: () => void;
  auth: McpAuthStatus | undefined;
  authBusy: boolean;
  onLogin: () => void;
  onLogout: () => void;
  browser: BrowserStatus | null;
  busyKeys: ReadonlySet<string>;
  checkingKeys: ReadonlySet<string>;
  instalandoKeys: ReadonlySet<string>;
  onUpdate: (
    server: McpServer,
    state: McpAgentState,
    patch: Partial<
      Pick<McpAgentState, "enabled" | "required" | "browser" | "browserConexao" | "fallback">
    >,
  ) => void;
  onCheck: (server: McpServer, state: McpAgentState) => void;
  onInstalarNoCli: (server: McpServer, state: McpAgentState) => void;
}) {
  const origem = server.sourceAgent
    ? (agentDef(server.sourceAgent)?.shortLabel ?? server.sourceAgent)
    : null;
  const estado = mcpEstadoCurto(server, auth, origem);
  const ofereceLogin = mcpOfereceLogin(server);
  const status = auth ?? { state: "sem-login" as const, expiresAt: null };
  const quem = ofereceLogin ? mcpQuemAutentica(server, status, origem) : null;
  const conectado = status.state === "conectado";
  // Fato estrutural que a pessoa NÃO resolve pelo app (SSE, helper, valor
  // literal). Com login do app o motivo `oauth` deixa de valer.
  const avisos = mcpPortabilityNotices(server, conectado).filter(
    (n) => !(ofereceLogin && n.kind === "native-only"),
  );
  const Chevron = aberto ? ChevronDown : ChevronRight;
  return (
    <div
      className={cn(
        "border-t border-border/40 first:border-t-0",
        !server.portable && !ofereceLogin && !conectado && "opacity-75",
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={aberto}
        className="block w-full text-left transition-colors hover:bg-accent/60"
      >
        <span className="grid grid-cols-[24px_minmax(0,1fr)_auto_20px] items-center gap-2.5 px-3 py-2.5">
          <span
            className={cn(
              controle("chip", { quadrado: true }),
              "border text-brass",
            )}
          >
            <Server className="size-3" />
          </span>
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-[13px] font-medium text-foreground">
                {server.name}
              </span>
              <span className="rounded border px-1.5 font-mono text-[11px] leading-[18px] text-muted-foreground">
                {mcpSourceLabel(server)}
              </span>
              <span className="rounded border px-1.5 font-mono text-[11px] leading-[18px] text-muted-foreground">
                {server.transport}
              </span>
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-2 text-[12px]">
              <span
                className={cn(
                  "shrink-0",
                  estado.tom === "ok" && "text-foreground",
                  estado.tom === "aviso" && "text-st-warning",
                  estado.tom === "neutro" && "text-muted-foreground",
                )}
              >
                {estado.texto}
              </span>
              <span
                className="truncate font-mono text-[11px] text-muted-foreground/70"
                title={server.locator}
              >
                {server.locator}
              </span>
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            {server.managed &&
              server.agentStates.map((st) => (
                <ChipDoMotor key={st.agent} state={st} />
              ))}
          </span>
          <Chevron className="size-3.5 text-muted-foreground/60" />
        </span>
      </button>

      {aberto && (
        <div className="grid gap-2.5 px-3 pb-3 pl-[46px]">
          {quem && (
            <div className="flex items-center gap-2.5 border-b border-border/40 pb-2.5">
              <span className="shrink-0 text-[12px] text-muted-foreground">
                Quem autentica
              </span>
              <span className="min-w-0 flex-1 text-[12px] text-foreground">
                {quem.titulo}
                <span className="block text-[11px] leading-snug text-muted-foreground">
                  {quem.detalhe}
                </span>
              </span>
              <Button
                size="compacto"
                variant={conectado ? "ghost" : "default"}
                disabled={authBusy}
                onClick={conectado ? onLogout : onLogin}
                className="shrink-0"
              >
                {authBusy && <Loader2 className="size-3.5 animate-spin" />}
                {conectado
                  ? mcpAuthActionLabel("conectado")
                  : "Entrar com o Frota"}
              </Button>
            </div>
          )}

          {avisos.map((aviso) => (
            <p
              key={aviso.kind}
              className={cn(
                "text-[11px] leading-snug",
                aviso.kind === "native-only"
                  ? "text-muted-foreground"
                  : "text-st-warning",
              )}
            >
              {aviso.text}
            </p>
          ))}
          {!server.sourceEnabled && server.managed && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              Desativado na origem; um vínculo aqui o ativa somente no turno
              gerenciado.
            </p>
          )}

          {server.managed ? (
            <McpAgentRows
              server={server}
              browser={browser}
              busyKeys={busyKeys}
              checkingKeys={checkingKeys}
              instalandoKeys={instalandoKeys}
              onUpdate={onUpdate}
              onCheck={onCheck}
              onInstalarNoCli={onInstalarNoCli}
            />
          ) : (
            <p className="text-[11px] text-muted-foreground">
              MCP interno, criado e limitado por turno pelo Frota.
            </p>
          )}

          <details className="group text-[12px] text-muted-foreground">
            <summary className="cursor-pointer list-none select-none [&::-webkit-details-marker]:hidden">
              <span className="inline-flex items-center gap-1">
                <ChevronRight className="size-3 group-open:rotate-90" />
                Detalhes técnicos
              </span>
            </summary>
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
              <dt>endereço</dt>
              <dd className="break-all font-mono text-foreground/80">
                {server.locator}
              </dd>
              {server.runtimeName && (
                <>
                  <dt>nome na sessão</dt>
                  <dd className="font-mono text-foreground/80">
                    {server.runtimeName}{" "}
                    <span className="font-sans text-muted-foreground">
                      (cite este nome no prompt)
                    </span>
                  </dd>
                </>
              )}
              {server.envKeys.length > 0 && (
                <>
                  <dt>env refs</dt>
                  <dd className="break-all font-mono text-foreground/80">
                    {server.envKeys.join(", ")}
                  </dd>
                </>
              )}
              {quem && (
                <>
                  <dt>cliente OAuth</dt>
                  <dd>
                    {server.nativeReason === "oauth"
                      ? "pré-registrado na configuração de origem"
                      : "registrado dinamicamente no login"}
                  </dd>
                  <dt>sair</dt>
                  <dd>
                    {auth?.revogavel
                      ? "revoga no servidor e apaga deste Mac"
                      : "apaga deste Mac; o servidor não oferece revogação"}
                  </dd>
                </>
              )}
            </dl>
          </details>
        </div>
      )}
    </div>
  );
}
