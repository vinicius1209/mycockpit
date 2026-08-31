import { Loader2, Package, ShieldCheck, SquareTerminal } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardBody,
  CardHead,
  Selo,
  type Tom,
} from "@/components/settings/parts"
import { PENDING_DECISION } from "@/lib/attention"
import {
  PLUGIN_CAPABILITY_DETAILS,
  PLUGIN_CAPABILITY_LABELS,
  pluginNeedsReview,
  type PluginView,
} from "@/lib/plugins"
import { resourceKindLabel } from "@/lib/resources"
import { cn } from "@/lib/utils"

export type PluginConfirmation = "review" | "revoke" | null

interface PluginStatus {
  label: string
  tone: Tom
  summary: string
  live: boolean
}

export function pluginStatus(plugin: PluginView): PluginStatus {
  if (plugin.state === "invalid") {
    return {
      label: "inválido",
      tone: "erro",
      summary: plugin.detail ?? "O pacote não passou na validação do manifesto.",
      live: false,
    }
  }
  if (plugin.runtime.state === "failed") {
    return {
      label: "falhou",
      tone: "erro",
      summary:
        plugin.runtime.lastError ?? "A última chamada do worker terminou com falha.",
      live: false,
    }
  }
  if (plugin.runtime.state === "starting") {
    return {
      label: "iniciando",
      tone: "neutro",
      summary: `Iniciando ${plugin.runtime.activeTool ?? "a chamada"} em um worker separado.`,
      live: true,
    }
  }
  if (plugin.runtime.state === "running") {
    return {
      label: "rodando",
      tone: "neutro",
      summary: `${plugin.runtime.activeTool ?? "Uma tool"} está atendendo uma chamada agora.`,
      live: true,
    }
  }
  if (plugin.runtime.state === "stopping") {
    return {
      label: "parando",
      tone: "neutro",
      summary: "A Frota solicitou o encerramento do grupo de processos desta chamada.",
      live: true,
    }
  }
  if (plugin.grant.status === "stale") {
    return {
      label: "mudou",
      tone: "atencao",
      summary:
        "Fingerprint ou capabilities mudaram. O consentimento anterior não vale para este pacote.",
      live: false,
    }
  }
  if (plugin.grant.status === "pending") {
    return {
      label: "revisar",
      tone: "atencao",
      summary: "Nada deste pacote é publicado antes da sua decisão.",
      live: false,
    }
  }
  if (plugin.grant.status === "disabled") {
    return {
      label: "desativado",
      tone: "neutro",
      summary: "O consentimento foi preservado, mas nada entra em novos runs.",
      live: false,
    }
  }
  if (
    plugin.contributes.tools === 0 &&
    plugin.contributes.skills === 0 &&
    plugin.contributes.mcpServers === 0
  ) {
    return {
      label: "revisado",
      tone: "neutro",
      summary: "Grant atual. O pacote não declara contribuições efetivas.",
      live: false,
    }
  }
  return {
    label: "ativo",
    tone: "neutro",
    summary:
      "Disponível sob demanda. Abrir Configurações não inicia worker nem navegador.",
    live: false,
  }
}

function contributionSummary(plugin: PluginView): string {
  const items = [
    plugin.contributes.skills > 0
      ? `${plugin.contributes.skills} skill${plugin.contributes.skills === 1 ? "" : "s"}`
      : null,
    plugin.contributes.mcpServers > 0
      ? `${plugin.contributes.mcpServers} MCP${plugin.contributes.mcpServers === 1 ? "" : "s"}`
      : null,
    plugin.contributes.tools > 0
      ? `${plugin.contributes.tools} tool${plugin.contributes.tools === 1 ? "" : "s"}`
      : null,
  ].filter((item): item is string => item !== null)
  return items.length > 0 ? items.join(" · ") : "sem contribuições declaradas"
}

function reviewedLabel(value: number | null): string | null {
  if (!value || !Number.isFinite(value)) return null
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value))
}

