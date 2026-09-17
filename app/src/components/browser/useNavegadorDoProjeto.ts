// O navegador do projeto visto de dentro da Frota: páginas, quadro ao vivo,
// piloto humano e entrada. Mora num hook para que a aba principal e a janela
// separada usem a MESMA lógica, cada uma com o seu contêiner (navegador PRD R1).
//
// Ciclo de vida é do screencast: montar liga o preview da página escolhida,
// desmontar para o preview e devolve o piloto. Sair da aba, portanto, pausa o
// stream sem regra extra.

import { useCallback, useEffect, useRef, useState } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
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
  type BrowserInputAction,
  type BrowserPage,
  type BrowserPilotStatus,
  type BrowserPreviewFrame,
} from "@/lib/browser"
import { anexarPaginaAoRascunho, copiarImagemDaPagina } from "./capturaDaPagina"

export interface AlvoDoNavegador {
  projectId: string
  projectPath: string
}

interface FrameNotice {
  projectId: string
  targetId: string
  revision: number
}

export interface NavegadorDoProjeto {
  pages: BrowserPage[]
  selected: BrowserPage | null
  frame: BrowserPreviewFrame | null
  pilot: BrowserPilotStatus | null
  ownsPilot: boolean
  address: string
  setAddress: (value: string) => void
  loading: boolean
  error: string | null
  refreshPages: () => void
  selectPage: (page: BrowserPage) => void
  acquire: () => void
  release: () => void
  input: (action: BrowserInputAction) => void
  /** Anexa a página visível ao rascunho da conversa ativa (R3). */
  anexarPagina: () => void
  /** Copia a página visível como imagem (R3). */
  copiarImagem: () => void
}

/** Vistas montadas por projeto e a parada adiada de cada um. Trocar de vista
 *  (aba → flutuante) desmonta uma e monta a outra no mesmo commit; parar o
 *  preview na hora e ligar logo depois corre em paralelo no backend e podia
 *  deixar a vista nova sem quadro. A parada espera um instante e desiste se
 *  outra vista do mesmo projeto já montou. */
const vistasMontadas = new Map<string, number>()
const paradasPendentes = new Map<string, ReturnType<typeof setTimeout>>()
const ESPERA_PARA_PARAR_MS = 400

function entrarNaVista(projectPath: string): void {
  const pendente = paradasPendentes.get(projectPath)
  if (pendente) {
    clearTimeout(pendente)
    paradasPendentes.delete(projectPath)
  }
  vistasMontadas.set(projectPath, (vistasMontadas.get(projectPath) ?? 0) + 1)
}

