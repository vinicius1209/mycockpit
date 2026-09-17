// O navegador do projeto (B2.1/B2.2), extraído de McpSettings.tsx: o cartão
// precisava contar o ENCADEAMENTO ("ligado" não basta, o run só recebe o
// endpoint por binding marcado) e o arquivo de origem já estava no teto da
// catraca de tamanho. O estado vive no hook para McpSettings poder dizer, na
// linha de cada agent, o que falta do outro lado.

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, Eye, Globe, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardBody,
  CardHead,
  Selo,
} from "@/components/settings/parts"
import {
  browserChainLine,
  browserPilotStatus,
  browserStateLabel,
  browserStatus,
  startProjectBrowser,
  stopProjectBrowser,
  type BrowserStatus,
  type BrowserPilotStatus,
} from "@/lib/browser"
import { listenWorkEvents } from "@/lib/work"
import type { McpServer } from "@/lib/mcp"
import { cn } from "@/lib/utils"
import { useApp } from "@/store/app"

export interface ProjectBrowser {
  status: BrowserStatus | null
  busy: boolean
  toggle: (on: boolean) => Promise<void>
}

/** Estado REAL do Chromium deste projeto. Nunca otimista: o backend só reporta
 *  sessão depois do `/json/version` responder, e o evento `browser_state`
 *  (janela fechada na mão, crash) faz o painel reconsultar. */
export function useProjectBrowser(projectPath: string | null): ProjectBrowser {
  const [status, setStatus] = useState<BrowserStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const pathRef = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    pathRef.current = projectPath
    if (!projectPath) {
      setStatus(null)
      return
    }
    try {
      const found = await browserStatus(projectPath)
      if (pathRef.current === projectPath) setStatus(found)
    } catch (cause) {
      if (pathRef.current === projectPath) {
        setStatus(null)
        toast.error(cause instanceof Error ? cause.message : String(cause))
      }
    }
  }, [projectPath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined
    void listenWorkEvents((event) => {
      if (event.kind === "browser_state") void refresh()
    }).then((fn) => {
      if (cancelled) fn()
      else unlisten = fn
    })
    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [refresh])

  const toggle = useCallback(
    async (on: boolean) => {
      if (!projectPath || busy) return
      setBusy(true)
      try {
        if (on) {
          const session = await startProjectBrowser(projectPath)
          toast.success(
            `Navegador do projeto ligado · ${session.browser ?? "chromium"}`,
          )
        } else {
          await stopProjectBrowser(projectPath)
        }
        await refresh()
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setBusy(false)
      }
    },
    [busy, projectPath, refresh],
  )

  return { status, busy, toggle }
}

export function ProjectBrowserCard({
  browser,
  servers,
  onConfigureDelivery,
}: {
  browser: ProjectBrowser
  servers: McpServer[]
  onConfigureDelivery?: () => void
}) {
  const { status, busy, toggle } = browser
  const [pilot, setPilot] = useState<BrowserPilotStatus | null>(null)
  const chain = browserChainLine(servers, status)
  const stateLabel = !status
    ? "indisponível"
    : status.session
      ? "ligado"
      : status.binary
        ? "desligado"
        : "ausente"

  useEffect(() => {
    const path = status?.session?.projectPath
    if (!path) {
      setPilot(null)
      return
    }
    let disposed = false
    const refresh = () => {
      void browserPilotStatus(path)
        .then((found) => {
          if (!disposed) setPilot(found)
        })
        .catch((cause) => console.warn("Piloto do navegador indisponível:", cause))
    }
    refresh()
    const timer = window.setInterval(refresh, 3_000)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [status?.session?.projectPath])

  const browserBusy = pilot?.mode === "agent" || pilot?.mode === "plugin"

  return (
    <Card>
      <CardHead
        nome={
          <span className="flex items-center gap-2">
            <Globe className="size-3.5 text-brass" />
            Navegador do projeto
          </span>
        }
        meta={
          <span title={status?.binary ?? undefined}>
            {browserStateLabel(status)}
          </span>
        }
        selo={<Selo>{stateLabel}</Selo>}
        acao={
          <Button
            size="compacto"
            variant={status?.session ? "ghost" : "secondary"}
            onClick={() => void toggle(!status?.session)}
            disabled={
              busy ||
              browserBusy ||
              (!status?.session && !status?.binary)
            }
            title={
              browserBusy
                ? `${pilot?.label}; encerre a atividade antes de desligar`
                : undefined
            }
          >
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {status?.session ? "Desligar" : "Ligar"}
          </Button>
        }
      />
      <CardBody>
        <p className="text-[12px] leading-snug text-muted-foreground">
          A Frota mantém um Chromium isolado em segundo plano, com perfil deste
          projeto. Você observa e pilota pelo painel próprio; o run só o recebe
          por um binding MCP marcado como navegador. Se o recurso estiver
          desligado, o run para antes de abrir outra janela.
        </p>
        {status?.session && pilot && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Piloto: {pilot.label}. {pilot.mode === "idle" ? "O painel ou um run pode assumir." : "Outras superfícies permanecem em observação."}
          </p>
        )}
        {chain && (
          <div
            className={cn(
              "mt-2 flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px] leading-snug",
              // Âmbar é "precisa de você"; o elo inteiro é estado assentado e
              // estado assentado é cinza (STYLEGUIDE §2: verde é marco, não
              // badge permanente).
              chain.tom === "aviso"
                ? "border border-st-warning/30 bg-st-warning/5 text-st-warning"
                : "border border-border/40 bg-background/40 text-muted-foreground",
            )}
          >
            {chain.tom === "aviso" && (
              <AlertTriangle className="mt-px size-3.5 shrink-0" />
            )}
            <span>{chain.texto}</span>
          </div>
        )}
        {status?.session && (
          <Button
            type="button"
            size="compacto"
            variant="outline"
            className="mt-2"
            onClick={() => {
              // O navegador mora na aba principal (navegador PRD R1), não mais
              // numa janela do sistema: leva a pessoa ao projeto dele e fecha
              // Configurações para a aba aparecer.
              const app = useApp.getState()
              const projectId = status.session!.projectId
              if (app.activeProjectId !== projectId) app.setActiveProject(projectId)
              app.openBrowserTab()
              app.setSettingsOpen(false)
            }}
          >
            <Eye className="size-3.5" />
            Observar e pilotar
          </Button>
        )}
        {onConfigureDelivery && (
          <Button
            type="button"
            size="chip"
            variant="ghost"
            className="mt-2"
            onClick={onConfigureDelivery}
          >
            Configurar entrega em MCPs
          </Button>
        )}
      </CardBody>
    </Card>
  )
}
