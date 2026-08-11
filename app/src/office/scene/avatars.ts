/** Avatares (agents + boss) — decompostos em PARTES com pivot (O6):
 *  torso, braço-esq, braço-dir (3 variantes de pose), cabeça (rosto + cabelo)
 *  e props de estado (café+vapor, balões de pensamento, mão erguida).
 *
 *  Direção de arte: chibi ~2.3 cabeças, formas 100% arredondadas (cápsulas,
 *  elipses, bezier — nada de trapézio duro), rosto mínimo (2 olhos + sobran-
 *  celhas), cabelo = UMA silhueta gráfica distinta por agent, roupa 2 tons
 *  (cor do agent + sombra à direita, luz vinda de cima-esquerda). Agents
 *  SENTADOS em cadeira (encosto atrás do torso, mesa oclui as pernas); boss
 *  em pé com ciclo de andar (bob + lean + braços/pernas alternando).
 *
 *  Partes que variam por instância em geometria BRANCA + tint; um
 *  GraphicsContext compartilhado por parte (1 tesselação p/ N instâncias).
 *  Animação SÓ transform/alpha, fase aleatória por instância (nada de
 *  uníssono). prefers-reduced-motion ⇒ poses estáticas.
 */
import { Container, Graphics, GraphicsContext, GraphicsPath } from "pixi.js"
import type { BossFacing, DeskVisualState, OfficeAgentId } from "@/lib/fleet/types"
import { partsForState } from "./logic"
import { SPIKE_SCALE, createChairBack, createChairSeat, createMug } from "./props"
import { createSteam, createThoughtDots } from "./effects"
import {
  microActionEnvelope,
  mulberry32,
  nextMicroAction,
  weightShiftSide,
  type MicroAction,
} from "./ambient"

/** Tons de pele (naturais/quentes — nunca na paleta sage do cenário). */
export const AGENT_SKINS: Record<OfficeAgentId, string> = {
  "claude-code": "#d7a77e",
  codex: "#794b37",
  agy: "#a86f4e",
}

/** Cabelo: cor fixa por agent (identidade = silhueta + cor, não rosto). */
const HAIR_COLORS: Record<OfficeAgentId, number> = {
  "claude-code": 0x4a3628, // castanho quente, topete lateral
  codex: 0x23272e, //         quase-preto, cacheado
  agy: 0x5b3a2e, //           acaju, chanel com franja
}

const INK = 0x2b2724 // olhos/sobrancelhas (lê em qualquer tom de pele)

// Cores de identidade e nomes de exibição NÃO vivem aqui: a cor vem dos tokens
// do tema (scene/logic.agentColor) e o nome vem do registry do app via
// DeskPlacement.agentName (bridge/layout) — fonte única, sem duplicação.

// ---------------------------------------------------------------------------
// Geometria — agent sentado (coords locais, escala SPIKE_SCALE no root)
//   cabeça: elipse r16.5×15.5 em (0,-46) · torso: cápsula -17..17 × -34..10
//   ombros: (±13,-27) · mãos na mesa: (±22,-3)
// ---------------------------------------------------------------------------

// ombros (pivots dos braços)
const SEAT_SHOULDER_L = { x: -13, y: -27 }
const SEAT_SHOULDER_R = { x: 13, y: -27 }
const NECK = { x: 0, y: -31 }
const EYES_Y = -43.5

type SeatedCtxs = {
  shadowOut: GraphicsContext
  shadowIn: GraphicsContext
  torso: GraphicsContext
  torsoShade: GraphicsContext
  head: GraphicsContext
  eyes: GraphicsContext
  brows: GraphicsContext
  hair: Record<OfficeAgentId, GraphicsContext>
  /** Variantes do braço (desenhadas p/ o lado DIREITO; esquerdo = espelho). */
  armDownSkin: GraphicsContext
  armDownSleeve: GraphicsContext
  armChinSkin: GraphicsContext
  armChinSleeve: GraphicsContext
  armRaisedSkin: GraphicsContext
  armRaisedSleeve: GraphicsContext
}

let seated: SeatedCtxs | null = null

