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
import { Application, Container } from "pixi.js"
import {
  TILE_H,
  type FloorPlan,
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
  labelTextVisibleAtZoom,
  quantizeZIndex,
  resolveThemeTokens,
  screenToWorldWith,
  worldToScreenWith,
  zIndexChanged,
  type CameraTransform,
} from "./logic"
import { createDeskBase, createDeskTop, hashSeed, SPIKE_SCALE, type DeskTop } from "./props"
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

/** Offset vertical dos "pés" do avatar (sombra do spike em y=17, escalada). */
const FEET_OFFSET = 17 * SPIKE_SCALE

/** Agent sentado ATRÁS da mesa: pés do avatar N px de TELA acima da âncora
 *  (reto, centrado). O tampo (zIndex maior) oclui colo+assento; cabeça, tronco
 *  e encosto da cadeira aparecem acima/atrás do tampo. */
const AGENT_BEHIND_DY = 17
/** zIndex relativo à âncora da mesa: parede norte oclusora (row 1) fica em
 *  ~anchor.y por tile ⇒ base/avatar precisam ficar À FRENTE dela e ATRÁS do
 *  tampo (anchor.y + TILE_H). */
const DESK_BASE_ZBIAS = 2
const AGENT_ZBIAS = 6
/** Ponto de CENA (px acima da âncora da mesa) onde o label ancora: topo da
 *  cabeça do agent sentado (~84px acima da âncora) + margem. Escala com o
 *  zoom — o cartão nunca cobre o agent atrás da mesa. */
const LABEL_ANCHOR_LIFT = 96
/** Ponto de CENA (px acima da BASE da parede norte) onde o label de SALA
 *  ancora — folga acima do topo da parede (96px), fora do caminho dos
 *  cartões de mesa no zoom-in e da TV/placa na parede. */
const ROOM_LABEL_LIFT = 152

export type OfficeStage = {
  applySnapshot(s: OfficeSnapshot): void
  render(world: World, alpha: number): void
  setHover(deskId: string | null): void
  setHighlight(deskId: string | null): void
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
      top.root.zIndex = quantizeZIndex(anchorScene.y + TILE_H)
      if (desk.flip) {
        base.scale.x = -SPIKE_SCALE
        top.root.scale.x = -SPIKE_SCALE
      }
      dynamicLayer.addChild(base, top.root)

      // brilho pulsante do monitor (irmão da tela dentro do deskTop; coords
      // locais) — ligado/desligado no applySnapshot (typing)
      const glow = createScreenGlow(hashSeed(desk.id))
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
    const w = screenToWorldWith(lastTransform, p.x, p.y)
    for (const d of desks.values()) {
      if (deskContainsWorld(d.tile, w.x, w.y)) return d.id
    }
    return null
  }

  // --- estado de hover/highlight ------------------------------------------
  let hoverId: string | null = null
  let highlightId: string | null = null
  const placeFx = (fx: DeskHighlight, deskId: string | null): void => {
    if (!deskId) {
      fx.hide()
      return
    }
    const d = desks.get(deskId)
    if (!d) {
      fx.hide()
      return
    }
    fx.showAt(d.anchorScene.x, d.anchorScene.y)
  }

  // --- snapshot (dif discreto) --------------------------------------------
  const applySnapshot = (s: OfficeSnapshot): void => {
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
  }

  // --- render por frame ----------------------------------------------------
  const render = (world: World, alpha: number): void => {
    if (destroyed) return
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
  }

  return {
    applySnapshot,
    render,
    setHover(deskId) {
      if (deskId === hoverId) return
      hoverId = deskId
      // hover não repete o realce quando a mesa já está em alcance
      placeFx(hoverFx, hoverId === highlightId ? null : hoverId)
      app.canvas.style.cursor = deskId ? "pointer" : "default"
    },
    setHighlight(deskId) {
      if (deskId === highlightId) return
      highlightId = deskId
      placeFx(reachFx, highlightId)
      if (hoverId === highlightId) placeFx(hoverFx, null)
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
        conversing = null
      }
      if (!deskId) return
      const view = desks.get(deskId)
      if (!view) return // mesa fora da planta (projeto removido): no-op
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
