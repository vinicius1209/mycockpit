// Modo Agent Office — monta o canvas Pixi (via scene/stage) + overlay React e
// orquestra o pipeline: planta → stage → world → input → loop → derive.
// Posições NUNCA passam pelo React (§7): a cena renderiza no rAF e os overlays
// DOM (Prompts) são posicionados no MESMO callback; o React só vê transições
// discretas (store local em ./store). Lazy no App (export default) — quando
// `hidden`, o loop PARA (e volta ao reaparecer).
import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import type { FloorPlan, OfficeSnapshot, SimEvent, World } from "../engine/types"
import { createWorld, simTick } from "../engine/sim"
import { createLoop, type OfficeLoop } from "../engine/loop"
import { attachInput } from "../engine/input"
import { setInspect, zoomAt } from "../engine/camera"
import { createOfficeStage, type OfficeStage } from "../scene/stage"
import { buildFloorPlan } from "../bridge/layout"
import { startDeriving } from "../bridge/derive"
import { startSimData } from "../bridge/sim-data"
import {
  dockLeaveCtx,
  exitOfficeToPainel,
  officeIsTauri,
  officeProjects,
  useOfficeProjects,
} from "../bridge/hooks"
import { officeEscape, useOfficeUi } from "./store"
import { Hud, OfficeMark } from "./Hud"
import { DeskDock, DOCK_W } from "./DeskDock"
import { MissionDock } from "./MissionDock"
import { deskMenuPrimary } from "./DeskMenu"
import { Prompts, type PromptsHandle } from "./Prompts"

const ONBOARD_KEY = "mc.office.onboarded"

/** Alvo do modo inspect = centro da sala. */
function roomCenter(plan: FloorPlan, projectId: string) {
  const room = plan.rooms.find((r) => r.projectId === projectId)
  if (!room) return null
  return { x: room.origin.x + room.w / 2, y: room.origin.y + room.h / 2 }
}

function OnboardingOverlay() {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-12 z-40 flex justify-center">
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3 text-[12px] text-foreground/90 shadow-xl">
        <p><b className="font-semibold">WASD / setas</b> — andar pelo escritório</p>
        <p><b className="font-semibold">Clique ou E</b> — ir até a mesa e falar com o agent</p>
        <p><b className="font-semibold">Tab</b> — ciclar salas · <b className="font-semibold">roda</b> — zoom</p>
        <p><b className="font-semibold">Esc</b> — cancelar ditado / fechar a conversa</p>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center">
      <div className="flex max-w-sm flex-col items-center gap-3 rounded-xl border border-border bg-card p-8 text-center shadow-xl">
        <OfficeMark className="size-8 text-brass" />
        <h2 className="text-[15px] font-semibold text-foreground">
          O escritório está vazio
        </h2>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Cada projeto vira uma sala com mesas para os agents. Adicione um
          projeto no painel para abrir a primeira sala.
        </p>
        <button
          type="button"
          onClick={exitOfficeToPainel}
          className="rounded-md bg-brass px-3.5 py-1.5 text-[13px] font-medium text-brass-foreground transition-opacity hover:opacity-90"
        >
          Ir para o painel
        </button>
      </div>
    </div>
  )
}

