// Configurações do MEDIDOR DE JANELA DE USO (rate limits por provider) —
// bloco da seção "Uso e custo" (mudou de casa: "quanto da janela queimei" é a
// mesma pergunta de "quanto gastei", não um detalhe das CLIs instaladas, e o
// bloco de custo em US$ mora ao lado). A instalação da statusline é GESTO do
// usuário (nunca no boot), com transparência total: mostra O QUE será escrito
// no settings.json dele, qual comando será encadeado (o slot pode estar
// ocupado, ex. wrapper do Xirp — preservamos, nunca substituímos), backup
// automático e desinstalação que restaura como estava. Motor de fonte "rpc"
// não instala nada (probe read-only local) e o bloco diz isso. Motor sem
// capability nem aparece (usageWindowAgents).

import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Check, ChevronDown, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { RichSelect } from "@/components/ui/RichSelect"
import { Switch } from "@/components/ui/switch"
import { BlockTitle, Row } from "@/components/settings/parts"
import { type AgentDef } from "@/lib/agents"
import { usageWindowAgents } from "@/lib/agentRoster"
import { isTauri } from "@/lib/db"
import { USAGE_POLL_CHOICES } from "@/lib/usageWindow"
import { useApp } from "@/store/app"
import { cn } from "@/lib/utils"

/** Espelho de statusline_install::StatuslineStatus (serde camelCase). */
interface StatuslineStatus {
  installed: boolean
  settingsPath: string
  scriptPath: string
  currentCommand: string | null
  chainedCommand: string | null
  preview: string
  /** Estado inconsistente (script sumido com o slot ainda nosso etc.): a
   *  linha mostra o motivo; ativar/desativar aborta com ele (fail-closed). */
  warning: string | null
}

