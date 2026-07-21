/** Efeitos da cena — tudo transform/alpha (O6: NADA de filtros; glow = elipses
 *  alpha empilhadas). Cada efeito expõe `tick(...)` chamado pelo stage a cada
 *  render; com reduced-motion tudo vira pose estática. */
import { Container, Graphics, GraphicsContext } from "pixi.js"
import { motePosition, moteSpecs, mulberry32 } from "./ambient"
import { SCREEN_ON } from "./props"

// ---------------------------------------------------------------------------
// Contexts compartilhados dos efeitos (geometria branca; tint por instância)
// ---------------------------------------------------------------------------

type FxCtxs = {
  /** Elipse de chão (glow/realce) — empilhada para gradiente falso. */
  floorGlow: GraphicsContext
  /** Anel de chão (marca de click-to-move). */
  floorRing: GraphicsContext
  /** Vapor do café (stroke do spike: "M-3-9c-7-8 8-9 0-18"). */
  steam: GraphicsContext
  /** Balões de pensamento (3 círculos crescentes do spike). */
  dotSmall: GraphicsContext
  dotMid: GraphicsContext
  dotBig: GraphicsContext
  /** Quad da tela do monitor (mesmo paralelogramo de props.monitorScreen) —
   *  empilhado vira o brilho pulsante de "digitando". */
  screenGlowQuad: GraphicsContext
  /** Retalho de confete (retângulo pequeno; tint por partícula). */
  confettiChip: GraphicsContext
}

let fx: FxCtxs | null = null

function fxCtxs(): FxCtxs {
  if (fx) return fx
  const floorGlow = new GraphicsContext().ellipse(0, 0, 54, 20).fill({ color: 0xffffff })
  const floorRing = new GraphicsContext()
    .ellipse(0, 0, 30, 15)
    .stroke({ width: 3, color: 0xffffff })
  const steam = new GraphicsContext()
    .moveTo(-3, -9)
    .bezierCurveTo(-10, -17, 5, -18, -3, -27)
    .stroke({ width: 2, color: 0xffffff })
  const dotSmall = new GraphicsContext().circle(0, 0, 4).fill({ color: 0xffffff })
  const dotMid = new GraphicsContext().circle(0, 0, 6).fill({ color: 0xffffff })
  const dotBig = new GraphicsContext().circle(0, 0, 9).fill({ color: 0xffffff })
  const screenGlowQuad = new GraphicsContext()
    .roundRect(-22, -88, 44, 26, 1)
    .fill({ color: 0xffffff })
  const confettiChip = new GraphicsContext()
    .roundRect(-2.5, -1.5, 5, 3, 1)
    .fill({ color: 0xffffff })
  fx = {
    floorGlow,
    floorRing,
    steam,
    dotSmall,
    dotMid,
    dotBig,
    screenGlowQuad,
    confettiChip,
  }
  return fx
}

// ---------------------------------------------------------------------------
// Highlight de mesa (hover / alcance de interação)
// ---------------------------------------------------------------------------

export type DeskHighlight = {
  root: Container
  /** Mostra o realce na posição de cena dada (px de mundo projetado). */
  showAt(x: number, y: number): void
  hide(): void
  setColor(color: string | number): void
  tick(timeSec: number, reducedMotion: boolean): void
}

/** Realce de chão sob a mesa: elipses alpha empilhadas (glow falso). */
export function createDeskHighlight(color: string | number): DeskHighlight {
  const root = new Container()
  root.visible = false
  const cx = fxCtxs()
  // pilha de 3 elipses — centro mais denso, borda suave
  const layers: Graphics[] = []
  for (const [scale, alpha] of [
    [1.0, 0.1],
    [0.72, 0.12],
    [0.45, 0.16],
  ] as const) {
    const g = new Graphics(cx.floorGlow)
    g.scale.set(scale)
    g.alpha = alpha
    layers.push(g)
    root.addChild(g)
  }
  for (const l of layers) l.tint = color
  return {
    root,
    showAt(x, y) {
      root.position.set(x, y)
      root.visible = true
    },
    hide() {
      root.visible = false
    },
    setColor(c) {
      for (const l of layers) l.tint = c
    },
    tick(timeSec, reducedMotion) {
      if (!root.visible) return
      // respiração sutil do realce (só transform/alpha)
      const s = reducedMotion ? 1 : 1 + 0.04 * Math.sin(timeSec * 3.4)
      root.scale.set(s)
    },
  }
}

