/** Lógica pura da cena (sem Pixi, sem DOM obrigatório) — 100% testável.
 *
 *  A projeção diamond 2:1 vem do engine/iso (toScreen/toWorld) — fonte única;
 *  aqui só vive o que é específico da cena (câmera aplicada, LOD, cores).
 */
import { toScreen, toWorld } from "../engine/iso"
import type {
  Vec2,
  DeskVisualState,
  OfficeAgentId,
  RoomAggregate,
} from "../engine/types"

// ---------------------------------------------------------------------------
// Transform da câmera (aplicado no container raiz a cada render)
// ---------------------------------------------------------------------------

export type CameraTransform = {
  /** Posição do container raiz em px de tela. */
  x: number
  y: number
  scale: number
}

/** Posição/escala do container raiz para centrar `camWorld` no viewport
 *  (screenOffset desloca o centro de framing, ex.: dock aberto). */
export function cameraTransform(
  camWorld: Vec2,
  zoom: number,
  viewportW: number,
  viewportH: number,
  screenOffset: Vec2,
): CameraTransform {
  const p = toScreen(camWorld.x, camWorld.y)
  return {
    x: viewportW / 2 + screenOffset.x - p.x * zoom,
    y: viewportH / 2 + screenOffset.y - p.y * zoom,
    scale: zoom,
  }
}

/** px de tela (relativos ao canvas) → mundo, dado o transform corrente. */
export function screenToWorldWith(t: CameraTransform, sx: number, sy: number): Vec2 {
  return toWorld((sx - t.x) / t.scale, (sy - t.y) / t.scale)
}

/** mundo → px de tela (relativos ao canvas), dado o transform corrente. */
export function worldToScreenWith(t: CameraTransform, wx: number, wy: number): Vec2 {
  const p = toScreen(wx, wy)
  return { x: p.x * t.scale + t.x, y: p.y * t.scale + t.y }
}

// ---------------------------------------------------------------------------
// Y-sort — zIndex quantizado (re-sort só quando o inteiro muda)
// ---------------------------------------------------------------------------

/** Quantiza o screenY dos pés para px inteiro — zIndex estável. */
export function quantizeZIndex(screenY: number): number {
  return Math.round(screenY)
}

/** True quando o zIndex quantizado mudou (única situação em que reatribuímos —
 *  atribuição dispara re-sort da camada dinâmica). */
export function zIndexChanged(prevQuantized: number, screenY: number): boolean {
  return quantizeZIndex(screenY) !== prevQuantized
}

// ---------------------------------------------------------------------------
// LOD de labels
// ---------------------------------------------------------------------------

/** Abaixo deste zoom o texto do label some (fica só o beacon de estado). */
export const LABEL_LOD_MIN_ZOOM = 0.8

export function labelTextVisibleAtZoom(zoom: number): boolean {
  return zoom >= LABEL_LOD_MIN_ZOOM
}

// ---------------------------------------------------------------------------
// Mapeamento DeskVisualState → partes visíveis do avatar (O6)
// ---------------------------------------------------------------------------

export type ArmRightPose =
  | "down" //   braço baixo (idle/typing)
  | "chin" //   mão no queixo (thinking — pose do spike)
  | "raised" // mão erguida (hand — precisa do humano)

export type AvatarParts = {
  /** false ⇒ avatar inteiro oculto (mesa apagada, CLI não detectado). */
  visible: boolean
  /** Caneca de café (prop de idle). */
  coffee: boolean
  /** Balões de pensamento. */
  thoughtDots: boolean
  /** Braços alternando digitação. */
  typingArms: boolean
  armRightPose: ArmRightPose
}

export function partsForState(state: DeskVisualState): AvatarParts {
  switch (state) {
    case "off":
      return { visible: false, coffee: false, thoughtDots: false, typingArms: false, armRightPose: "down" }
    case "idle":
      return { visible: true, coffee: true, thoughtDots: false, typingArms: false, armRightPose: "down" }
    case "thinking":
      return { visible: true, coffee: false, thoughtDots: true, typingArms: false, armRightPose: "chin" }
    case "typing":
      return { visible: true, coffee: false, thoughtDots: false, typingArms: true, armRightPose: "down" }
    case "hand":
      return { visible: true, coffee: false, thoughtDots: false, typingArms: false, armRightPose: "raised" }
  }
}

