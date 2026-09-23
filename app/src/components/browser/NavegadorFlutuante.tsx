// O navegador do projeto flutuando sobre a conversa (navegador PRD R2): o MESMO
// stream da aba, numa janela dentro do cartão central, arrastável pela barra e
// redimensionável por qualquer borda ou canto (ADR-229). Nunca sai do cartão (`encaixarNoCartao`) e nasce
// sem cobrir o composer. Aba e flutuante não mostram o stream juntas: o
// AppShell só desenha esta janela fora da aba Navegador.

import { useLayoutEffect, useRef, useState } from "react"
import { AppWindow, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useProjectBrowser } from "@/components/settings/ProjectBrowserCard"
import {
  encaixarNoCartao,
  geometriaInicial,
  redimensionar,
  type Borda,
  type Geometria,
} from "@/lib/navegadorFlutuante"
import { useApp } from "@/store/app"
import { useNavegadorFlutuante } from "@/store/navegadorFlutuante"
import { NavegadorAoVivo } from "./NavegadorTab"

type Gesto = { borda: Borda | null; x0: number; y0: number; g0: Geometria }

/** As alças: 8 px de pega, metade para FORA da janela (a área de clique cresce
 *  para fora, o conteúdo não se mexe) e os cantos por cima das bordas. */
const ALCAS: Array<{ borda: Borda; className: string }> = [
  { borda: "n", className: "-top-1 inset-x-3 h-2 cursor-ns-resize" },
  { borda: "s", className: "-bottom-1 inset-x-3 h-2 cursor-ns-resize" },
  { borda: "w", className: "-left-1 inset-y-3 w-2 cursor-ew-resize" },
  { borda: "e", className: "-right-1 inset-y-3 w-2 cursor-ew-resize" },
  { borda: "nw", className: "-top-1 -left-1 size-4 cursor-nwse-resize" },
  { borda: "se", className: "-right-1 -bottom-1 size-4 cursor-nwse-resize" },
  { borda: "ne", className: "-top-1 -right-1 size-4 cursor-nesw-resize" },
  { borda: "sw", className: "-bottom-1 -left-1 size-4 cursor-nesw-resize" },
]

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

  /** `null` move a janela; uma borda redimensiona por ela. */
  const comecar = (borda: Borda | null) => (event: React.PointerEvent<HTMLElement>) => {
    if (!g || event.button !== 0) return
    // botões da barra seguem clicáveis: só a área livre arrasta
    if (!borda && (event.target as HTMLElement).closest("button")) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    gestoRef.current = { borda, x0: event.clientX, y0: event.clientY, g0: g }
    setEmGesto(g)
  }
  const mover = (event: React.PointerEvent<HTMLElement>) => {
    const gesto = gestoRef.current
    if (!gesto || !cartao) return
    const dx = event.clientX - gesto.x0
    const dy = event.clientY - gesto.y0
    setEmGesto(
      gesto.borda
        ? redimensionar(gesto.g0, gesto.borda, dx, dy, cartao.w, cartao.h)
        : encaixarNoCartao({ ...gesto.g0, x: gesto.g0.x + dx, y: gesto.g0.y + dy }, cartao.w, cartao.h),
    )
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
        // As alças moram FORA da seção: ela recorta o conteúdo (`overflow-clip`)
        // e recortaria a metade de fora de cada pega.
        <div
          style={{ left: g.x, top: g.y, width: g.w, height: g.h }}
          className="group/flutuante pointer-events-auto absolute"
        >
          <section
            aria-label="Navegador do projeto flutuando sobre a conversa"
            className="flex h-full w-full flex-col overflow-clip rounded-xl border bg-background shadow-[var(--shadow-pop)]"
          >
            <div
              onPointerDown={comecar(null)}
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
          </section>
          {/* A pega do canto à vista: antes o canto redimensionava sem nada que
              dissesse isso, e a pessoa não descobria. */}
          <svg
            aria-hidden
            viewBox="0 0 10 10"
            className="pointer-events-none absolute right-1 bottom-1 size-2.5 text-muted-foreground/70 opacity-0 transition-opacity group-hover/flutuante:opacity-100"
          >
            <path d="M9 3 3 9M9 6.5 6.5 9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          {ALCAS.map(({ borda, className }) => (
            <div
              key={borda}
              role="separator"
              aria-label="Redimensionar"
              onPointerDown={comecar(borda)}
              onPointerMove={mover}
              onPointerUp={terminar}
              onPointerCancel={terminar}
              className={`absolute touch-none ${className}`}
            />
          ))}
        </div>
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