function seatedCtxs(): SeatedCtxs {
  if (seated) return seated
  const white = { color: 0xffffff }

  // sombra de contato: 2 elipses empilhadas (borda macia sem gradiente)
  const shadowOut = new GraphicsContext().ellipse(0, 16, 30, 11).fill(white)
  const shadowIn = new GraphicsContext().ellipse(0, 16, 20, 8).fill(white)

  // torso: cápsula arredondada (branca → cor do agent)
  const torso = new GraphicsContext().roundRect(-17, -34, 34, 44, 15).fill(white)
  // sombra da roupa: CRESCENTE na borda direita (não meia-cápsula dura)
  const torsoShade = new GraphicsContext()
    .path(
      new GraphicsPath(
        "M5 -33.5 C12 -32.5 17 -27.5 17 -19 L17 -5 C17 3.5 12 8.5 5 9.5 " +
          "C10 3 10 -27 5 -33.5 Z",
      ),
    )
    .fill({ color: 0x000000 })

  const head = new GraphicsContext().ellipse(0, -46, 16.5, 15.5).fill(white)

  // rosto mínimo: olhos com esclera clara + pupila (lê em QUALQUER tom de
  // pele — pupila pura some nas peles escuras) + sobrancelhas sutis
  const SCLERA = 0xf6efe3
  const eyes = new GraphicsContext()
    .ellipse(-6, EYES_Y, 3, 2.7)
    .fill({ color: SCLERA })
    .ellipse(6, EYES_Y, 3, 2.7)
    .fill({ color: SCLERA })
    .circle(-6, EYES_Y, 1.7)
    .fill({ color: INK })
    .circle(6, EYES_Y, 1.7)
    .fill({ color: INK })
  const brows = new GraphicsContext()
    .moveTo(-8.2, -49)
    .quadraticCurveTo(-6, -50.2, -3.8, -49.4)
    .moveTo(3.8, -49.4)
    .quadraticCurveTo(6, -50.2, 8.2, -49)
    .stroke({ width: 1.5, color: INK, cap: "round" })

  // cabelos: UMA silhueta fechada por agent (portador da identidade)
  const hairClaude = new GraphicsContext()
    .path(
      new GraphicsPath(
        "M-17.5 -45 C-19.5 -62 -7 -68.5 2 -67.5 C11.5 -66.5 19 -58.5 17.5 -45 " +
          "C16.5 -50.5 14 -54.5 9 -56.5 C2.5 -59 -5 -57.5 -10 -53 " +
          "C-13.5 -49.5 -16 -47 -17.5 -45 Z",
      ),
    )
    .fill({ color: 0xffffff })
  const hairCodex = new GraphicsContext()
    .circle(-11, -59, 7.5)
    .circle(0, -63.5, 8.5)
    .circle(11, -59, 7.5)
    .circle(-15.5, -52, 5.5)
    .circle(15.5, -52, 5.5)
    .ellipse(0, -56.5, 15.5, 8.5)
    .fill({ color: 0xffffff })
  const hairAgy = new GraphicsContext()
    .path(
      new GraphicsPath(
        "M-19 -31 C-22.5 -50 -17 -63 -6 -65.5 C6 -68 18 -60 19.5 -47 " +
          "C20.5 -40 20 -35 19 -31 L14 -32 C15.5 -40 15 -46.5 11.5 -50 " +
          "L-11.5 -50 C-15 -46.5 -15 -39 -14 -32 Z",
      ),
    )
    .fill({ color: 0xffffff })

  // --- braços (cápsulas com mão-luva; direito; esquerdo = scale.x -1) ------
  // pose "na mesa/teclado": desce em diagonal até a beirada da mesa
  const armDownSkin = new GraphicsContext()
    .moveTo(13, -27)
    .quadraticCurveTo(21, -19, 22, -4)
    .stroke({ width: 7.5, color: 0xffffff, cap: "round" })
    .circle(22, -3, 4.2)
    .fill(white)
  const armDownSleeve = new GraphicsContext()
    .moveTo(12.5, -27.5)
    .quadraticCurveTo(16.5, -24, 18.5, -17)
    .stroke({ width: 9.5, color: 0xffffff, cap: "round" })
  // pose "mão no queixo" (thinking): cotovelo fora, mão volta ao queixo
  const armChinSkin = new GraphicsContext()
    .moveTo(13, -27)
    .quadraticCurveTo(22, -23, 21, -14)
    .moveTo(21, -14)
    .quadraticCurveTo(17, -26, 9, -33)
    .stroke({ width: 7.5, color: 0xffffff, cap: "round" })
    .circle(8.5, -34, 4)
    .fill(white)
  const armChinSleeve = new GraphicsContext()
    .moveTo(12.5, -27.5)
    .quadraticCurveTo(18, -25, 19.5, -19)
    .stroke({ width: 9.5, color: 0xffffff, cap: "round" })
  // pose "mão erguida" (hand): braço claro acima da cabeça
  const armRaisedSkin = new GraphicsContext()
    .moveTo(13, -27)
    .quadraticCurveTo(22.5, -34, 21.5, -51)
    .stroke({ width: 7.5, color: 0xffffff, cap: "round" })
    .circle(21.5, -53, 4.5)
    .fill(white)
  const armRaisedSleeve = new GraphicsContext()
    .moveTo(13, -27.5)
    .quadraticCurveTo(17.5, -30.5, 18.5, -36)
    .stroke({ width: 9.5, color: 0xffffff, cap: "round" })

  seated = {
    shadowOut,
    shadowIn,
    torso,
    torsoShade,
    head,
    eyes,
    brows,
    hair: { "claude-code": hairClaude, codex: hairCodex, agy: hairAgy },
    armDownSkin,
    armDownSleeve,
    armChinSkin,
    armChinSleeve,
    armRaisedSkin,
    armRaisedSleeve,
  }
  return seated
}

// ---------------------------------------------------------------------------
// Geometria — boss em pé (cabeça em (0,-62), torso -50..-4, pernas até 15)
// ---------------------------------------------------------------------------

const BOSS_SHOULDER_L = { x: -13.5, y: -44 }
const BOSS_SHOULDER_R = { x: 13.5, y: -44 }
const BOSS_HIP_L = { x: -5.5, y: -11 }
const BOSS_HIP_R = { x: 5.5, y: -11 }
const BOSS_EYES_Y = -59.5

type BossCtxs = {
  torso: GraphicsContext
  torsoShade: GraphicsContext
  collar: GraphicsContext
  head: GraphicsContext
  eyes: GraphicsContext
  glasses: GraphicsContext
  hair: GraphicsContext
  leg: GraphicsContext
  armSkin: GraphicsContext
  armSleeve: GraphicsContext
}

let bossParts: BossCtxs | null = null

