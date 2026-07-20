// Testes da planta (bridge/layout.ts): determinismo (inclusive da decoração
// procedural), encolhimento com 1 projeto, capacidade de 8, portas/interação
// caminháveis, mesas bloqueadas, props de chão que nunca selam caminho
// (verificado com o A* real do engine), sala comum e corredor decorado.

import { describe, expect, it } from "vitest"
import { findPath } from "@/office/engine/astar"
import {
  OFFICE_AGENTS,
  T_DOOR,
  T_INTERACT,
  T_WALK,
  type FloorPlan,
  type RoomDecorItem,
  type RoomPlacement,
} from "@/office/engine/types"
import {
  buildFloorPlan,
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
    expect(plan.w).toBe(alaW(1) + COMMONS_W + 1) // ala + sala comum + parede
    // altura dominada pela sala comum (9 tiles centrados no corredor)
    const commonsTop = CORRIDOR_TOP - Math.floor((COMMONS_H - CORRIDOR_H) / 2)
    expect(plan.h).toBe(commonsTop + COMMONS_H + 1)
    // a largura caminhável do corredor (fileira do MEIO — decoração pode
    // ocupar as fileiras encostadas nas paredes) É a largura da sala; o tile
    // extra em x = alaW-1 é a PORTA da sala comum, fora da conta
    const midY = CORRIDOR_TOP + 1
    const walkable = []
    for (let x = 0; x < alaW(1) - 1; x++) {
      if (tile(plan, x, midY) & T_WALK) walkable.push(x)
    }
    expect(walkable).toHaveLength(ROOM_W)
    expect(tile(plan, alaW(1) - 1, midY) & T_DOOR).toBeTruthy()
  })

  it("2+ projetos ganham a fileira de baixo (corredor no meio)", () => {
    const plan = buildFloorPlan(projetos(2))
    expect(plan.rooms.map((r) => r.row)).toEqual([0, 1])
    expect(plan.h).toBe(1 + ROOM_H + 1 + CORRIDOR_H + 1 + ROOM_H + 1)
  })

  it("8 projetos cabem: 4 colunas × 2 fileiras + sala comum, tudo na grid", () => {
    const plan = buildFloorPlan(projetos(8))
    expect(plan.rooms).toHaveLength(8)
    expect(plan.w).toBe(alaW(8) + COMMONS_W + 1)
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
  it("mesas encostadas na parede NORTE nas DUAS fileiras, interação ao sul", () => {
    const plan = buildFloorPlan(projetos(4))
    for (const room of plan.rooms) {
      for (const desk of room.desks) {
        // parede norte = primeira linha do interior (fundo alto do isométrico)
        expect(desk.tile.y).toBe(room.origin.y)
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

  it("flip varia entre mesas (nada de fileira em uníssono)", () => {
    const plan = buildFloorPlan(projetos(2))
    for (const room of plan.rooms) {
      const flips = new Set(room.desks.map((d) => d.flip))
      expect(flips.size).toBeGreaterThan(1)
    }
  })
})

describe("buildFloorPlan — spawn", () => {
  it("spawn cai no corredor, caminhável, em frente à porta da primeira sala", () => {
    const plan = buildFloorPlan(projetos(3))
    const sx = Math.floor(plan.spawn.x)
    const sy = Math.floor(plan.spawn.y)
    expect(tile(plan, sx, sy) & T_WALK).toBeTruthy()
    // linha imediatamente abaixo da porta da sala 0 (row 0)
    const first = plan.rooms[0]
    expect(sy).toBe(first.doorTiles[0].y + 1)
    const doorXs = first.doorTiles.map((d) => d.x)
    expect(plan.spawn.x).toBeGreaterThanOrEqual(Math.min(...doorXs))
    expect(plan.spawn.x).toBeLessThanOrEqual(Math.max(...doorXs) + 1)
  })
})

describe("buildFloorPlan — decoração procedural das salas", () => {
  const rugKinds = new Set(["rug", "rug-large"])
  const plantKinds = new Set<string>(PLANT_KINDS)
  const wallKinds = new Set<string>(WALL_PROP_KINDS)
  const floorKinds = new Set<string>(FLOOR_PROP_KINDS)

  it("toda sala tem 1 tapete, 1–2 props de parede, 2–4 plantas, 0–2 de chão", () => {
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
      expect(plants.length).toBeGreaterThanOrEqual(2)
      expect(plants.length).toBeLessThanOrEqual(4)
      expect(floors.length).toBeLessThanOrEqual(2)
      expect(rugs.length + walls.length + plants.length + floors.length).toBe(
        decor.length,
      )
    }
  })

  it("com 2 plantas ou mais, sempre há pelo menos 2 espécies", () => {
    const plan = buildFloorPlan(projetos(8))
    for (const room of plan.rooms) {
      const species = new Set(
        decorDe(room)
          .filter((d) => plantKinds.has(d.kind))
          .map((d) => d.kind),
      )
      expect(species.size).toBeGreaterThanOrEqual(2)
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
        // tile efetivamente bloqueado na grid
        expect(tile(plan, d.tile.x, d.tile.y)).toBe(0)
        // e dentro do interior da sala
        expect(d.tile.x).toBeGreaterThanOrEqual(room.origin.x)
        expect(d.tile.x).toBeLessThan(room.origin.x + room.w)
        expect(d.tile.y).toBeGreaterThanOrEqual(room.origin.y)
        expect(d.tile.y).toBeLessThan(room.origin.y + room.h)
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
    expect(commons.origin.x).toBe(alaW(3))
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
  it("tem bebedouro, plantas e quadro de avisos (6 projetos)", () => {
    const plan = buildFloorPlan(projetos(6))
    const kinds = plan.corridorDecor!.map((d) => d.kind)
    expect(kinds).toContain("water-cooler")
    expect(kinds).toContain("notice-board")
    expect(kinds.some((k) => k.startsWith("plant-"))).toBe(true)
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

  it("quadro de avisos fica na parede norte do corredor, sem porta", () => {
    const plan = buildFloorPlan(projetos(4))
    const board = plan.corridorDecor!.find((d) => d.kind === "notice-board")!
    expect(board).toBeDefined()
    expect(board.tile.y).toBe(CORRIDOR_TOP - 1)
    expect(tile(plan, board.tile.x, board.tile.y) & T_DOOR).toBeFalsy()
  })
})
