// Matriz do canal de inventário por agent: espelho TS da capability
// `command_inventory` do Rust (ADR-189). O teste-gêmeo no Rust
// (`matriz_native_slash_e_fontes_por_agent`) afirma a MESMA matriz:
// "run-init" ↔ CommandInventory::ClaudeRunInit, "side-query" ↔
// CommandInventory::CodexSkillsList, "none" ↔ None. Mexeu aqui, mexa lá.
//
// Divergir estraga o rodapé do "/": só Rust ⇒ o popover diria "lido das pastas"
// para um inventário que veio do motor; só TS ⇒ prometeria inventário que o
// backend nunca compõe.

import { describe, expect, it } from "vitest"
import { DESTINATIONS } from "./agents"
import { commandInventoryChannel, inventoryFootnote } from "./agentCommands"

const MATRIZ: Record<string, string> = {
  "claude-code": "run-init",
  codex: "side-query",
  agy: "none",
}

describe("canal de inventário de comandos por agent", () => {
  for (const [id, canal] of Object.entries(MATRIZ)) {
    it(`${id}: ${canal}`, () => {
      expect(commandInventoryChannel(id)).toBe(canal)
    })
  }

  it("todo destino registrado declara canal, e motor desconhecido não ganha um", () => {
    for (const d of DESTINATIONS) {
      expect(["run-init", "side-query", "none"]).toContain(commandInventoryChannel(d.id))
    }
    expect(commandInventoryChannel("motor-novo")).toBe("none")
  })
})

describe("rodapé do popover diz de onde veio o inventário", () => {
  const now = new Date(2026, 8, 14, 17, 30).getTime()
  const base = { agentLabel: "Claude Code", now }

  it("inventário anunciado pelo motor mostra o horário", () => {
    const at = new Date(2026, 8, 14, 17, 2).getTime()
    expect(
      inventoryFootnote({ ...base, channel: "run-init", origin: "motor", observedAt: at }),
    ).toBe("Inventário anunciado pelo Claude Code no último turno deste projeto, às 17:02.")
  })

  it("evidência de outro dia leva a data", () => {
    const at = new Date(2026, 8, 12, 9, 5).getTime()
    expect(
      inventoryFootnote({
        agentLabel: "Codex",
        now,
        channel: "side-query",
        origin: "motor",
        observedAt: at,
      }),
    ).toBe("Skills consultadas ao Codex em 12/09 às 09:05.")
  })

  it("sem evidência não finge que veio do motor", () => {
    expect(
      inventoryFootnote({ ...base, channel: "run-init", origin: "disco", observedAt: null }),
    ).toMatch(/^Lido das pastas\./)
    expect(
      inventoryFootnote({ agentLabel: "agy", now, channel: "none", origin: "disco", observedAt: null }),
    ).toBe("O agy não publica inventário de comandos. Aparecem os da Frota e do projeto.")
  })

  it("copy sem travessão", () => {
    for (const channel of ["run-init", "side-query", "none"] as const) {
      for (const origin of ["motor", "disco"] as const) {
        expect(inventoryFootnote({ ...base, channel, origin, observedAt: now })).not.toContain("—")
      }
    }
  })
})
