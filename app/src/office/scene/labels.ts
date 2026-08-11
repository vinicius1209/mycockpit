/** Labels de mesa — Pixi Text em camada própria de TELA (escala inversa ao
 *  zoom feita pelo stage: a camada não recebe o transform da câmera; o stage
 *  só reposiciona o root do label na projeção da mesa a cada render).
 *
 *  Direção de arte (onda Gather): o PADRÃO é um mini-pill — dot de estado +
 *  nome, sem linha de estado, sem borda grossa. O cartão completo (nome +
 *  linha de estado/persona) é REVELAÇÃO PROGRESSIVA: só aparece quando a mesa
 *  importa (proximidade do boss, hover, mão levantada, persona de missão). A
 *  transição pill↔cartão é animada por scale/alpha no tick (easing do app).
 *
 *  LOD: abaixo de zoom 0.8 pill/cartão somem e fica só o beacon de estado
 *  (marco), reancorado ao monitor da mesa. Texts com resolution=DPR, criados
 *  após fonts.ready.
 */
import { Container, Graphics, Text } from "pixi.js"
import type { DeskVisualState, RoomAggregate } from "@/lib/fleet/types"
import {
  beaconColorForState,
  doorLightColor,
  LABEL_LOD_MIN_ZOOM,
  type ThemeTokens,
} from "./logic"

// --- pill (padrão Gather: dot + nome, compacto) ----------------------------
const PILL_PAD_X = 9
const PILL_PAD_Y = 4
const PILL_DOT_R = 3 //           dot de estado (6px)
const PILL_GAP = 5 //             respiro dot→nome→glifo
const PILL_NAME_SIZE = 11
// --- cartão expandido (revelação progressiva; compacto, não o 176×60 antigo)
const CARD_PAD_X = 11
const CARD_PAD_Y = 8
const CARD_GAP = 6 //             dot→nome no cabeçalho
const CARD_LINE_GAP = 3 //        nome→linha de estado
const CARD_NAME_SIZE = 13
const CARD_STATE_SIZE = 10
const CARD_MIN_W = 128
/** Respiro do centro do pill/cartão acima do ponto de ancoragem (px de tela).
 *  O stage já projeta o label num ponto de CENA acima da cabeça do agent
 *  (LABEL_ANCHOR_LIFT); aqui só a folga fina do pill sobre ele. */
const LABEL_LIFT = 4
/** No LOD sem texto o beacon desce até o MONITOR da mesa: px de CENA abaixo
 *  do ponto de ancoragem do label (LABEL_ANCHOR_LIFT=96 do stage − topo do
 *  monitor ≈ 58) — multiplicado pelo zoom REAL, o dot gruda no monitor em
 *  qualquer zoom em vez de flutuar em altura fixa de tela. */
const BEACON_MONITOR_DROP = 38
/** Duração da transição pill↔cartão (s) — 120ms do app. */
const EMPHASIS_DUR = 0.12

const FONT_SANS = "Geist Variable, ui-sans-serif, system-ui, sans-serif"
const FONT_MONO = "Geist Mono Variable, ui-monospace, monospace"

/** Easing do app: cubic-bezier(0.2, 0.8, 0.2, 1) — solver por bisseção. */
function makeCubicBezier(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): (x: number) => number {
  const sampleX = (t: number) =>
    3 * (1 - t) * (1 - t) * t * x1 + 3 * (1 - t) * t * t * x2 + t * t * t
  const sampleY = (t: number) =>
    3 * (1 - t) * (1 - t) * t * y1 + 3 * (1 - t) * t * t * y2 + t * t * t
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let lo = 0
    let hi = 1
    let t = x
    for (let i = 0; i < 14; i++) {
      const e = sampleX(t) - x
      if (Math.abs(e) < 1e-4) break
      if (e > 0) hi = t
      else lo = t
      t = (lo + hi) / 2
    }
    return sampleY(t)
  }
}
const EASE_APP = makeCubicBezier(0.2, 0.8, 0.2, 1)

/** Estado "rodando" (turno ativo): dot pulsa + glifo ⚙ no pill. */
function isRunning(state: DeskVisualState): boolean {
  return state === "typing" || state === "thinking"
}

function textResolution(): number {
  if (typeof devicePixelRatio === "number") return Math.min(devicePixelRatio, 2)
  return 1
}