function bossCtxs(): BossCtxs {
  if (bossParts) return bossParts
  const white = { color: 0xffffff }

  const torso = new GraphicsContext().roundRect(-15, -50, 30, 46, 12).fill(white)
  const torsoShade = new GraphicsContext()
    .path(
      new GraphicsPath(
        "M5 -49.5 C10.5 -48.5 15 -43.5 15 -37 L15 -17 C15 -10.5 10.5 -5.5 5 -4.5 " +
          "C9 -11 9 -43 5 -49.5 Z",
      ),
    )
    .fill({ color: 0x000000 })
  // gola V sutil abaixo do queixo (detalhe de "chefe" sem custo de cor)
  const collar = new GraphicsContext()
    .path(new GraphicsPath("M-7 -45.5 L0 -37.5 L7 -45.5 L0 -41.5 Z"))
    .fill({ color: 0x000000 })

  const head = new GraphicsContext().ellipse(0, -62, 16.5, 15.5).fill(white)
  const eyes = new GraphicsContext()
    .ellipse(-6.2, BOSS_EYES_Y, 3, 2.7)
    .fill({ color: 0xf6efe3 })
    .ellipse(6.2, BOSS_EYES_Y, 3, 2.7)
    .fill({ color: 0xf6efe3 })
    .circle(-6.2, BOSS_EYES_Y, 1.7)
    .fill({ color: INK })
    .circle(6.2, BOSS_EYES_Y, 1.7)
    .fill({ color: INK })
  // óculos arredondados (marca visual do boss) — traço fino p/ o olho aparecer
  const glasses = new GraphicsContext()
    .roundRect(-11.8, -65, 11.2, 10.5, 4.6)
    .stroke({ width: 1.4, color: 0x22262b })
    .roundRect(0.6, -65, 11.2, 10.5, 4.6)
    .stroke({ width: 1.4, color: 0x22262b })
  glasses
    .moveTo(-0.6, -60.5)
    .lineTo(0.6, -60.5)
    .moveTo(-11.8, -60.5)
    .lineTo(-15.5, -62)
    .moveTo(11.8, -60.5)
    .lineTo(15.5, -62)
    .stroke({ width: 1.4, color: 0x22262b, cap: "round" })
  // cabelo penteado para trás, grisalho (testa aberta + laterais nas têmporas)
  const hair = new GraphicsContext()
    .path(
      new GraphicsPath(
        "M-16.5 -61 C-17.5 -75 -7 -81 1 -80.5 C10 -80 18 -72.5 16.5 -60 " +
          "C15 -66.5 11.5 -70.5 5.5 -72 C-2.5 -74 -11.5 -70 -16.5 -61 Z",
      ),
    )
    .fill({ color: 0x746e64 })
  hair
    .ellipse(-15.8, -61, 2.3, 4.2)
    .fill({ color: 0x746e64 })
    .ellipse(15.8, -61, 2.3, 4.2)
    .fill({ color: 0x746e64 })

  // perna: cápsula (calça) + sapato; direita; esquerda = espelho
  const leg = new GraphicsContext()
    .moveTo(5.5, -11)
    .quadraticCurveTo(6.5, 2, 6.5, 12)
    .stroke({ width: 9, color: 0x2e3437, cap: "round" })
    .ellipse(7.5, 14, 5.5, 3)
    .fill({ color: 0x23282c })

  const armSkin = new GraphicsContext()
    .moveTo(13.5, -44)
    .quadraticCurveTo(19.5, -36, 19, -22)
    .stroke({ width: 7, color: 0xffffff, cap: "round" })
    .circle(19, -20.5, 4)
    .fill(white)
  const armSleeve = new GraphicsContext()
    .moveTo(13, -44.5)
    .quadraticCurveTo(17, -41, 18.2, -34)
    .stroke({ width: 9, color: 0xffffff, cap: "round" })

  bossParts = {
    torso,
    torsoShade,
    collar,
    head,
    eyes,
    glasses,
    hair,
    leg,
    armSkin,
    armSleeve,
  }
  return bossParts
}

// ---------------------------------------------------------------------------
// Constantes de animação
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180
const BREATHE_IDLE_PERIOD = 2.4 // s
const BREATHE_TYPING_PERIOD = 0.62 // s
const TYPE_CYCLE = 0.68 // s
const BLINK_PERIOD = 4.6 // s
const BLINK_DUR = 0.12 // s
const SHADE_ALPHA = 0.18 // sombra da roupa (~18% mais escura à direita)

/** Escala Y dos olhos no instante t (piscada rápida a cada ~4.6s). */
function blinkScaleY(t: number): number {
  return t % BLINK_PERIOD < BLINK_DUR ? 0.12 : 1
}

/** Par de Graphics de braço (pele + manga) com espelho opcional. */
function armPair(
  skinCtx: GraphicsContext,
  sleeveCtx: GraphicsContext,
  skin: string | number,
  color: string | number,
  mirror: boolean,
): Container {
  const c = new Container()
  const skinG = new Graphics(skinCtx)
  skinG.tint = skin
  const sleeveG = new Graphics(sleeveCtx)
  sleeveG.tint = color
  if (mirror) {
    skinG.scale.x = -1
    sleeveG.scale.x = -1
  }
  c.addChild(skinG, sleeveG)
  return c
}

/** Roupa comunica PAPEL, enquanto a cor continua comunicando provider/estado.
 *  A variante determinística evita clones exatos entre salas sem transformar
 *  os agents em pessoas aleatórias a cada sessão. */
function createAgentOutfit(agent: OfficeAgentId, variant: number): Graphics {
  const g = new Graphics()
  const light = 0xf1ead9
  const ink = 0x273034
  if (agent === "claude-code") {
    // Cardigan de arquiteto: gola clara, lapelas e botões discretos.
    g.roundRect(-9, -34, 18, 7, 3).fill({ color: light, alpha: 0.95 })
    g.moveTo(-8, -28).lineTo(0, -17).lineTo(8, -28).stroke({ width: 2, color: light, alpha: 0.8 })
    for (const y of [-13, -6, 1]) g.circle(0, y, 1.2).fill({ color: ink, alpha: 0.75 })
    if (variant === 1) g.roundRect(7, -14, 5, 7, 1).fill({ color: light, alpha: 0.75 })
    if (variant === 2) g.circle(-9, -23, 2).fill({ color: 0xe4a862 })
  } else if (agent === "codex") {
    // Bomber técnica: gola alta, zíper e patch geométrico.
    g.moveTo(-12, -30).quadraticCurveTo(-6, -35, 0, -29)
      .quadraticCurveTo(6, -35, 12, -30)
      .stroke({ width: 4, color: ink, alpha: 0.9 })
    g.moveTo(0, -28).lineTo(0, 7).stroke({ width: 1.5, color: light, alpha: 0.65 })
    g.roundRect(6, -15, 7, 7, 2).stroke({ width: 1.5, color: light, alpha: 0.8 })
    if (variant === 1) g.moveTo(-12, 2).lineTo(-5, 2).stroke({ width: 2, color: light, alpha: 0.65 })
    if (variant === 2) g.circle(9.5, -11.5, 1.5).fill({ color: 0x5bb8e8 })
  } else {
    // Overshirt de pesquisa: lapela assimétrica e crachá de campo.
    g.moveTo(-11, -31).lineTo(-2, -18).lineTo(1, -30)
      .moveTo(11, -31).lineTo(2, -18).lineTo(-1, -30)
      .stroke({ width: 2.2, color: light, alpha: 0.85 })
    g.roundRect(5, -13, 8, 10, 1.5).fill({ color: light, alpha: 0.82 })
    g.roundRect(7, -10, 4, 2, 1).fill({ color: 0x5bd6a0, alpha: 0.9 })
    if (variant === 1) g.moveTo(-10, -8).lineTo(-4, -8).stroke({ width: 2, color: light, alpha: 0.7 })
    if (variant === 2) g.circle(-9, -22, 2).fill({ color: 0xf1ead9, alpha: 0.9 })
  }
  return g
}

