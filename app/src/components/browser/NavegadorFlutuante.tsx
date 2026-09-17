// O navegador do projeto flutuando sobre a conversa (navegador PRD R2): o MESMO
// stream da aba, numa janela dentro do cartão central, arrastável pela barra e
// redimensionável pelo canto. Nunca sai do cartão (`encaixarNoCartao`) e nasce
// sem cobrir o composer. Aba e flutuante não mostram o stream juntas: o
// AppShell só desenha esta janela fora da aba Navegador.

import { useLayoutEffect, useRef, useState } from "react"
import { AppWindow, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useProjectBrowser } from "@/components/settings/ProjectBrowserCard"
import {
  encaixarNoCartao,
  geometriaInicial,
  type Geometria,
} from "@/lib/navegadorFlutuante"
import { useApp } from "@/store/app"
import { useNavegadorFlutuante } from "@/store/navegadorFlutuante"
import { NavegadorAoVivo } from "./NavegadorTab"

type Gesto = { tipo: "mover" | "redimensionar"; x0: number; y0: number; g0: Geometria }

function JanelaFlutuante({ projectId, projectPath }: { projectId: string; projectPath: string }) {
  const { status } = useProjectBrowser(projectPath)
  const lembrada = useNavegadorFlutuante((s) => s.geometria[projectId])
  const guardar = useNavegadorFlutuante((s) => s.guardarGeometria)
  const recolher = useNavegadorFlutuante((s) => s.recolher)
  const palcoRef = useRef<HTMLDivElement | null>(null)
  const [cartao, setCartao] = useState<{ w: number; h: number } | null>(null)
  const [emGesto, setEmGesto] = useState<Geometria | null>(null)
  const gestoRef = useRef<Gesto | null>(null)

  useLayoutEffect(() => {
    const palco = palcoRef.current
    if (!palco) return
    const medir = () => setCartao({ w: palco.clientWidth, h: palco.clientHeight })
    medir()
    const observador = new ResizeObserver(medir)
    observador.observe(palco)
    return () => observador.disconnect()
  }, [])

  const base = cartao
    ? encaixarNoCartao(lembrada ?? geometriaInicial(cartao.w, cartao.h), cartao.w, cartao.h)
    : null
  const g = emGesto ?? base

  const comecar = (tipo: Gesto["tipo"]) => (event: React.PointerEvent<HTMLElement>) => {
    if (!g || event.button !== 0) return
    // botões da barra seguem clicáveis: só a área livre arrasta
    if (tipo === "mover" && (event.target as HTMLElement).closest("button")) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    gestoRef.current = { tipo, x0: event.clientX, y0: event.clientY, g0: g }
    setEmGesto(g)
  }
  const mover = (event: React.PointerEvent<HTMLElement>) => {
    const gesto = gestoRef.current
    if (!gesto || !cartao) return
    const dx = event.clientX - gesto.x0
    const dy = event.clientY - gesto.y0
    const proxima =
      gesto.tipo === "mover"
        ? { ...gesto.g0, x: gesto.g0.x + dx, y: gesto.g0.y + dy }
        : { ...gesto.g0, w: gesto.g0.w + dx, h: gesto.g0.h + dy }
    setEmGesto(encaixarNoCartao(proxima, cartao.w, cartao.h))
  }
  const terminar = () => {
    if (!gestoRef.current) return
    gestoRef.current = null
    if (emGesto) guardar(projectId, emGesto)
    setEmGesto(null)
  }

  const session = status?.session ?? null

  return (
    <div ref={palcoRef} className="pointer-events-none absolute inset-0 z-20">
      {g && (
        <section
          aria-label="Navegador do projeto flutuando sobre a conversa"
          style={{ left: g.x, top: g.y, width: g.w, height: g.h }}
          className="pointer-events-auto absolute flex flex-col overflow-clip rounded-xl border bg-background shadow-[var(--shadow-pop)]"
        >
          <div
            onPointerDown={comecar("mover")}
            onPointerMove={mover}
            onPointerUp={terminar}
            onPointerCancel={terminar}
            className="flex shrink-0 cursor-grab touch-none items-center gap-1 border-b border-border/40 py-1 pr-1 pl-3 select-none active:cursor-grabbing"
          >
            <span className="text-[11px] font-medium text-muted-foreground">Navegador</span>
            <Button
              size="icone-chip"
              variant="ghost"
              className="ml-auto"
              aria-label="Voltar para a aba"
              title="Voltar para a aba"
              onClick={() => {
                recolher(projectId)
                useApp.getState().openBrowserTab()
              }}
            >
              <AppWindow />
            </Button>
            <Button
              size="icone-chip"
              variant="ghost"
              aria-label="Fechar navegador flutuante"
              title="Fechar"
              onClick={() => recolher(projectId)}
            >
              <X />
            </Button>
          </div>
          <div className="min-h-0 flex-1">
            {session ? (
              <NavegadorAoVivo
                alvo={{ projectId: session.projectId, projectPath: session.projectPath }}
              />
            ) : (
              <p className="grid h-full place-items-center px-4 text-center text-[12px] text-muted-foreground">
                {status ? "O navegador do projeto foi desligado." : "Consultando o navegador do projeto"}
              </p>
            )}
          </div>
          <div
            role="separator"
            aria-label="Redimensionar"
            onPointerDown={comecar("redimensionar")}
            onPointerMove={mover}
            onPointerUp={terminar}
            onPointerCancel={terminar}
            className="absolute right-0 bottom-0 size-3.5 cursor-nwse-resize touch-none"
          />
        </section>
      )}
    </div>
  )
}

export function NavegadorFlutuante() {
  const project = useApp((s) => s.projects.find((p) => p.id === s.activeProjectId) ?? null)
  const flutuando = useNavegadorFlutuante((s) => (project ? Boolean(s.flutuando[project.id]) : false))
  if (!project || !flutuando) return null
  return <JanelaFlutuante key={project.id} projectId={project.id} projectPath={project.path} />
}