function sairDaVista(projectPath: string): void {
  const restantes = Math.max(0, (vistasMontadas.get(projectPath) ?? 1) - 1)
  vistasMontadas.set(projectPath, restantes)
  if (restantes > 0) return
  paradasPendentes.set(
    projectPath,
    setTimeout(() => {
      paradasPendentes.delete(projectPath)
      if ((vistasMontadas.get(projectPath) ?? 0) > 0) return
      void stopBrowserPreview(projectPath).catch((cause) =>
        console.warn("Falha ao encerrar preview:", cause),
      )
    }, ESPERA_PARA_PARAR_MS),
  )
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function useNavegadorDoProjeto(
  alvo: AlvoDoNavegador | null,
): NavegadorDoProjeto {
  const projectPath = alvo?.projectPath ?? null
  const projectId = alvo?.projectId ?? null
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
  const pilotTokenRef = useRef<string | null>(null)
  const pullingFrameRef = useRef(false)
  const pendingFrameRef = useRef(false)

  const refreshPilot = useCallback(async (path: string) => {
    try {
      setPilot(await browserPilotStatus(path))
    } catch (cause) {
      setError(messageOf(cause))
    }
  }, [])

  const loadPages = useCallback(
    async (path: string, preferred?: string | null) => {
      try {
        const found = await listBrowserPages(path)
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

  const pullFrame = useCallback(async (path: string) => {
    if (pullingFrameRef.current) {
      pendingFrameRef.current = true
      return
    }
    pullingFrameRef.current = true
    try {
      do {
        pendingFrameRef.current = false
        const next = await browserPreviewFrame(path, revisionRef.current || undefined)
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

  const showPage = useCallback(
    async (path: string, page: BrowserPage) => {
      setSelectedId(page.id)
      selectedRef.current = page.id
      setAddress(page.url)
      setFrame(null)
      revisionRef.current = 0
      try {
        await startBrowserPreview(path, page.id)
        await pullFrame(path)
        setError(null)
      } catch (cause) {
        setError(messageOf(cause))
      }
    },
    [pullFrame],
  )

  useEffect(() => {
    if (!projectPath || !projectId) return
    let disposed = false
    const unlisteners: UnlistenFn[] = []
    entrarNaVista(projectPath)
    setLoading(true)
    void (async () => {
      const page = await loadPages(projectPath)
      await refreshPilot(projectPath)
      if (page && !disposed) await showPage(projectPath, page)
    })().finally(() => {
      if (!disposed) setLoading(false)
    })
    void listen<FrameNotice>("browser-preview://frame", (event) => {
      if (event.payload.projectId === projectId) void pullFrame(projectPath)
    })
      .then((unlisten) => {
        if (disposed) unlisten()
        else unlisteners.push(unlisten)
      })
      .catch((cause) => console.warn("Preview sem eventos:", cause))
    const poll = window.setInterval(() => {
      if (document.hidden) return
      void refreshPilot(projectPath)
      void pullFrame(projectPath)
    }, 2_500)
    return () => {
      disposed = true
      unlisteners.forEach((unlisten) => unlisten())
      window.clearInterval(poll)
      sairDaVista(projectPath)
      const token = pilotTokenRef.current
      if (token) {
        pilotTokenRef.current = null
        void releaseBrowserPilot(projectPath, token).catch((cause) =>
          console.warn("Falha ao liberar piloto:", cause),
        )
      }
    }
  }, [projectPath, projectId, loadPages, pullFrame, refreshPilot, showPage])

  // O token humano tem TTL no backend. Enquanto esta vista é o piloto, um
  // heartbeat curto mantém a posse; sumir/crashar libera sozinho em 15 s.
  useEffect(() => {
    if (!projectPath || !pilotToken) return
    const heartbeat = window.setInterval(() => {
      void heartbeatBrowserPilot(projectPath, pilotToken)
        .then(setPilot)
        .catch((cause) => {
          setPilotToken(null)
          pilotTokenRef.current = null
          setError(messageOf(cause))
          void refreshPilot(projectPath)
        })
    }, 8_000)
    return () => window.clearInterval(heartbeat)
  }, [projectPath, pilotToken, refreshPilot])

  const selected = pages.find((page) => page.id === selectedId) ?? null

  return {
    pages,
    selected,
    frame,
    pilot,
    ownsPilot: pilot?.mode === "human" && Boolean(pilotToken),
    address,
    setAddress,
    loading,
    error,
    refreshPages: () => {
      if (projectPath) void loadPages(projectPath, selectedId)
    },
    selectPage: (page) => {
      if (projectPath) void showPage(projectPath, page)
    },
    acquire: () => {
      if (!projectPath) return
      void acquireBrowserPilot(projectPath)
        .then((grant) => {
          setPilotToken(grant.token)
          pilotTokenRef.current = grant.token
          setPilot(grant.status)
          setError(null)
        })
        .catch((cause) => {
          setError(messageOf(cause))
          void refreshPilot(projectPath)
        })
    },
    release: () => {
      if (!projectPath || !pilotToken) return
      void releaseBrowserPilot(projectPath, pilotToken)
        .then((status) => {
          setPilot(status)
          setPilotToken(null)
          pilotTokenRef.current = null
        })
        .catch((cause) => setError(messageOf(cause)))
    },
    anexarPagina: () => {
      if (projectPath && selected) void anexarPaginaAoRascunho(projectPath, selected.id)
    },
    copiarImagem: () => {
      if (projectPath && selected) void copiarImagemDaPagina(projectPath, selected.id)
    },
    input: (action) => {
      if (!projectPath || !selected || !pilotToken) return
      void sendBrowserInput(projectPath, selected.id, pilotToken, action)
        .then(() => setError(null))
        .catch((cause) => {
          setError(messageOf(cause))
          void refreshPilot(projectPath)
        })
    },
  }
}