// ---------------------------------------------------------------------------
// Avatar de agent (sentado à mesa)
// ---------------------------------------------------------------------------

/** Duração do aceno sentado (cumprimento ao boss — pack pessoal). */
export const SEATED_WAVE_S = 1.2

export type AgentAvatar = {
  root: Container
  /** Troca discreta de estado (props visíveis + pose) — nunca por frame. */
  setState(state: DeskVisualState): void
  /** Espelha horizontalmente (mesa flip). */
  setFlip(flip: boolean): void
  /** No trabalho olha para o monitor; em conversa olha para o visitante. */
  setAttention(attention: "work" | "visitor"): void
  /** Aceno curto (~SEATED_WAVE_S) com a variante de braço ERGUIDA, olhando
   *  pro lado do boss (dir). OVERLAY temporário: não muda o estado — a pose
   *  do estado corrente volta sozinha ao fim (troca de estado cancela). */
  wave(nowSec: number, dir?: "left" | "right"): void
  /** Chamado a cada render com o relógio da sim (segundos). */
  updateAnim(timeSec: number, reducedMotion: boolean): void
  destroy(): void
}

export function createAgentAvatar(
  agent: OfficeAgentId,
  color: string | number,
  skin: string | number = AGENT_SKINS[agent],
  seed?: number,
): AgentAvatar {
  const cx = seatedCtxs()
  const root = new Container()
  root.scale.set(SPIKE_SCALE)
  const rng = mulberry32(seed ?? (Math.random() * 0xffffffff) >>> 0)
  const outfitVariant = Math.floor(rng() * 3)

  // sombra de contato (fora do bob de respiração)
  const shOut = new Graphics(cx.shadowOut)
  shOut.tint = 0x11161c
  shOut.alpha = 0.16
  const shIn = new Graphics(cx.shadowIn)
  shIn.tint = 0x11161c
  shIn.alpha = 0.18
  root.addChild(shOut, shIn)

  const flipRoot = new Container()
  root.addChild(flipRoot)

  // cadeira NÃO respira: fica fora do bodyRoot
  const chairBack = createChairBack()
  const chairSeat = createChairSeat()
  flipRoot.addChild(chairBack, chairSeat)

  const bodyRoot = new Container()
  flipRoot.addChild(bodyRoot)

  const torso = new Graphics(cx.torso)
  torso.tint = color
  const shade = new Graphics(cx.torsoShade)
  shade.alpha = SHADE_ALPHA
  const outfit = createAgentOutfit(agent, outfitVariant)

  // poseRoot guarda o olhar contextual sem brigar com micro-animações da cabeça.
  const headPose = new Container()
  const headGroup = new Container()
  headGroup.pivot.set(NECK.x, NECK.y)
  headGroup.position.set(NECK.x, NECK.y)
  const head = new Graphics(cx.head)
  head.tint = skin
  const eyes = new Graphics(cx.eyes)
  eyes.pivot.set(0, EYES_Y)
  eyes.position.set(0, EYES_Y)
  const brows = new Graphics(cx.brows)
  brows.alpha = 0.5
  const hair = new Graphics(cx.hair[agent])
  hair.tint = HAIR_COLORS[agent]
  headGroup.addChild(head, eyes, brows, hair)
  headPose.addChild(headGroup)

  // braço esquerdo (sempre pose "na mesa")
  const armL = new Container()
  armL.pivot.set(SEAT_SHOULDER_L.x, SEAT_SHOULDER_L.y)
  armL.position.set(SEAT_SHOULDER_L.x, SEAT_SHOULDER_L.y)
  armL.addChild(armPair(cx.armDownSkin, cx.armDownSleeve, skin, color, true))

  // braço direito: 3 variantes pré-desenhadas (down/chin/raised) — troca
  // discreta de visibilidade no setState, nunca por frame
  const armR = new Container()
  armR.pivot.set(SEAT_SHOULDER_R.x, SEAT_SHOULDER_R.y)
  armR.position.set(SEAT_SHOULDER_R.x, SEAT_SHOULDER_R.y)
  const armRDown = armPair(cx.armDownSkin, cx.armDownSleeve, skin, color, false)
  const armRChin = armPair(cx.armChinSkin, cx.armChinSleeve, skin, color, false)
  const armRRaised = armPair(cx.armRaisedSkin, cx.armRaisedSleeve, skin, color, false)
  armR.addChild(armRDown, armRChin, armRRaised)

  // café na mão direita (segue o braço no gole) + vapor
  const coffee = new Container()
  coffee.position.set(23, -7)
  coffee.scale.set(0.6)
  const mug = createMug()
  const steam = createSteam()
  coffee.addChild(mug, steam.root)
  armR.addChild(coffee)

  // balões de pensamento
  const dots = createThoughtDots(color)
  dots.root.position.set(28, -76)

  bodyRoot.addChild(torso, shade, outfit, headPose, armL, armR, dots.root)

  // determinismo: com seed (hash do projectId/deskId) a MESMA vida se repete
  // entre sessões (fase, variante de idle e agenda de micro-ações); sem seed
  // cai no comportamento antigo (aleatório por sessão)
  const phase = rng() * 100
  const idleVariant = Math.floor(rng() * 3)
  const microSeed = Math.floor(rng() * 0xffffffff)
  // micro-vida do idle: a cada 12–25s uma micro-ação de 1–2s
  let micro: MicroAction = nextMicroAction(microSeed, 0)

  let state: DeskVisualState = "idle"
  let p = partsForState(state)
  let attention: "work" | "visitor" = "work"

  // aceno (cumprimento ao boss): overlay temporário sobre a pose do estado —
  // transições discretas no updateAnim (nunca reconstrói por frame)
  let flipped = false
  let waving = false
  let waveUntil = -1
  let waveDir: "left" | "right" | null = null

  const applyAttention = (): void => {
    const working = attention === "work"
    headPose.rotation = working ? 0.055 : 0
    headPose.y = working ? 1.5 : 0
    eyes.position.set(working ? 1.4 : 0, EYES_Y + (working ? 1.5 : 0))
  }

  const applyPose = (): void => {
    root.visible = p.visible
    coffee.visible = p.coffee
    dots.root.visible = p.thoughtDots
    armRDown.visible = p.armRightPose === "down"
    armRChin.visible = p.armRightPose === "chin"
    armRRaised.visible = p.armRightPose === "raised"
    bodyRoot.position.set(0, 0)
    bodyRoot.rotation = 0
    headGroup.position.set(NECK.x, NECK.y)
    // pensando: cabeça pende de leve na direção da mão
    headGroup.rotation = p.armRightPose === "chin" ? 0.09 : 0
    armL.rotation = 0
    armR.rotation = 0
    eyes.scale.set(1)
    applyAttention()
  }
  applyPose()

  return {
    root,
    setState(next) {
      if (next === state) return
      state = next
      p = partsForState(state)
      waveUntil = -1 // estado novo cancela o aceno (o updateAnim restaura)
      applyPose()
    },
    setFlip(flip) {
      flipped = flip
      if (!waving) flipRoot.scale.x = flip ? -1 : 1
    },
    setAttention(next) {
      if (next === attention) return
      attention = next
      applyAttention()
    },
    wave(nowSec, dir) {
      if (!p.visible) return
      waveUntil = nowSec + SEATED_WAVE_S
      waveDir = dir ?? null
    },
    updateAnim(timeSec, reducedMotion) {
      if (!p.visible) return
      if (reducedMotion) {
        steam.tick(timeSec, phase, true)
        dots.tick(timeSec, phase, true)
        return
      }
      const t = timeSec + phase

      // aceno (overlay): transição DISCRETA — entra com a variante erguida
      // (flip pro lado do boss) e sai restaurando a pose do estado corrente
      const isWaving = timeSec < waveUntil
      if (isWaving !== waving) {
        waving = isWaving
        if (waving) {
          armRDown.visible = false
          armRChin.visible = false
          armRRaised.visible = true
          coffee.visible = false // a caneca fica na mesa durante o aceno
          if (waveDir) flipRoot.scale.x = waveDir === "left" ? -1 : 1
        } else {
          applyPose() // volta a variante de braço/props do estado
          flipRoot.scale.x = flipped ? -1 : 1
        }
      }

      // respiração (typing acelera); piscada em qualquer estado
      const period = p.typingArms ? BREATHE_TYPING_PERIOD : BREATHE_IDLE_PERIOD
      bodyRoot.y = -1 + 1 * Math.cos((t * Math.PI * 2) / period)
      eyes.scale.y = blinkScaleY(t)

      if (waving) {
        // aceno curto: mão erguida balançando + cabeça pende pro visitante
        armR.rotation = 0.12 * Math.sin(t * 6.5)
        headGroup.rotation = -0.03
      } else if (p.typingArms) {
        // braços alternando no teclado + micro-nod da cabeça
        const w = (t * Math.PI * 2) / TYPE_CYCLE
        armL.rotation = (2 + 5 * Math.sin(w)) * DEG
        armR.rotation = (-1.5 + 5.5 * Math.sin(w - (0.14 / TYPE_CYCLE) * Math.PI * 2)) * DEG
        headGroup.rotation = 0.015 * Math.sin(t * 2.1)
      } else if (p.armRightPose === "raised") {
        // aceno curto com a mão erguida
        armR.rotation = 0.1 * Math.sin(t * 6)
      } else if (p.armRightPose === "chin") {
        // pensando: cabeça oscila devagar em volta do tilt base
        headGroup.rotation = 0.09 + 0.02 * Math.sin(t * 0.8)
      } else if (state === "idle") {
        // micro-vida: agenda determinística por seed — avança SÓ quando a
        // ação corrente expira (nunca reconstrói por frame)
        if (timeSec > micro.start + micro.duration) micro = nextMicroAction(microSeed, timeSec)
        const e = microActionEnvelope(micro, timeSec)
        // baseline zerado por frame — variante/micro-ação atribuem por cima
        bodyRoot.rotation = 0
        headGroup.rotation = 0
        headGroup.x = NECK.x
        armL.rotation = 0
        armR.rotation = 0
        if (e > 0) {
          if (micro.kind === "stretch") {
            // alongar: braços sobem de leve + cabeça inclina p/ trás
            armL.rotation = 0.22 * e
            armR.rotation = -0.22 * e
            headGroup.rotation = -0.07 * e
          } else if (micro.kind === "lookAround") {
            // olhar ao redor: cabeça vira p/ um lado, volta pelo outro
            const sweep = Math.sin(((timeSec - micro.start) / micro.duration) * Math.PI * 2)
            headGroup.rotation = 0.09 * sweep * e
            headGroup.x = NECK.x + 2.5 * sweep * e
          } else {
            // gole demorado: caneca sobe, segura e desce; cabeça acompanha
            armR.rotation = -0.38 * e
            headGroup.rotation = -0.04 * e
          }
        } else if (idleVariant === 1) {
          // alongar: torção sutil do tronco
          bodyRoot.rotation = 0.04 * Math.sin(t * 0.9)
        } else if (idleVariant === 2) {
          // olhar em volta: cabeça desliza devagar
          headGroup.x = NECK.x + 2 * Math.sin(t * 0.7)
        } else {
          // café: gole ocasional (braço+caneca sobem juntos a cada ~6s)
          const sip = Math.max(0, Math.sin(t * ((Math.PI * 2) / 6)) - 0.92) / 0.08
          armR.rotation = -0.38 * sip
        }
      }

      steam.tick(timeSec, phase, false)
      dots.tick(timeSec, phase, false)
    },
    destroy() {
      root.destroy({ children: true })
    },
  }
}

