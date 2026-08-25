import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ fail: false }))

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => {
    if (h.fail) throw new Error("disco indisponível")
    return null
  }),
}))

import {
  writeActivePointer,
  writeRunState,
  type MissionRunState,
} from "./missionState"

function state(id: string): MissionRunState {
  return {
    version: 2,
    missionId: id,
    dir: `.mycockpit/missions/${id}`,
    convId: "conv-1",
    task: "testar checkpoint",
    preset: {
      id: "plan",
      revision: 1,
      name: "Plano",
      phases: [],
      maxCostUsd: null,
    },
    current: 0,
    phases: [],
    costTotal: 0,
    maxCostUsd: null,
    status: "running",
    updatedAt: 1,
  }
}

beforeEach(() => {
  h.fail = false
})

describe("persistência observável da missão", () => {
  it("confirma checkpoint e ponteiro gravados", async () => {
    await expect(writeRunState("/projeto-ok", state("ok"))).resolves.toBeNull()
    await expect(
      writeActivePointer("/projeto-ok", "conv-1", ".mycockpit/missions/ok"),
    ).resolves.toBeNull()
  })

  it("devolve diagnóstico quando a retomada perde sua garantia", async () => {
    h.fail = true
    await expect(writeRunState("/projeto-falha", state("falha"))).resolves.toMatch(
      /checkpoint/,
    )
    await expect(
      writeActivePointer(
        "/projeto-falha",
        "conv-1",
        ".mycockpit/missions/falha",
      ),
    ).resolves.toMatch(/ponteiro/)
  })
})
