// Testes da planta (bridge/layout.ts): determinismo (inclusive da decoração
// procedural), encolhimento com 1 projeto, capacidade de 8, portas/interação
// caminháveis, mesas bloqueadas, props de chão que nunca selam caminho
// (verificado com o A* real do engine), sala comum e corredor decorado.

import { describe, expect, it } from "vitest"
import { findPath } from "@/office/engine/astar"
import {
  NOTICE_BOARD_ID,
  OFFICE_AGENTS,
  T_DOOR,
  T_INTERACT,
  T_WALK,
  type FloorPlan,
  type RoomDecorItem,
  type RoomPlacement,
} from "@/lib/fleet/types"
import {
  buildFloorPlan,
  BOSS_ROOM_H,
  BOSS_ROOM_W,
  COMMONS_H,
  COMMONS_ID,
  COMMONS_W,
  CORRIDOR_H,
  DECOR_FOOTPRINTS,
  FLOOR_PROP_KINDS,
  isBlockingDecor,
  MAX_ROOMS,
  PLANT_KINDS,
  ROOM_H,
  ROOM_W,
  WALL_PROP_KINDS,
  type OfficeProjectRef,
} from "./layout"

function projetos(n: number): OfficeProjectRef[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    name: `Projeto ${i}`,
    color: i % 2 === 0 ? "#e4a862" : null,
  }))
}

function tile(plan: FloorPlan, x: number, y: number): number {
  return plan.grid[y * plan.w + x]
}

function decorDe(room: RoomPlacement): RoomDecorItem[] {
  expect(room.decor).toBeDefined()
  return room.decor!
}

/** Largura da ala de salas (paredes incluídas) para n projetos. */
function alaW(n: number): number {
  return 1 + Math.ceil(n / 2) * (ROOM_W + 1)
}

function diretoriaEndX(n: number): number {
  return alaW(n) + BOSS_ROOM_W + 1
}

const CORRIDOR_TOP = 1 + ROOM_H + 1

describe("buildFloorPlan — determinismo", () => {
  it("mesma entrada ⇒ mesma planta (grid, salas, decor, commons e spawn)", () => {
    const a = buildFloorPlan(projetos(5))
    const b = buildFloorPlan(projetos(5))
    expect(b.w).toBe(a.w)
    expect(b.h).toBe(a.h)
    expect(Array.from(b.grid)).toEqual(Array.from(a.grid))
    expect(JSON.parse(JSON.stringify(b.rooms))).toEqual(
      JSON.parse(JSON.stringify(a.rooms)),
    )
    expect(JSON.parse(JSON.stringify(b.commonRoom))).toEqual(
      JSON.parse(JSON.stringify(a.commonRoom)),
    )
    expect(JSON.parse(JSON.stringify(b.bossRoom))).toEqual(
      JSON.parse(JSON.stringify(a.bossRoom)),
    )
    expect(JSON.parse(JSON.stringify(b.corridorDecor))).toEqual(
      JSON.parse(JSON.stringify(a.corridorDecor)),
    )
    expect(b.spawn).toEqual(a.spawn)
  })

  it("projetos diferentes ⇒ decoração diferente (seed é o projectId)", () => {
    const a = buildFloorPlan([
      { id: "apollo", name: "Apollo" },
      { id: "borealis", name: "Borealis" },
      { id: "cygnus", name: "Cygnus" },
    ])
    const b = buildFloorPlan([
      { id: "dynamo", name: "Dynamo" },
      { id: "eclipse", name: "Eclipse" },
      { id: "fusion", name: "Fusion" },
    ])
    // mesma geometria (mesmo número de salas), decor distinto em alguma sala
    const decorA = JSON.stringify(a.rooms.map((r) => r.decor))
    const decorB = JSON.stringify(b.rooms.map((r) => r.decor))
    expect(decorB).not.toEqual(decorA)
  })
})

