// Matriz de canais/continuidade por agent — o espelho TS das capabilities
// `system_channel`/`session_resume`/`context_mcp` do Rust (adapters.rs).
//
// POR QUE ESTE TESTE EXISTE (mesma disciplina do agents.slash.test.ts e do
// agents.caps.test.ts): a capability mora em DOIS lugares. O Rust declara a
// verdade auditada por versão (§7.1 do agent-runner.md) e roteia o canal de
// verdade (route_system_prompt, --append-system-prompt); o espelho TS é o que
// ChatPanel/send/handoff consultam pra decidir ONDE vai a doutrina/persona
// (H1), quando montar memória sintética (H5, sessionResume) e que ponteiros o
// handoff promete (H5, contextMcp). Divergir estraga dos dois lados:
//   - só Rust ⇒ o front manda doutrina no corpo de um motor cujo canal system
//     a receberia (eco + inchaço que o H1 existiu pra matar);
//   - só TS  ⇒ pior: o front manda systemPrompt pra um motor sem canal e conta
//     com um re-envio por spawn que não existe (o Rust dobra no corpo, mas a
//     cadência vira a errada).
// O teste-gêmeo no Rust (`matriz_de_canais_por_agent`) afirma a MESMA matriz.
// Mexeu aqui, mexa lá.

import { describe, expect, it } from "vitest"
import { agentDef, DESTINATIONS } from "./agents"

/** A matriz, escrita UMA vez. O Rust repete estes valores. */
const MATRIZ: Record<
  string,
  { systemChannel: boolean; sessionResume: boolean; contextMcp: boolean }
> = {
  // claude 2.1.219: --append-system-prompt documentado (já era o canal dos
  // nudges de MCP) + resume nativo + mc-context.
  "claude-code": { systemChannel: true, sessionResume: true, contextMcp: true },
  // codex 0.146: `-c developer_instructions` existe (achado por strings, não
  // documentado) e funciona em sessão NOVA, mas no `exec resume` a instrução
  // original venceu a nova (empírico 03/08/2026) → sem canal são por spawn.
  codex: { systemChannel: false, sessionResume: true, contextMcp: true },
  // agy 1.1.13: sem canal system (o `--help` não expõe outro além do `-p`) e
  // sem MCP por-run (só config global). Resume SIM: `--conversation <ID>`
  // continuou a conversa (step_index 6→8 e o modelo lembrou o turno anterior,
  // medido 14/08/2026).
  agy: { systemChannel: false, sessionResume: true, contextMcp: false },
}

describe("canais e continuidade por agent (espelho das capabilities do Rust)", () => {
  for (const [id, esperado] of Object.entries(MATRIZ)) {
    it(`${id}: system=${esperado.systemChannel} resume=${esperado.sessionResume} mc-context=${esperado.contextMcp}`, () => {
      const def = agentDef(id)
      expect(def, `${id} precisa existir no registry`).toBeTruthy()
      expect(def?.systemChannel).toBe(esperado.systemChannel)
      expect(def?.sessionResume).toBe(esperado.sessionResume)
      expect(def?.contextMcp).toBe(esperado.contextMcp)
    })
  }

  it("todo destino do tipo agent está na matriz (agent novo não passa batido)", () => {
    const agents = DESTINATIONS.filter((d) => d.kind === "agent").map((d) => d.id)
    for (const id of agents) {
      if (!(id in MATRIZ)) {
        // agent novo sem decisão explícita: o default honesto é NEGAR os três
        // (na dúvida, false — guarda do capability-registry-plan): sem canal
        // fantasma, sem resume prometido, sem MCP que não alcança.
        expect(agentDef(id)?.systemChannel).toBe(false)
        expect(agentDef(id)?.sessionResume).toBe(false)
        expect(agentDef(id)?.contextMcp).toBe(false)
      }
    }
  })
})
