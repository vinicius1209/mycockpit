import { useCallback, useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import {
  ArrowLeft,
  ArrowRight,
  Eye,
  Globe,
  Loader2,
  MousePointer2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  acquireBrowserPilot,
  browserPilotStatus,
  browserPreviewFrame,
  heartbeatBrowserPilot,
  listBrowserPages,
  releaseBrowserPilot,
  sendBrowserInput,
  startBrowserPreview,
  stopBrowserPreview,
  type BrowserPage,
  type BrowserPilotStatus,
  type BrowserPreviewFrame,
} from "@/lib/browser"
import { cn } from "@/lib/utils"

interface PanelContext {
  projectId: string
  projectPath: string
}

interface FrameNotice {
  projectId: string
  targetId: string
  revision: number
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function pageLabel(page: BrowserPage): string {
  return page.title.trim() || page.displayUrl || "Página sem título"
}

export function BrowserPanel() {
  const [context, setContext] = useState<PanelContext | null>(null)
  const [pages, setPages] = useState<BrowserPage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [frame, setFrame] = useState<BrowserPreviewFrame | null>(null)
  const [pilot, setPilot] = useState<BrowserPilotStatus | null>(null)
  const [pilotToken, setPilotToken] = useState<string | null>(null)
  const [address, setAddress] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const revisionRef = useRef(0)
  const selectedRef = useRef<string | null>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const pilotTokenRef = useRef<string | null>(null)
  const pullingFrameRef = useRef(false)
  const pendingFrameRef = useRef(false)

  const refreshPilot = useCallback(async (projectPath: string) => {
    try {
      setPilot(await browserPilotStatus(projectPath))
    } catch (cause) {
      setError(messageOf(cause))
    }
  }, [])

  const refreshPages = useCallback(
    async (projectPath: string, preferred?: string | null) => {
      try {
        const found = await listBrowserPages(projectPath)
        setPages(found)
        const next =
          found.find((page) => page.id === (preferred ?? selectedRef.current)) ??
          found[0] ??
          null
        setSelectedId(next?.id ?? null)
        selectedRef.current = next?.id ?? null
        if (next) setAddress(next.url)
        setError(null)
        return next
      } catch (cause) {
        setError(messageOf(cause))
        return null
      }
    },
    [],
  )

  const pullFrame = useCallback(async (projectPath: string) => {
    if (pullingFrameRef.current) {
      pendingFrameRef.current = true
      return
    }
    pullingFrameRef.current = true
    try {
      do {
        pendingFrameRef.current = false
        const next = await browserPreviewFrame(
          projectPath,
          revisionRef.current || undefined,
        )
        if (next) {
          revisionRef.current = next.revision
          setFrame(next)
        }
      } while (pendingFrameRef.current)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      pullingFrameRef.current = false
    }
  }, [])

  const selectPage = useCallback(
    async (projectPath: string, page: BrowserPage) => {
      setSelectedId(page.id)
      selectedRef.current = page.id
      setAddress(page.url)
      setFrame(null)
      revisionRef.current = 0
      try {
        await startBrowserPreview(projectPath, page.id)
        await pullFrame(projectPath)
        setError(null)
      } catch (cause) {
        setError(messageOf(cause))
      }
    },
    [pullFrame],
  )

  useEffect(() => {
    let disposed = false
    const unlisteners: UnlistenFn[] = []
    let projectPath = ""
    let projectId = ""
    void invoke<PanelContext>("browser_panel_context")
      .then(async (found) => {
        if (disposed) return
        projectPath = found.projectPath
        projectId = found.projectId
        setContext(found)
        const page = await refreshPages(found.projectPath)
        await refreshPilot(found.projectPath)
        if (page && !disposed) await selectPage(found.projectPath, page)
      })
      .catch((cause) => {
        if (!disposed) setError(messageOf(cause))
      })
      .finally(() => {
        if (!disposed) setLoading(false)
      })
    void listen<FrameNotice>("browser-preview://frame", (event) => {
      if (event.payload.projectId === projectId) {
        if (projectPath) void pullFrame(projectPath)
      }
    })
      .then((unlisten) => {
        if (disposed) unlisten()
        else unlisteners.push(unlisten)
      })
      .catch((cause) => console.warn("Preview sem eventos:", cause))
    const poll = window.setInterval(() => {
      if (!projectPath || document.hidden) return
      void refreshPilot(projectPath)
      void pullFrame(projectPath)
    }, 2_500)
    return () => {
      disposed = true
      unlisteners.forEach((unlisten) => unlisten())
      window.clearInterval(poll)
      if (projectPath) {
        void stopBrowserPreview(projectPath).catch((cause) =>
          console.warn("Falha ao encerrar preview:", cause),
        )
        if (pilotTokenRef.current) {
          void releaseBrowserPilot(projectPath, pilotTokenRef.current).catch(
            (cause) => console.warn("Falha ao liberar piloto:", cause),
          )
        }
      }
    }
  }, [pullFrame, refreshPages, refreshPilot, selectPage])

  // O token humano tem TTL no backend. Enquanto este painel é o piloto, um
  // heartbeat curto mantém a posse; sumir/crashar libera sozinho em 15 s.
  useEffect(() => {
    if (!context || !pilotToken) return
    const heartbeat = window.setInterval(() => {
      void heartbeatBrowserPilot(context.projectPath, pilotToken)
        .then(setPilot)
        .catch((cause) => {
          setPilotToken(null)
          pilotTokenRef.current = null
          setError(messageOf(cause))
          void refreshPilot(context.projectPath)
        })
    }, 8_000)
    return () => window.clearInterval(heartbeat)
  }, [context, pilotToken, refreshPilot])

  const selected = pages.find((page) => page.id === selectedId) ?? null
  const ownsPilot = pilot?.mode === "human" && Boolean(pilotToken)

  const acquire = async () => {
    if (!context) return
    try {
      const grant = await acquireBrowserPilot(context.projectPath)
      setPilotToken(grant.token)
      pilotTokenRef.current = grant.token
      setPilot(grant.status)
      setError(null)
    } catch (cause) {
      setError(messageOf(cause))
      await refreshPilot(context.projectPath)
    }
  }

  const release = async () => {
    if (!context || !pilotToken) return
    try {
      setPilot(await releaseBrowserPilot(context.projectPath, pilotToken))
      setPilotToken(null)
      pilotTokenRef.current = null
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  const input = async (
    action: Parameters<typeof sendBrowserInput>[3],
  ): Promise<void> => {
    if (!context || !selected || !pilotToken) return
    try {
      await sendBrowserInput(
        context.projectPath,
        selected.id,
        pilotToken,
        action,
      )
      setError(null)
    } catch (cause) {
      setError(messageOf(cause))
      await refreshPilot(context.projectPath)
    }
  }

  const framePoint = (clientX: number, clientY: number) => {
    const image = imageRef.current
    if (!image) return null
    const rect = image.getBoundingClientRect()
    const width = frame?.width ?? image.naturalWidth
    const height = frame?.height ?? image.naturalHeight
    if (!rect.width || !rect.height || !width || !height) return null
    return {
      x: ((clientX - rect.left) / rect.width) * width,
      y: ((clientY - rect.top) / rect.height) * height,
    }
  }

  if (loading) {
    return (
      <main className="grid h-screen place-items-center bg-background text-foreground">
        <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Preparando o painel
        </span>
      </main>
    )
  }

  return (
    <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
      <header
        data-tauri-drag-region
        className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4"
      >
        <span className="grid size-8 place-items-center rounded-lg border border-border bg-card">
          <Globe className="size-4 text-muted-foreground" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-[14px] font-semibold">
            Navegador do projeto
          </h1>
          <p className="truncate text-[11px] text-muted-foreground">
            {context?.projectPath ?? "Projeto indisponível"}
          </p>
        </div>
        <span className="ml-auto flex items-center gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground">
          {pilot?.mode === "human" ? (
            <MousePointer2 className="size-3 text-st-running" />
          ) : (
            <Eye className="size-3" />
          )}
          {pilot?.label ?? "Consultando piloto"}
        </span>
        {ownsPilot ? (
          <Button size="compacto" variant="outline" onClick={() => void release()}>
            Liberar controle
          </Button>
        ) : (
          <Button
            size="compacto"
            onClick={() => void acquire()}
            disabled={!pilot?.canTakeOver}
          >
            <ShieldCheck className="size-3.5" />
            Assumir controle
          </Button>
        )}
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card/35">
          <div className="flex h-11 items-center justify-between border-b border-border/40 px-3">
            <span className="label-mono">Páginas abertas</span>
            <Button
              size="icone-compacto"
              variant="ghost"
              aria-label="Atualizar páginas"
              title="Atualizar páginas"
              onClick={() => {
                if (context) void refreshPages(context.projectPath, selectedId)
              }}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
          <nav aria-label="Páginas do navegador" className="min-h-0 flex-1 overflow-y-auto p-2">
            {pages.length ? (
              pages.map((page) => (
                <button
                  key={page.id}
                  type="button"
                  onClick={() => {
                    if (context) void selectPage(context.projectPath, page)
                  }}
                  className={cn(
                    "mb-1 block w-full rounded-lg px-2.5 py-2 text-left focus-visible:outline-2 focus-visible:outline-ring",
                    page.id === selectedId
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:bg-accent/60 hover:text-foreground",
                  )}
                >
                  <span className="block truncate text-[12px] font-medium">
                    {pageLabel(page)}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-[11px] opacity-70">
                    {page.displayUrl}
                  </span>
                </button>
              ))
            ) : (
              <p className="px-2 py-4 text-[12px] leading-snug text-muted-foreground">
                Nenhuma página observável está aberta.
              </p>
            )}
          </nav>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          <form
            className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border/40 px-3"
            onSubmit={(event) => {
              event.preventDefault()
              void input({ kind: "navigate", url: address })
            }}
          >
            <Button
              type="button"
              size="icone-compacto"
              variant="ghost"
              disabled={!ownsPilot}
              aria-label="Voltar"
              onClick={() => void input({ kind: "history", direction: "back" })}
            >
              <ArrowLeft className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icone-compacto"
              variant="ghost"
              disabled={!ownsPilot}
              aria-label="Avançar"
              onClick={() => void input({ kind: "history", direction: "forward" })}
            >
              <ArrowRight className="size-3.5" />
            </Button>
            <Input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              disabled={!ownsPilot || !selected}
              aria-label="Endereço da página"
              className="h-8 font-mono text-[12px]"
            />
            <Button type="submit" size="compacto" disabled={!ownsPilot || !selected}>
              Ir
            </Button>
          </form>

          <div className="relative min-h-0 flex-1 overflow-auto bg-card/30 p-4">
            {frame ? (
              <button
                type="button"
                disabled={!ownsPilot}
                aria-label={
                  ownsPilot
                    ? "Visualização da página, clique para interagir"
                    : "Visualização da página em modo observação"
                }
                className="mx-auto block max-h-full max-w-full overflow-hidden rounded-lg border border-border bg-background shadow-[var(--shadow-sm)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-default"
                onClick={(event) => {
                  const point = framePoint(event.clientX, event.clientY)
                  if (point) void input({ kind: "click", ...point })
                }}
                onWheel={(event) => {
                  if (!ownsPilot) return
                  const point = framePoint(event.clientX, event.clientY)
                  if (point) {
                    event.preventDefault()
                    void input({
                      kind: "scroll",
                      ...point,
                      deltaX: event.deltaX,
                      deltaY: event.deltaY,
                    })
                  }
                }}
                onKeyDown={(event) => {
                  if (!ownsPilot || event.metaKey || event.ctrlKey || event.altKey) return
                  event.preventDefault()
                  if (event.key.length === 1) {
                    void input({ kind: "text", text: event.key })
                  } else {
                    void input({ kind: "key", key: event.key, code: event.code })
                  }
                }}
              >
                <img
                  ref={imageRef}
                  src={`data:image/jpeg;base64,${frame.data}`}
                  alt="Página observada no Navegador do projeto"
                  draggable={false}
                  className="block max-h-[calc(100vh-9rem)] max-w-full object-contain"
                />
              </button>
            ) : (
              <div className="grid h-full min-h-48 place-items-center text-center">
                <div>
                  <Eye className="mx-auto size-5 text-muted-foreground" />
                  <p className="mt-2 text-[13px] font-medium">
                    {selected ? "Aguardando o primeiro frame" : "Escolha uma página"}
                  </p>
                  <p className="mt-1 text-[12px] text-muted-foreground">
                    O preview fica dentro da Frota e não cria outro navegador.
                  </p>
                </div>
              </div>
            )}
            {!ownsPilot && frame && (
              <div className="pointer-events-none absolute right-6 bottom-6 rounded-md border border-border bg-popover px-2.5 py-1.5 text-[11px] text-muted-foreground shadow-[var(--shadow-sm)]">
                Observando, {pilot?.label.toLowerCase() ?? "sem piloto"}
              </div>
            )}
          </div>

          {error && (
            <div role="alert" className="shrink-0 border-t border-st-error/30 bg-st-error/5 px-4 py-2 text-[12px] text-st-error">
              {error}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