/** Espera as fontes do app (com timeout — nunca trava a cena). */
export async function whenFontsReady(timeoutMs = 1500): Promise<void> {
  if (typeof document === "undefined" || !("fonts" in document)) return
  await Promise.race([
    document.fonts.ready.then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]).catch(() => undefined)
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** Nível de ênfase do label — pill compacto (padrão) ou cartão completo. */
export type LabelEmphasis = "pill" | "expanded"

export type DeskLabel = {
  /** Container em coords de TELA — o stage posiciona a cada render. */
  root: Container
  setInfo(name: string, color: string): void
  /** Atualização discreta vinda do snapshot (nunca por frame). */
  setState(state: DeskVisualState, label: string, detail?: string): void
  /** LOD — false esconde pill/cartão e mantém só o beacon; zoom aproxima o
   *  beacon da mesa (a altura fixa de tela flutuaria no zoom-out). */
  setLod(textVisible: boolean, zoom: number): void
  /** Revelação progressiva: "expanded" abre o cartão completo. O stage passa
   *  a ênfase por hover/proximidade; a mão levantada expande sozinha (interno).
   *  Barato de chamar por frame (early-return sem mudança). */
  setEmphasis(level: LabelEmphasis): void
  tick(timeSec: number, reducedMotion: boolean): void
  destroy(): void
}

export function createDeskLabel(name: string, color: string, tokens: ThemeTokens): DeskLabel {
  const root = new Container()
  // labels nunca capturam ponteiro (hit-test de mesa é do stage)
  root.eventMode = "none"

  let borderColor = color
  let state: DeskVisualState = "idle"

  // === PILL (padrão) — dot + nome, compacto ================================
  const pillC = new Container()
  const pillBg = new Graphics()
  const pillDot = new Graphics()
  pillDot.circle(0, 0, PILL_DOT_R).fill({ color: 0xffffff })
  pillDot.tint = tokens.stIdle
  const pillName = new Text({
    text: truncate(name, 18),
    style: { fontFamily: FONT_SANS, fontSize: PILL_NAME_SIZE, fontWeight: "600", fill: 0xf0f1f2 },
    resolution: textResolution(),
  })
  const gearText = new Text({
    text: "⚙",
    style: { fontFamily: FONT_SANS, fontSize: 10, fill: 0x8e969f },
    resolution: textResolution(),
  })
  gearText.visible = false
  pillC.addChild(pillBg, pillDot, pillName, gearText)
  pillC.position.set(0, -LABEL_LIFT)
  root.addChild(pillC)

  function layoutPill(): void {
    const running = isRunning(state)
    gearText.visible = running
    const gearW = running ? PILL_GAP + gearText.width : 0
    const contentW = PILL_DOT_R * 2 + PILL_GAP + pillName.width + gearW
    const w = PILL_PAD_X * 2 + contentW
    const h = PILL_PAD_Y * 2 + Math.max(PILL_DOT_R * 2, pillName.height)
    const x0 = -w / 2
    const y0 = -h / 2
    pillBg.clear()
    pillBg.roundRect(x0, y0, w, h, h / 2).fill({ color: 0x0b1018, alpha: 0.92 })
    pillBg.roundRect(x0, y0, w, h, h / 2).stroke({ width: 1, color: borderColor, alpha: 0.5 })
    let cx = x0 + PILL_PAD_X + PILL_DOT_R
    pillDot.position.set(cx, 0)
    cx += PILL_DOT_R + PILL_GAP
    pillName.position.set(cx, -pillName.height / 2)
    cx += pillName.width
    if (running) gearText.position.set(cx + PILL_GAP, -gearText.height / 2)
  }

  // === CARTÃO expandido — dot + nome + linha de estado =====================
  const cardC = new Container()
  const cardBg = new Graphics()
  const cardDot = new Graphics()
  cardDot.circle(0, 0, PILL_DOT_R).fill({ color: 0xffffff })
  cardDot.tint = tokens.stIdle
  const cardName = new Text({
    text: truncate(name, 20),
    style: { fontFamily: FONT_SANS, fontSize: CARD_NAME_SIZE, fontWeight: "600", fill: 0xf0f1f2 },
    resolution: textResolution(),
  })
  const cardState = new Text({
    text: "",
    style: { fontFamily: FONT_MONO, fontSize: CARD_STATE_SIZE, fontWeight: "500", fill: 0x8e969f, letterSpacing: 0.2 },
    resolution: textResolution(),
  })
  cardC.addChild(cardBg, cardDot, cardName, cardState)
  cardC.position.set(0, -LABEL_LIFT)
  cardC.alpha = 0
  cardC.visible = false
  root.addChild(cardC)

  function layoutCard(): void {
    const headW = PILL_DOT_R * 2 + CARD_GAP + cardName.width
    const inner = Math.max(headW, cardState.width)
    const w = Math.max(CARD_MIN_W, CARD_PAD_X * 2 + inner)
    const h = CARD_PAD_Y * 2 + cardName.height + CARD_LINE_GAP + cardState.height
    const x0 = -w / 2
    const y0 = -h / 2
    cardBg.clear()
    cardBg.roundRect(x0, y0, w, h, 10).fill({ color: 0x0b1018, alpha: 0.92 })
    cardBg.roundRect(x0, y0, w, h, 10).stroke({ width: 1, color: borderColor, alpha: 0.5 })
    const nameY = y0 + CARD_PAD_Y
    cardDot.position.set(x0 + CARD_PAD_X + PILL_DOT_R, nameY + cardName.height / 2)
    cardName.position.set(x0 + CARD_PAD_X + PILL_DOT_R * 2 + CARD_GAP, nameY)
    cardState.position.set(x0 + CARD_PAD_X, nameY + cardName.height + CARD_LINE_GAP)
  }

  // === beacon (só no LOD longe — marco no monitor) =========================
  const beacon = new Graphics()
  beacon.circle(0, 0, 6).fill({ color: 0xffffff })
  beacon.tint = tokens.stIdle
  beacon.visible = false
  root.addChild(beacon)

  layoutPill()
  layoutCard()

  // ênfase: alvo (0 pill · 1 cartão) + progresso animado ---------------------
  let wantExpand = false //          pedido do stage (hover/proximidade)
  let emphProg = 0 //                progresso corrente (0..1)
  let animFrom = 0
  let animTo = 0
  let animStart = 0
  let animActive = false
  let lodText = true

  /** Alvo efetivo: stage OU mão levantada (auto-expande, §revelação). */
  function effectiveTarget(): number {
    return wantExpand || state === "hand" ? 1 : 0
  }
  function retargetEmphasis(timeSec: number): void {
    const to = effectiveTarget()
    if (to === animTo) return //  já no alvo (ou animando pra ele)
    animFrom = emphProg
    animTo = to
    animStart = timeSec
    animActive = true
  }

  function setDotTint(): void {
    const c = beaconColorForState(state, tokens)
    pillDot.tint = c
    cardDot.tint = c
    beacon.tint = c
  }

  return {
    root,
    setInfo(nextName, nextColor) {
      pillName.text = truncate(nextName, 18)
      cardName.text = truncate(nextName, 20)
      if (nextColor !== borderColor) borderColor = nextColor
      layoutPill()
      layoutCard()
    },
    setState(nextState, label, detail) {
      const wasRunning = isRunning(state)
      state = nextState
      setDotTint()
      // linha do cartão: mão ⇒ chamada explícita; senão rótulo (+ persona)
      const line =
        nextState === "hand"
          ? "Aguardando aprovação"
          : detail
            ? `${label} · ${detail}`
            : label
      cardState.text = truncate(line, 30)
      // mesa apagada: tudo esmaecido
      const off = nextState === "off"
      pillC.alpha = off ? 0.55 : 1 - emphProg
      cardC.alpha = off ? 0.55 * emphProg : emphProg
      layoutCard()
      if (wasRunning !== isRunning(nextState)) layoutPill()
    },
    setLod(textVisible, zoom) {
      lodText = textVisible
      if (textVisible) {
        beacon.visible = false
        beacon.scale.set(1)
      } else {
        // só o beacon, um pouco maior — REANCORADO ao monitor da mesa (offset
        // de CENA × zoom real), nunca altura fixa de tela: em zoom-out o dot
        // fica colado no monitor em vez de boiar desconectado da mesa
        pillC.visible = false
        cardC.visible = false
        beacon.visible = true
        beacon.position.set(0, BEACON_MONITOR_DROP * zoom)
        beacon.scale.set(1.4)
      }
    },
    setEmphasis(level) {
      const next = level === "expanded"
      if (next === wantExpand) return
      wantExpand = next
    },
    tick(timeSec, reducedMotion) {
      // 1) transição pill↔cartão (só quando há texto — LOD longe é só o beacon)
      if (lodText) {
        retargetEmphasis(timeSec)
        if (animActive) {
          if (reducedMotion) {
            emphProg = animTo //           corte seco
            animActive = false
          } else {
            const t = (timeSec - animStart) / EMPHASIS_DUR
            if (t >= 1) {
              emphProg = animTo
              animActive = false
            } else {
              emphProg = animFrom + (animTo - animFrom) * EASE_APP(t)
            }
          }
        }
        const off = state === "off"
        pillC.visible = emphProg < 1
        cardC.visible = emphProg > 0
        pillC.alpha = off ? 0.55 * (1 - emphProg) : 1 - emphProg
        cardC.alpha = off ? 0.55 * emphProg : emphProg
        // cartão cresce sutil do pill (0.96→1); pill encolhe de leve ao sair
        cardC.scale.set(0.96 + 0.04 * emphProg)
        pillC.scale.set(1 - 0.03 * emphProg)
      }

      // 2) pulso do dot: turno rodando OU mão levantada (chama o humano)
      const pulses = (isRunning(state) || state === "hand") && !reducedMotion
      const a = pulses ? 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(timeSec * 5)) : 1
      pillDot.alpha = a
      cardDot.alpha = a
      beacon.alpha = a
    },
    destroy() {
      root.destroy({ children: true })
    },
  }
}