function AuditLine({ plugin }: { plugin: PluginView }) {
  const latest = plugin.audit[0]
  if (!latest) return null
  const when = reviewedLabel(latest.createdAt)
  return (
    <p className="mt-2 font-mono text-[11px] text-muted-foreground">
      último evento: {latest.event} · {latest.outcome}
      {when ? ` · ${when}` : ""}
    </p>
  )
}

export function PluginReviewCard({
  plugin,
  confirmation,
  busy,
  error,
  onConfirm,
  onCancel,
  onApprove,
  onEnable,
  onRevoke,
  onStop,
}: {
  plugin: PluginView
  confirmation: PluginConfirmation
  busy: boolean
  error: string | null
  onConfirm: (kind: Exclude<PluginConfirmation, null>) => void
  onCancel: () => void
  onApprove: () => void
  onEnable: (enabled: boolean) => void
  onRevoke: () => void
  onStop: () => void
}) {
  const status = pluginStatus(plugin)
  const needsReview = pluginNeedsReview(plugin)
  const canRevoke = plugin.grant.status !== "pending"
  const runtimeActive = ["starting", "running", "stopping"].includes(
    plugin.runtime.state,
  )
  const reviewedAt = reviewedLabel(plugin.grant.reviewedAt)
  const decisionPending = needsReview || confirmation !== null
  const hasSkills = plugin.contributes.skills > 0
  const hasMcps = plugin.contributes.mcpServers > 0
  const hasTools = plugin.contributes.tools > 0
  const hasContributions = hasSkills || hasMcps || hasTools

  return (
    <Card className={cn(decisionPending && PENDING_DECISION)}>
      <CardHead
        nome={
          <span className="flex items-center gap-2">
            <Package className="size-3.5 text-muted-foreground" />
            {plugin.name}
          </span>
        }
        meta={`${plugin.key}${plugin.version ? ` · ${plugin.version}` : ""}`}
        selo={<Selo tom={status.tone}>{status.label}</Selo>}
      />
      <CardBody>
        <div className="flex items-start gap-2.5">
          {status.live ? (
            <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
          ) : (
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-[12px] leading-snug text-muted-foreground",
                status.tone === "erro" && "text-st-error",
              )}
            >
              {status.summary}
            </p>
            <p className="mt-1 text-[12px] text-muted-foreground">
              {plugin.executable || hasMcps
                ? "pode executar código ou abrir conexão"
                : "somente conteúdo"}
              {` · ${contributionSummary(plugin)}`}
            </p>
            {plugin.state === "validated" && plugin.detail && (
              <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                {plugin.detail}
              </p>
            )}
            {plugin.fingerprint && (
              <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                fingerprint {plugin.fingerprint.slice(0, 12)}
                {reviewedAt ? ` · revisado em ${reviewedAt}` : ""}
              </p>
            )}
          </div>
        </div>

        {plugin.capabilities.length > 0 && (
          <div className="mt-3 border-t border-border/40 pt-2.5">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Acessos declarados
            </p>
            <ul className="divide-y divide-border/40">
              {plugin.capabilities.map((capability) => (
                <li
                  key={capability}
                  className="flex flex-col gap-0.5 py-1.5 first:pt-0 last:pb-0 sm:flex-row sm:gap-3"
                >
                  <span className="shrink-0 text-[12px] font-medium text-foreground sm:w-40">
                    {PLUGIN_CAPABILITY_LABELS[capability]}
                  </span>
                  <span className="text-[12px] leading-snug text-muted-foreground">
                    {PLUGIN_CAPABILITY_DETAILS[capability]}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {plugin.activeResources.length > 0 && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            Recursos em lease: {plugin.activeResources.map(resourceKindLabel).join(" · ")}
          </p>
        )}

        {confirmation === "review" && (
          <div className="mt-3 border-t border-border/40 pt-3">
            <p className="text-[13px] font-medium text-foreground">
              Confirme o pacote que você acabou de revisar
            </p>
            <div className="mt-2 space-y-1 text-[12px] leading-snug text-muted-foreground">
              <p>Descobrir este pacote e abrir esta tela não executam código.</p>
              {hasTools && (
                <p>
                  O worker nasce em processo separado somente quando uma tool for chamada e
                  termina com ela.
                </p>
              )}
              {hasSkills && (
                <p>
                  Skills aparecem com namespace do plugin e só entram no prompt quando você
                  as invoca.
                </p>
              )}
              {hasMcps && (
                <p>
                  MCPs passam por validação e health check a cada materialização. Processos
                  stdio nascem pelo launcher da Frota e terminam com o run.
                </p>
              )}
              <p>
                Isso contém falhas, mas não é um sandbox completo do sistema operacional.
                Ative apenas código local em que você confia.
              </p>
              <p>A revisão não inicia worker, MCP ou navegador por si só.</p>
            </div>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                size="compacto"
                variant="ghost"
                onClick={onCancel}
                disabled={busy}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="compacto"
                onClick={onApprove}
                disabled={busy || !plugin.fingerprint}
              >
                {busy && <Loader2 className="animate-spin" />}
                {hasContributions ? "Confirmar e ativar" : "Confirmar revisão"}
              </Button>
            </div>
          </div>
        )}

        {confirmation === "revoke" && (
          <div className="mt-3 border-t border-border/40 pt-3">
            <p className="text-[13px] font-medium text-foreground">
              Revogar o consentimento deste fingerprint?
            </p>
            <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
              Novos runs deixam de receber suas contribuições. Workers de tools ativos são
              encerrados; um MCP já materializado termina junto com o run atual.
            </p>
            <div className="mt-3 flex justify-end gap-2">
              <Button
                type="button"
                size="compacto"
                variant="ghost"
                onClick={onCancel}
                disabled={busy}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                size="compacto"
                variant="destructive"
                onClick={onRevoke}
                disabled={busy}
              >
                {busy && <Loader2 className="animate-spin" />}
                Confirmar revogação
              </Button>
            </div>
          </div>
        )}

        {confirmation === null && plugin.state === "validated" && (
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-border/40 pt-3">
            {runtimeActive && plugin.runtime.state !== "stopping" && (
              <Button
                type="button"
                size="compacto"
                variant="destructive"
                onClick={onStop}
                disabled={busy}
              >
                <SquareTerminal />
                Parar chamada
              </Button>
            )}
            {needsReview ? (
              <Button
                type="button"
                size="compacto"
                onClick={() => onConfirm("review")}
                disabled={busy || !plugin.fingerprint}
              >
                {hasContributions ? "Revisar e ativar" : "Revisar pacote"}
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  size="compacto"
                  variant={plugin.grant.enabled ? "outline" : "default"}
                  onClick={() => onEnable(!plugin.grant.enabled)}
                  disabled={busy || runtimeActive}
                >
                  {plugin.grant.enabled ? "Desativar" : "Ativar"}
                </Button>
                {canRevoke && (
                  <Button
                    type="button"
                    size="compacto"
                    variant="destructive"
                    onClick={() => onConfirm("revoke")}
                    disabled={busy}
                  >
                    Revogar permissão
                  </Button>
                )}
              </>
            )}
          </div>
        )}

        {confirmation === null && plugin.state === "invalid" && canRevoke && (
          <div className="mt-3 flex justify-end border-t border-border/40 pt-3">
            <Button
              type="button"
              size="compacto"
              variant="destructive"
              onClick={() => onConfirm("revoke")}
              disabled={busy}
            >
              Revogar permissão órfã
            </Button>
          </div>
        )}

        {error && (
          <p className="mt-2 text-[12px] leading-snug text-st-error" role="alert">
            {error}
          </p>
        )}
        <AuditLine plugin={plugin} />
      </CardBody>
    </Card>
  )
}
