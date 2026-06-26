import { useEffect } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { open } from "@tauri-apps/plugin-dialog"
import { toast } from "sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Toaster } from "@/components/ui/sonner"
import { TitleBar } from "@/components/layout/TitleBar"
import { Sidebar } from "@/components/layout/Sidebar"
import { ContextPanel } from "@/components/layout/ContextPanel"
import { ChatPanel } from "@/components/chat/ChatPanel"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { useApp } from "@/store/app"
import { isTauri, listProjects, insertProject } from "@/lib/db"
import type { Project } from "@/lib/types"

const queryClient = new QueryClient()

// Seed do 1º run: projetos reais como exemplo. Persistem no SQLite a partir daí.
const SEED: Project[] = [
  {
    id: "seed-prime",
    name: "prime-sales-hub",
    path: "/Users/viniciusmachado/projetos/prime/prime-sales-hub",
    createdAt: 3,
    hasClaudeMd: true,
    hasAgentsMd: true,
    status: "idle",
  },
  {
    id: "seed-warp",
    name: "warp",
    path: "/Users/viniciusmachado/projetos/warp",
    createdAt: 2,
    hasClaudeMd: false,
    hasAgentsMd: false,
    status: "idle",
  },
  {
    id: "seed-studio",
    name: "vinimachado-studio",
    path: "/Users/viniciusmachado/projetos/pessoais/vinimachado-studio",
    createdAt: 1,
    hasClaudeMd: false,
    hasAgentsMd: true,
    status: "idle",
  },
]

export default function App() {
  const sidebarOpen = useApp((s) => s.sidebarOpen)
  const contextOpen = useApp((s) => s.contextOpen)
  const setProjects = useApp((s) => s.setProjects)
  const addProject = useApp((s) => s.addProject)
  const setReady = useApp((s) => s.setReady)
  const theme = useApp((s) => s.theme)

  useEffect(() => {
    let cancelled = false
    async function load() {
      // Em `vite dev` (browser) não há Tauri → seed em memória.
      if (!isTauri()) {
        if (!cancelled) setProjects(SEED)
        return
      }
      const existing = await listProjects()
      if (cancelled) return
      if (existing && existing.length > 0) {
        setProjects(existing)
      } else {
        for (const p of SEED) await insertProject(p) // 1º run: semeia o banco
        const seeded = await listProjects()
        if (!cancelled) setProjects(seeded ?? SEED)
      }
    }
    load()
      .catch((e) => {
        console.error("Falha ao carregar projetos:", e)
        if (!cancelled) setProjects(SEED)
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [setProjects, setReady])

  async function handleAddProject() {
    if (!isTauri()) {
      toast("Seleção de pasta disponível no app (tauri dev)")
      return
    }
    try {
      const dir = await open({
        directory: true,
        multiple: false,
        title: "Escolha a pasta do projeto",
      })
      if (typeof dir !== "string") return
      const name = dir.split("/").filter(Boolean).pop() ?? dir
      const project: Project = {
        id: crypto.randomUUID(),
        name,
        path: dir,
        createdAt: Date.now(),
        hasClaudeMd: false,
        hasAgentsMd: false,
        status: "idle",
      }
      await insertProject(project)
      addProject(project)
      toast.success(`Projeto adicionado: ${name}`)
    } catch (e) {
      console.error(e)
      toast.error("Não foi possível adicionar o projeto")
    }
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={300}>
        <div className="grain flex h-screen w-screen flex-col overflow-hidden bg-rail text-foreground">
          <TitleBar />
          <ResizablePanelGroup
            orientation="horizontal"
            className="min-h-0 flex-1"
          >
            {sidebarOpen && (
              <>
                <ResizablePanel
                  id="sidebar"
                  defaultSize="19%"
                  minSize="190px"
                  maxSize="32%"
                >
                  <Sidebar onAddProject={handleAddProject} />
                </ResizablePanel>
                <ResizableHandle className="bg-transparent after:w-2 hover:after:bg-brass/40" />
              </>
            )}
            {/* Conteúdo principal como "card inset" flutuando no rail. */}
            <ResizablePanel id="main" defaultSize="81%" minSize="40%">
              <div className="h-full py-2 pr-2 pl-1">
                <div className="flex h-full overflow-hidden rounded-xl border bg-background shadow-[var(--shadow-pop)]">
                  <ResizablePanelGroup
                    orientation="horizontal"
                    className="h-full"
                  >
                    <ResizablePanel id="chat" defaultSize="70%" minSize="42%">
                      <ChatPanel />
                    </ResizablePanel>
                    {contextOpen && (
                      <>
                        <ResizableHandle className="bg-border/60 transition-colors hover:bg-brass/50 after:w-2" />
                        <ResizablePanel
                          id="context"
                          defaultSize="30%"
                          minSize="240px"
                          maxSize="42%"
                        >
                          <ContextPanel />
                        </ResizablePanel>
                      </>
                    )}
                  </ResizablePanelGroup>
                </div>
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>
        <Toaster position="bottom-center" theme={theme} />
      </TooltipProvider>
    </QueryClientProvider>
  )
}