// ---------------------------------------------------------------------------
// Indicador de click-to-move (marca no chão que pulsa e some)
// ---------------------------------------------------------------------------

const CLICK_MARK_DURATION = 0.7 // s

export type ClickMarker = {
  root: Container
  /** Dispara a marca na posição de cena dada. */
  showAt(x: number, y: number, timeSec: number): void
  tick(timeSec: number, reducedMotion: boolean): void
}

export function createClickMarker(color: string | number): ClickMarker {
  const root = new Container()
  root.visible = false
  const cx = fxCtxs()
  const ringA = new Graphics(cx.floorRing)
  const ringB = new Graphics(cx.floorRing)
  ringA.tint = color
  ringB.tint = color
  root.addChild(ringA, ringB)
  let startedAt = -1
  return {
    root,
    showAt(x, y, timeSec) {
      root.position.set(x, y)
      root.visible = true
      startedAt = timeSec
    },
    tick(timeSec, reducedMotion) {
      if (!root.visible || startedAt < 0) return
      const t = (timeSec - startedAt) / CLICK_MARK_DURATION
      if (t >= 1) {
        root.visible = false
        startedAt = -1
        return
      }
      if (reducedMotion) {
        // estático: some na metade do tempo, sem pulso
        ringA.scale.set(1)
        ringB.visible = false
        root.alpha = t < 0.5 ? 0.8 : 0
        return
      }
      ringB.visible = true
      // anel externo expande e esvai; interno contrai
      ringA.scale.set(0.4 + t * 1.1)
      ringA.alpha = 0.9 * (1 - t)
      ringB.scale.set(Math.max(0.15, 0.7 - t * 0.5))
      ringB.alpha = 0.5 * (1 - t)
      root.alpha = 1
    },
  }
}

// ---------------------------------------------------------------------------
// Vapor do café (prop de idle)
// ---------------------------------------------------------------------------

const STEAM_PERIOD = 1.8 // s (spike: animation steam 1.8s ease-out infinite)

export type Steam = {
  root: Graphics
  tick(timeSec: number, phase: number, reducedMotion: boolean): void
}

export function createSteam(): Steam {
  const root = new Graphics(fxCtxs().steam)
  root.tint = 0xffffff
  root.alpha = 0.5
  return {
    root,
    tick(timeSec, phase, reducedMotion) {
      if (!root.visible) return
      if (reducedMotion) {
        // pose estática: vapor fraco, parado
        root.position.set(0, 0)
        root.alpha = 0.3
        return
      }
      // spike: translateY 2px→-8px, opacity 0→.7→0
      const t = ((timeSec + phase) % STEAM_PERIOD) / STEAM_PERIOD
      root.position.set(0, 2 - 10 * t)
      root.alpha = 0.7 * (t < 0.35 ? t / 0.35 : 1 - (t - 0.35) / 0.65) * 0.71
    },
  }
}

// ---------------------------------------------------------------------------
// Balões de pensamento (thinking)
// ---------------------------------------------------------------------------

const DOT_PERIOD = 1.5 // s (spike: dot-pulse 1.5s)
const DOT_DELAYS = [0, 0.18, 0.36] // s (spike: nth-child delays)

export type ThoughtDots = {
  root: Container
  setColor(color: string | number): void
  tick(timeSec: number, phase: number, reducedMotion: boolean): void
}

