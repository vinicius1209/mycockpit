// Teste-GÊMEO do eixo de confinamento próprio.
//
// Par no Rust: `contrato_capabilities_x_comportamento_por_agent` (adapters.rs),
// que cobra a outra metade — motor que DECLARA confinar sozinho tem que passar
// flag de sandbox no comando. Aqui a cobrança é que o espelho não divirja e que
// a consequência (envelope entra ou não) seja derivada da capability, nunca do
// nome do motor.
//
// # O incidente que este arquivo guarda (04–09/09/2026)
//
// O Codex aplica Seatbelt por dentro, `(deny default)` a cada comando de shell.
// A Frota envelopava o processo por fora sempre que o modo prometia escrita
// zero. macOS recusa aplicar perfil restritivo dentro de perfil já aplicado, e
// quem morre é o de DENTRO — o que executa. Medido:
//
//   sandbox-exec -f allow-default.sb sandbox-exec -f deny-default.sb sh -c 'echo ok'
//   → sandbox-exec: sandbox_apply: Operation not permitted   (exit 71)
//
// Consequência real: "Pendencias na Prime" rodou às 07:00 de 04/09, 06/09 e
// 09/09 com `pwd` e `cat` devolvendo exit 71. As três foram gravadas como `ok`,
// somaram US$ 1,16 e não entregaram nada.

import { describe, expect, it } from "vitest"
import { AGENTS, agentDef } from "@/lib/agents"
import { dispensaEnvelopeDaFrota } from "@/lib/confinamento"

describe("sandboxProprio no espelho TS", () => {
  it("todo agent registrado declara um valor do eixo", () => {
    // Campo novo sem valor em algum motor sairia como `undefined` e o
    // `dispensaEnvelope` responderia `false` por acidente — fail-closed por
    // acaso não é fail-closed por decisão.
    for (const a of AGENTS) {
      expect(
        ["nenhum", "melhorEsforco", "sistemaOperacional"],
        `${a.id} sem valor no eixo`,
      ).toContain(a.sandboxProprio)
    }
  })

  it("o Codex declara garantia MEDIDA, e é ele que dispensa o envelope", () => {
    // Se esta linha voltar pra "nenhum", o envelope volta, os dois perfis
    // Seatbelt se aninham e o Codex fica cego de novo em Só lê e em Planejar.
    expect(agentDef("codex")?.sandboxProprio).toBe("sistemaOperacional")
    expect(dispensaEnvelopeDaFrota("codex")).toBe(true)
  })

  it("o agy NÃO dispensa: ele emudece em vez de falhar", () => {
    // Fase 0 do sandbox-plan: barrado, o agy sai com exit 0, stdout vazio e
    // stderr sem assinatura. Tratar isso como garantia entregaria um "Só lê"
    // que silenciosamente não faz nada, que é a degradação invisível que o
    // módulo existe pra impedir. Ele é quem mais precisa do envelope.
    expect(agentDef("agy")?.sandboxProprio).toBe("melhorEsforco")
    expect(dispensaEnvelopeDaFrota("agy")).toBe(false)
  })

  it("quem não tem sandbox de SO mantém o envelope", () => {
    for (const id of ["claude-code", "opencode"]) {
      expect(agentDef(id)?.sandboxProprio, id).toBe("nenhum")
      expect(dispensaEnvelopeDaFrota(id), id).toBe(false)
    }
  })

  it("motor desconhecido NÃO dispensa o envelope", () => {
    // Fail-closed do §9: dispensar por engano deixa o turno sem confinamento
    // nenhum, que é pior que um envelope a mais.
    expect(dispensaEnvelopeDaFrota("motor-que-nao-existe")).toBe(false)
    expect(dispensaEnvelopeDaFrota(null)).toBe(false)
  })
})
