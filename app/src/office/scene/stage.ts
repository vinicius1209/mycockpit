/** Stage Pixi do Agent Office — monta Application, camadas e a cena inteira,
 *  e expõe a interface imperativa consumida pela ui/ (O2/§6/§7).
 *
 *  Camadas:
 *    root (recebe o transform da câmera a cada render)
 *      ├ floorLayer   — chão + paredes norte/oeste estáticas (batch, sem cache)
 *      ├ fxLayer      — marcas de chão (highlight, click-to-move)
 *      └ dynamicLayer — y-sort por screenY dos pés (mesas fatiadas base+tampo,
 *                       segmentos de parede oclusores, plantas, avatares)
 *    labelLayer       — ESCALA DE TELA (fora do root; escala inversa ao zoom)
 *
 *  render(world, alpha): boss SEM interpolação (snap); câmera COM (lerp
 *  prev→pos por alpha). zIndex reatribuído só quando o valor quantizado muda.
 *  applySnapshot: dif por deskId — nunca recria objetos.
 */
import { Application, Container, Graphics, Text } from "pixi.js"
import {
  TILE_H,
  type DeskVisualState,
  type FloorPlan,
  type OfficeAgentId,
  type OfficeSnapshot,
  type Vec2,
  type World,
} from "../engine/types"
import { toScreen } from "../engine/iso"
import {
  agentColor,
  cameraTransform,
  deskAnchorWorld,
  deskContainsWorld,
  interactableContainsWorld,
  labelTextVisibleAtZoom,
  quantizeZIndex,
  resolveThemeTokens,
  screenToWorldWith,
  worldToScreenWith,
  zIndexChanged,
  type CameraTransform,
} from "./logic"
import { perfSpan } from "../engine/perf"
import {
  createDeskBase,
  createDeskTop,
  DESK_SCREEN_RECT,
  hashSeed,
  SPIKE_SCALE,
  type DeskTop,
} from "./props"
import {
  createAgentAvatar,
  createBossAvatar,
  type AgentAvatar,
  type BossAvatar,
} from "./avatars"
import { createRoomsView, type RoomsView } from "./rooms"
import {
  createDeskLabel,
  createRoomLabel,
  whenFontsReady,
  type DeskLabel,
  type RoomLabel,
} from "./labels"
import {
  createClickMarker,
  createDeskHighlight,
  createDustPuff,
  createScreenGlow,
  type ClickMarker,
  type DeskHighlight,
  type DustPuff,
  type ScreenGlow,
} from "./effects"
import { createWalkerSystem } from "./walkers"
import {
  behaviorTargetsFromPlan,
  createBehaviors,
  type BehaviorCtx,
  type BehaviorDeskInfo,
} from "./behaviors"
// [REGIÃO PACKS DE COMPORTAMENTO — imports, um por linha; frentes adicionam aqui]
import { createCorePack } from "./behaviors/core"
import { createPersonalPack } from "./behaviors/personal"
import { activeGateVisit, createMissionPack } from "./behaviors/mission"
import { createAmbientPack } from "./behaviors/ambient"

/** Offset vertical dos "pés" do avatar (sombra do spike em y=17, escalada). */
const FEET_OFFSET = 17 * SPIKE_SCALE

/** Agent sentado ATRÁS da mesa: pés do avatar N px de TELA acima da âncora
 *  (reto, centrado). O tampo (zIndex maior) oclui colo+assento; cabeça, tronco
 *  e encosto da cadeira aparecem acima/atrás do tampo. */
export const AGENT_BEHIND_DY = 50
/** Geometria nativa do glow ainda segue o monitor histórico; a transformação
 *  abaixo o encaixa no widescreen atual sem duplicar tesselação por mesa. */
const SCREEN_GLOW_NATIVE = { x: -22, y: -88, w: 44, h: 26 } as const
/** zIndex relativo à âncora da mesa. O tampo termina no limite sul do footprint
 *  2×1; quem pisa na faixa de aproximação precisa aparecer à frente dele. */
const DESK_BASE_ZBIAS = 2
const AGENT_ZBIAS = 6
const DESK_TOP_ZBIAS = TILE_H / 2
/** Ponto de CENA (px acima da âncora da mesa) onde o label ancora: topo da
 *  cabeça do agent sentado (~84px acima da âncora) + margem. Escala com o
 *  zoom — o cartão nunca cobre o agent atrás da mesa. */
