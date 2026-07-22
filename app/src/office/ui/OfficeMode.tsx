// Modo Agent Office — monta o canvas Pixi (via scene/stage) + overlay React e
// orquestra o pipeline: planta → stage → world → input → loop → derive.
// Posições NUNCA passam pelo React (§7): a cena renderiza no rAF e os overlays
// DOM (Prompts) são posicionados no MESMO callback; o React só vê transições
// discretas (store local em ./store). Lazy no App (export default) — quando
// `hidden`, o loop PARA (e volta ao reaparecer).
import {
  Profiler,
  useEffect,
  useRef,
  useState,
  type ProfilerOnRenderCallback,
} from "react"
import { cn } from "@/lib/utils"
import { formatHotkey } from "@/lib/dictationHotkey"
import { useApp } from "@/store/app"
import {
  BOSS_DESK_ID,
  MISSION_TABLE_ID,
  type FloorPlan,
  type OfficeSnapshot,
  type SimEvent,
  type World,
} from "../engine/types"
import { createWorld, simTick } from "../engine/sim"
import { createLoop, type OfficeLoop } from "../engine/loop"
import { attachInput } from "../engine/input"
import { setInspect, snapInspect, zoomAt } from "../engine/camera"
import { createOfficeStage, type OfficeStage } from "../scene/stage"
import { perfAgg, perfDuration, perfEnabled } from "../engine/perf"
import { fitIsometricRoom } from "../scene/logic"
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
import {
  activeDockWidth,
  DOCK_W,
  officeEscape,
  useOfficeUi,
  type OfficeUiState,
} from "./store"
import { Hud, OfficeMark } from "./Hud"
import { DeskDock } from "./DeskDock"
import { MissionDock } from "./MissionDock"
import { deskMenuPrimary } from "./DeskMenu"
import { Prompts, type PromptsHandle } from "./Prompts"
import {
  BossCenter,
  BOSS_CENTER_W,
  type BossDeskTarget,
} from "./BossCenter"

const ONBOARD_KEY = "mc.office.onboarded"

/** Commit do React nas árvores do office (telemetria; só montado com a flag
 *  mc.office.perf). actualDuration entra na janela do frame corrente. */
const onOfficeCommit: ProfilerOnRenderCallback = (
  _id,
  _phase,
  actualDuration,
) => perfDuration("react:commit", actualDuration)
const HUD_TOP_H = 44
const HUD_BOTTOM_H = 24
const ROOM_FIT_PADDING = 24
const ROOM_FIT_MAX_ZOOM = 1.25
/** Paredes sobem 96px alem do piso; a folga adicional cobre props altos. */
const ROOM_FIT_EXTENTS = { top: 104, right: 16, bottom: 24, left: 16 }

function safeScreenOffset(rightPanelW: number) {
  return {
    x: -rightPanelW / 2,
    y: (HUD_TOP_H - HUD_BOTTOM_H) / 2,
  }
}

/** FONTE ÚNICA da largura do slot direito (dock da mesa/missão e Central
 *  compartilham o slot). Todo deslocamento de câmera (screenOffset) e todo
 *  enquadramento (inspect*) derivam DAQUI — nunca recalcule inline. */
function rightPanelWidth(
  dockOpen: boolean,
  bossCenterOpen: boolean,
  dockWide: boolean,
) {
  return dockOpen || bossCenterOpen
    ? Math.max(activeDockWidth(dockWide), BOSS_CENTER_W)
    : 0
}

function applyRoomFit(
  world: World,
  host: HTMLDivElement,
  room: { origin: { x: number; y: number }; w: number; h: number },
  rightPanelW: number,
) {
  const fit = fitIsometricRoom(
    room,
    { w: host.clientWidth, h: host.clientHeight },
    {
      insets: {
        top: HUD_TOP_H,
        right: rightPanelW,
        bottom: HUD_BOTTOM_H,
        left: 0,
      },
      extents: ROOM_FIT_EXTENTS,
      padding: ROOM_FIT_PADDING,
      maxZoom: ROOM_FIT_MAX_ZOOM,
    },
  )
  world.camera.zoom = fit.zoom
  world.camera.screenOffset = fit.screenOffset
  snapInspect(world, fit.target)
}

