// Configurações dos HOOKS DE STATUS (hooks-plan H1) — bloco da seção "CLIs
// instaladas". A instalação é GESTO do usuário (nunca no boot), com
// transparência total: mostra O QUE será escrito no config de hooks de cada
// CLI (as entradas entram AO LADO das existentes, nunca substituem), backup
// automático e desinstalação que remove só o que é nosso. Motor sem a
// capability nem aparece (hooksAgents — decisão por registry, nunca por nome).

import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Check, ChevronDown, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Switch } from "@/components/ui/switch"
import { hooksAgents, type AgentDef } from "@/lib/agents"
import { isTauri } from "@/lib/db"
import { cn } from "@/lib/utils"

/** Espelho de hooks_install::HooksStatus (serde camelCase). */
interface HooksStatus {
  installed: boolean
  /** As entradas de PERMISSÃO (H2) também estão instaladas? */
  permissionInstalled: boolean
  configPath: string
  scriptPath: string
  preview: string
  /** Fragmento ADICIONAL escrito quando a permissão está ligada. */
  previewPermission: string
  events: string[]
  /** Estado inconsistente (entradas presentes com script sumido etc.). */
  warning: string | null
  dialect: string
}

function HooksRow({ def }: { def: AgentDef }) {
  const [status, setStatus] = useState<HooksStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  // O que a PRÓXIMA instalação inclui (antes de instalar); depois de
  // instalado, a verdade é status.permissionInstalled.
  const [wantPermission, setWantPermission] = useState(false)

  async function refresh() {
    try {
      const s = await invoke<HooksStatus>("hooks_status", { agent: def.id })
      setStatus(s)
      setWantPermission(s.permissionInstalled)
      setError(null)
    } catch (e) {
      // erro visível (config que não parseia, HOME ausente…): a linha mostra
      // o motivo em vez de sumir com o botão.
      setError(typeof e === "string" ? e : String(e))
    }
  }
  useEffect(() => {
    if (isTauri()) void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function act(cmd: "hooks_install" | "hooks_uninstall", permission?: boolean) {
    setBusy(true)
    try {
      const s = await invoke<HooksStatus>(
        cmd,
        cmd === "hooks_install"
          ? { agent: def.id, permission: permission ?? wantPermission }
          : { agent: def.id },
      )
      setStatus(s)
      setWantPermission(s.permissionInstalled)
      setError(null)
      toast.success(
        cmd === "hooks_install"
          ? `Hooks ativados. Sessões do ${def.label} abertas no terminal passam a aparecer no Painel e no tray.`
          : "Hooks desativados, as entradas do MyCockpit foram removidas do config.",
      )
    } catch (e) {
      toast.error(typeof e === "string" ? e : "Falha na operação")
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="rounded-lg border border-border/50 bg-secondary/20 px-3 py-2">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] text-foreground">
            {def.label}{" "}
            <span className="text-muted-foreground">· hooks de status</span>
          </div>
          <div className="truncate text-[12px] text-muted-foreground">
            {error
              ? error
              : status == null
                ? "verificando…"
                : status.installed
                  ? status.warning
                    ? "ativo, em estado inconsistente"
                    : `ativo (${status.events.length} eventos de ciclo de vida)`
                  : "inativo · suas entradas de hook atuais serão preservadas"}
          </div>
          {status?.warning && (
            <div className="text-[11px] text-st-error" title={status.warning}>
              {status.warning}
            </div>
          )}
        </div>
        {status?.installed && !status.warning && (
          <Check className="size-4 shrink-0 text-st-success" aria-hidden />
        )}
        {status && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() =>
                void act(status.installed ? "hooks_uninstall" : "hooks_install")
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
              {status.installed
                ? status.warning
                  ? "Reparar (desinstalar)"
                  : "Desativar"
                : "Ativar hooks"}
            </button>
          </div>
        )}
      </div>
      {/* H2 — permissões respondíveis: opt-in SEPARADO (o hook é síncrono e
          segura o prompt por até 30s; ligar é uma decisão, não um default).
          Aprovação continua sendo gesto humano: aqui você ganha o controle
          FINO de decidir do app/celular, nunca um pulo de permissão. */}
      {def.hooksPermission && status && (
        <div className="mt-1.5 flex items-center justify-between gap-3 rounded-md border border-border/40 bg-background/40 px-2.5 py-1.5">
          <div className="min-w-0">
            <div className="text-[12px] text-foreground">
              Responder permissões pelo app
            </div>
            <div className="text-[11px] text-muted-foreground">
              O pedido aparece aqui e no Companion por até 30s; sem resposta,
              o prompt normal aparece no terminal.
            </div>
          </div>
          <Switch
            checked={status.installed ? status.permissionInstalled : wantPermission}
            disabled={busy}
            onCheckedChange={(v) => {
              if (status.installed) {
                // reinstala com/sem as entradas de permissão (idempotente).
                void act("hooks_install", v)
              } else {
                setWantPermission(v)
              }
            }}
            aria-label={`Responder permissões do ${def.label} pelo app`}
          />
        </div>
      )}
      {status && (
        <div className="mt-1.5">
          <button
            onClick={() => setShowPreview((v) => !v)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                "size-3 transition-transform",
                showPreview && "rotate-180",
              )}
            />
            {status.installed
              ? "ver o que está escrito no seu config de hooks"
              : "ver o que será escrito no seu config de hooks"}
          </button>
          {showPreview && (
            <div className="mt-1.5 flex flex-col gap-1.5">
              <p className="text-[11px] text-muted-foreground">
                Em <span className="font-mono">{status.configPath}</span>, as
                entradas abaixo entram AO LADO das suas (backup automático em
                .bak-mycockpit, reversível no botão Desativar):
              </p>
              <pre className="max-h-48 overflow-auto rounded bg-background/60 px-2 py-1.5 font-mono text-[11px] leading-snug text-muted-foreground">
                {status.preview}
              </pre>
              {(status.installed
                ? status.permissionInstalled
                : wantPermission) && (
                <>
                  <p className="text-[11px] text-muted-foreground">
                    Com "responder permissões" ligado, entra também:
                  </p>
                  <pre className="max-h-32 overflow-auto rounded bg-background/60 px-2 py-1.5 font-mono text-[11px] leading-snug text-muted-foreground">
                    {status.previewPermission}
                  </pre>
                </>
              )}
              {status.dialect === "codex-hooks-json" && (
                <p className="text-[11px] text-muted-foreground">
                  O Codex confirma hooks novos na próxima sessão (trust por
                  hook, mecanismo dele). Aceite uma vez; reinstalações não
                  pedem de novo.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  )
}

export function HooksSettings() {
  const providers = hooksAgents()
  // nenhum motor com hooks (build sem os três integrados): o bloco some
  // inteiro (degradação honesta).
  if (providers.length === 0) return null

  return (
    <div className="mt-6">
      <h3 className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground/70 uppercase">
        Sessões no terminal (hooks)
      </h3>
      <p className="mb-2 text-[12px] leading-snug text-muted-foreground">
        Sessões abertas direto no terminal aparecem no Painel e no tray com
        status honesto (trabalhando, esperando você, ociosa). O app só
        observa: nada é enviado às sessões e nada fica salvo entre reinícios.
        Fail-open: com o app fechado, o hook falha em silêncio em menos de 1s
        e a CLI segue normal.
      </p>
      <ul className="flex flex-col gap-1.5">
        {providers.map((def) => (
          <HooksRow key={def.id} def={def} />
        ))}
      </ul>
    </div>
  )
}