const LABEL_ANCHOR_LIFT = 112
/** Ponto de CENA (px acima da BASE da parede norte) onde o label de SALA
 *  ancora — folga acima do topo da parede (96px), fora do caminho dos
 *  cartões de mesa no zoom-in e da TV/placa na parede. */
const ROOM_LABEL_LIFT = 152

/** Vida do balão "📄 handoff" (s) — efeito de cena pedido pelos behaviors. */
const HANDOFF_BUBBLE_LIFE_S = 1.6

/** Hit-área mínima do WALKER de gate-visit (agent esperando decisão na mesa
 *  do Boss), em px de CENA ao redor da posição projetada dos pés: o corpo é
 *  ALTO na projeção 2:1, então a caixa sobe até a cabeça e desce um tico. */
const GATE_WALKER_HIT = { halfW: 30, up: 110, down: 22 } as const

export type OfficeStage = {
  applySnapshot(s: OfficeSnapshot): void
  render(world: World, alpha: number): void
  setHover(deskId: string | null): void
  setHighlight(deskId: string | null): void
  setPromptTarget(targetId: string | null): void
  hitTestDesk(clientX: number, clientY: number): string | null
  worldToScreen(wx: number, wy: number): { x: number; y: number }
  screenToWorld(clientX: number, clientY: number): Vec2
  /** Âncora do BOSS em px de TELA do último render (mesmo mecanismo dos
   *  anchors de mesa — Prompts posiciona balões do boss com ela). Retorna um
   *  scratch mutável: consumir no MESMO rAF, nunca guardar. */
  bossScreen(): Vec2
  /** Conversa aberta na mesa (§5.4 v2): o avatar do desk FLIPA na direção do
   *  boss enquanto ativo (comparação por x de cena a cada render, com
   *  histerese) e restaura o flip original ao sair. null = ninguém conversa. */
  setConversing(deskId: string | null): void
  /** Feedback visual do click-to-move (marca no chão em coords de MUNDO) —
   *  quem decide o clique é a ui (pointerdown do OfficeMode); a sim clampa. */
  showClickAt(wx: number, wy: number): void
  destroy(): void
}

type DeskView = {
  id: string
  projectId: string
  agent: OfficeAgentId
  /** Cor do agent (mesma dos labels) — courier/café usam no avatar em pé. */
  color: string
  tile: Vec2
  anchor: Vec2
  anchorScene: Vec2
  /** Flip ORIGINAL da planta (restaurado ao fim da conversa — setConversing). */
  baseFlip: boolean
  top: DeskTop
  avatar: AgentAvatar
  label: DeskLabel
  /** Brilho pulsante do monitor — ativo SÓ com a mesa "typing". */
  glow: ScreenGlow
  /** Última tupla aplicada (dif discreto do snapshot). */
  applied: string
  /** Reposiciona o label no próximo frame mesmo com a câmera parada. */
  labelDirty: boolean
  /** Estado corrente do snapshot (os behaviors leem via ctx.deskState). */
  state: DeskVisualState
}

/** Label de SALA em escala de tela (LOD inverso ao das mesas). */
type RoomLabelView = {
  label: RoomLabel
  /** Âncora de CENA: centro da parede norte da sala. */
  ax: number
  ay: number
  dirty: boolean
}

// HMR: destruir Applications vivas ao descartar o módulo (contexts WebGL vazam)
const liveDisposers = new Set<() => void>()
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const d of [...liveDisposers]) d()
  })
}