// ---------------------------------------------------------------------------
// Label de SALA (identificação de relance) — escala de tela, LOD INVERSO ao
// das mesas: em zoom-out (cartões de mesa somem) os labels de sala CRESCEM e
// viram o marco dominante; em zoom-in ficam discretos (menores, alpha 0.75).
// ---------------------------------------------------------------------------

const ROOM_LABEL_H = 36
/** Escala do label de sala no zoom-out (marco de wayfinding dominante). No
 *  zoom-in o label some (o decalque do piso carrega a identidade da sala). */
const ROOM_SCALE_FAR = 1.18

export type RoomLabel = {
  /** Container em coords de TELA — o stage posiciona a cada render (âncora de
   *  CENA acima do centro da parede norte da sala). */
  root: Container
  /** Nome COMPLETO (sem truncar) + cor do projeto — discreto (snapshot). */
  setInfo(name: string, color: string | number): void
  /** Dot do agregado da sala; null esconde o dot (sala comum). */
  setAggregate(agg: RoomAggregate | null): void
  /** LOD inverso por zoom (chamado por render; early-return sem mudança). */
  setLod(zoom: number): void
  tick(timeSec: number, reducedMotion: boolean): void
  destroy(): void
}

export function createRoomLabel(initialName: string, tokens: ThemeTokens): RoomLabel {
  const root = new Container()
  root.eventMode = "none"

  const bg = new Graphics()
  const bar = new Graphics()
  const dot = new Graphics()
  dot.circle(0, 0, 5).fill({ color: 0xffffff })
  dot.visible = false
  const nameText = new Text({
    text: initialName,
    style: { fontFamily: FONT_SANS, fontSize: 15, fontWeight: "600", fill: 0xf0f1f2 },
    resolution: textResolution(),
  })
  root.addChild(bg, bar, nameText, dot)

  let color: string | number = tokens.brass
  let agg: RoomAggregate | null = null

  /** Re-layout DISCRETO (nome/cor/dot mudou) — nunca por frame. */
  function layout(): void {
    const dotZone = agg === null ? 0 : 20
    const w = 30 + nameText.width + dotZone + 12
    const x0 = -w / 2
    bg.clear()
    bg.roundRect(x0, -ROOM_LABEL_H / 2, w, ROOM_LABEL_H, 10).fill({ color: 0x0b1018, alpha: 0.92 })
    bg.roundRect(x0, -ROOM_LABEL_H / 2, w, ROOM_LABEL_H, 10)
      .stroke({ width: 1.5, color: 0xffffff, alpha: 0.14 })
    bar.clear()
    bar.roundRect(x0 + 9, -10, 5, 20, 2.5).fill({ color: 0xffffff })
    bar.tint = color
    nameText.position.set(x0 + 22, -nameText.height / 2)
    dot.position.set(x0 + w - 14, 0)
  }
  layout()

  let lodZoom = -1
  return {
    root,
    setInfo(name, nextColor) {
      if (name === nameText.text && nextColor === color) return
      nameText.text = name // nome COMPLETO — identificação é a missão do label
      color = nextColor
      layout()
    },
    setAggregate(nextAgg) {
      if (nextAgg === agg) return
      agg = nextAgg
      dot.visible = nextAgg !== null
      if (nextAgg !== null) dot.tint = doorLightColor(nextAgg, tokens)
      layout()
    },
    setLod(zoom) {
      const far = zoom < LABEL_LOD_MIN_ZOOM
      const wasFar = lodZoom < LABEL_LOD_MIN_ZOOM
      const first = lodZoom < 0
      lodZoom = zoom
      if (!first && far === wasFar) return
      // LOD INVERSO real: em zoom-out o label de sala é o MARCO dominante de
      // wayfinding (cresce). Em zoom-in ele SOME — a identidade da sala já está
      // pintada no piso (decalque "FROTA"/"LAB DE IDEIAS"); manter o pill
      // flutuante aqui só duplica o decalque e COLIDE com os pills das mesas.
      root.visible = far
      root.scale.set(ROOM_SCALE_FAR)
      root.alpha = 1
    },
    tick(timeSec, reducedMotion) {
      if (agg === "hand" && !reducedMotion) {
        dot.alpha = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(timeSec * 5))
      } else {
        dot.alpha = 1
      }
    },
    destroy() {
      root.destroy({ children: true })
    },
  }
}
