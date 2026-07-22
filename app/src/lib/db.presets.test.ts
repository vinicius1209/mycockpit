// Sprint 3 (E2) — CRUD de agent_presets com o Database do plugin-sql MOCKADO
// por um mini-engine em memória (padrão db.cards.test.ts): cada statement que
// o db.ts emite tem um handler; SQL não mapeado LANÇA (drift do schema
// aparece no teste). O digest roda de verdade (crypto.subtle, node 20+).

import { beforeEach, describe, expect, it, vi } from "vitest"

interface FakePresetRow {
  id: string
  name: string
  personality_md: string | null
  skills_json: string | null
  policy: string | null
  backend: string
  model: string | null
  effort: string | null
  digest: string
  version: number
  created_at: number
  updated_at: number
}

const h = vi.hoisted(() => ({
  presets: [] as FakePresetRow[],
  convs: [] as { id: string; preset_id: string | null; preset_digest: string | null }[],
}))

vi.mock("@tauri-apps/plugin-sql", () => {
  const fakeDb = {
    execute: async (sql: string, params: unknown[] = []) => {
      if (sql.startsWith("CREATE TABLE") || sql.startsWith("CREATE INDEX")) {
        return { rowsAffected: 0 }
      }
      if (sql.startsWith("INSERT INTO agent_presets")) {
        const [
          id,
          name,
          personality_md,
          skills_json,
          policy,
          backend,
          model,
          effort,
          digest,
          version,
          created_at,
          updated_at,
        ] = params as [
          string,
          string,
          string | null,
          string | null,
          string | null,
          string,
          string | null,
          string | null,
          string,
          number,
          number,
          number,
        ]
        h.presets.push({
          id,
          name,
          personality_md,
          skills_json,
          policy,
          backend,
          model,
          effort,
          digest,
          version,
          created_at,
          updated_at,
        })
        return { rowsAffected: 1 }
      }
      if (sql.startsWith("UPDATE agent_presets SET")) {
        const [
          name,
          personality_md,
          skills_json,
          policy,
          backend,
          model,
          effort,
          digest,
          version,
          updated_at,
          id,
        ] = params as [
          string,
          string | null,
          string | null,
          string | null,
          string,
          string | null,
          string | null,
          string,
          number,
          number,
          string,
        ]
        const row = h.presets.find((p) => p.id === id)
        if (!row) return { rowsAffected: 0 }
        Object.assign(row, {
          name,
          personality_md,
          skills_json,
          policy,
          backend,
          model,
          effort,
          digest,
          version,
          updated_at,
        })
        return { rowsAffected: 1 }
      }
      if (sql.startsWith("DELETE FROM agent_presets")) {
        const [id] = params as [string]
        const i = h.presets.findIndex((p) => p.id === id)
        if (i >= 0) h.presets.splice(i, 1)
        return { rowsAffected: i >= 0 ? 1 : 0 }
      }
      if (sql.startsWith("UPDATE conversations SET preset_id")) {
        const [presetId, presetDigest, id] = params as [
          string | null,
          string | null,
          string,
        ]
        let row = h.convs.find((c) => c.id === id)
        if (!row) {
          row = { id, preset_id: null, preset_digest: null }
          h.convs.push(row)
        }
        row.preset_id = presetId
        row.preset_digest = presetDigest
        return { rowsAffected: 1 }
      }
      throw new Error(`SQL não mapeado no fake (execute): ${sql}`)
    },
    select: async (sql: string, params: unknown[] = []) => {
      if (sql.includes("FROM agent_presets WHERE id")) {
        const [id] = params as [string]
        return h.presets.filter((p) => p.id === id).map((p) => ({ ...p }))
      }
      if (sql.includes("FROM agent_presets ORDER BY")) {
        return [...h.presets]
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((p) => ({ ...p }))
      }
      throw new Error(`SQL não mapeado no fake (select): ${sql}`)
    },
  }
  return { default: { load: async () => fakeDb } }
})

