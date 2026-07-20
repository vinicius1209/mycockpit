/** Câmera — máquina de estados follow|inspect (§3 do design doc).
 *
 *  Convenção de framing: a cena mapeia camera.pos para o CENTRO do viewport
 *  (px(p) = (S(p) - S(cam)) * zoom + centroDoViewport). `screenOffset` é onde o
 *  ALVO deve aparecer relativo ao centro, em px de tela — dock aberto à direita
 *  ⇒ screenOffset.x negativo (alvo desloca para a esquerda).
 *
 *  Coordenadas de tela passadas a zoomAt são RELATIVAS ao centro do viewport.
 */
import { toScreen, toWorld } from "./iso"
import type { Vec2, World } from "./types"

export const ZOOM_MIN = 0.5
export const ZOOM_MAX = 2.5
/** Deadzone retangular do follow, em px de tela. */
export const DEAD_W = 110
export const DEAD_H = 70
/** Base da suavização exponencial: alpha = 1 - CAM_SMOOTH^dt (dt em s). */
export const CAM_SMOOTH = 0.0005
/** Janela (s) em que o alvo do follow congela durante o gesto de zoom
 *  (bookkeeping no próprio CameraState: `zoomFreezeUntil`). */
export const ZOOM_FREEZE_S = 0.25

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Entra em modo inspect (Tab/pan manual/badge do HUD). A volta para follow é
 *  da sim (primeiro input de movimento do boss), que emite o SimEvent. */
export function setInspect(world: World, target: Vec2): void {
  world.camera.mode = "inspect"
  world.camera.inspectTarget = { x: target.x, y: target.y }
}

/** Um passo de câmera (chamado pela sim a cada tick). Deadzone retangular no
 *  follow + suavização exponencial 1 - k^dt; inspect persegue o alvo direto. */
export function updateCamera(world: World, dt: number): void {
  const cam = world.camera
  cam.prev = { x: cam.pos.x, y: cam.pos.y }

  // Gesto de zoom em andamento: o alvo do follow congela (zoomAt já ancorou).
  if (cam.zoomFreezeUntil > world.time) return

  const target = cam.mode === "inspect" && cam.inspectTarget ? cam.inspectTarget : world.boss.pos

  // Desejo em espaço iso de tela, com o centro de framing deslocado (dock).
  const st = toScreen(target.x, target.y)
  const desX = st.x - cam.screenOffset.x / cam.zoom
  const desY = st.y - cam.screenOffset.y / cam.zoom
  const sc = toScreen(cam.pos.x, cam.pos.y)

  // Erro em px de tela.
  let ex = (desX - sc.x) * cam.zoom
  let ey = (desY - sc.y) * cam.zoom
  if (cam.mode === "follow") {
    // Deadzone retangular: só persegue o excedente.
    ex -= clamp(ex, -DEAD_W / 2, DEAD_W / 2)
    ey -= clamp(ey, -DEAD_H / 2, DEAD_H / 2)
  }
  if (ex === 0 && ey === 0) return

  const a = 1 - Math.pow(CAM_SMOOTH, dt)
  const nx = sc.x + (ex / cam.zoom) * a
  const ny = sc.y + (ey / cam.zoom) * a
  const w = toWorld(nx, ny)
  cam.pos.x = clamp(w.x, 0, world.plan.w)
  cam.pos.y = clamp(w.y, 0, world.plan.h)
}

/** Zoom em torno do cursor: o ponto de MUNDO sob (screenX, screenY) — px
 *  relativos ao centro do viewport — fica invariante. Clamp 0.5–2.5 e aos
 *  limites do mundo; congela o alvo do follow durante o gesto. */
export function zoomAt(world: World, screenX: number, screenY: number, factor: number): void {
  const cam = world.camera
  const z0 = cam.zoom
  const z1 = clamp(z0 * factor, ZOOM_MIN, ZOOM_MAX)

  const sc = toScreen(cam.pos.x, cam.pos.y)
  // Ponto iso de tela sob o cursor: S(p) = S(cam) + cursor/z.
  const px = sc.x + screenX / z0
  const py = sc.y + screenY / z0

  cam.zoom = z1
  // Reancora a câmera para manter S(p) sob o cursor no novo zoom.
  const w = toWorld(px - screenX / z1, py - screenY / z1)
  cam.pos.x = clamp(w.x, 0, world.plan.w)
  cam.pos.y = clamp(w.y, 0, world.plan.h)
  cam.prev = { x: cam.pos.x, y: cam.pos.y } // zoom não interpola (snap)

  cam.zoomFreezeUntil = world.time + ZOOM_FREEZE_S
}
