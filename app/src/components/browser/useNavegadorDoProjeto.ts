// O navegador do projeto visto de dentro da Frota: páginas, quadro ao vivo,
// piloto humano e entrada. Mora num hook para que a aba principal e a janela
// separada usem a MESMA lógica, cada uma com o seu contêiner (navegador PRD R1).
//
// Ciclo de vida é do screencast: montar liga o preview da página escolhida,
// desmontar para o preview e devolve o piloto. Sair da aba, portanto, pausa o
// stream sem regra extra.
//
// Tudo é da PÁGINA, não do projeto (ADR-258): cada vista se apresenta ao
// backend com um id próprio, recebe só os quadros da página que escolheu, e o
// controle que a pessoa assume vale só para essa página.

import { useCallback, useEffect, useRef, useState } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { getCurrentWindow } from "@tauri-apps/api/window"
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

export interface FrameNotice {
  projectId: string
  targetId: string
  revision: number
}

export interface NavegadorDoProjeto {
  /** O projeto da vista; sem alvo, vazio. */
  projectPath: string
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
  /** A página escolhida está atrás de outra e não manda quadro (ADR-257). */
  deFundo: boolean
  /** Reabre a página escolhida numa janela própria (gesto, recarrega). */
  abrirEmJanelaPropria: () => void
}

/** O id desta vista no backend, "<janela>:<aleatório>" (ADR-258). A janela
 *  vem na frente para que fechar a flutuante leve as vistas dela. */
function novaVista(): string {
  let janela = "main"
  try {
    janela = getCurrentWindow().label
  } catch {
    // Fora do Tauri (teste): a janela principal. Só nomeia a vista.
  }
  return `${janela}:${crypto.randomUUID()}`
}

/** O aviso de quadro novo é da página que esta vista mostra? Puro. */
export function avisoEhDaPagina(aviso: FrameNotice, projectId: string, selecionada: string | null): boolean {
  return aviso.projectId === projectId && !!selecionada && aviso.targetId === selecionada
}

/** Só o quadro da página escolhida vai à tela: um quadro atrasado da página
 *  de antes nunca aparece com o nome da nova no seletor. Puro. */