// ---------------------------------------------------------------------------
// Avatar de agent EM PÉ (locomoção de NPCs — handoff/café). MESMO personagem
// do sentado (cabelo/pele/cor idênticos) sobre o rig de andar do boss
// (pernas com pivô no quadril, braços em oposição, bob, flip).
// ---------------------------------------------------------------------------

/** Prop carregável na mão dianteira do NPC em pé. */
export type StandingCarry = "doc" | "coffee" | null

export type StandingAgentAvatar = {
  root: Container
  setMoving(moving: boolean): void
  setFacing(facing: BossFacing): void
  /** Documento branco ou caneca presa à mão dianteira (null = mãos livres). */
  setCarrying(item: StandingCarry): void
  updateAnim(timeSec: number, reducedMotion: boolean): void
  destroy(): void
}

/** Delta do centro da cabeça: sentado (0,-46) → em pé (0,-62), como o boss. */
const STAND_HEAD_DY = -16
/** Braço dianteiro erguido segurando o prop (rad, fixo durante o andar). */
const CARRY_ARM_ROT = -0.52

export function createStandingAgentAvatar(
  agent: OfficeAgentId,
  color: string | number,
  seed?: number,
): StandingAgentAvatar {
  const seat = seatedCtxs()
  const cx = bossCtxs()
  const skin = AGENT_SKINS[agent]
  const rng = mulberry32(seed ?? (Math.random() * 0xffffffff) >>> 0)

  const root = new Container()
  root.scale.set(SPIKE_SCALE)

  const shOut = new Graphics(seat.shadowOut)
  shOut.tint = 0x11161c
  shOut.alpha = 0.16
  const shIn = new Graphics(seat.shadowIn)
  shIn.tint = 0x11161c
  shIn.alpha = 0.18
  root.addChild(shOut, shIn)

  const flipRoot = new Container()
  root.addChild(flipRoot)
  const poseRoot = new Container()
  flipRoot.addChild(poseRoot)
  const bodyRoot = new Container()
  poseRoot.addChild(bodyRoot)

  // pernas (contexts do boss — calça escura compartilhada; pivô no quadril)
  const legL = new Container()
  legL.pivot.set(BOSS_HIP_L.x, BOSS_HIP_L.y)
  legL.position.set(BOSS_HIP_L.x, BOSS_HIP_L.y)
  const legLG = new Graphics(cx.leg)
  legLG.scale.x = -1
  legL.addChild(legLG)
  const legR = new Container()
  legR.pivot.set(BOSS_HIP_R.x, BOSS_HIP_R.y)
  legR.position.set(BOSS_HIP_R.x, BOSS_HIP_R.y)
  legR.addChild(new Graphics(cx.leg))

  const torso = new Graphics(cx.torso)
  torso.tint = color
  const shade = new Graphics(cx.torsoShade)
  shade.alpha = SHADE_ALPHA

  // cabeça: MESMAS partes do sentado (portadoras da identidade), erguida ao
  // pescoço da silhueta em pé
  const headGroup = new Container()
  headGroup.pivot.set(0, -47)
  headGroup.position.set(0, -47)
  const headArt = new Container()
  headArt.y = STAND_HEAD_DY
  const head = new Graphics(seat.head)
  head.tint = skin
  const eyes = new Graphics(seat.eyes)
  eyes.pivot.set(0, EYES_Y)
  eyes.position.set(0, EYES_Y)
  const brows = new Graphics(seat.brows)
  brows.alpha = 0.5
  const hair = new Graphics(seat.hair[agent])
  hair.tint = HAIR_COLORS[agent]
  headArt.addChild(head, eyes, brows, hair)
  headGroup.addChild(headArt)

  const armL = new Container()
  armL.pivot.set(BOSS_SHOULDER_L.x, BOSS_SHOULDER_L.y)
  armL.position.set(BOSS_SHOULDER_L.x, BOSS_SHOULDER_L.y)
  armL.addChild(armPair(cx.armSkin, cx.armSleeve, skin, color, true))
  const armR = new Container()
  armR.pivot.set(BOSS_SHOULDER_R.x, BOSS_SHOULDER_R.y)
  armR.position.set(BOSS_SHOULDER_R.x, BOSS_SHOULDER_R.y)
  armR.addChild(armPair(cx.armSkin, cx.armSleeve, skin, color, false))

  // prop na mão dianteira (filho do armR — segue a rotação do braço)
  const carryRoot = new Container()
  carryRoot.position.set(20, -22)
  const doc = new Graphics()
    .roundRect(-5, -6.5, 10, 13, 1.5)
    .fill({ color: 0xf6efe3 })
    .moveTo(-2.8, -3)
    .lineTo(2.8, -3)
    .moveTo(-2.8, 0)
    .lineTo(2.8, 0)
    .moveTo(-2.8, 3)
    .lineTo(1.4, 3)
    .stroke({ width: 1, color: 0x8d867a, alpha: 0.8, cap: "round" })
  doc.rotation = -0.12
  const mug = new Container()
  mug.scale.set(0.55)
  mug.position.set(-0.5, -3)
  mug.addChild(createMug())
  doc.visible = false
  mug.visible = false
  carryRoot.visible = false
  carryRoot.addChild(doc, mug)
  armR.addChild(carryRoot)

  bodyRoot.addChild(legL, legR, torso, shade, headGroup, armL, armR)

  const phase = rng() * 100
  let moving = false
  let facing: BossFacing = "front"
  let carrying: StandingCarry = null
  let squashStart = -1
  let squashPending = false

  const applyDirection = (): void => {
    const side = facing === "left" || facing === "right"
    flipRoot.scale.x = facing === "left" ? -1 : 1
    poseRoot.scale.x = side ? 0.9 : 1
    poseRoot.x = side ? 1 : 0
  }
  applyDirection()

  const applyCarry = (): void => {
    carryRoot.visible = carrying !== null
    doc.visible = carrying === "doc"
    mug.visible = carrying === "coffee"
    // braço dianteiro segura o prop erguido (pose estática; anim respeita)
    armR.rotation = carrying !== null ? CARRY_ARM_ROT : 0
  }
  applyCarry()

  return {
    root,
    setMoving(next) {
      if (next === moving) return
      if (!next && moving) squashPending = true
      moving = next
    },
    setFacing(f) {
      if (f === facing) return
      facing = f
      applyDirection()
    },
    setCarrying(item) {
      if (item === carrying) return
      carrying = item
      applyCarry()
    },
    updateAnim(timeSec, reducedMotion) {
      if (squashPending) {
        squashPending = false
        squashStart = reducedMotion ? -1 : timeSec
      }
      if (reducedMotion) {
        bodyRoot.position.set(0, 0)
        bodyRoot.rotation = 0
        bodyRoot.scale.set(1)
        armL.rotation = 0
        armR.rotation = carrying !== null ? CARRY_ARM_ROT : 0
        legL.rotation = 0
        legR.rotation = 0
        eyes.scale.set(1)
        return
      }
      const t = timeSec + phase
      eyes.scale.y = blinkScaleY(t)
      if (moving) {
        // ciclo de andar: bob + lean + pernas/braços alternando em oposição
        const s = Math.sin(t * BOB_FREQ)
        bodyRoot.x = 0
        bodyRoot.y = -3 * Math.abs(s)
        bodyRoot.rotation = 0.06
        legL.rotation = 0.38 * s
        legR.rotation = -0.38 * s
        armL.rotation = -0.2 * s
        // carregando: mão dianteira firme no prop (não balança)
        armR.rotation = carrying !== null ? CARRY_ARM_ROT : 0.2 * s
        bodyRoot.scale.set(1)
      } else {
        // idle relaxado: respiração + balanço mínimo + peso alternando
        const w = weightShiftSide(t)
        bodyRoot.y = -1 + 1 * Math.cos((t * Math.PI * 2) / BREATHE_IDLE_PERIOD)
        bodyRoot.x = w
        bodyRoot.rotation = 0.015 * w
        legL.rotation = 0
        legR.rotation = 0
        armL.rotation = 0.03 * Math.sin(t * 1.1)
        armR.rotation =
          carrying !== null ? CARRY_ARM_ROT + 0.02 * Math.sin(t * 1.1) : -0.03 * Math.sin(t * 1.1)
        if (squashStart >= 0) {
          const e = 1 - (timeSec - squashStart) / SQUASH_DURATION
          if (e <= 0) {
            squashStart = -1
            bodyRoot.scale.set(1)
          } else {
            bodyRoot.scale.set(1 + 0.1 * e, 1 - 0.14 * e)
          }
        }
      }
    },
    destroy() {
      root.destroy({ children: true })
    },
  }
}