function StatuslineRow({ def }: { def: AgentDef }) {
  const [status, setStatus] = useState<StatuslineStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  async function refresh() {
    try {
      setStatus(
        await invoke<StatuslineStatus>("usage_statusline_status", {
          agent: def.id,
        }),
      )
      setError(null)
    } catch (e) {
      // erro visível (settings.json que não parseia, HOME ausente…): a linha
      // mostra o motivo em vez de sumir com o botão.
      setError(typeof e === "string" ? e : String(e))
    }
  }
  useEffect(() => {
    if (isTauri()) void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function act(cmd: "usage_statusline_install" | "usage_statusline_uninstall") {
    setBusy(true)
    try {
      setStatus(await invoke<StatuslineStatus>(cmd, { agent: def.id }))
      setError(null)
      toast.success(
        cmd === "usage_statusline_install"
          ? `Medidor ativado. O ${def.label} passa a reportar a janela a cada turno.`
          : "Medidor desativado, statusline restaurada como estava.",
      )
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha na operação")
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-lg border bg-secondary/20 px-3 py-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-foreground">
            {def.label}{" "}
            <span className="text-muted-foreground">· via statusline</span>
          </div>
          <div className="truncate text-[12px] text-muted-foreground">
            {error
              ? error
              : status == null
                ? "verificando…"
                : status.installed
                  ? status.chainedCommand
                    ? "ativo, encadeando a sua statusline atual"
                    : status.warning
                      ? "ativo, em estado inconsistente"
                      : "ativo (não havia statusline antes)"
                  : status.currentCommand
                    ? "inativo · sua statusline atual será preservada e encadeada"
                    : "inativo · você não tem statusline configurada"}
          </div>
          {status?.warning && (
            <div className="text-[11px] text-st-error" title={status.warning}>
              {status.warning}
            </div>
          )}
        </div>
        {status?.installed && (
          <Check className="size-4 shrink-0 text-st-success" aria-hidden />
        )}
        {status && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() =>
                void act(
                  status.installed
                    ? "usage_statusline_uninstall"
                    : "usage_statusline_install",
                )
              }
              disabled={busy}
              className={cn(
                "flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium transition-opacity hover:opacity-90 disabled:opacity-40",
                status.installed
                  ? "bg-background/60 text-muted-foreground hover:text-foreground"
                  : "bg-brass text-background",
              )}
            >
              {busy && <Loader2 className="size-3 animate-spin" />}
              {status.installed ? "Desativar" : "Ativar medidor"}
            </button>
          </div>
        )}
      </div>
      {status && (
        <div className="mt-1.5">
          <button
            onClick={() => setShowPreview((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown
              className={cn("size-3 transition-transform", showPreview && "rotate-180")}
            />
            {status.installed
              ? "ver o que está escrito no seu settings.json"
              : "ver o que será escrito no seu settings.json"}
          </button>
          {showPreview && (
            <div className="mt-1.5 flex flex-col gap-1.5">
              <p className="text-[11px] text-muted-foreground">
                Em <span className="font-mono">{status.settingsPath}</span>, a
                chave <span className="font-mono">statusLine</span> fica assim
                (backup automático em .bak-mycockpit, reversível no botão
                Desativar):
              </p>
              <pre className="overflow-x-auto rounded bg-background/60 px-2 py-1.5 font-mono text-[11px] leading-snug text-muted-foreground">
                {status.preview}
              </pre>
              {status.chainedCommand && (
                <p className="text-[11px] text-muted-foreground">
                  O script encadeia (preserva) a statusline que ocupa o slot:{" "}
                  <span className="font-mono break-all">
                    {status.chainedCommand}
                  </span>
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

export function UsageMeterSettings() {
  const enabled = useApp((s) => s.settings.usageMeterEnabled)
  const cadencia = useApp((s) => s.settings.usagePollMinutes)
  const setSettings = useApp((s) => s.setSettings)
  const providers = usageWindowAgents()
  // nenhum motor com fonte (build sem claude/codex integrados): o bloco some
  // inteiro, toggle incluído (1ª camada de esconder do Orca).
  if (providers.length === 0) return null

  return (
    <div>
      <BlockTitle hint="Quanto da janela do seu plano já foi usada (percentual e reset), por provider, na barra superior. Não é custo em US$: é medição de carona, nenhuma quota é consumida.">
        Janela do plano
      </BlockTitle>
      {/* `Row` de settings/parts, não cartão à mão: é o mesmo gesto das linhas
          de provider logo abaixo, e a guarda de superfícies existe pra impedir
          que a mesma coisa ganhe dois desenhos no mesmo arquivo. */}
      <ul className="mb-2 flex flex-col gap-1.5">
        <Row
          titulo="Mostrar na barra"
          dica="Desligar esconde a pill e pausa as medições."
          direita={
            <Switch
              checked={enabled}
              onCheckedChange={(v) => setSettings({ usageMeterEnabled: v })}
              aria-label="Mostrar o medidor de janela de uso na barra"
            />
          }
        />
        {/* A cadência só existe quando há o que medir: com o medidor desligado
            o poll está pausado, e oferecer "de quanto em quanto tempo" ali
            seria um controle que não faz nada. */}
        {enabled && (
          <Row
            titulo="Reler a cada"
            dica="Vale para a leitura automática. O botão Atualizar do medidor continua imediato, e uma falha do provider segue esperando o tempo dela."
            direita={
              <RichSelect
                value={String(cadencia)}
                onValueChange={(v) => setSettings({ usagePollMinutes: Number(v) })}
                options={USAGE_POLL_CHOICES.map((min) => ({
                  value: String(min),
                  label: `${min} min`,
                }))}
                align="end"
                triggerClassName="w-24"
                aria-label="Intervalo da leitura automática da janela de uso"
              />
            }
          />
        )}
      </ul>
      <ul className="flex flex-col gap-1.5">
        {providers.map((def) =>
          def.usageWindow === "statusline" ? (
            <StatuslineRow key={def.id} def={def} />
          ) : (
            <li
              key={def.id}
              className="rounded-lg border bg-secondary/20 px-3 py-2"
            >
              <div className="truncate text-[13px] text-foreground">
                {def.label}{" "}
                <span className="text-muted-foreground">
                  · leitura local automática
                </span>
              </div>
              <div className="text-[12px] text-muted-foreground">
                Consulta read-only ao próprio CLI a cada 15 min, nada é
                instalado nem configurado.
              </div>
            </li>
          ),
        )}
      </ul>
    </div>
  )
}
