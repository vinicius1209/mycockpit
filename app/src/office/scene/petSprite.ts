/** GATO DO ESCRITÓRIO — sprite flat na mesma linguagem do office (formas
 *  arredondadas, 2 tons + detalhe creme, sombra de contato elíptica, escala
 *  SPIKE_SCALE, âncora nos pés em y=0).
 *
 *  Duas poses em containers irmãos (troca DISCRETA de visibilidade, nunca
 *  redesenho): em pé (corpo cápsula horizontal, cabeça à frente, cauda em
 *  curva animada por seno) e loaf (deitado de pão, olhos fechados, cauda
 *  enrolada). Vista de perfil — flip horizontal dá a direção.
 *
 *  Animação SÓ transform/alpha: andar = bob + perninhas alternando + cauda;
 *  dormir = respiração lenta + orelha que treme de vez em quando.
 *  prefers-reduced-motion ⇒ pose estática (updateAnim zera transforms). */
import { Container, Graphics } from "pixi.js"
import { SPIKE_SCALE } from "./props"

// paleta do bicho: cinza-sage do cenário + peito/patas creme (nunca as cores
// de identidade dos agents — o gato é mobília viva, não provider)
const FUR = 0x8f9585
const FUR_SHADE = 0x767c6c
const CREAM = 0xe9e3d2
const EAR_INNER = 0xc9a08e
const INK = 0x2b2724

const BREATHE_SLEEP_PERIOD = 3.4 // s — respiração do loaf
const WALK_FREQ = 7.5 // rad/s — trote curto
const TAIL_FREQ = 2.1 // rad/s — cauda balança devagar

export type PetSprite = {
  root: Container
  setMoving(moving: boolean): void
  /** Espelha horizontalmente (true = olhando para a esquerda da tela). */
  setFlip(flip: boolean): void
  setSleeping(sleeping: boolean): void
  updateAnim(timeSec: number, reducedMotion: boolean): void
  destroy(): void
}

/** Orelha triangular com forro (desenhada apontando para cima; x = centro). */
function ear(x: number, y: number, w: number, h: number): Graphics {
  const g = new Graphics()
    .poly([x - w / 2, y, x, y - h, x + w / 2, y])
    .fill({ color: FUR })
    .poly([x - w / 4, y - 0.5, x, y - h * 0.62, x + w / 4, y - 0.5])
    .fill({ color: EAR_INNER, alpha: 0.85 })
  return g
}