function OnboardingOverlay() {
  // Atalho de ditado CONFIGURADO (settings) — null omite a menção na dica.
  const hotkey = useApp((s) => s.settings.dictationHotkey)
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-12 z-40 flex justify-center">
      <div className="flex flex-col gap-1 rounded-lg border border-border bg-card px-4 py-3 text-[12px] text-foreground/90 shadow-xl">
        <p><b className="font-semibold">WASD / setas</b> — andar pelo escritório</p>
        <p><b className="font-semibold">Clique ou E</b> — ir até a mesa e falar com o agent</p>
        <p><b className="font-semibold">R</b> — ciclar salas · <b className="font-semibold">roda</b> — zoom</p>
        <p><b className="font-semibold">Esc</b> — cancelar ditado / fechar a conversa{hotkey ? <> · <b className="font-semibold">{formatHotkey(hotkey)}</b> — ditar (toque ou segure)</> : null}</p>
        <p className="mt-1 border-t border-border/60 pt-1.5 text-muted-foreground">
          rail = pra onde ir e com quem falar · <b className="font-semibold text-brass">👑</b> = briefing + missão · cena = presença ao vivo
        </p>
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
  const roomIdxRef = useRef(-1)
  const hiddenRef = useRef(hidden)
  hiddenRef.current = hidden

  const [plan, setPlan] = useState<FloorPlan | null>(null)
  const [ready, setReady] = useState(false)
  const [bossCenterOpen, setBossCenterOpen] = useState(false)
  const dockOpen = useOfficeUi(
    (s) => s.dockDeskId !== null && !s.dockMinimized,
  )
  // Gate card visível ⇒ dock alargado (560px) — o enquadramento acompanha.
  const dockWide = useOfficeUi((s) => s.dockWide)
  const [onboard, setOnboard] = useState(() => {
    try {
      return localStorage.getItem(ONBOARD_KEY) !== "1"
    } catch {
      return false
    }
  })

  const projects = useOfficeProjects()
  const projectsKey = projects.map((p) => p.id).join("|")

  function activePanelWidth() {
    // Largura VIVA do slot direito: dock padrão ou ALARGADO (gate visível).
    return rightPanelWidth(
      dockOpen,
      bossCenterOpen,
      useOfficeUi.getState().dockWide,
    )
  }

  // Selecao explicita de sala ⇒ inspect com zoom calculado para a area segura.
  function inspectRoom(projectId: string, rightPanelW = activePanelWidth()) {
    const world = worldRef.current
    const p = planRef.current
    const host = hostRef.current
    if (!world || !p || !host) return
    const room = p.rooms.find((candidate) => candidate.projectId === projectId)
    if (room) applyRoomFit(world, host, room, rightPanelW)
  }

  function inspectCommons(rightPanelW = activePanelWidth()) {
    const world = worldRef.current
    const commons = planRef.current?.commonRoom
    const host = hostRef.current
    if (!world || !commons || !host) return
    applyRoomFit(world, host, commons, rightPanelW)
  }

  function inspectBoss(rightPanelW = activePanelWidth()) {
    const world = worldRef.current
    const room = planRef.current?.bossRoom
    const host = hostRef.current
    if (!world || !room || !host) return
    applyRoomFit(world, host, room, rightPanelW)
  }

  function openBossCenter() {
    const ui = useOfficeUi.getState()
    if (ui.dockDeskId && !ui.dockMinimized) ui.minimizeDock()
    inspectBoss(BOSS_CENTER_W)
    setBossCenterOpen(true)
  }

  function openDeskFromBoss(target: BossDeskTarget) {
    inspectRoom(target.projectId, DOCK_W)
    const ui = useOfficeUi.getState()
    ui.openDock(target.id)
    // No browser puro os ids do roteiro visual não existem no useChat; deixa
    // o dock resolver a conversa da mesa. No app real, preserva o id exato.
    if (target.convId && officeIsTauri()) ui.setDockConv(target.convId)
  }

  function openMissionFromBoss() {
    inspectCommons(DOCK_W)
    useOfficeUi.getState().openDock(MISSION_TABLE_ID)
  }

  // Consumo das intenções de navegação vindas da rail (que vive na Sidebar,
  // fora do OfficeMode, sem ref da câmera). Ref atualizada a cada render para
  // que o subscribe (montado uma vez) sempre chame o handler FRESCO — evita
  // closures velhas de dockOpen/bossCenterOpen. Cada intenção é limpa (null)
  // assim que consumida, para não re-disparar.
  const consumeFocusRef = useRef<(s: OfficeUiState) => void>(() => {})
  consumeFocusRef.current = (s) => {
    const ui = useOfficeUi.getState()
    // Posto de comando físico (§8): E/clique no menu da mesa do Boss pediu a
    // Central via store (deskMenuPrimary do BOSS_DESK_ID).
    if (s.bossCenterRequested) {
      ui.clearBossCenterRequest()
      openBossCenter()
      return
    }
    if (s.focusDeskId) {
      const deskId = s.focusDeskId
      ui.focusDesk(null)
      // Coreografia da Central: enquadra a sala do agent + abre o dock. O id da
      // mesa é `${projectId}::…`; a conversa o próprio dock resolve.
      openDeskFromBoss({ id: deskId, projectId: deskId.split("::")[0] })
      return
    }
    if (s.focusRoomId) {
      const id = s.focusRoomId
      ui.focusRoom(null)
      if (id === "@commons") inspectCommons()
      else if (id === "@boss") inspectBoss()
      else inspectRoom(id)
    }
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
          isTextTarget: (e: KeyboardEvent) => {
            const el = e.target as HTMLElement | null
            if (!el || typeof el.tagName !== "string") return false
            return (
              el.tagName === "INPUT" ||
              el.tagName === "TEXTAREA" ||
              el.tagName === "SELECT" ||
              el.tagName === "BUTTON" ||
              el.tagName === "A" ||
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
          onCycleRoom: () => {
            const p = planRef.current
            const w = worldRef.current
            if (!p || !w || p.rooms.length === 0) return
            const targets = p.rooms.map((room) => ({
              x: room.origin.x + room.w / 2,
              y: room.origin.y + room.h / 2,
            }))
            if (p.bossRoom)
              targets.push({
                x: p.bossRoom.origin.x + p.bossRoom.w / 2,
                y: p.bossRoom.origin.y + p.bossRoom.h / 2,
              })
            if (p.commonRoom)
              targets.push({
                x: p.commonRoom.origin.x + p.commonRoom.w / 2,
                y: p.commonRoom.origin.y + p.commonRoom.h / 2,
              })
            roomIdxRef.current = (roomIdxRef.current + 1) % targets.length
            const target = targets[roomIdxRef.current]
            if (target) setInspect(w, target)
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
          const promptTarget =
            s.nearDeskId && (!open || s.nearDeskId !== s.dockDeskId)
              ? s.nearDeskId
              : null
          const previousPromptTarget =
            prev.nearDeskId && (!wasOpen || prev.nearDeskId !== prev.dockDeskId)
              ? prev.nearDeskId
              : null
          if (promptTarget !== previousPromptTarget)
            stage.setPromptTarget(promptTarget)
          // Nada de screenOffset aqui: o ESCRITOR ÚNICO é o effect
          // [dockOpen, bossCenterOpen, dockWide, ready] lá embaixo — dockOpen e
          // dockWide são estado React (useOfficeUi hooks), então qualquer
          // mudança destes campos re-renderiza e o effect reaplica o offset.
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
        // S3: mouse 500–1000Hz ⇒ span AGREGADO por segundo (nunca um measure
        // por move); no-op sem mc.office.perf.
        const endHit = perfAgg("hitTest")
        const id = stage.hitTestDesk(e.clientX, e.clientY)
        endHit()
        if (id !== lastHover) {
          lastHover = id
          stage.setHover(id) // o stage também troca o cursor do canvas
        }
      }
      const onPointerDown = (e: PointerEvent) => {
        if (e.button !== 0) return
        const id = stage.hitTestDesk(e.clientX, e.clientY)
        if (id) {
          // Clique no AGENT do gate-visit: o hit mapeia pro deskId dele, mas o
          // CORPO está em pé na mesa do Boss — o boss anda até LÁ (o menu
          // "✋ Responder" abre na chegada, mesmo fluxo das mesas).
          const gv = useOfficeUi.getState().gateVisit
          world.input.clickDeskId =
            gv && gv.deskId === id ? BOSS_DESK_ID : id
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
            el.tagName === "SELECT" ||
            el.tagName === "BUTTON" ||
            el.tagName === "A" ||
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

  // Rail → câmera: assina UMA vez as intenções de navegação (focusRoomId/
  // focusDeskId) do store e as delega ao handler fresco (consumeFocusRef).
  useEffect(() => {
    return useOfficeUi.subscribe((s, prev) => {
      if (
        (s.focusRoomId && s.focusRoomId !== prev.focusRoomId) ||
        (s.focusDeskId && s.focusDeskId !== prev.focusDeskId) ||
        (s.bossCenterRequested && !prev.bossCenterRequested)
      )
        consumeFocusRef.current(s)
    })
  }, [])

  // A Central e o dock compartilham o slot direito. Abrir uma conversa fecha
  // o briefing; qualquer um dos dois mantém o alvo enquadrado à esquerda.
  useEffect(() => {
    if (dockOpen && bossCenterOpen) setBossCenterOpen(false)
  }, [dockOpen, bossCenterOpen])

  // ESCRITOR ÚNICO de world.camera.screenOffset por estado de painel (§3).
  // Convenção do engine/camera.ts: screenOffset é onde o ALVO aparece relativo
  // ao centro — painel à DIREITA ⇒ alvo à esquerda ⇒ x NEGATIVO. O applyRoomFit
  // (inspect explícito) também escreve, mas sempre derivando a MESMA largura
  // via activePanelWidth/rightPanelWidth — uma única fonte, nunca diverge.
  useEffect(() => {
    const world = worldRef.current
    if (!world) return
    world.camera.screenOffset = safeScreenOffset(
      rightPanelWidth(dockOpen, bossCenterOpen, dockWide),
    )
  }, [dockOpen, bossCenterOpen, dockWide, ready])

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

  // Overlays React (o canvas fica FORA: a cena não é filha do Profiler).
  const overlays = (
    <>
      <Prompts ref={promptsRef} plan={plan} />
      <Hud
        onOpenBossCenter={() =>
          bossCenterOpen ? setBossCenterOpen(false) : openBossCenter()
        }
        bossCenterOpen={bossCenterOpen}
      />
      <BossCenter
        open={bossCenterOpen}
        onClose={() => setBossCenterOpen(false)}
        onOpenDesk={openDeskFromBoss}
        onInspectRoom={(projectId) => inspectRoom(projectId, 0)}
        onOpenMission={openMissionFromBoss}
      />
      <DeskDock />
      {/* dock da mesa de reunião (O-2): mesmo slot/largura — os dois docks
          leem dockDeskId e só UM renderiza (DeskDock ignora o id da mesa). */}
      <MissionDock />

      {projects.length === 0 ? (
        <EmptyState />
      ) : (
        onboard && <OnboardingOverlay />
      )}
    </>
  )

  return (
    <div
      data-testid="office-mode"
      className={cn(
        "absolute inset-0 overflow-hidden bg-background",
        hidden && "hidden",
      )}
    >
      {/* host do canvas Pixi (a cena instala o <canvas> aqui) */}
      <div
        ref={hostRef}
        data-testid="office-canvas"
        tabIndex={0}
        aria-label="Escritório virtual. Use WASD ou setas para andar, E para interagir e R para ciclar salas."
        className="absolute inset-0 touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brass/70"
      />

      {/* Telemetria (S2/S6): com a flag, o commit das árvores do office vira
          span react:commit — a flag é estável na sessão, o branch não troca. */}
      {perfEnabled() ? (
        <Profiler id="office-ui" onRender={onOfficeCommit}>
          {overlays}
        </Profiler>
      ) : (
        overlays
      )}
    </div>
  )
}
