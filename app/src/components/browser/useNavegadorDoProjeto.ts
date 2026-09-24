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
import { listenWorkEvents, type WorkEvent } from "@/lib/work"
import {
  anexarPaginaAoRascunho,
  copiarImagemDaPagina,
  marcarRegiaoNoRascunho,
  type RegiaoNoQuadro,
} from "./capturaDaPagina"

export interface AlvoDoNavegador {
  projectId: string
  projectPath: string
  /** A conversa cuja vista é esta: só as páginas dela (ADR-244). Sem, todas
   *  as do projeto (a janela avulsa). */
  conversa?: string | null
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
  /** Dá à conversa uma página (adota uma sem dono ou abre outra). Só existe
   *  numa vista de conversa, e só por gesto: olhar não abre página (ADR-244). */
  abrirPagina: (() => void) | null
  selectPage: (page: BrowserPage) => void
  acquire: () => void
  release: () => void
  input: (action: BrowserInputAction) => void
  /** Anexa a página visível ao rascunho da conversa ativa (R3). */
  anexarPagina: () => void
  /** Copia a página visível como imagem (R3). */
  copiarImagem: () => void
  /** Marca uma região do quadro e manda ao rascunho (R4, B3). */
  marcar: (regiao: RegiaoNoQuadro) => Promise<boolean>
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

/** A aba do agente que a vista deve passar a mostrar, ou `null`. Puro. */
export function abaParaSeguir(
  event: WorkEvent,
  projectPath: string,
  selecionada: string | null,
  pessoaPilotando: boolean,
  conversa: string | null = null,
): string | null {
  if (event.kind !== "browser_agent_active" || event.data.projectPath !== projectPath) return null
  // A vista de uma conversa não segue o agente de outra (ADR-244).
  if (conversa && event.data.convId && event.data.convId !== conversa) return null
  const alvo = event.data.targetId
  if (!alvo || alvo === selecionada || pessoaPilotando) return null
  return alvo
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export function useNavegadorDoProjeto(
  alvo: AlvoDoNavegador | null,
): NavegadorDoProjeto {
  const projectPath = alvo?.projectPath ?? null
  const projectId = alvo?.projectId ?? null
  const conversa = alvo?.conversa ?? null
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
    async (path: string, preferred?: string | null, abrir = false) => {
      try {
        const found = await listBrowserPages(path, conversa, abrir)
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
    [conversa],
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
        await startBrowserPreview(path, page.id, conversa)
        await pullFrame(path)
        setError(null)
      } catch (cause) {
        setError(messageOf(cause))
      }
    },
    [pullFrame, conversa],
  )

  useEffect(() => {
    if (!projectPath || !projectId) return
    let disposed = false
    const unlisteners: UnlistenFn[] = []
    entrarNaVista(projectPath)
    // Outra conversa (ADR-244): nada da vista anterior fica. Sem isto, quadro,
    // seleção e polling seguiam na página da conversa de antes.
    setPages([])
    setSelectedId(null)
    selectedRef.current = null
    setFrame(null)
    revisionRef.current = 0
    setLoading(true)
    void (async () => {
      const page = await loadPages(projectPath)
      await refreshPilot(projectPath)
      if (disposed) return
      if (page) await showPage(projectPath, page)
      // Conversa sem página: o screencast da página de outra não segue aberto.
      else
        void stopBrowserPreview(projectPath).catch((cause) =>
          console.warn("Falha ao encerrar preview:", cause),
        )
    })().finally(() => {
      if (!disposed) setLoading(false)
    })
    void listen<FrameNotice>("browser-preview://frame", (event) => {
      if (event.payload.projectId === projectId && selectedRef.current) void pullFrame(projectPath)
    })
      .then((unlisten) => {
        if (disposed) unlisten()
        else unlisteners.push(unlisten)
      })
      .catch((cause) => console.warn("Preview sem eventos:", cause))
    // A vista segue a aba em que o agente está (ADR-231): antes ela ficava na
    // aba escolhida ao montar, e um link que abria aba nova deixava a pessoa
    // olhando uma página enquanto o agente trabalhava em outra. Com a pessoa
    // pilotando, a aba é dela e nada muda.
    void listenWorkEvents((event) => {
      const alvoDoAgente = abaParaSeguir(event, projectPath, selectedRef.current, !!pilotTokenRef.current, conversa)
      if (!alvoDoAgente) return
      void loadPages(projectPath, alvoDoAgente).then((page) => {
        if (!disposed && page?.id === alvoDoAgente) void showPage(projectPath, page)
      })
    })
      .then((unlisten) => {
        if (disposed) unlisten()
        else unlisteners.push(unlisten)
      })
      .catch((cause) => console.warn("Vista sem a aba do agente:", cause))
    const poll = window.setInterval(() => {
      if (document.hidden) return
      void refreshPilot(projectPath)
      if (selectedRef.current) void pullFrame(projectPath)
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
  }, [projectPath, projectId, conversa, loadPages, pullFrame, refreshPilot, showPage])

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
    abrirPagina:
      projectPath && conversa
        ? () => {
            void loadPages(projectPath, null, true).then((page) => {
              if (page) void showPage(projectPath, page)
            })
          }
        : null,
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
    marcar: async (regiao) => {
      if (!projectPath || !selected) return false
      return marcarRegiaoNoRascunho(projectPath, selected.id, regiao)
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