describe("buildFloorPlan — dimensões", () => {
  it("com 1 projeto a ala de salas encolhe; a sala comum fica no fim", () => {
    const plan = buildFloorPlan(projetos(1))
    // uma coluna, sem fileira de baixo
    expect(plan.rooms).toHaveLength(1)
    expect(plan.rooms[0].row).toBe(0)
    expect(plan.w).toBe(diretoriaEndX(1) + COMMONS_W + 1)
    // altura dominada pela sala comum (9 tiles centrados no corredor)
    const commonsTop = CORRIDOR_TOP - Math.floor((COMMONS_H - CORRIDOR_H) / 2)
    expect(plan.h).toBe(commonsTop + COMMONS_H + 1)
    // O corredor conecta projetos → diretoria → porta da sala comum.
    const midY = CORRIDOR_TOP + 1
    expect(tile(plan, 1, midY) & T_WALK).toBeTruthy()
    expect(tile(plan, diretoriaEndX(1) - 1, midY) & T_DOOR).toBeTruthy()
  })

  it("2+ projetos ganham a fileira de baixo (corredor no meio)", () => {
    const plan = buildFloorPlan(projetos(2))
    expect(plan.rooms.map((r) => r.row)).toEqual([0, 1])
    expect(plan.h).toBe(1 + ROOM_H + 1 + CORRIDOR_H + 1 + ROOM_H + 1)
  })

  it("8 projetos cabem: 4 colunas × 2 fileiras + sala comum, tudo na grid", () => {
    const plan = buildFloorPlan(projetos(8))
    expect(plan.rooms).toHaveLength(8)
    expect(plan.w).toBe(diretoriaEndX(8) + COMMONS_W + 1)
    // alternância de fileiras: 0,1,0,1…
    expect(plan.rooms.map((r) => r.row)).toEqual([0, 1, 0, 1, 0, 1, 0, 1])
    for (const room of plan.rooms) {
      expect(room.origin.x).toBeGreaterThanOrEqual(1)
      expect(room.origin.y).toBeGreaterThanOrEqual(1)
      expect(room.origin.x + room.w).toBeLessThanOrEqual(plan.w - 1)
      expect(room.origin.y + room.h).toBeLessThanOrEqual(plan.h - 1)
      expect(room.desks.map((d) => d.agent)).toEqual(OFFICE_AGENTS)
    }
    // ids de mesa únicos no prédio inteiro
    const ids = plan.rooms.flatMap((r) => r.desks.map((d) => d.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("acima do alvo (9+) só os 8 primeiros entram na planta", () => {
    const plan = buildFloorPlan(projetos(11))
    expect(plan.rooms).toHaveLength(MAX_ROOMS)
  })

  it("zero projetos ⇒ planta mínima com chão pro boss (CTA fica na cena)", () => {
    const plan = buildFloorPlan([])
    expect(plan.rooms).toHaveLength(0)
    expect(plan.commonRoom).toBeUndefined()
    expect(plan.corridorDecor).toEqual([])
    const s = tile(plan, Math.floor(plan.spawn.x), Math.floor(plan.spawn.y))
    expect(s & T_WALK).toBeTruthy()
  })
})

describe("buildFloorPlan — portas", () => {
  it("toda porta tem 2 tiles caminháveis marcados T_DOOR, colados no corredor", () => {
    const plan = buildFloorPlan(projetos(5))
    for (const room of plan.rooms) {
      expect(room.doorTiles).toHaveLength(2)
      for (const d of room.doorTiles) {
        const f = tile(plan, d.x, d.y)
        expect(f & T_WALK).toBeTruthy()
        expect(f & T_DOOR).toBeTruthy()
        // o tile do outro lado da porta (lado do corredor) é caminhável
        const corridorSide = room.row === 0 ? d.y + 1 : d.y - 1
        expect(tile(plan, d.x, corridorSide) & T_WALK).toBeTruthy()
        // e o tile de ENTRADA da sala também — nenhuma mesa/decoração pode
        // bloquear a porta
        const roomSide = room.row === 0 ? d.y - 1 : d.y + 1
        expect(tile(plan, d.x, roomSide) & T_WALK).toBeTruthy()
      }
    }
  })
})

describe("buildFloorPlan — mesas e interação", () => {
  it("estações recuam duas linhas da parede e atendem pela frente", () => {
    const plan = buildFloorPlan(projetos(4))
    for (const room of plan.rooms) {
      for (const desk of room.desks) {
        // ry=0 é faixa técnica, ry=1 contém cadeira/agent e ry=2 contém mesa.
        expect(desk.tile.y).toBe(room.origin.y + 2)
        // tile de interação SEMPRE ao sul, dentro da sala
        expect(desk.interactTile.y).toBe(desk.tile.y + 1)
      }
    }
  })

  it("interactTiles são caminháveis, marcados T_INTERACT e adjacentes à mesa", () => {
    const plan = buildFloorPlan(projetos(4))
    for (const room of plan.rooms) {
      for (const desk of room.desks) {
        const f = tile(plan, desk.interactTile.x, desk.interactTile.y)
        expect(f & T_WALK).toBeTruthy()
        expect(f & T_INTERACT).toBeTruthy()
        // adjacência (vizinhança-8) ao canto da mesa
        const dx = Math.abs(desk.interactTile.x - desk.tile.x)
        const dy = Math.abs(desk.interactTile.y - desk.tile.y)
        expect(Math.max(dx, dy)).toBe(1)
        // e dentro do interior da sala
        expect(desk.interactTile.x).toBeGreaterThanOrEqual(room.origin.x)
        expect(desk.interactTile.x).toBeLessThan(room.origin.x + room.w)
      }
    }
  })

  it("mesas NÃO são caminháveis (footprint 2×1 bloqueado)", () => {
    const plan = buildFloorPlan(projetos(4))
    for (const room of plan.rooms) {
      for (const desk of room.desks) {
        expect(tile(plan, desk.tile.x, desk.tile.y) & T_WALK).toBeFalsy()
        expect(tile(plan, desk.tile.x + 1, desk.tile.y) & T_WALK).toBeFalsy()
      }
    }
  })

  it("reserva o footprint das cadeiras e dos agents atrás das mesas", () => {
    const plan = buildFloorPlan(projetos(4))
    for (const room of plan.rooms) {
      for (const desk of room.desks) {
        expect(tile(plan, desk.tile.x, desk.tile.y - 1) & T_WALK).toBeFalsy()
        expect(tile(plan, desk.tile.x + 1, desk.tile.y - 1) & T_WALK).toBeFalsy()
      }
    }
  })

  it("mantém uma faixa frontal contínua para o boss cruzar a sala", () => {
    const plan = buildFloorPlan(projetos(8))
    for (const room of plan.rooms) {
      const aisleY = room.origin.y + 4
      for (let x = room.origin.x; x < room.origin.x + room.w; x++) {
        expect(tile(plan, x, aisleY) & T_WALK).toBeTruthy()
      }
    }
  })

  it("estações mantêm ao menos um tile de respiro entre footprints", () => {
    const plan = buildFloorPlan(projetos(4))
    for (const room of plan.rooms) {
      const sorted = room.desks.map((d) => d.tile.x).sort((a, b) => a - b)
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i] - (sorted[i - 1] + 2)).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it("flip varia entre mesas (nada de fileira em uníssono)", () => {
    const plan = buildFloorPlan(projetos(2))
    for (const room of plan.rooms) {
      const flips = new Set(room.desks.map((d) => d.flip))
      expect(flips.size).toBeGreaterThan(1)
    }
  })
})

describe("buildFloorPlan — spawn", () => {
  it("spawn cai caminhável dentro da sala do boss", () => {
    const plan = buildFloorPlan(projetos(3))
    const sx = Math.floor(plan.spawn.x)
    const sy = Math.floor(plan.spawn.y)
    expect(tile(plan, sx, sy) & T_WALK).toBeTruthy()
    const boss = plan.bossRoom!
    expect(plan.spawn.x).toBeGreaterThan(boss.origin.x)
    expect(plan.spawn.x).toBeLessThan(boss.origin.x + boss.w)
    expect(plan.spawn.y).toBeGreaterThan(boss.origin.y)
    expect(plan.spawn.y).toBeLessThan(boss.origin.y + boss.h)
  })
})

describe("buildFloorPlan — diretoria", () => {
  it("é fixa, alcançável e mantém mesa/móveis fora da circulação central", () => {
    const plan = buildFloorPlan(projetos(3))
    const boss = plan.bossRoom!
    expect(boss.id).toBe("boss")
    expect(boss.origin.x).toBe(alaW(3))
    expect(boss.w).toBe(BOSS_ROOM_W)
    expect(boss.h).toBe(BOSS_ROOM_H)
    expect(boss.doorTiles).toHaveLength(2)
    expect(boss.deskFootprint).toEqual({ w: 4, h: 2 })
    for (let fy = 0; fy < boss.deskFootprint.h; fy++) {
      for (let fx = 0; fx < boss.deskFootprint.w; fx++) {
        expect(tile(plan, boss.deskTile.x + fx, boss.deskTile.y + fy)).toBe(0)
      }
    }
    const visitors = boss.decor.filter((item) => item.kind === "executive-visitor-chair")
    expect(visitors).toHaveLength(2)
    expect(visitors[1].tile.x - visitors[0].tile.x).toBeGreaterThanOrEqual(3)
    expect(boss.decor.some((item) => item.kind === "executive-chair")).toBe(true)
    const operatorChair = boss.decor.find((item) => item.kind === "executive-chair")!
    expect(operatorChair.offset).toEqual({ x: -0.5, y: 0 })
    expect(boss.decor.some((item) => item.kind === "executive-sideboard")).toBe(true)
    for (const item of boss.decor.filter((entry) => isBlockingDecor(entry.kind))) {
      const fp = DECOR_FOOTPRINTS[item.kind] ?? { w: 1, h: 1 }
      for (let fy = 0; fy < fp.h; fy++) {
        for (let fx = 0; fx < fp.w; fx++) {
          expect(tile(plan, item.tile.x + fx, item.tile.y + fy)).toBe(0)
        }
      }
    }
    expect(tile(plan, boss.interactTile.x, boss.interactTile.y) & T_INTERACT).toBeTruthy()
    expect(findPath(plan, plan.spawn, boss.interactTile)).not.toBeNull()
    for (const door of boss.doorTiles) {
      expect(tile(plan, door.x, door.y) & T_DOOR).toBeTruthy()
      expect(findPath(plan, plan.spawn, { x: door.x + 0.5, y: door.y + 0.5 })).not.toBeNull()
      expect(findPath(plan, { x: door.x + 0.5, y: door.y + 0.5 }, boss.interactTile)).not.toBeNull()
    }
  })

  it("centraliza o spawn visualmente entre as cadeiras de visita", () => {
    const plan = buildFloorPlan(projetos(3))
    const visitors = plan.bossRoom!.decor.filter(
      (item) => item.kind === "executive-visitor-chair",
    )
    const screenX = (x: number, y: number) => x - y
    const chairXs = visitors.map((item) => screenX(item.tile.x + 0.5, item.tile.y + 0.5))
    const midpoint = (chairXs[0] + chairXs[1]) / 2
    expect(screenX(plan.spawn.x, plan.spawn.y)).toBeCloseTo(midpoint)
  })
})

describe("buildFloorPlan — decoração procedural das salas", () => {
  const rugKinds = new Set(["rug", "rug-large"])
  const plantKinds = new Set<string>(PLANT_KINDS)
  const wallKinds = new Set<string>(WALL_PROP_KINDS)
  const floorKinds = new Set<string>(FLOOR_PROP_KINDS)

  it("toda sala tem 1 tapete, 1–2 props de parede, 1–2 plantas, 0–1 de apoio", () => {
    const plan = buildFloorPlan(projetos(8))
    for (const room of plan.rooms) {
      const decor = decorDe(room)
      const rugs = decor.filter((d) => rugKinds.has(d.kind))
      const walls = decor.filter((d) => wallKinds.has(d.kind))
      const plants = decor.filter((d) => plantKinds.has(d.kind))
      const floors = decor.filter((d) => floorKinds.has(d.kind))
      expect(rugs).toHaveLength(1)
      expect(walls.length).toBeGreaterThanOrEqual(1)
      expect(walls.length).toBeLessThanOrEqual(2)
      expect(plants.length).toBeGreaterThanOrEqual(1)
      expect(plants.length).toBeLessThanOrEqual(2)
      expect(floors.length).toBeLessThanOrEqual(1)
      expect(rugs.length + walls.length + plants.length + floors.length).toBe(
        decor.length,
      )
    }
  })

  it("quando há 2 plantas, elas ocupam nichos semânticos espaçados e usam espécies distintas", () => {
    const plan = buildFloorPlan(projetos(8))
    for (const room of plan.rooms) {
      const plants = decorDe(room).filter((d) => plantKinds.has(d.kind))
      const allowed = new Set([`0,${room.h - 2}`, `${room.w - 2},${room.h - 2}`])
      for (const plant of plants) {
        const rx = plant.tile.x - room.origin.x
        const ry = plant.tile.y - room.origin.y
        expect(allowed.has(`${rx},${ry}`)).toBe(true)
      }
      if (plants.length === 2) {
        expect(new Set(plants.map((d) => d.kind)).size).toBe(2)
        const distance =
          Math.abs(plants[0].tile.x - plants[1].tile.x) +
          Math.abs(plants[0].tile.y - plants[1].tile.y)
        expect(distance).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it("props de parede ficam NA parede norte, fora de mesas e portas", () => {
    const plan = buildFloorPlan(projetos(8))
    for (const room of plan.rooms) {
      const deskXs = new Set(
        room.desks.flatMap((d) => [d.tile.x, d.tile.x + 1]),
      )
      for (const d of decorDe(room).filter((i) => wallKinds.has(i.kind))) {
        expect(d.tile.y).toBe(room.origin.y - 1)
        expect(deskXs.has(d.tile.x)).toBe(false)
        expect(tile(plan, d.tile.x, d.tile.y) & T_DOOR).toBeFalsy()
      }
    }
  })

  it("tapete não bloqueia (tiles do footprint continuam caminháveis)", () => {
    const plan = buildFloorPlan(projetos(8))
    for (const room of plan.rooms) {
      const rug = decorDe(room).find((d) => rugKinds.has(d.kind))!
      const fp = DECOR_FOOTPRINTS[rug.kind]
      for (let dy = 0; dy < fp.h; dy++) {
        for (let dx = 0; dx < fp.w; dx++) {
          expect(tile(plan, rug.tile.x + dx, rug.tile.y + dy) & T_WALK).toBeTruthy()
        }
      }
    }
  })

  it("props de chão bloqueiam a grid e NUNCA caem em porta/interação/mesa", () => {
    const plan = buildFloorPlan(projetos(8))
    for (const room of plan.rooms) {
      const deskTiles = new Set(
        room.desks.flatMap((d) => [
          `${d.tile.x},${d.tile.y}`,
          `${d.tile.x + 1},${d.tile.y}`,
        ]),
      )
      const doorTiles = new Set(room.doorTiles.map((d) => `${d.x},${d.y}`))
      const interactTiles = new Set(
        room.desks.map((d) => `${d.interactTile.x},${d.interactTile.y}`),
      )
      for (const d of decorDe(room).filter((i) => isBlockingDecor(i.kind))) {
        const key = `${d.tile.x},${d.tile.y}`
        expect(deskTiles.has(key)).toBe(false)
        expect(doorTiles.has(key)).toBe(false)
        expect(interactTiles.has(key)).toBe(false)
        // footprint inteiro bloqueado e contido no interior da sala
        const fp = DECOR_FOOTPRINTS[d.kind] ?? { w: 1, h: 1 }
        for (let fy = 0; fy < fp.h; fy++) {
          for (let fx = 0; fx < fp.w; fx++) {
            expect(tile(plan, d.tile.x + fx, d.tile.y + fy)).toBe(0)
            expect(d.tile.x + fx).toBeGreaterThanOrEqual(room.origin.x)
            expect(d.tile.x + fx).toBeLessThan(room.origin.x + room.w)
            expect(d.tile.y + fy).toBeGreaterThanOrEqual(room.origin.y)
            expect(d.tile.y + fy).toBeLessThan(room.origin.y + room.h)
          }
        }
      }
    }
  })

  it("decoração nunca sela porta→interactTiles (A* real do engine)", () => {
    const plan = buildFloorPlan(projetos(8))
    for (const room of plan.rooms) {
      for (const door of room.doorTiles) {
        const from = { x: door.x + 0.5, y: door.y + 0.5 }
        for (const desk of room.desks) {
          const to = {
            x: desk.interactTile.x + 0.5,
            y: desk.interactTile.y + 0.5,
          }
          expect(findPath(plan, from, to)).not.toBeNull()
        }
      }
    }
  })

  it("do spawn dá pra chegar a TODAS as mesas (corredor decorado não sela)", () => {
    const plan = buildFloorPlan(projetos(8))
    for (const room of plan.rooms) {
      for (const desk of room.desks) {
        const to = {
          x: desk.interactTile.x + 0.5,
          y: desk.interactTile.y + 0.5,
        }
        expect(findPath(plan, plan.spawn, to)).not.toBeNull()
      }
    }
  })
})

describe("buildFloorPlan — sala comum", () => {
  it("existe no fim do corredor, 12×9, com porta de 2 tiles caminhável", () => {
    const plan = buildFloorPlan(projetos(3))
    const commons = plan.commonRoom!
    expect(commons).toBeDefined()
    expect(commons.id).toBe(COMMONS_ID)
    expect(commons.w).toBe(COMMONS_W)
    expect(commons.h).toBe(COMMONS_H)
    // a leste da ala de salas
    expect(commons.origin.x).toBe(diretoriaEndX(3))
    expect(commons.doorTiles).toHaveLength(2)
    for (const d of commons.doorTiles) {
      const f = tile(plan, d.x, d.y)
      expect(f & T_WALK).toBeTruthy()
      expect(f & T_DOOR).toBeTruthy()
      // corredor de um lado, interior da sala do outro
      expect(tile(plan, d.x - 1, d.y) & T_WALK).toBeTruthy()
      expect(tile(plan, d.x + 1, d.y) & T_WALK).toBeTruthy()
    }
  })

  it("mobília completa: mesão + cadeiras encaixadas + tv + lounge + cozinha", () => {
    const plan = buildFloorPlan(projetos(2))
    const kinds = plan.commonRoom!.decor.map((d) => d.kind)
    const count = (k: string) => kinds.filter((x) => x === k).length
    expect(count("meeting-table")).toBe(1)
    // norte de FRENTE (2) + sul/cabeceira de COSTAS (3); ponta oeste livre
    expect(count("meeting-chair")).toBe(2)
    expect(count("meeting-chair-back")).toBe(3)
    expect(count("tv")).toBe(1)
    expect(count("sofa")).toBe(1)
    expect(count("coffee-table")).toBe(1)
    expect(count("kitchen-counter")).toBe(1)
    expect(count("coffee-machine")).toBe(1)
    expect(count("water-cooler")).toBe(1)
    expect(kinds.some((k) => k.startsWith("plant-"))).toBe(true)
  })

  it("móveis bloqueiam o footprint; tv (parede) não; entrada livre", () => {
    const plan = buildFloorPlan(projetos(2))
    const commons = plan.commonRoom!
    for (const d of commons.decor) {
      const fp = DECOR_FOOTPRINTS[d.kind] ?? { w: 1, h: 1 }
      if (isBlockingDecor(d.kind)) {
        for (let dy = 0; dy < fp.h; dy++) {
          for (let dx = 0; dx < fp.w; dx++) {
            expect(tile(plan, d.tile.x + dx, d.tile.y + dy)).toBe(0)
          }
        }
      }
    }
    // tv na parede norte, fora do interior
    const tv = commons.decor.find((d) => d.kind === "tv")!
    expect(tv.tile.y).toBe(commons.origin.y - 1)
    // tiles de entrada (interior, colados na porta) caminháveis
    for (const d of commons.doorTiles) {
      expect(tile(plan, d.x + 1, d.y) & T_WALK).toBeTruthy()
    }
  })

  it("faixa ry=6 ao sul do mesão fica 100% caminhável (interação da fase 2)", () => {
    const plan = buildFloorPlan(projetos(3))
    const c = plan.commonRoom!
    for (let rx = 3; rx <= 8; rx++) {
      expect(tile(plan, c.origin.x + rx, c.origin.y + 6) & T_WALK).toBeTruthy()
    }
  })

  it("reserva a lateral oeste do mesão para o avatar não entrar no overhang", () => {
    const plan = buildFloorPlan(projetos(2))
    const c = plan.commonRoom!
    expect(tile(plan, c.origin.x + 3, c.origin.y + 3)).toBe(0)
    expect(tile(plan, c.origin.x + 3, c.origin.y + 4)).toBe(0)
  })

  it("lounge e copa mantêm respiro das paredes baixas/altas", () => {
    const plan = buildFloorPlan(projetos(2))
    const c = plan.commonRoom!
    const sofa = c.decor.find((d) => d.kind === "sofa")!
    const rug = c.decor.find((d) => d.kind === "rug-large")!
    const plant = c.decor.find((d) => d.kind.startsWith("plant-"))!
    const counter = c.decor.find((d) => d.kind === "kitchen-counter")!
    const coffee = c.decor.find((d) => d.kind === "coffee-machine")!
    const cooler = c.decor.find((d) => d.kind === "water-cooler")!
    const sofaFp = DECOR_FOOTPRINTS.sofa
    const rugFp = DECOR_FOOTPRINTS["rug-large"]
    expect(sofa.tile.x + sofaFp.w).toBeLessThan(c.origin.x + c.w)
    expect(rug.tile.x + rugFp.w).toBeLessThan(c.origin.x + c.w)
    expect(rug.tile.y + rugFp.h).toBeLessThan(c.origin.y + c.h)
    expect(plant.tile.x).toBeLessThan(c.origin.x + c.w - 1)
    expect(counter.tile.x).toBe(c.origin.x + 1)
    expect(counter.tile.y).toBe(c.origin.y)
    expect(DECOR_FOOTPRINTS["kitchen-counter"]).toEqual({ w: 2, h: 1 })
    expect(coffee.tile).toEqual(counter.tile)
    expect(cooler.tile.x).toBeGreaterThan(c.origin.x)
    expect(cooler.tile.y).toBe(c.origin.y)
  })

  it("o boss chega do spawn ao interior da sala comum (A*)", () => {
    for (const n of [1, 2, 5, 8]) {
      const plan = buildFloorPlan(projetos(n))
      const commons = plan.commonRoom!
      // alvo num tile garantidamente livre (colunas 1–2 da entrada)
      const to = {
        x: commons.origin.x + 2 + 0.5,
        y: commons.origin.y + 6 + 0.5,
      }
      expect(tile(plan, Math.floor(to.x), Math.floor(to.y)) & T_WALK).toBeTruthy()
      expect(findPath(plan, plan.spawn, to)).not.toBeNull()
    }
  })
})

describe("buildFloorPlan — corredor decorado", () => {
  it("o eixo só tem o quadro de avisos, pendurado na LINHA DE PAREDE", () => {
    const plan = buildFloorPlan(projetos(6))
    expect(plan.corridorDecor).toHaveLength(1)
    const board = plan.corridorDecor![0]
    expect(board.kind).toBe("notice-board")
    expect(board.tile.y).toBe(CORRIDOR_TOP - 1) // parede norte do corredor
    expect(isBlockingDecor(board.kind)).toBe(false) // parede — não bloqueia
  })

  it("não reserva nenhum tile caminhável para decoração", () => {
    const plan = buildFloorPlan(projetos(8))
    const floor = plan.corridorDecor!.filter((d) => isBlockingDecor(d.kind))
    expect(floor).toEqual([])
  })

  it("a fileira do MEIO do corredor fica 100% caminhável", () => {
    for (const n of [1, 3, 8]) {
      const plan = buildFloorPlan(projetos(n))
      const midY = CORRIDOR_TOP + 1
      for (let x = 1; x < alaW(n) - 1; x++) {
        expect(tile(plan, x, midY) & T_WALK).toBeTruthy()
      }
    }
  })

  it("decoração de chão nunca na frente de portas (salas e sala comum)", () => {
    const plan = buildFloorPlan(projetos(8))
    const frontTiles = new Set<string>()
    for (const room of plan.rooms) {
      for (const d of room.doorTiles) {
        const y = room.row === 0 ? d.y + 1 : d.y - 1
        frontTiles.add(`${d.x},${y}`)
      }
    }
    for (const d of plan.commonRoom!.doorTiles) {
      frontTiles.add(`${d.x - 1},${d.y}`)
    }
    for (const d of plan.corridorDecor!.filter((i) => isBlockingDecor(i.kind))) {
      expect(frontTiles.has(`${d.tile.x},${d.tile.y}`)).toBe(false)
      // e o tile está efetivamente bloqueado na grid
      expect(tile(plan, d.tile.x, d.tile.y)).toBe(0)
    }
  })
})

describe("buildFloorPlan — quadro de avisos (interactable do corredor)", () => {
  it("registra NOTICE_BOARD_ID com interactTile caminhável e T_INTERACT", () => {
    for (const n of [1, 3, 8]) {
      const plan = buildFloorPlan(projetos(n))
      const board = plan.interactables?.find((i) => i.id === NOTICE_BOARD_ID)
      expect(board).toBeDefined()
      const f = tile(plan, board!.interactTile.x, board!.interactTile.y)
      expect(f & T_WALK).toBeTruthy()
      expect(f & T_INTERACT).toBeTruthy()
      // interactTile é o tile do corredor logo abaixo do quadro na parede
      expect(board!.interactTile.y).toBe(CORRIDOR_TOP)
      const decorBoard = plan.corridorDecor!.find((d) => d.kind === "notice-board")!
      expect(board!.interactTile.x).toBe(decorBoard.tile.x)
      // âncora do balão/hit = CENTRO do tile de parede (interactableContainsWorld)
      expect(board!.tile).toEqual({
        x: decorBoard.tile.x + 0.5,
        y: decorBoard.tile.y + 0.5,
      })
    }
  })

  it("nunca colide com portas (diretoria/sala comum) e o boss ALCANÇA o quadro", () => {
    for (const n of [1, 3, 8]) {
      const plan = buildFloorPlan(projetos(n))
      const board = plan.interactables!.find((i) => i.id === NOTICE_BOARD_ID)!
      const decorBoard = plan.corridorDecor!.find((d) => d.kind === "notice-board")!
      const doorKeys = new Set(
        [...plan.bossRoom!.doorTiles, ...plan.commonRoom!.doorTiles].map(
          (d) => `${d.x},${d.y}`,
        ),
      )
      expect(doorKeys.has(`${decorBoard.tile.x},${decorBoard.tile.y}`)).toBe(false)
      // A* real do engine, do spawn até o tile de interação (mesma métrica do boss)
      const to = {
        x: board.interactTile.x + 0.5,
        y: board.interactTile.y + 0.5,
      }
      expect(findPath(plan, plan.spawn, to)).not.toBeNull()
    }
  })
})