export function createThoughtDots(color: string | number): ThoughtDots {
  const cx = fxCtxs()
  const root = new Container()
  // posições do spike: translate(34 -83) fica no avatar; aqui local
  const dots = [
    new Graphics(cx.dotSmall),
    new Graphics(cx.dotMid),
    new Graphics(cx.dotBig),
  ]
  dots[1].position.set(13, -9)
  dots[2].position.set(31, -17)
  for (const d of dots) {
    d.tint = color
    root.addChild(d)
  }
  return {
    root,
    setColor(c) {
      for (const d of dots) d.tint = c
    },
    tick(timeSec, phase, reducedMotion) {
      if (!root.visible) return
      if (reducedMotion) {
        for (const d of dots) {
          d.scale.set(1)
          d.alpha = 0.8
        }
        return
      }
      // spike: scale .8↔1.15, opacity .48↔1
      for (let i = 0; i < dots.length; i++) {
        const t = ((timeSec + phase - DOT_DELAYS[i]) % DOT_PERIOD) / DOT_PERIOD
        const wave = 0.5 - 0.5 * Math.cos(t * Math.PI * 2)
        dots[i].scale.set(0.8 + 0.35 * wave)
        dots[i].alpha = 0.48 + 0.52 * wave
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Vida ambiente — efeitos uniformes {root, update(timeSec, reducedMotion)}
// (fase por seed: mulberry32 — mesma seed ⇒ mesma vida entre sessões)
// ---------------------------------------------------------------------------

/** Assinatura comum dos efeitos de vida ambiente: o integrador adiciona
 *  `root` na cena e chama `update` no tick existente do stage. */
export type AmbientFx = {
  root: Container
  update(timeSec: number, reducedMotion: boolean): void
}

// --- brilho do monitor digitando -------------------------------------------

const SCREEN_GLOW_PERIOD = 1.2 // s
/** Centro do quad da tela (pivot p/ as camadas escalarem no lugar). */
const SCREEN_GLOW_CX = -11.5
const SCREEN_GLOW_CY = -8
/** Camadas [escala, alpha base] — externa difusa, interna sobre a tela. */
const SCREEN_GLOW_LAYERS = [
  [1.45, 0.12],
  [1.2, 0.17],
  [1.0, 0.24],
] as const

export type ScreenGlow = AmbientFx & {
  setColor(color: string | number): void
  /** Liga/desliga (integrador: ativo SÓ com a mesa digitando). */
  setActive(active: boolean): void
}

/** Brilho sutil pulsante do monitor digitando: 3 quads alpha empilhados
 *  atrás/na tela (mesmo paralelogramo da tela do monitor, coords locais do
 *  deskTop — adicionar `root` como irmão da tela dentro de deskTop.root).
 *  Nasce inativo (invisível). */
export function createScreenGlow(seed: number, color: string | number = SCREEN_ON): ScreenGlow {
  const root = new Container()
  root.visible = false
  const cx = fxCtxs()
  const layers: Graphics[] = []
  for (const [scale, alpha] of SCREEN_GLOW_LAYERS) {
    const g = new Graphics(cx.screenGlowQuad)
    g.pivot.set(SCREEN_GLOW_CX, SCREEN_GLOW_CY)
    g.position.set(SCREEN_GLOW_CX, SCREEN_GLOW_CY)
    g.scale.set(scale)
    g.alpha = alpha
    g.tint = color
    layers.push(g)
    root.addChild(g)
  }
  const phase = mulberry32(seed)() * SCREEN_GLOW_PERIOD
  return {
    root,
    setColor(c) {
      for (const l of layers) l.tint = c
    },
    setActive(active) {
      root.visible = active
    },
    update(timeSec, reducedMotion) {
      if (!root.visible) return
      if (reducedMotion) {
        // pose estática: brilho fixo nas bases
        for (let i = 0; i < layers.length; i++) {
          layers[i].alpha = SCREEN_GLOW_LAYERS[i][1]
          layers[i].scale.set(SCREEN_GLOW_LAYERS[i][0])
        }
        return
      }
      // pulso ~1.2s: alpha respira; camada externa cresce um tiquinho
      const w = 0.5 + 0.5 * Math.sin(((timeSec + phase) * Math.PI * 2) / SCREEN_GLOW_PERIOD)
      for (let i = 0; i < layers.length; i++) {
        layers[i].alpha = SCREEN_GLOW_LAYERS[i][1] * (0.6 + 0.4 * w)
      }
      layers[0].scale.set(SCREEN_GLOW_LAYERS[0][0] * (1 + 0.04 * w))
    },
  }
}

// --- baforada de poeira (boss chega do click-to-move) -----------------------

const PUFF_DURATION = 0.55 // s
const PUFF_PARTICLES = 6
const PUFF_TINT = 0xd8d2c2 // poeira quente (chão sage)

export type DustPuff = AmbientFx & {
  /** Dispara a baforada na posição de cena dada (pés do avatar). Pooled:
   *  reutiliza os mesmos Graphics a cada burst — zero alocação. */
  burstAt(x: number, y: number, timeSec: number): void
}

export function createDustPuff(seed = 1): DustPuff {
  const root = new Container()
  root.visible = false
  const cx = fxCtxs()
  const rng = mulberry32(seed)
  type Particle = { g: Graphics; dx: number; rise: number; size: number; delay: number }
  const parts: Particle[] = []
  for (let i = 0; i < PUFF_PARTICLES; i++) {
    const g = new Graphics(cx.dotSmall)
    g.tint = PUFF_TINT
    root.addChild(g)
    const side = i % 2 === 0 ? 1 : -1
    parts.push({
      g,
      dx: side * (7 + rng() * 12),
      rise: 3 + rng() * 5,
      size: 0.4 + rng() * 0.35,
      delay: rng() * 0.08,
    })
  }
  let startedAt = -1
  return {
    root,
    burstAt(x, y, timeSec) {
      root.position.set(x, y)
      root.visible = true
      startedAt = timeSec
    },
    update(timeSec, reducedMotion) {
      if (!root.visible || startedAt < 0) return
      if (reducedMotion) {
        // estático ⇒ sem baforada
        root.visible = false
        startedAt = -1
        return
      }
      if ((timeSec - startedAt) / PUFF_DURATION >= 1) {
        root.visible = false
        startedAt = -1
        return
      }
      for (const p of parts) {
        const u = Math.min(
          1,
          Math.max(0, (timeSec - startedAt - p.delay) / (PUFF_DURATION - p.delay)),
        )
        const spread = 1 - (1 - u) * (1 - u) // ease-out: espalha e desacelera
        p.g.position.set(
          p.dx * spread,
          -p.rise * Math.sin(Math.PI * Math.min(1, u * 1.15)),
        )
        p.g.scale.set(p.size * (0.6 + 0.9 * u))
        p.g.alpha = 0.32 * (1 - u)
      }
    },
  }
}

// --- vapor genérico (máquina de café / chaleira da decoração) ---------------

export type SteamPlume = AmbientFx

/** Vapor genérico reutilizável: 2 fiapos (mesma geometria compartilhada do
 *  vapor do avatar) com fases distintas por seed; sobe e esvai em loop. */
export function createSteamPlume(seed: number, scale = 1): SteamPlume {
  const root = new Container()
  root.scale.set(scale)
  const rng = mulberry32(seed)
  const wisps = [createSteam(), createSteam()]
  const phases = wisps.map(() => rng() * STEAM_PERIOD)
  for (let i = 0; i < wisps.length; i++) {
    // holder: o tick do fiapo escreve position/alpha do próprio root — o
    // deslocamento do 2º fiapo vive no pai (não é clobberado)
    const holder = new Container()
    holder.position.set(i * 5, i)
    holder.alpha = i === 0 ? 1 : 0.6
    holder.addChild(wisps[i].root)
    root.addChild(holder)
  }
  return {
    root,
    update(timeSec, reducedMotion) {
      if (!root.visible) return
      for (let i = 0; i < wisps.length; i++) wisps[i].tick(timeSec, phases[i], reducedMotion)
    },
  }
}

// --- poeira no facho da luminária -------------------------------------------

const MOTE_TINT = 0xfff3d8 // luz quente da luminária

export type AmbientMotes = AmbientFx

/** 4–6 partículas de poeira flutuando devagar no facho da luminária (alpha
 *  baixíssimo, browniano barato por seno composto — ambient.moteSpecs).
 *  `root` ancorado no TOPO-CENTRO do facho; width/height em px locais. */
export function createAmbientMotes(seed: number, width = 90, height = 70): AmbientMotes {
  const root = new Container()
  const cx = fxCtxs()
  const specs = moteSpecs(seed)
  const dots = specs.map((m) => {
    const g = new Graphics(cx.dotSmall)
    g.tint = MOTE_TINT
    g.scale.set(m.scale)
    g.alpha = m.alpha
    root.addChild(g)
    return g
  })
  const place = (timeSec: number): void => {
    for (let i = 0; i < specs.length; i++) {
      const p = motePosition(specs[i], timeSec)
      dots[i].position.set((p.x - 0.5) * width, p.y * height)
    }
  }
  place(0)
  return {
    root,
    update(timeSec, reducedMotion) {
      if (!root.visible) return
      if (reducedMotion) {
        // estático: pose de t=0, alphas base
        place(0)
        for (let i = 0; i < specs.length; i++) dots[i].alpha = specs[i].alpha
        return
      }
      place(timeSec)
      // cintilar lentíssimo (sempre baixíssimo)
      for (let i = 0; i < specs.length; i++) {
        dots[i].alpha = specs[i].alpha * (0.65 + 0.35 * Math.sin(0.5 * timeSec + specs[i].pa))
      }
    },
  }
}

// --- confete de comemoração (missão concluída) -------------------------------

const CONFETTI_DURATION = 1.5 // s
/** 12–16 partículas por burst (quantidade sorteada por seed). */
const CONFETTI_MIN = 12
const CONFETTI_SPAN = 5
/** Paleta festiva discreta: brass + running + success + papel claro. */
const CONFETTI_COLORS = [0xe4a862, 0x5bb8e8, 0x5bd6a0, 0xf1ead9] as const

export type Confetti = AmbientFx & {
  /** Dispara o burst na posição de cena dada (ponto de ORIGEM; as partículas
   *  caem a partir dele). Pooled: reutiliza os mesmos Graphics a cada burst —
   *  zero alocação por disparo. */
  burstAt(x: number, y: number, timeSec: number): void
}

/** Confete discreto de comemoração: 12–16 retalhos coloridos caem ~1.5s com
 *  balanço lateral e giro (transform/alpha apenas), esvaindo no fim. Coords
 *  locais do pai — anexar onde a chuva deve nascer (ex.: acima do avatar). */
export function createConfetti(seed = 1): Confetti {
  const root = new Container()
  root.visible = false
  const cx = fxCtxs()
  const rng = mulberry32(seed)
  const count = CONFETTI_MIN + Math.floor(rng() * (CONFETTI_SPAN + 1))
  type Chip = {
    g: Graphics
    dx: number //     deslocamento lateral total (px locais)
    fall: number //   queda total (px locais)
    sway: number //   amplitude do balanço lateral
    swayW: number //  frequência do balanço (rad/s)
    spinW: number //  velocidade de giro (rad/s)
    delay: number //  atraso do disparo (s)
    scale: number
    phase: number
  }
  const chips: Chip[] = []
  for (let i = 0; i < count; i++) {
    const g = new Graphics(cx.confettiChip)
    g.tint = CONFETTI_COLORS[i % CONFETTI_COLORS.length]
    g.visible = false
    root.addChild(g)
    const side = i % 2 === 0 ? 1 : -1
    chips.push({
      g,
      dx: side * (6 + rng() * 22),
      fall: 58 + rng() * 26,
      sway: 3 + rng() * 5,
      swayW: 5 + rng() * 5,
      spinW: (rng() - 0.5) * 14,
      delay: rng() * 0.18,
      scale: 0.7 + rng() * 0.5,
      phase: rng() * Math.PI * 2,
    })
  }
  let startedAt = -1
  return {
    root,
    burstAt(x, y, timeSec) {
      root.position.set(x, y)
      root.visible = true
      startedAt = timeSec
    },
    update(timeSec, reducedMotion) {
      if (!root.visible || startedAt < 0) return
      if (reducedMotion) {
        // estático ⇒ sem chuva de confete
        root.visible = false
        startedAt = -1
        return
      }
      if ((timeSec - startedAt) / CONFETTI_DURATION >= 1) {
        root.visible = false
        startedAt = -1
        return
      }
      for (const c of chips) {
        const u = Math.min(
          1,
          Math.max(0, (timeSec - startedAt - c.delay) / (CONFETTI_DURATION - c.delay)),
        )
        c.g.visible = u > 0
        if (u <= 0) continue
        // queda com leve aceleração + espalhada lateral desacelerando
        const drop = u * (0.55 + 0.45 * u)
        const spread = 1 - (1 - u) * (1 - u)
        c.g.position.set(
          c.dx * spread + c.sway * Math.sin(c.phase + timeSec * c.swayW),
          c.fall * drop,
        )
        c.g.rotation = c.phase + timeSec * c.spinW
        c.g.scale.set(c.scale)
        c.g.alpha = u < 0.68 ? 0.95 : 0.95 * (1 - (u - 0.68) / 0.32)
      }
    },
  }
}
