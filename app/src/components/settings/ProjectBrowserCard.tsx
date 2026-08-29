// O navegador do projeto (B2.1/B2.2), extraído de McpSettings.tsx: o cartão
// precisava contar o ENCADEAMENTO ("ligado" não basta, o run só recebe o
// endpoint por binding marcado) e o arquivo de origem já estava no teto da
// catraca de tamanho. O estado vive no hook para McpSettings poder dizer, na
// linha de cada agent, o que falta do outro lado.

import { useCallback, useEffect, useRef, useState } from "react"
import { AlertTriangle, Globe, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  browserChainLine,
  browserStateLabel,
  browserStatus,
  startProjectBrowser,
  stopProjectBrowser,
  type BrowserStatus,
} from "@/lib/browser"
import { listenWorkEvents } from "@/lib/work"
import type { McpServer } from "@/lib/mcp"
import { cn } from "@/lib/utils"

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
}: {
  browser: ProjectBrowser
  servers: McpServer[]
}) {
  const { status, busy, toggle } = browser
  const chain = browserChainLine(servers, status)

  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-secondary/15 p-3">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg border border-border/60 bg-background/60">
          <Globe className="size-3.5 text-brass" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium text-foreground">
            Navegador do projeto
          </div>
          <div className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
            O app abre e mantém um Chromium com perfil próprio deste projeto.
            Ligar aqui é metade do caminho: o run só recebe este navegador nos
            MCPs marcados como "navegador" para aquele agent, abaixo.
          </div>
          <div
            className="mt-1 truncate font-mono text-[11px] text-muted-foreground/75"
            title={status?.binary ?? undefined}
          >
            {browserStateLabel(status)}
          </div>
        </div>
        <Button
          size="padrao"
          variant={status?.session ? "ghost" : "secondary"}
          onClick={() => void toggle(!status?.session)}
          disabled={busy || (!status?.session && !status?.binary)}
          className="h-7 shrink-0 px-2.5 text-[12px]"
        >
          {busy && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
          {status?.session ? "Desligar" : "Ligar"}
        </Button>
      </div>
      {chain && (
        <div
          className={cn(
            "mt-2 flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px] leading-snug",
            // Âmbar é "precisa de você"; o elo inteiro é estado assentado e
            // estado assentado é cinza (STYLEGUIDE §2: verde é marco, não
            // badge permanente).
            chain.tom === "aviso"
              ? "border border-st-warning/30 bg-st-warning/5 text-st-warning"
              : "border border-border/50 bg-background/40 text-muted-foreground",
          )}
        >
          {chain.tom === "aviso" && (
            <AlertTriangle className="mt-px size-3.5 shrink-0" />
          )}
          <span>{chain.texto}</span>
        </div>
      )}
    </div>
  )
}