export default function OfficeMode({ hidden = false }: { hidden?: boolean }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const worldRef = useRef<World | null>(null)
  const stageRef = useRef<OfficeStage | null>(null)
  const loopRef = useRef<OfficeLoop | null>(null)
  const planRef = useRef<FloorPlan | null>(null)
  const promptsRef = useRef<PromptsHandle>(null)
  const roomIdxRef = useRef(0)
  const hiddenRef = useRef(hidden)
  hiddenRef.current = hidden

  const [plan, setPlan] = useState<FloorPlan | null>(null)
  const [ready, setReady] = useState(false)
  const [onboard, setOnboard] = useState(() => {
    try {
      return localStorage.getItem(ONBOARD_KEY) !== "1"
    } catch {
      return false
    }
  })

  const projects = useOfficeProjects()
  const projectsKey = projects.map((p) => p.id).join("|")

  // Badge do HUD ⇒ câmera inspeciona a sala.
  function inspectRoom(projectId: string) {
    const world = worldRef.current
    const p = planRef.current
    if (!world || !p) return
    const c = roomCenter(p, projectId)
    if (c) setInspect(world, c)
  }

  // useEffect ÚNICO do pipeline (re-roda só quando a lista de projetos muda —
  // a planta é derivada dela). StrictMode monta 2×: token `cancelled` + o
  // stage tem o próprio token de init assíncrono (O2).
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const list = officeProjects()
    if (list.length === 0) return

    let cancelled = false
    const detach: Array<() => void> = []

    void (async () => {
      const floorPlan = buildFloorPlan(list)
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches
      const stage = await createOfficeStage(host, floorPlan, { reducedMotion })
      if (cancelled) {
        stage.destroy()
        return
      }
      const world = createWorld(floorPlan)
      stageRef.current = stage
      worldRef.current = world
      planRef.current = floorPlan
      setPlan(floorPlan)

      // Mesa do dock sumiu da planta (projeto removido) ⇒ fecha.
      const ui = useOfficeUi.getState()
      ui.setNearDesk(null)
      if (ui.dockDeskId && !list.some((p) => ui.dockDeskId!.startsWith(`${p.id}::`)))
        ui.closeDock()

      // SimEvent → espelho zustand (transições discretas; near-desk e a
      // chegada por clique levam o contexto §5.4 lido do useChat pelo bridge).
      const emitSimEvent = (e: SimEvent) => {
        const s = useOfficeUi.getState()
        if (e.kind === "near-desk" || e.kind === "arrived-at-desk")
          s.handleSimEvent(e, dockLeaveCtx(s.dockConvId))
        else s.handleSimEvent(e)
      }

      detach.push(
        attachInput(window, world, {
          isDockOpen: () => {
            const s = useOfficeUi.getState()
            return s.dockDeskId !== null && !s.dockMinimized
          },
          isTextTarget: (e: KeyboardEvent) => {
            const el = e.target as HTMLElement | null
            if (!el || typeof el.tagName !== "string") return false
            return (
              el.tagName === "INPUT" ||
              el.tagName === "TEXTAREA" ||
              el.isContentEditable === true
            )
          },
          // O attachInput fica vivo com o office oculto (montado + hidden):
          // isActive corta TUDO (sem preventDefault) — Tab/setas/E/Esc de
          // outro modo nunca mexem no office nem perdem a função local.
          isActive: () => !hiddenRef.current,
          // Esc — executor único (§5): gravando > dock aberto (§5.4) > nada.
          onEscape: () => void officeEscape(),
          onInteract: () => {
            // E aciona a AÇÃO PRIMÁRIA do menu-balão da mesa em alcance
            // (§5.2 v2): Conversar/Abrir/Responder/Acompanhar ⇒ abre o dock.
            const id = worldRef.current?.nearDeskId ?? null
            if (id) deskMenuPrimary(id)
          },
          onTabRoom: () => {
            const p = planRef.current
            const w = worldRef.current
            if (!p || !w || p.rooms.length === 0) return
            roomIdxRef.current = (roomIdxRef.current + 1) % p.rooms.length
            const room = p.rooms[roomIdxRef.current]
            const c = roomCenter(p, room.projectId)
            if (c) setInspect(w, c)
          },
        }),
      )

      // Sim 60Hz fixa + render com interpolação; overlays DOM no MESMO rAF.
      let frames = 0
      let fpsAt = performance.now()
      const loop = createLoop({
        simulate: (dt: number) => simTick(world, dt, emitSimEvent),
        render: (alpha: number) => {
          stage.render(world, alpha)
          promptsRef.current?.frame(
            (wx, wy) => stage.worldToScreen(wx, wy),
            stage.bossScreen(),
          )
          frames++
          const now = performance.now()
          if (now - fpsAt >= 1000) {
            useOfficeUi.getState().setFps(Math.round((frames * 1000) / (now - fpsAt)))
            frames = 0
            fpsAt = now
          }
        },
      })
      loopRef.current = loop
      if (!hiddenRef.current) loop.start()
      detach.push(() => loop.stop())

      // Atividade real (Tauri) ou fixture (browser puro, O8) → cena + HUD.
      const onSnapshot = (snap: OfficeSnapshot) => {
        stage.applySnapshot(snap)
        useOfficeUi.getState().setSnapshot(snap)
      }
      detach.push(
        officeIsTauri() ? startDeriving(onSnapshot) : startSimData(onSnapshot),
      )

      // Espelhos discretos store → cena/mundo (nunca por frame).
      detach.push(
        useOfficeUi.subscribe((s, prev) => {
          if (s.nearDeskId !== prev.nearDeskId) stage.setHighlight(s.nearDeskId)
          const open = s.dockDeskId !== null && !s.dockMinimized
          const wasOpen = prev.dockDeskId !== null && !prev.dockMinimized
          // Dock aberto desloca o centro de framing por meia largura (§3).
          // Convenção do engine/camera.ts: screenOffset é onde o ALVO aparece
          // relativo ao centro — dock à DIREITA ⇒ alvo à esquerda ⇒ x NEGATIVO.
          if (open !== wasOpen)
            world.camera.screenOffset = { x: open ? -DOCK_W / 2 : 0, y: 0 }
          // Conversa aberta ⇒ o agent da mesa olha pro boss (§5.4 v2); fechar
          // (ou minimizar) devolve o flip original. Cobre também a TROCA de
          // mesa com o dock aberto.
          if (open !== wasOpen || s.dockDeskId !== prev.dockDeskId)
            stage.setConversing(open ? s.dockDeskId : null)
        }),
      )

      // Ponteiro: hover acende highlight/cursor; pointerdown vira intenção na
      // sim (clickDeskId | clickWorld); wheel = zoom em torno do cursor.
      let lastHover: string | null = null
      const onPointerMove = (e: PointerEvent) => {
        const id = stage.hitTestDesk(e.clientX, e.clientY)
        if (id !== lastHover) {
          lastHover = id
          stage.setHover(id) // o stage também troca o cursor do canvas
        }
      }
      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return
        const id = stage.hitTestDesk(e.clientX, e.clientY)
        if (id) {
          world.input.clickDeskId = id
        } else {
          const w = stage.screenToWorld(e.clientX, e.clientY)
          world.input.clickWorld = w
          stage.showClickAt(w.x, w.y) // marca de chão do click-to-move
        }
      }
      const onWheel = (e: WheelEvent) => {
        e.preventDefault()
        // zoomAt recebe px RELATIVOS AO CENTRO do viewport (engine/camera.ts):
        // cursor − centro do host (o canvas preenche o host).
        const rect = host.getBoundingClientRect()
        // Fator multiplicativo suave (~10%/tick de roda), invariante de DPI.
        zoomAt(
          world,
          e.clientX - rect.left - rect.width / 2,
          e.clientY - rect.top - rect.height / 2,
          Math.exp(-e.deltaY * 0.0015),
        )
      }
      // Zoom por teclado (+/- — §5): fora do engine/input de propósito (a
      // cena/ui é dona do zoom). Centro do viewport como âncora (0,0).
      const onKeyZoom = (e: KeyboardEvent) => {
        if (hiddenRef.current || e.metaKey || e.ctrlKey || e.altKey) return
        const el = e.target as HTMLElement | null
        if (
          el &&
          (el.tagName === "INPUT" ||
            el.tagName === "TEXTAREA" ||
            el.isContentEditable === true)
        )
          return
        if (e.key === "+" || e.key === "=") zoomAt(world, 0, 0, 1.15)
        else if (e.key === "-") zoomAt(world, 0, 0, 1 / 1.15)
      }
      host.addEventListener("pointermove", onPointerMove)
      host.addEventListener("pointerdown", onPointerDown)
      host.addEventListener("wheel", onWheel, { passive: false })
      window.addEventListener("keydown", onKeyZoom)
      detach.push(() => {
        host.removeEventListener("pointermove", onPointerMove)
        host.removeEventListener("pointerdown", onPointerDown)
        host.removeEventListener("wheel", onWheel)
        window.removeEventListener("keydown", onKeyZoom)
      })

      setReady(true)
    })()

    return () => {
      cancelled = true
      for (const f of detach.reverse()) f()
      stageRef.current?.destroy()
      stageRef.current = null
      worldRef.current = null
      planRef.current = null
      loopRef.current = null
      setReady(false)
      setPlan(null)
    }
    // A chave resume a identidade da lista (planta é função dela).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectsKey])

  // Oculto ⇒ para o loop (ticker parado, §7); visível de volta ⇒ religa.
  useEffect(() => {
    if (hidden) loopRef.current?.stop()
    else if (ready) loopRef.current?.start()
  }, [hidden, ready])

  // Onboarding: overlay de controles no primeiro uso, some ao PRIMEIRO input.
  useEffect(() => {
    if (!onboard || hidden) return
    const done = () => {
      try {
        localStorage.setItem(ONBOARD_KEY, "1")
      } catch {
        /* localStorage indisponível — só esconde nesta sessão */
      }
      setOnboard(false)
    }
    window.addEventListener("keydown", done, { capture: true, once: true })
    window.addEventListener("pointerdown", done, { capture: true, once: true })
    return () => {
      window.removeEventListener("keydown", done, { capture: true })
      window.removeEventListener("pointerdown", done, { capture: true })
    }
  }, [onboard, hidden])

  return (
    <div
      className={cn(
        "absolute inset-0 overflow-hidden bg-background",
        hidden && "hidden",
      )}
    >
      {/* host do canvas Pixi (a cena instala o <canvas> aqui) */}
      <div ref={hostRef} className="absolute inset-0 touch-none select-none" />

      <Prompts ref={promptsRef} plan={plan} />
      <Hud onInspectRoom={inspectRoom} />
      <DeskDock />
      {/* dock da mesa de reunião (O-2): mesmo slot/largura — os dois docks
          leem dockDeskId e só UM renderiza (DeskDock ignora o id da mesa). */}
      <MissionDock />

      {projects.length === 0 ? (
        <EmptyState />
      ) : (
        onboard && <OnboardingOverlay />
      )}
    </div>
  )
}