// ---------------------------------------------------------------------------
// Tokens de tema (--brass / --st-*) — leitura injetável p/ teste; fallback
// dark-first espelhando app/src/index.css
// ---------------------------------------------------------------------------

export type ThemeTokens = {
  brass: string
  stIdle: string
  stRunning: string
  stQueued: string
  stSuccess: string
  stError: string
}

/** Fallback dark-first (valores do tema escuro em index.css). */
export const DARK_TOKEN_FALLBACK: ThemeTokens = {
  brass: "#e4a862",
  stIdle: "#687078",
  stRunning: "#5bb8e8",
  stQueued: "#d99138",
  stSuccess: "#5bd6a0",
  stError: "#f2766b",
}

/** Resolve os tokens do tema; `read` injetável (default: getComputedStyle). */
export function resolveThemeTokens(read?: (varName: string) => string): ThemeTokens {
  const readVar =
    read ??
    ((name: string) => {
      if (typeof document === "undefined") return ""
      return getComputedStyle(document.documentElement).getPropertyValue(name)
    })
  const pick = (name: string, fallback: string): string => {
    const v = readVar(name).trim()
    return v.length > 0 ? v : fallback
  }
  return {
    brass: pick("--brass", DARK_TOKEN_FALLBACK.brass),
    stIdle: pick("--st-idle", DARK_TOKEN_FALLBACK.stIdle),
    stRunning: pick("--st-running", DARK_TOKEN_FALLBACK.stRunning),
    stQueued: pick("--st-queued", DARK_TOKEN_FALLBACK.stQueued),
    stSuccess: pick("--st-success", DARK_TOKEN_FALLBACK.stSuccess),
    stError: pick("--st-error", DARK_TOKEN_FALLBACK.stError),
  }
}

/** Cor de identidade do agent DERIVADA dos tokens do tema (fonte única — nada
 *  de hex duplicado: claude=brass, codex=azul running, agy=verde success). */
export function agentColor(agent: OfficeAgentId, tokens: ThemeTokens): string {
  switch (agent) {
    case "claude-code":
      return tokens.brass
    case "codex":
      return tokens.stRunning
    case "agy":
      return tokens.stSuccess
  }
}

/** Cor do beacon de estado do label (linguagem do spike: thinking=brass,
 *  typing=azul, idle=verde; hand=âmbar da fila; off=cinza). */
export function beaconColorForState(state: DeskVisualState, tokens: ThemeTokens): string {
  switch (state) {
    case "off":
      return tokens.stIdle
    case "idle":
      return tokens.stSuccess
    case "thinking":
      return tokens.brass
    case "typing":
      return tokens.stRunning
    case "hand":
      return tokens.stQueued
  }
}

/** Luz da porta pelo agregado da sala (§3: hand=âmbar pulsando, running=azul,
 *  idle=verde). */
export function doorLightColor(agg: RoomAggregate, tokens: ThemeTokens): string {
  switch (agg) {
    case "hand":
      return tokens.stQueued
    case "running":
      return tokens.stRunning
    case "idle":
      return tokens.stSuccess
  }
}

/** Só o agregado "hand" pulsa (âmbar chamando atenção). */
export function doorLightPulses(agg: RoomAggregate): boolean {
  return agg === "hand"
}

// ---------------------------------------------------------------------------
// Hit-test de mesa (footprint 2×2 tiles a partir do tile de origem)
// ---------------------------------------------------------------------------

export const DESK_FOOT_W = 2
export const DESK_FOOT_H = 2

export function deskContainsWorld(deskTile: Vec2, wx: number, wy: number): boolean {
  return (
    wx >= deskTile.x &&
    wx < deskTile.x + DESK_FOOT_W &&
    wy >= deskTile.y &&
    wy < deskTile.y + DESK_FOOT_H
  )
}

/** Âncora visual da mesa (centro do footprint BLOQUEADO de 2×1 tiles), em
 *  mundo. O hit-test acima segue 2×2 de propósito: inclui a faixa da frente
 *  (interactTile) — clicar ali também leva o boss à mesa. */
export function deskAnchorWorld(deskTile: Vec2): Vec2 {
  return { x: deskTile.x + DESK_FOOT_W / 2, y: deskTile.y + 0.5 }
}