export function createPetSprite(): PetSprite {
  const root = new Container()
  root.scale.set(SPIKE_SCALE)

  // sombra de contato (mesma receita dos avatares, menor)
  const shadow = new Graphics().ellipse(0, 1, 15, 5).fill({ color: 0x11161c })
  shadow.alpha = 0.16
  root.addChild(shadow)

  const flipRoot = new Container()
  root.addChild(flipRoot)

  // --- pose EM PÉ (perfil: cabeça à direita, cauda à esquerda) -------------
  const standRoot = new Container()
  flipRoot.addChild(standRoot)

  // cauda: pivô na garupa; curva pra cima com ponta creme
  const tail = new Container()
  tail.position.set(-13, -13)
  const tailG = new Graphics()
    .moveTo(0, 0)
    .quadraticCurveTo(-7, -2, -8.5, -10)
    .stroke({ width: 3.4, color: FUR, cap: "round" })
    .circle(-8.6, -10.6, 2)
    .fill({ color: CREAM })
  tail.addChild(tailG)

  // perninhas (pivô no quadril/ombro): par traseiro e par dianteiro
  const legs: Container[] = []
  for (const hx of [-9, -6, 5, 8]) {
    const leg = new Container()
    leg.position.set(hx, -6)
    leg.addChild(
      new Graphics()
        .roundRect(-1.6, 0, 3.2, 6.6, 1.6)
        .fill({ color: hx < 0 ? FUR_SHADE : FUR })
        .ellipse(0, 6.2, 1.9, 1.2)
        .fill({ color: CREAM }),
    )
    legs.push(leg)
  }

  // corpo: cápsula horizontal + barriga creme + sombra na garupa
  const standBody = new Container()
  const bodyG = new Graphics()
    .roundRect(-14, -17, 26, 12, 6)
    .fill({ color: FUR })
    .ellipse(-8, -8.4, 5.5, 2.6)
    .fill({ color: FUR_SHADE, alpha: 0.5 })
    .ellipse(3, -6.6, 6.5, 2.4)
    .fill({ color: CREAM, alpha: 0.9 })
  standBody.addChild(bodyG)

  // cabeça à frente (3/4: dois olhos, focinho creme, bigodinhos implícitos)
  const standHead = new Container()
  standHead.position.set(13, -19)
  const headG = new Graphics()
    .circle(0, 0, 7)
    .fill({ color: FUR })
    .ellipse(2.2, 2.6, 4, 2.8)
    .fill({ color: CREAM, alpha: 0.95 })
    .circle(-1.4, -0.6, 1.1)
    .fill({ color: INK })
    .circle(3.4, -0.6, 1.1)
    .fill({ color: INK })
    .circle(2.4, 2, 0.8)
    .fill({ color: EAR_INNER })
  const earBackStand = ear(-3.6, -5.4, 5, 5.5)
  const earFrontStand = ear(3.2, -5.6, 5, 5.5)
  standHead.addChild(earBackStand, earFrontStand, headG)

  standRoot.addChild(tail, legs[0], legs[2], standBody, legs[1], legs[3], standHead)

  // --- pose LOAF (dormindo de pão) -----------------------------------------
  const loafRoot = new Container()
  loafRoot.visible = false
  flipRoot.addChild(loafRoot)

  const loafBody = new Container()
  const loafG = new Graphics()
    .roundRect(-13, -10, 26, 10, 5)
    .fill({ color: FUR })
    .ellipse(-6, -3.4, 6, 2)
    .fill({ color: FUR_SHADE, alpha: 0.45 })
  // cauda enrolada na frente do pão (ponta creme)
  const loafTail = new Graphics()
    .moveTo(-11, -2.6)
    .quadraticCurveTo(-2, 0.6, 6.5, -1.6)
    .stroke({ width: 2.6, color: FUR_SHADE, cap: "round" })
    .circle(7, -1.8, 1.7)
    .fill({ color: CREAM })
  loafBody.addChild(loafG, loafTail)

  const loafHead = new Container()
  loafHead.position.set(9, -11)
  const loafHeadG = new Graphics()
    .circle(0, 0, 6.4)
    .fill({ color: FUR })
    .ellipse(2, 2.4, 3.6, 2.5)
    .fill({ color: CREAM, alpha: 0.95 })
  // olhos fechados: dois arcos serenos
  const closedEyes = new Graphics()
    .moveTo(-3.2, -0.4)
    .quadraticCurveTo(-1.8, 0.8, -0.4, -0.4)
    .moveTo(1.6, -0.4)
    .quadraticCurveTo(3, 0.8, 4.4, -0.4)
    .stroke({ width: 1.1, color: INK, cap: "round" })
  const earBackLoaf = ear(-3.2, -4.8, 4.6, 5)
  const earFrontLoaf = ear(3, -5, 4.6, 5)
  loafHead.addChild(earBackLoaf, earFrontLoaf, loafHeadG, closedEyes)
  loafBody.addChild(loafHead)
  loafRoot.addChild(loafBody)

  let moving = false
  let sleeping = false

  const resetPose = (): void => {
    standRoot.y = 0
    for (const leg of legs) leg.rotation = 0
    tail.rotation = 0
    loafBody.scale.set(1)
    earFrontLoaf.rotation = 0
  }

  return {
    root,
    setMoving(next) {
      moving = next
    },
    setFlip(flip) {
      flipRoot.scale.x = flip ? -1 : 1
    },
    setSleeping(next) {
      if (next === sleeping) return
      sleeping = next
      standRoot.visible = !next
      loafRoot.visible = next
      resetPose()
    },
    updateAnim(timeSec, reducedMotion) {
      if (reducedMotion) {
        resetPose()
        return
      }
      if (sleeping) {
        // respiração lenta do pão + tremida ocasional da orelha da frente
        const b = Math.cos((timeSec * Math.PI * 2) / BREATHE_SLEEP_PERIOD)
        loafBody.scale.set(1 + 0.012 * b, 1 - 0.03 * b)
        const twitch = Math.max(0, Math.sin(timeSec * 0.53) - 0.985) / 0.015
        earFrontLoaf.rotation = -0.16 * twitch * Math.sin(timeSec * 40)
        return
      }
      if (moving) {
        // trote: bob curto + pares diagonais alternando + cauda acompanhando
        const s = Math.sin(timeSec * WALK_FREQ)
        standRoot.y = -1.2 * Math.abs(s)
        legs[0].rotation = 0.5 * s
        legs[3].rotation = 0.5 * s
        legs[1].rotation = -0.5 * s
        legs[2].rotation = -0.5 * s
        tail.rotation = 0.14 * Math.sin(timeSec * TAIL_FREQ) + 0.05 * s
      } else {
        // parado: cauda balança devagar, corpo assenta
        standRoot.y = 0
        for (const leg of legs) leg.rotation = 0
        tail.rotation = 0.18 * Math.sin(timeSec * TAIL_FREQ)
      }
    },
    destroy() {
      root.destroy({ children: true })
    },
  }
}