export function quadroDaPagina(
  quadro: BrowserPreviewFrame | null,
  selecionada: string | null,
): BrowserPreviewFrame | null {
  return quadro && quadro.targetId === selecionada ? quadro : null
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
  const [deFundo, setDeFundo] = useState(false)
  const revisionRef = useRef(0)
  const selectedRef = useRef<string | null>(null)
  const pilotTokenRef = useRef<string | null>(null)
  const pullingFrameRef = useRef(false)
  const pendingFrameRef = useRef(false)
  const vistaRef = useRef<string | null>(null)
  vistaRef.current ??= novaVista()
  const vista = vistaRef.current
  /** A página em que o controle da pessoa vale (ADR-258). */
  const pilotPageRef = useRef<string | null>(null)

  const refreshPilot = useCallback(async (path: string) => {
    try {
      setPilot(await browserPilotStatus(path, selectedRef.current))
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
        const pagina = selectedRef.current
        if (!pagina) break
        const next = quadroDaPagina(await browserPreviewFrame(path, pagina, revisionRef.current || undefined), selectedRef.current)
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

  /** Devolve o controle da pessoa, se ela tiver. Trocar de página devolve:
   *  o controle é da página em que foi assumido. */
  const devolverPiloto = useCallback((path: string) => {
    const token = pilotTokenRef.current
    const pagina = pilotPageRef.current
    pilotTokenRef.current = null
    pilotPageRef.current = null
    setPilotToken(null)
    if (token && pagina)
      void releaseBrowserPilot(path, pagina, token).catch((cause) =>
        console.warn("Falha ao liberar piloto:", cause),
      )
  }, [])

  const showPage = useCallback(
    async (path: string, page: BrowserPage) => {
      if (pilotPageRef.current && pilotPageRef.current !== page.id) devolverPiloto(path)
      setSelectedId(page.id)
      selectedRef.current = page.id
      setAddress(page.url)
      setFrame(null)
      setDeFundo(false)
      revisionRef.current = 0
      try {
        const status = await startBrowserPreview(path, page.id, conversa, vista)
        setDeFundo(status.deFundo)
        await pullFrame(path)
        void refreshPilot(path)
        setError(null)
      } catch (cause) {
        setError(messageOf(cause))
      }
    },
    [pullFrame, refreshPilot, devolverPiloto, conversa, vista],
  )

  useEffect(() => {
    if (!projectPath || !projectId) return
    let disposed = false
    const unlisteners: UnlistenFn[] = []
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
        void stopBrowserPreview(projectPath, vista).catch((cause) =>
          console.warn("Falha ao encerrar preview:", cause),
        )
    })().finally(() => {
      if (!disposed) setLoading(false)
    })
    void listen<FrameNotice>("browser-preview://frame", (event) => {
      if (avisoEhDaPagina(event.payload, projectId, selectedRef.current)) void pullFrame(projectPath)
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
      // A vista sai; a transmissão da página segue se outra vista olha a
      // mesma página (a aba e a flutuante, ADR-258).
      void stopBrowserPreview(projectPath, vista).catch((cause) =>
        console.warn("Falha ao encerrar preview:", cause),
      )
      devolverPiloto(projectPath)
    }
  }, [projectPath, projectId, conversa, vista, loadPages, pullFrame, refreshPilot, showPage, devolverPiloto])

  // O token humano tem TTL no backend. Enquanto esta vista é o piloto, um
  // heartbeat curto mantém a posse; sumir/crashar libera sozinho em 15 s.
  useEffect(() => {
    if (!projectPath || !pilotToken) return
    const heartbeat = window.setInterval(() => {
      const pagina = pilotPageRef.current
      if (!pagina) return
      void heartbeatBrowserPilot(projectPath, pagina, pilotToken)
        .then(setPilot)
        .catch((cause) => {
          setPilotToken(null)
          pilotTokenRef.current = null
          pilotPageRef.current = null
          setError(messageOf(cause))
          void refreshPilot(projectPath)
        })
    }, 8_000)
    return () => window.clearInterval(heartbeat)
  }, [projectPath, pilotToken, refreshPilot])

  const selected = pages.find((page) => page.id === selectedId) ?? null

  return {
    projectPath: projectPath ?? "",
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
    deFundo,
    abrirEmJanelaPropria: () => {
      if (!projectPath || !selected) return
      setError(null)
      void startBrowserPreview(projectPath, selected.id, conversa, vista, true)
        .then(async (status) => {
          const nova = await loadPages(projectPath, status.targetId)
          setDeFundo(status.deFundo)
          if (nova) await showPage(projectPath, nova)
        })
        .catch((cause) => setError(messageOf(cause)))
    },
    acquire: () => {
      if (!projectPath || !selected) return
      const pagina = selected.id
      void acquireBrowserPilot(projectPath, pagina)
        .then((grant) => {
          setPilotToken(grant.token)
          pilotTokenRef.current = grant.token
          pilotPageRef.current = pagina
          setPilot(grant.status)
          setError(null)
        })
        .catch((cause) => {
          setError(messageOf(cause))
          void refreshPilot(projectPath)
        })
    },
    release: () => {
      const pagina = pilotPageRef.current
      if (!projectPath || !pilotToken || !pagina) return
      void releaseBrowserPilot(projectPath, pagina, pilotToken)
        .then((status) => {
          setPilot(status)
          setPilotToken(null)
          pilotTokenRef.current = null
          pilotPageRef.current = null
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
      if (!projectPath || !selected || !pilotToken || pilotPageRef.current !== selected.id) return
      void sendBrowserInput(projectPath, selected.id, pilotToken, action)
        .then(() => setError(null))
        .catch((cause) => {
          setError(messageOf(cause))
          void refreshPilot(projectPath)
        })
    },
  }
}