export async function createOfficeStage(
  host: HTMLElement,
  plan: FloorPlan,
  opts: { reducedMotion: boolean },
): Promise<OfficeStage> {
  const app = new Application()
  let destroyed = false

  const dispose = () => {
    if (destroyed) return
    destroyed = true
    liveDisposers.delete(dispose)
    // remove canvas + destrói árvore; contexts compartilhados (props) sobrevivem
    app.destroy({ removeView: true }, { children: true, texture: false })
  }
  liveDisposers.add(dispose)

  await app.init({
    preference: "webgl",
    antialias: true,
    resolution: Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, 2),
    autoDensity: true,
    resizeTo: host,
    backgroundAlpha: 0,
  })
  // token de cancelamento (StrictMode monta 2×): host saiu do DOM durante o
  // init assíncrono ⇒ aborta e libera o contexto WebGL
  if (destroyed || !host.isConnected) {
    dispose()
    throw new Error("office/stage: init cancelado (host desmontado)")
  }
  app.ticker.maxFPS = 60
  host.appendChild(app.canvas)

  const tokens = resolveThemeTokens()

  // --- camadas -------------------------------------------------------------
  const root = new Container()
  const floorLayer = new Container()
  const fxLayer = new Container()
  const dynamicLayer = new Container()
  dynamicLayer.sortableChildren = true
  root.addChild(floorLayer, fxLayer, dynamicLayer)
  const labelLayer = new Container() // escala de TELA — fora do root
  app.stage.addChild(root, labelLayer)

  // --- efeitos de chão -----------------------------------------------------
  const hoverFx: DeskHighlight = createDeskHighlight(0xffffff)
  const reachFx: DeskHighlight = createDeskHighlight(tokens.brass)
  const clickFx: ClickMarker = createClickMarker(tokens.brass)
  fxLayer.addChild(hoverFx.root, reachFx.root, clickFx.root)

  // placas e labels usam Pixi Text — só depois das fontes (senão medem errado)
  await whenFontsReady()
  if (destroyed || !host.isConnected) {
    dispose()
    throw new Error("office/stage: init cancelado (host desmontado)")
  }

  // --- cenário -------------------------------------------------------------
  const rooms: RoomsView = createRoomsView(plan, tokens)
  floorLayer.addChild(rooms.staticRoot)
  for (const item of rooms.dynamicItems) {
    item.container.zIndex = item.zIndex
    dynamicLayer.addChild(item.container)
  }

  // --- labels de SALA (identificação de relance; LOD inverso) --------------
  const roomLabels: RoomLabelView[] = []
  const roomLabelByProject = new Map<string, RoomLabelView>()
  for (const room of plan.rooms) {
    const a = toScreen(room.origin.x + room.w / 2, room.origin.y)
    const label = createRoomLabel(room.projectId, tokens)
    labelLayer.addChild(label.root)
    const view: RoomLabelView = { label, ax: a.x, ay: a.y, dirty: true }
    roomLabels.push(view)
    roomLabelByProject.set(room.projectId, view)
  }
  if (plan.commonRoom) {
    const c = plan.commonRoom
    const a = toScreen(c.origin.x + c.w / 2, c.origin.y)
    const label = createRoomLabel("Sala comum", tokens)
    label.setAggregate(null)
    labelLayer.addChild(label.root)
    roomLabels.push({ label, ax: a.x, ay: a.y, dirty: true })
  }

  // --- mesas + avatares + labels ------------------------------------------
  const desks = new Map<string, DeskView>()
  for (const room of plan.rooms) {
    for (const desk of room.desks) {
      const anchor = deskAnchorWorld(desk.tile)
      const anchorScene = toScreen(anchor.x, anchor.y)

      const base = createDeskBase()
      base.position.set(anchorScene.x, anchorScene.y)
      base.zIndex = quantizeZIndex(anchorScene.y + DESK_BASE_ZBIAS)
      const top = createDeskTop()
      top.root.position.set(anchorScene.x, anchorScene.y)
      top.root.zIndex = quantizeZIndex(anchorScene.y + DESK_TOP_ZBIAS)
      if (desk.flip) {
        base.scale.x = -SPIKE_SCALE
        top.root.scale.x = -SPIKE_SCALE
      }
      dynamicLayer.addChild(base, top.root)

      // brilho pulsante do monitor (irmão da tela dentro do deskTop; coords
      // locais) — ligado/desligado no applySnapshot (typing)
      const glow = createScreenGlow(hashSeed(desk.id))
      const glowScaleX = DESK_SCREEN_RECT.w / SCREEN_GLOW_NATIVE.w
      const glowScaleY = DESK_SCREEN_RECT.h / SCREEN_GLOW_NATIVE.h
      glow.root.scale.set(glowScaleX, glowScaleY)
      glow.root.position.set(
        DESK_SCREEN_RECT.x - SCREEN_GLOW_NATIVE.x * glowScaleX,
        DESK_SCREEN_RECT.y - SCREEN_GLOW_NATIVE.y * glowScaleY,
      )
      top.root.addChild(glow.root)

      // agent SENTADO atrás da mesa: offset FIXO de tela a partir da âncora
      // (centrado; nada de vetor até o interactTile). O sanduíche de zIndex
      // parede < avatar < tampo faz o tampo ocluir o colo sem engolir a cabeça.
      const agentScene = { x: anchorScene.x, y: anchorScene.y - AGENT_BEHIND_DY }
      // cor derivada dos tokens do tema (fonte única — nada de hex duplicado)
      const color = agentColor(desk.agent, tokens)
      // seed por deskId: fase/variante de idle + agenda de micro-ações
      // determinísticas (a mesma mesa "vive" igual entre sessões)
      const avatar = createAgentAvatar(desk.agent, color, undefined, hashSeed(desk.id))
      avatar.setFlip(desk.flip)
      avatar.root.position.set(agentScene.x, agentScene.y)
      avatar.root.zIndex = quantizeZIndex(anchorScene.y + AGENT_ZBIAS)
      dynamicLayer.addChild(avatar.root)

      // nome vem do plan (registry via bridge/layout); id é o fallback cru
      const label = createDeskLabel(desk.agentName ?? desk.agent, color, tokens)
      labelLayer.addChild(label.root)

      desks.set(desk.id, {
        id: desk.id,
        projectId: desk.projectId,
        agent: desk.agent,
        color,
        tile: desk.tile,
        anchor,
        anchorScene,
        baseFlip: desk.flip,
        top,
        avatar,
        label,
        glow,
        applied: "",
        labelDirty: true,
        state: "idle",
      })
    }
  }

  // --- boss ----------------------------------------------------------------
  const boss: BossAvatar = createBossAvatar(tokens.brass)
  {
    const p = toScreen(plan.spawn.x, plan.spawn.y)
    boss.root.position.set(p.x, p.y)
    boss.root.zIndex = quantizeZIndex(p.y + FEET_OFFSET)
  }
  dynamicLayer.addChild(boss.root)
  let bossZQ = boss.root.zIndex

  // baforada de poeira na CHEGADA do click-to-move (pooled; zero alocação)
  const puff: DustPuff = createDustPuff(hashSeed("boss|puff"))
  dynamicLayer.addChild(puff.root)
  let bossWasMoving = false

  // âncora do boss em px de TELA (scratch — atualizado a cada render)
  const bossScreenScratch: Vec2 = { x: 0, y: 0 }

  // --- vida no escritório: sistema de COMPORTAMENTOS (scene/behaviors) -----
  const walkers = createWalkerSystem(plan)
  /** Centro caminhável de interação de cada mesa (origem/destino de walkers). */
  const interactByDesk = new Map<string, Vec2>()
  for (const room of plan.rooms) {
    for (const d of room.desks) {
      interactByDesk.set(d.id, {
        x: d.interactTile.x + 0.5,
        y: d.interactTile.y + 0.5,
      })
    }
  }

  /** Balões efêmeros "📄 handoff" na cena (poucos e discretos; só sem
   *  reducedMotion — courier nem spawna com ela ligada). */
  type Bubble = { root: Container; baseY: number; born: number }
  const bubbles: Bubble[] = []
  const spawnHandoffBubble = (view: DeskView): void => {
    const root = new Container()
    const text = new Text({
      text: "📄 handoff",
      style: {
        fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif",
        fontSize: 13,
        fontWeight: "600",
        fill: 0xf0f1f2,
      },
    })
    text.anchor.set(0.5)
    const pad = { x: 9, y: 5 }
    const bg = new Graphics()
      .roundRect(
        -text.width / 2 - pad.x,
        -text.height / 2 - pad.y,
        text.width + pad.x * 2,
        text.height + pad.y * 2,
        9,
      )
      .fill({ color: 0x1c2127, alpha: 0.92 })
      .stroke({ color: 0xffffff, alpha: 0.14, width: 1 })
    root.addChild(bg, text)
    const baseY = view.anchorScene.y - LABEL_ANCHOR_LIFT + 22
    root.position.set(view.anchorScene.x, baseY)
    root.zIndex = quantizeZIndex(view.anchorScene.y + DESK_TOP_ZBIAS) + 4
    dynamicLayer.addChild(root)
    bubbles.push({ root, baseY, born: lastTime })
  }
  const tickBubbles = (time: number): void => {
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i]
      const t = time - b.born
      if (t >= HANDOFF_BUBBLE_LIFE_S) {
        b.root.destroy({ children: true })
        bubbles.splice(i, 1)
        continue
      }
      // sobe suave e some no último trecho (transform/alpha apenas)
      b.root.position.y = b.baseY - 10 * (t / HANDOFF_BUBBLE_LIFE_S)
      const fade = HANDOFF_BUBBLE_LIFE_S - 0.5
      b.root.alpha = t < fade ? 1 : 1 - (t - fade) / 0.5
    }
  }

  // --- comportamentos: orquestrador + ctx (ponte cena ↔ behaviors) ---------
  const behaviors = createBehaviors({ plan, walkers, reducedMotion: opts.reducedMotion })
  // [REGIÃO PACKS DE COMPORTAMENTO — registerPack, um por linha; frentes
  //  adicionam aqui (mission/personal/ambient em scene/behaviors/*.ts)]
  behaviors.registerPack(createCorePack())
  behaviors.registerPack(createPersonalPack())
  behaviors.registerPack(createMissionPack())
  behaviors.registerPack(createAmbientPack({ layer: dynamicLayer }))

  /** Dados de spawn por mesa (agent/cor/seed/âncora caminhável) — imutável. */
  const infoByDesk = new Map<string, BehaviorDeskInfo>()
  const deskIdList: string[] = []
  for (const view of desks.values()) {
    const anchor = interactByDesk.get(view.id)
    if (!anchor) continue
    deskIdList.push(view.id)
    infoByDesk.set(view.id, {
      id: view.id,
      agent: view.agent,
      color: view.color,
      seed: hashSeed(view.id),
      anchor,
    })
  }
  /** Última posição conhecida do boss em MUNDO (render atualiza a referência). */
  let bossWorldPos: Vec2 = { x: plan.spawn.x, y: plan.spawn.y }
  const behaviorCtx: BehaviorCtx = {
    hideSeated(deskId) {
      const view = desks.get(deskId)
      if (view) view.avatar.root.visible = false
    },
    showSeated(deskId) {
      const view = desks.get(deskId)
      // mesa "off" não ressuscita avatar: a pose do estado manda (a cadeira
      // vazia do ambiente é quem representa a mesa apagada)
      if (view) view.avatar.root.visible = view.state !== "off"
    },
    seatedVisible(deskId) {
      return desks.get(deskId)?.avatar.root.visible ?? false
    },
    deskAnchor(deskId) {
      return interactByDesk.get(deskId) ?? null
    },
    deskState(deskId) {
      return desks.get(deskId)?.state ?? null
    },
    deskInfo(deskId) {
      return infoByDesk.get(deskId) ?? null
    },
    deskIds() {
      return deskIdList
    },
    bossPos() {
      return bossWorldPos
    },
    targets: behaviorTargetsFromPlan(plan),
    time: 0,
    spawnWalker(spawnOpts) {
      const walker = walkers.spawn(spawnOpts)
      dynamicLayer.addChild(walker.root)
      return walker
    },
    handoffBubble(deskId) {
      const view = desks.get(deskId)
      if (view) spawnHandoffBubble(view)
    },
    waveSeated(deskId) {
      const view = desks.get(deskId)
      if (!view) return
      // olha pro lado do boss (mesma projeção do flip de conversa)
      const bp = toScreen(bossWorldPos.x, bossWorldPos.y)
      view.avatar.wave(lastTime, bp.x < view.anchorScene.x ? "left" : "right")
    },
  }

  // conversa ativa: avatar do desk flipa pro boss (histerese em px de CENA —
  // invariante ao zoom; dentro da banda mantém o flip corrente, sem tremer)
  const CONVERSE_HYST_PX = 14
  let conversing: { view: DeskView; flip: boolean } | null = null

  // --- input DOM -----------------------------------------------------------
  // Clique é responsabilidade do OfficeMode (pointerdown → sim); a cena só
  // expõe hitTestDesk/showClickAt — nenhum listener duplicado aqui.
  /** Offset do transform SEMPRE zero: o screenOffset do dock é responsabilidade
   *  da updateCamera do engine (baked em cam.pos). Ver render(). */
  const ZERO_OFFSET = { x: 0, y: 0 }
  let lastTransform: CameraTransform = cameraTransform(
    plan.spawn,
    1,
    app.screen.width,
    app.screen.height,
    ZERO_OFFSET,
  )
  /** Scratch da posição interpolada da câmera (zero alocação por frame). */
  const camPosScratch = { x: 0, y: 0 }
  let lastTime = 0

  const toCanvas = (clientX: number, clientY: number): Vec2 => {
    const rect = app.canvas.getBoundingClientRect()
    return { x: clientX - rect.left, y: clientY - rect.top }
  }
  const hitTestDesk = (clientX: number, clientY: number): string | null => {
    const p = toCanvas(clientX, clientY)
    // agent ESPERANDO DECISÃO na mesa do Boss (gate-visit): o clique no
    // walker mapeia pro deskId DELE — caixa em px de tela (o corpo é alto na
    // projeção; um teste por tile de mundo só acertaria os pés)
    const gv = activeGateVisit()
    if (gv) {
      const gp = worldToScreenWith(lastTransform, gv.pos.x, gv.pos.y)
      const sc = lastTransform.scale
      const dx = p.x - gp.x
      const dy = p.y - gp.y
      if (
        Math.abs(dx) <= GATE_WALKER_HIT.halfW * sc &&
        dy >= -GATE_WALKER_HIT.up * sc &&
        dy <= GATE_WALKER_HIT.down * sc
      ) {
        return gv.deskId
      }
    }
    const w = screenToWorldWith(lastTransform, p.x, p.y)
    for (const d of desks.values()) {
      if (deskContainsWorld(d.tile, w.x, w.y)) return d.id
    }
    for (const target of plan.interactables ?? []) {
      if (interactableContainsWorld(target.tile, target.footprint, w.x, w.y)) return target.id
    }
    return null
  }

  // --- estado de hover/highlight ------------------------------------------
  let hoverId: string | null = null
  let highlightId: string | null = null
  let promptTargetId: string | null = null
  const placeFx = (fx: DeskHighlight, deskId: string | null): void => {
    if (!deskId) {
      fx.hide()
      return
    }
    const d = desks.get(deskId)
    if (d) {
      fx.showAt(d.anchorScene.x, d.anchorScene.y)
      return
    }
    const target = plan.interactables?.find((item) => item.id === deskId)
    if (target) {
      const p = toScreen(target.tile.x, target.tile.y)
      fx.showAt(p.x, p.y)
    } else fx.hide()
  }

  // --- snapshot (dif discreto) --------------------------------------------
  const applySnapshot = (s: OfficeSnapshot): void => {
    const endSpan = perfSpan("applySnapshot") // S4 (no-op sem mc.office.perf)
    for (const room of s.rooms) {
      rooms.setRoomInfo(room.projectId, room.name, room.color)
      rooms.setRoomAggregate(room.projectId, room.agg)
      const rl = roomLabelByProject.get(room.projectId)
      if (rl) {
        rl.label.setInfo(room.name, room.color ?? tokens.brass)
        rl.label.setAggregate(room.agg)
      }
      for (const desk of room.desks) {
        const view = desks.get(desk.id)
        if (!view) continue // mesa desconhecida no plan: nunca dropar — ignora visualmente
        view.state = desk.state // vida ociosa/abortos leem o estado corrente
        const key = `${desk.state}|${desk.label}|${desk.detail ?? ""}|${desk.hand ?? ""}`
        if (view.applied === key) continue
        view.applied = key
        view.avatar.setState(desk.state)
        view.top.setScreenOn(desk.state !== "off")
        view.top.root.alpha = desk.state === "off" ? 0.5 : 1
        view.glow.setActive(desk.state === "typing")
        view.label.setState(desk.state, desk.label, desk.detail)
      }
    }
    // balões de entrega são do overlay DOM (ui/Prompts.tsx) — a cena não os
    // duplica; aqui só estados/labels/luzes.

    // [REGIÃO AMBIENTE: snapshot → TV/kanban/cadeira vazia/pilha do boss —
    //  dif discreto dentro de rooms.applyAmbient; quando o pack missão
    //  publicar useOfficeUi.unseenDeliveries, passe { bossPile } aqui]
    rooms.applyAmbient(s)

    // comportamentos (handoff/café/...): abortos por estado + reação dos packs
    behaviorCtx.time = lastTime
    behaviors.applySnapshot(s, behaviorCtx)
    endSpan()
  }

  // --- render por frame ----------------------------------------------------
  const render = (world: World, alpha: number): void => {
    if (destroyed) return
    const endSpan = perfSpan("stage:render") // coração do frame (no-op sem flag)
    // dt do relógio da sim (walkers avançam por ele; clamp anti-salto)
    const dt = Math.min(Math.max(world.time - lastTime, 0), 0.25)
    lastTime = world.time
    const reduced = opts.reducedMotion

    // câmera COM interpolação (lerp prev→pos por alpha) — scratch, sem alocar
    const cam = world.camera
    camPosScratch.x = cam.prev.x + (cam.pos.x - cam.prev.x) * alpha
    camPosScratch.y = cam.prev.y + (cam.pos.y - cam.prev.y) * alpha
    // Convenção do engine/camera.ts: camera.pos mapeia para o CENTRO do
    // viewport — o screenOffset do dock já foi APLICADO pela updateCamera
    // (baked em cam.pos, com suavização). Passá-lo de novo aqui dobraria o
    // deslocamento; o transform usa offset zero.
    const t = cameraTransform(
      camPosScratch,
      cam.zoom,
      app.screen.width,
      app.screen.height,
      ZERO_OFFSET,
    )
    // câmera parada ⇒ pula o reposicionamento dos labels (âncoras estáticas);
    // o resize entra aqui de graça (o transform depende de app.screen)
    const camMoved =
      t.x !== lastTransform.x || t.y !== lastTransform.y || t.scale !== lastTransform.scale
    lastTransform = t
    root.position.set(t.x, t.y)
    root.scale.set(t.scale)

    // boss SEM interpolação (snap ao estado da sim)
    const bp = toScreen(world.boss.pos.x, world.boss.pos.y)
    // âncora do boss pros overlays DOM (mesma projeção dos labels)
    bossScreenScratch.x = bp.x * t.scale + t.x
    bossScreenScratch.y = bp.y * t.scale + t.y
    // conversa ativa: agent da mesa olha pro boss (x de CENA, com histerese)
    if (conversing) {
      const dx = bp.x - conversing.view.anchorScene.x
      if (dx > CONVERSE_HYST_PX && conversing.flip) {
        conversing.flip = false
        conversing.view.avatar.setFlip(false)
      } else if (dx < -CONVERSE_HYST_PX && !conversing.flip) {
        conversing.flip = true
        conversing.view.avatar.setFlip(true)
      }
    }
    boss.root.position.set(bp.x, bp.y)
    boss.setMoving(world.boss.moving)
    boss.setFacing(world.boss.facing)
    const feetY = bp.y + FEET_OFFSET
    if (zIndexChanged(bossZQ, feetY)) {
      bossZQ = quantizeZIndex(feetY)
      boss.root.zIndex = bossZQ // atribuição só quando o quantizado muda (re-sort)
    }
    boss.updateAnim(world.time, reduced)

    // chegada do click-to-move (moving true→false) ⇒ baforada nos pés
    if (bossWasMoving && !world.boss.moving && !reduced) {
      puff.root.zIndex = bossZQ + 1
      puff.burstAt(bp.x, feetY, world.time)
    }
    bossWasMoving = world.boss.moving
    puff.update(world.time, reduced)

    // comportamentos (handoff/café/...): pausas, ticks dos packs e o avanço
    // dos walkers acontecem no orquestrador
    bossWorldPos = world.boss.pos
    behaviorCtx.time = world.time
    behaviors.update(dt, behaviorCtx)
    tickBubbles(world.time)

    // [REGIÃO AMBIENTE: daylight/TV/pile]
    // dia/noite real (1×/min), fade das caixas de mudança (1×/s) e pulso do
    // kanban vivem DENTRO de rooms.tick (chamado abaixo); TV/kanban/cadeira
    // vazia/pilha redesenham só no applySnapshot (rooms.applyAmbient).

    // labels em escala de TELA (camada fora do root) + LOD por zoom
    const textVisible = labelTextVisibleAtZoom(cam.zoom)
    for (const d of desks.values()) {
      if (camMoved || d.labelDirty) {
        // projeção direta da âncora pré-computada (sem alocar Vec2 por mesa)
        d.labelDirty = false
        d.label.root.position.set(
          d.anchorScene.x * t.scale + t.x,
          (d.anchorScene.y - LABEL_ANCHOR_LIFT) * t.scale + t.y,
        )
      }
      d.label.setLod(textVisible, cam.zoom)
      d.label.root.visible = d.id !== promptTargetId
      // revelação progressiva: cartão completo só na mesa em foco (hover do
      // mouse OU alvo de proximidade do boss); as demais ficam em pill. A mão
      // levantada expande sozinha (interno ao label).
      d.label.setEmphasis(d.id === hoverId || d.id === highlightId ? "expanded" : "pill")
      d.label.tick(world.time, reduced)
      d.avatar.updateAnim(world.time, reduced)
      d.glow.update(world.time, reduced)
    }

    // labels de SALA — LOD INVERSO: dominantes no zoom-out, discretos no zoom-in
    for (const rl of roomLabels) {
      if (camMoved || rl.dirty) {
        rl.dirty = false
        rl.label.root.position.set(
          rl.ax * t.scale + t.x,
          (rl.ay - ROOM_LABEL_LIFT) * t.scale + t.y,
        )
      }
      rl.label.setLod(cam.zoom)
      rl.label.tick(world.time, reduced)
    }

    rooms.setLod(cam.zoom)
    rooms.tick(world.time, reduced)
    hoverFx.tick(world.time, reduced)
    reachFx.tick(world.time, reduced)
    clickFx.tick(world.time, reduced)
    endSpan()
  }

  return {
    applySnapshot,
    render,
    setHover(deskId) {
      if (deskId === hoverId) return
      hoverId = deskId
      // hover não repete o realce quando a mesa já está em alcance; hover no
      // WALKER do gate-visit não acende a mesa de ORIGEM (o corpo está na do
      // Boss — realçar a cadeira vazia do outro lado da planta confundiria)
      const suppress =
        hoverId === highlightId || hoverId === activeGateVisit()?.deskId
      placeFx(hoverFx, suppress ? null : hoverId)
      app.canvas.style.cursor = deskId ? "pointer" : "default"
    },
    setHighlight(deskId) {
      if (deskId === highlightId) return
      highlightId = deskId
      placeFx(reachFx, highlightId)
      if (hoverId === highlightId) placeFx(hoverFx, null)
    },
    setPromptTarget(targetId) {
      promptTargetId = targetId
    },
    hitTestDesk,
    bossScreen() {
      return bossScreenScratch
    },
    setConversing(deskId) {
      if (conversing?.view.id === (deskId ?? undefined)) return
      if (conversing) {
        // restaura o flip ORIGINAL da planta ao sair da conversa
        conversing.view.avatar.setFlip(conversing.view.baseFlip)
        conversing.view.avatar.setAttention("work")
        conversing = null
      }
      if (!deskId) return
      const view = desks.get(deskId)
      if (!view) return // mesa fora da planta (projeto removido): no-op
      view.avatar.setAttention("visitor")
      conversing = { view, flip: view.baseFlip }
    },
    worldToScreen(wx, wy) {
      return worldToScreenWith(lastTransform, wx, wy)
    },
    screenToWorld(clientX, clientY) {
      const p = toCanvas(clientX, clientY)
      return screenToWorldWith(lastTransform, p.x, p.y)
    },
    showClickAt(wx, wy) {
      // marca de click-to-move no ponto clicado (a sim decide/clampa o destino)
      const s = toScreen(wx, wy)
      clickFx.showAt(s.x, s.y, lastTime)
    },
    destroy() {
      if (destroyed) return
      behaviors.clear() // aborta viagens (restaura sentados) + walkers.clear
      for (const b of bubbles) b.root.destroy({ children: true })
      bubbles.length = 0
      for (const d of desks.values()) {
        d.avatar.destroy()
        d.label.destroy()
      }
      for (const rl of roomLabels) rl.label.destroy()
      boss.destroy()
      rooms.destroy()
      dispose()
    },
  }
}
