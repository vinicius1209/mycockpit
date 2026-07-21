/** Testes da biblioteca de props — PRNG determinístico e fábricas puras
 *  (GraphicsContext/Graphics instanciam sem renderer; nada de WebGL aqui). */
import { describe, expect, it } from "vitest"
import {
  createBookshelf,
  createCoffeeMachine,
  createDeskTop,
  createExecutiveChair,
  createExecutiveDeskBase,
  createExecutiveDeskTop,
  createExecutiveSideboard,
  createExecutiveVisitorChair,
  createMeetingTableBase,
  createMeetingTableTop,
  createPlantVariant,
  createRug,
  createTv,
  createWallArt,
  createWallClock,
  createWhiteboard,
  DESK_MONITOR_FRAME,
  DESK_SCREEN_RECT,
  hashSeed,
  mulberry32,
  PLANT_VARIANTS,
  sharedDecorContexts,
  SPIKE_SCALE,
} from "./props"
import { AGENT_BEHIND_DY } from "./stage"

describe("PRNG semeado (decoração determinística por sala)", () => {
  it("hashSeed é estável, uint32 e sensível ao projectId", () => {
    expect(hashSeed("mycockpit")).toBe(hashSeed("mycockpit"))
    expect(hashSeed("mycockpit")).not.toBe(hashSeed("outro-projeto"))
    for (const s of ["", "a", "mycockpit", "🚀"]) {
      const h = hashSeed(s)
      expect(Number.isInteger(h)).toBe(true)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xffffffff)
    }
  })

  it("mulberry32: mesma semente ⇒ mesma sequência; sementes distintas divergem", () => {
    const a = mulberry32(hashSeed("proj-a"))
    const b = mulberry32(hashSeed("proj-a"))
    const c = mulberry32(hashSeed("proj-b"))
    const seqA = [a(), a(), a(), a()]
    const seqB = [b(), b(), b(), b()]
    const seqC = [c(), c(), c(), c()]
    expect(seqA).toEqual(seqB)
    expect(seqA).not.toEqual(seqC)
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it("escolha de variante de planta por semente é reprodutível", () => {
    const pick = (id: string): string => {
      const rnd = mulberry32(hashSeed(id))
      return PLANT_VARIANTS[Math.floor(rnd() * PLANT_VARIANTS.length)]
    }
    expect(pick("mycockpit")).toBe(pick("mycockpit"))
    expect(PLANT_VARIANTS).toContain(pick("qualquer"))
  })
})

describe("contexts compartilhados da decoração", () => {
  it("são singleton (1 tesselação p/ N instâncias)", () => {
    const a = sharedDecorContexts()
    const b = sharedDecorContexts()
    expect(a).toBe(b)
    // duas instâncias do mesmo prop compartilham o MESMO context
    expect(createBookshelf().context).toBe(createBookshelf().context)
    expect(createPlantVariant("b").context).toBe(createPlantVariant("b").context)
  })

  it("variantes de planta têm geometria própria", () => {
    const ids = new Set(PLANT_VARIANTS.map((v) => createPlantVariant(v).context))
    expect(ids.size).toBe(3)
  })
})

describe("fábricas", () => {
  it("aplicam SPIKE_SCALE (escala consistente com a mesa)", () => {
    for (const g of [createRug("small"), createBookshelf(), createWhiteboard()]) {
      expect(g.scale.x).toBeCloseTo(SPIKE_SCALE)
      expect(g.scale.y).toBeCloseTo(SPIKE_SCALE)
    }
    expect(createCoffeeMachine().root.scale.x).toBeCloseTo(SPIKE_SCALE)
    expect(createWallClock().root.scale.x).toBeCloseTo(SPIKE_SCALE)
  })

  it("tapete: 2 tamanhos com contexts distintos e cor via tint", () => {
    const small = createRug("small")
    const large = createRug("large", 0x9cab8f)
    expect(small.context).not.toBe(large.context)
    expect(small.tint).toBe(0xffffff) // geometria branca, sem tint por padrão
    expect(large.tint).toBe(0x9cab8f)
  })

  it("workstation revela roupa sem perder a leitura sentada atrás da mesa", () => {
    const top = createDeskTop().root
    const screen = top.children[1].getLocalBounds()
    expect(screen.width).toBeCloseTo(DESK_SCREEN_RECT.w)
    expect(screen.height).toBeCloseTo(DESK_SCREEN_RECT.h)
    expect(DESK_MONITOR_FRAME.w / DESK_MONITOR_FRAME.h).toBeGreaterThan(1.8)

    // Avatar sentado: torso local -34..10. Mede a faixa acima do primeiro
    // pixel sólido do chassis, já considerando escala e offset do stage.
    const torsoTop = -AGENT_BEHIND_DY - 34 * SPIKE_SCALE
    const torsoHeight = 44 * SPIKE_SCALE
    const monitorTop = DESK_MONITOR_FRAME.y * SPIKE_SCALE
    const visibleRatio = (monitorTop - torsoTop) / torsoHeight
    expect(visibleRatio).toBeGreaterThanOrEqual(0.25)
    expect(visibleRatio).toBeLessThanOrEqual(0.5)
  })

  it("mesão: fatias base/tampo separadas p/ y-sort, mesma âncora", () => {
    const base = createMeetingTableBase()
    const top = createMeetingTableTop()
    expect(base.context).not.toBe(top.context)
    // âncora nos pés: o tampo vive acima da âncora (y negativo)
    expect(top.getLocalBounds().maxY).toBeLessThan(0)
    // a base alcança o chão (sombra em volta de y=0)
    expect(base.getLocalBounds().maxY).toBeGreaterThan(0)
  })

  it("diretoria: estação fatiada e assentos têm proporções próprias", () => {
    const base = createExecutiveDeskBase()
    const top = createExecutiveDeskTop()
    expect(base.context).not.toBe(top.context)
    expect(base.getLocalBounds().maxY).toBeGreaterThan(0)
    expect(top.getLocalBounds().maxY).toBeLessThan(0)

    const chair = createExecutiveChair().getLocalBounds()
    const visitor = createExecutiveVisitorChair().getLocalBounds()
    expect(chair.minY).toBeLessThan(visitor.minY)
    expect(chair.width).toBeGreaterThan(visitor.width)
    expect(createExecutiveSideboard().getLocalBounds().maxY).toBeGreaterThan(0)
  })

  it("âncora nos pés: móveis de chão tocam y≈0; props de parede ficam acima", () => {
    const shelf = createBookshelf().getLocalBounds()
    expect(shelf.minY).toBeLessThan(-80) // alto
    expect(shelf.maxY).toBeGreaterThan(0) // sombra/base no chão
    for (const wall of [createTv(), createWallArt(), createWhiteboard()]) {
      expect(wall.getLocalBounds().maxY).toBeLessThanOrEqual(0)
    }
  })

  it("relógio: ponteiros são filhos separados com rotação independente", () => {
    const clock = createWallClock()
    expect(clock.hourHand).not.toBe(clock.minuteHand)
    const plane = clock.hourHand.parent
    expect(plane).toBe(clock.minuteHand.parent)
    // plano da parede: skew que deita o mostrador na inclinação 1/2
    expect(plane?.skew.y).toBeCloseTo(Math.atan(0.5))
    clock.hourHand.rotation = 1.25
    clock.minuteHand.rotation = -0.5
    expect(clock.hourHand.rotation).toBeCloseTo(1.25)
    expect(clock.minuteHand.rotation).toBeCloseTo(-0.5)
  })

  it("máquina de café expõe o vapor como parte animável dentro do root", () => {
    const machine = createCoffeeMachine()
    expect(machine.steam.root.parent).toBe(machine.root)
    // tick não explode e respeita reduced-motion (pose estática)
    machine.steam.tick(1.23, 0.5, true)
    expect(machine.steam.root.alpha).toBeCloseTo(0.3)
  })
})
