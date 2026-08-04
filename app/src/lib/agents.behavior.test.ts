// G1.2/G1.4 (capability-registry-plan) — contrato do ESPELHO TS: para cada
// agent do registry, a capability declarada tem que corresponder ao
// comportamento genérico da UI ("/" cru vs expansão app-side, copy do vazio).
// Loop sobre o registry, nunca um caso copiado por agent: motor novo entra na
// factory (lib/agents) e é cobrado aqui automaticamente — é o teste que impede
// o próximo vazamento de decisão por nome no front.

import { describe, expect, it } from "vitest"
import { AGENTS } from "./agents"
import { expandSlashCommand, slashEmptyHint } from "./slashCommands"
import type { SlashCommand } from "@/lib/sources"

/** Só os motores de verdade (kind "agent"); "model" não conversa com "/". */
const ENGINES = AGENTS.filter((a) => a.kind === "agent")

function cmdOf(source: string): SlashCommand {
  return {
    name: "deploy",
    description: null,
    kind: "command",
    origin: "project",
    source,
    body: "Faça o deploy de $ARGUMENTS.",
  }
}

describe("contrato nativeSlash ↔ expansão do /comando (loop no registry)", () => {
  for (const def of ENGINES) {
    it(`${def.id}: comando da fonte nativa ${
      def.nativeSlash ? "passa CRU (o CLI interpreta)" : "expande app-side"
    }`, () => {
      // sem fonte nativa declarada, o caso vira o da casa (expande sempre)
      const source = def.nativeCommandSource ?? "mycockpit"
      const out = expandSlashCommand("/deploy prod", [cmdOf(source)], def.id)
      if (def.nativeSlash) {
        expect(out).toBe("/deploy prod")
      } else {
        expect(out).toBe("Faça o deploy de prod.")
      }
    })

    it(`${def.id}: comando da CASA expande sempre (a casa é do app, não do CLI)`, () => {
      expect(
        expandSlashCommand("/deploy prod", [cmdOf("mycockpit")], def.id),
      ).toBe("Faça o deploy de prod.")
    })
  }

  it("nativeSlash exige fonte nativa declarada (espelho coerente)", () => {
    for (const def of ENGINES) {
      if (def.nativeSlash) {
        expect(def.nativeCommandSource, def.id).not.toBeNull()
      }
    }
  })

  it("agent fora do registry nunca passa comando cru (fail-closed)", () => {
    expect(
      expandSlashCommand("/deploy prod", [cmdOf("claude")], "motor-inexistente"),
    ).toBe("Faça o deploy de prod.")
  })
})

describe("contrato slashEmptyExtra ↔ copy do vazio do /", () => {
  for (const def of ENGINES) {
    it(`${def.id}: a casa sempre; convenção nativa só quando declarada`, () => {
      const hint = slashEmptyHint(def.id)
      expect(hint).toContain(".mycockpit/commands")
      expect(hint).not.toContain("—") // regra da casa: sem travessão
      if (def.slashEmptyExtra) {
        expect(hint).toContain(def.slashEmptyExtra)
      } else {
        // sem convenção própria: não ensina a pasta de OUTRO fornecedor
        expect(hint).not.toContain(".claude")
        expect(hint).not.toContain(".codex")
      }
    })
  }
})