// isTauri() exige window.__TAURI_INTERNALS__ (ambiente node não tem window).
;(globalThis as Record<string, unknown>).window = { __TAURI_INTERNALS__: {} }

import {
  createPreset,
  deletePreset,
  getPreset,
  listPresets,
  setConversationPreset,
  updatePreset,
  type AgentPresetInput,
} from "@/lib/db"
import { presetDigest } from "@/lib/presets"

function input(patch: Partial<AgentPresetInput> = {}): AgentPresetInput {
  return {
    name: "UI Engineer",
    personalityMd: "# UI\nCuida da interface.",
    skills: ["revisar-pr", "testes"],
    policy: "nunca commita",
    backend: "codex",
    model: "gpt-x",
    effort: "high",
    ...patch,
  }
}

beforeEach(() => {
  h.presets.length = 0
  h.convs.length = 0
})

describe("agent_presets (S3.1): CRUD", () => {
  it("createPreset grava version 1 com o digest computado dos campos", async () => {
    const p = await createPreset(input())
    expect(p).not.toBeNull()
    expect(p!.version).toBe(1)
    expect(p!.digest).toBe(await presetDigest(input()))
    expect(p!.digest).toMatch(/^[0-9a-f]{64}$/)
    // a linha persistida bate com o retorno (skills serializadas)
    expect(h.presets).toHaveLength(1)
    expect(h.presets[0].skills_json).toBe(
      JSON.stringify(["revisar-pr", "testes"]),
    )
  })

  it("getPreset devolve a linha (skills desserializadas); inexistente é null", async () => {
    const created = await createPreset(input())
    const got = await getPreset(created!.id)
    expect(got).toEqual(created)
    expect(await getPreset("nao-existe")).toBeNull()
  })

  it("listPresets ordena por nome", async () => {
    await createPreset(input({ name: "Zeta" }))
    await createPreset(input({ name: "Alfa" }))
    const names = (await listPresets()).map((p) => p.name)
    expect(names).toEqual(["Alfa", "Zeta"])
  })

  it("updatePreset bumpa a version e RECOMPUTA o digest dos campos novos", async () => {
    const created = await createPreset(input())
    const updated = await updatePreset(created!.id, {
      personalityMd: "# UI v2\nAgora com mais rigor.",
    })
    expect(updated!.version).toBe(2)
    expect(updated!.digest).not.toBe(created!.digest)
    expect(updated!.digest).toBe(
      await presetDigest({
        ...input(),
        personalityMd: "# UI v2\nAgora com mais rigor.",
      }),
    )
    // a linha no banco reflete a nova versão (conversas antigas guardam o
    // digest velho no carimbo delas — é o drift desejado do S3.4)
    expect(h.presets[0].version).toBe(2)
    expect(h.presets[0].digest).toBe(updated!.digest)
  })

  it("updatePreset de id inexistente devolve null (nada gravado)", async () => {
    expect(await updatePreset("fantasma", { name: "X" })).toBeNull()
    expect(h.presets).toHaveLength(0)
  })

  it("deletePreset remove a linha; getPreset passa a devolver null", async () => {
    const created = await createPreset(input())
    await deletePreset(created!.id)
    expect(h.presets).toHaveLength(0)
    expect(await getPreset(created!.id)).toBeNull()
  })
})

describe("carimbo da conversa (S3.2): setConversationPreset", () => {
  it("grava preset_id + preset_digest na conversa (e limpa com nulls)", async () => {
    await setConversationPreset("c1", "pr1", "digest-abc")
    expect(h.convs).toEqual([
      { id: "c1", preset_id: "pr1", preset_digest: "digest-abc" },
    ])
    await setConversationPreset("c1", null, null)
    expect(h.convs).toEqual([{ id: "c1", preset_id: null, preset_digest: null }])
  })
})