// ---------------------------------------------------------------------------
// Avatar do boss (em pé; óculos + grisalho, cor brass)
// ---------------------------------------------------------------------------

const BOB_FREQ = 9 // rad/s do ciclo de andar
const SQUASH_DURATION = 0.16 // s

export type BossAvatar = {
  root: Container
  setMoving(moving: boolean): void
  setFacing(facing: BossFacing): void
  updateAnim(timeSec: number, reducedMotion: boolean): void
  destroy(): void
}

export function createBossAvatar(color: string | number = "#e4a862"): BossAvatar {
  const seat = seatedCtxs()
  const cx = bossCtxs()
  const skin = "#d7a77e"

  const root = new Container()
  root.scale.set(SPIKE_SCALE * 1.06)

  const shOut = new Graphics(seat.shadowOut)
  shOut.tint = 0x11161c
  shOut.alpha = 0.16
  const shIn = new Graphics(seat.shadowIn)
  shIn.tint = 0x11161c
  shIn.alpha = 0.18
  root.addChild(shOut, shIn)

  const flipRoot = new Container()
  root.addChild(flipRoot)
  const poseRoot = new Container()
  flipRoot.addChild(poseRoot)
  const bodyRoot = new Container()
  poseRoot.addChild(bodyRoot)

  // pernas (pivot no quadril — ciclo de andar de verdade, sem "patinar")
  const legL = new Container()
  legL.pivot.set(BOSS_HIP_L.x, BOSS_HIP_L.y)
  legL.position.set(BOSS_HIP_L.x, BOSS_HIP_L.y)
  const legLG = new Graphics(cx.leg)
  legLG.scale.x = -1
  legL.addChild(legLG)
  const legR = new Container()
  legR.pivot.set(BOSS_HIP_R.x, BOSS_HIP_R.y)
  legR.position.set(BOSS_HIP_R.x, BOSS_HIP_R.y)
  legR.addChild(new Graphics(cx.leg))

  const torso = new Graphics(cx.torso)
  torso.tint = color
  const shade = new Graphics(cx.torsoShade)
  shade.alpha = SHADE_ALPHA
  const collar = new Graphics(cx.collar)
  collar.alpha = 0.22

  const headGroup = new Container()
  headGroup.pivot.set(0, -47)
  headGroup.position.set(0, -47)
  const head = new Graphics(cx.head)
  head.tint = skin
  const eyes = new Graphics(cx.eyes)
  eyes.pivot.set(0, BOSS_EYES_Y)
  eyes.position.set(0, BOSS_EYES_Y)
  const glasses = new Graphics(cx.glasses)
  const hair = new Graphics(cx.hair)

  // Cada direção usa uma cabeça completa. Reaproveitar a cabeça frontal e
  // esconder só algumas features deformava o aro no perfil e deixava uma
  // faixa de pele atravessando a nuca nas costas.
  const frontHead = new Container()
  frontHead.addChild(head, eyes, glasses, hair)

  const profileHead = new Container()
  const profileSkull = new Graphics()
    .path(
      new GraphicsPath(
        "M-14 -63 C-15 -73 -8 -78.5 1 -78.5 C10 -78.5 15 -72 15 -65 " +
          "C18 -64 19.5 -62 17 -59.5 C19 -57.5 17.5 -55 14 -55 " +
          "C11 -49.5 4 -46.5 -4 -47 C-12 -47.5 -16 -54 -14 -63 Z",
      ),
    )
    .fill({ color: skin })
    .ellipse(-11.5, -59, 2.7, 4.2)
    .fill({ color: skin })
  const profileHair = new Graphics()
    .path(
      new GraphicsPath(
        "M-14.5 -62 C-16 -74 -7.5 -81 2 -80 C10 -79.5 15 -73 15 -65 " +
          "C10.5 -69 5 -71.5 -1 -71 C-7 -70.5 -11.5 -67 -14.5 -62 Z",
      ),
    )
    .fill({ color: 0x746e64 })
    .ellipse(-13, -60, 2.2, 5)
    .fill({ color: 0x746e64 })
  const profileEyeGroup = new Container()
  profileEyeGroup.position.set(7.5, -61.5)
  profileEyeGroup.addChild(
    new Graphics()
      .ellipse(0.35, 0, 1.25, 1.45)
      .fill({ color: INK })
      .circle(0.7, -0.45, 0.35)
      .fill({ color: 0xf6efe3, alpha: 0.9 }),
  )
  const profileGlasses = new Graphics()
    .ellipse(7.4, -61.4, 3.9, 3.15)
    .stroke({ width: 1.15, color: 0x22262b })
    .moveTo(3.55, -61.25)
    .lineTo(-8.8, -59.6)
    .moveTo(11.25, -61.2)
    .lineTo(14.2, -60.2)
    .stroke({ width: 1.15, color: 0x22262b, cap: "round", join: "round" })
  const profileBrow = new Graphics()
    .moveTo(5.7, -66)
    .quadraticCurveTo(8.1, -67, 10.2, -65.7)
    .stroke({ width: 1.2, color: 0x50483f, alpha: 0.8, cap: "round" })
  const profileMouth = new Graphics()
    .moveTo(14.4, -54.5)
    .quadraticCurveTo(16.4, -53.7, 14.6, -52.9)
    .stroke({ width: 1.2, color: 0x4c3327, cap: "round" })
  profileHead.addChild(
    profileSkull,
    profileHair,
    profileBrow,
    profileEyeGroup,
    profileGlasses,
    profileMouth,
  )
  profileHead.visible = false

  const backHead = new Container()
  const backSkull = new Graphics()
    .ellipse(0, -62, 16.5, 15.5)
    .fill({ color: skin })
  const backHair = new Graphics()
    .ellipse(0, -63, 16.8, 16)
    .fill({ color: 0x746e64 })
    .path(
      new GraphicsPath(
        "M-14 -64 C-9 -75 -1 -79 8 -75 C12 -73 15 -68 15 -63 " +
          "C8 -68 -3 -69 -14 -64 Z",
      ),
    )
    .fill({ color: 0x8a8479, alpha: 0.78 })
  backHair
    .moveTo(-12.5, -52.5)
    .quadraticCurveTo(-6, -49.5, 0, -52)
    .quadraticCurveTo(6, -49.5, 12.5, -52.5)
    .stroke({ width: 1.5, color: 0x504c46, alpha: 0.72, cap: "round" })
  const backEarsAndNape = new Graphics()
    .ellipse(-16, -60, 2.4, 4.1)
    .fill({ color: skin })
    .ellipse(16, -60, 2.4, 4.1)
    .fill({ color: skin })
    .roundRect(-5, -49, 10, 7, 3)
    .fill({ color: skin })
  backHead.addChild(backSkull, backEarsAndNape, backHair)
  backHead.visible = false

  headGroup.addChild(frontHead, profileHead, backHead)

  const armL = new Container()
  armL.pivot.set(BOSS_SHOULDER_L.x, BOSS_SHOULDER_L.y)
  armL.position.set(BOSS_SHOULDER_L.x, BOSS_SHOULDER_L.y)
  armL.addChild(armPair(cx.armSkin, cx.armSleeve, skin, color, true))
  const armR = new Container()
  armR.pivot.set(BOSS_SHOULDER_R.x, BOSS_SHOULDER_R.y)
  armR.position.set(BOSS_SHOULDER_R.x, BOSS_SHOULDER_R.y)
  armR.addChild(armPair(cx.armSkin, cx.armSleeve, skin, color, false))

  bodyRoot.addChild(legL, legR, torso, shade, collar, headGroup, armL, armR)

  const phase = Math.random() * 100
  let moving = false
  let facing: BossFacing = "front"
  let squashStart = -1
  let squashPending = false

  const applyDirection = (): void => {
    const side = facing === "left" || facing === "right"
    const back = facing === "back"
    flipRoot.scale.x = facing === "left" ? -1 : 1
    poseRoot.scale.x = side ? 0.9 : 1
    poseRoot.x = side ? 1 : 0
    frontHead.visible = facing === "front"
    profileHead.visible = side
    backHead.visible = back
    collar.visible = !back
  }
  applyDirection()

  return {
    root,
    setMoving(next) {
      if (next === moving) return
      if (!next && moving) squashPending = true
      moving = next
    },
    setFacing(f) {
      if (f === facing) return
      facing = f
      applyDirection()
    },
    updateAnim(timeSec, reducedMotion) {
      if (squashPending) {
        squashPending = false
        squashStart = reducedMotion ? -1 : timeSec
      }
      if (reducedMotion) {
        bodyRoot.position.set(0, 0)
        bodyRoot.rotation = 0
        bodyRoot.scale.set(1)
        armL.rotation = 0
        armR.rotation = 0
        legL.rotation = 0
        legR.rotation = 0
        eyes.scale.set(1)
        profileEyeGroup.scale.set(1)
        return
      }
      const t = timeSec + phase
      const blink = blinkScaleY(t)
      eyes.scale.y = blink
      profileEyeGroup.scale.y = blink
      if (moving) {
        // ciclo de andar: bob + lean + pernas/braços alternando em oposição
        const s = Math.sin(t * BOB_FREQ)
        bodyRoot.x = 0 // zera o shift de peso do idle
        bodyRoot.y = -3 * Math.abs(s)
        bodyRoot.rotation = 0.06
        legL.rotation = 0.38 * s
        legR.rotation = -0.38 * s
        armL.rotation = -0.2 * s
        armR.rotation = 0.2 * s
        bodyRoot.scale.set(1)
      } else {
        // idle relaxado: respiração + balanço mínimo dos braços + peso
        // alternando de perna a cada ~8s (shift sutil de ~1px + tilt)
        const w = weightShiftSide(t)
        bodyRoot.y = -1 + 1 * Math.cos((t * Math.PI * 2) / BREATHE_IDLE_PERIOD)
        bodyRoot.x = w
        bodyRoot.rotation = 0.015 * w
        legL.rotation = 0
        legR.rotation = 0
        armL.rotation = 0.03 * Math.sin(t * 1.1)
        armR.rotation = -0.03 * Math.sin(t * 1.1)
        if (squashStart >= 0) {
          const e = 1 - (timeSec - squashStart) / SQUASH_DURATION
          if (e <= 0) {
            squashStart = -1
            bodyRoot.scale.set(1)
          } else {
            bodyRoot.scale.set(1 + 0.1 * e, 1 - 0.14 * e)
          }
        }
      }
    },
    destroy() {
      root.destroy({ children: true })
    },
  }
}
