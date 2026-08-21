// A curadoria dos modos (M1) e o cruzamento com a sonda.
//
// O que estes testes protegem é uma decisão de SEGURANÇA: id descoberto sem
// curadoria não pode virar opção. A tentação natural — "o motor anuncia, então
// oferece" — é fail-open, e neste eixo fail-open não dá sintoma até um agente
// escrever onde não devia.
//
// Os ids reais usados aqui vieram da sonda rodando nos binários desta máquina
// em 21/08/2026 (claude 2.1.220, codex 0.147.0, agy 1.1.17).

import { describe, expect, it } from "vitest"
import { naoAlarga } from "./sessionMode"
import {
  MODOS_CURADOS,
  modoEfetivo,
  wireDoModo,
  driftDeModos,
  frasesDoDrift,
  modosOferecidos,
} from "./agentModes"

const CLAUDE_REAL = [
  "acceptEdits",
  "auto",
  "bypassPermissions",
  "manual",
  "dontAsk",
  "plan",
]
const CODEX_REAL = ["read-only", "workspace-write", "danger-full-access"]
const AGY_REAL = ["accept-edits", "plan"]

describe("modosOferecidos — só o que o motor tem E a gente explica", () => {
  it("claude: os curados passam, inclusive o EMULADO", () => {
    // "Só lê" não é `--permission-mode` nenhum: o app monta com
    // `--disallowedTools`. Ele não tem `probeId` e por isso nunca é filtrado —
    // filtrar por descoberta apagaria um modo que existe desde sempre.
    expect(modosOferecidos("claude-code", CLAUDE_REAL).map((d) => d.id)).toEqual([
      "plan",
      "leitura",
      "acceptEdits",
      "auto",
      "bypassPermissions",
    ])
  })

  it("sonda SEM resposta cai na lista curada, nunca em lista vazia", () => {
    // A regressão que os testes do composer pegaram: com `[]` o controle de
    // permissão SUMIA da tela. Ficar sem controle é pior que ficar com uma
    // lista desatualizada — e a curada é o que o app já mandava antes da sonda.
    expect(modosOferecidos("claude-code", null).length).toBeGreaterThan(0)
    expect(modosOferecidos("codex", null).length).toBe(3)
  })

  it("claude: `manual` e `dontAsk` NÃO viram opção", () => {
    // O coração da decisão: o `--help` os cita, e ninguém aqui validou o quanto
    // eles liberam. Oferecer seria fail-open.
    const ids = modosOferecidos("claude-code", CLAUDE_REAL).map((d) => d.id)
    expect(ids).not.toContain("manual")
    expect(ids).not.toContain("dontAsk")
  })

  it("modo REPASSADO que o motor não anuncia mais some; o emulado fica", () => {
    // Motor que perdeu o modo: parar de mandar a flag é melhor que falhar o
    // turno. Mas o emulado não depende do motor pra existir.
    const ids = modosOferecidos("claude-code", ["plan"]).map((d) => d.id)
    expect(ids).toEqual(["plan", "leitura"])
  })

  it("codex: os três são sandbox de SO", () => {
    const defs = modosOferecidos("codex", CODEX_REAL)
    expect(defs).toHaveLength(3)
    expect(defs.every((d) => d.enforcement === "sandbox")).toBe(true)
  })

  it("agy: todos EMULADOS, então a descoberta não filtra nenhum", () => {
    // O app não manda `--mode` no agy; monta com prompt + sandbox +
    // skip-permissions. O que o binário anuncia não confirma nem desmente isso.
    const ids = modosOferecidos("agy", AGY_REAL).map((d) => d.id)
    expect(ids).toEqual(["plan", "leitura", "padrao", "liberado"])
    expect(MODOS_CURADOS.agy.defs.every((d) => !d.probeId)).toBe(true)
    expect(MODOS_CURADOS.agy.nota).toBeTruthy()
  })

  it("o `enforcement` conta a verdade: planejar no agy é PEDIDO, no codex é sandbox", () => {
    // A diferença que sumia quando os três tinham o mesmo botão.
    const planAgy = MODOS_CURADOS.agy.defs.find((d) => d.canonico === "plan")
    const roCodex = MODOS_CURADOS.codex.defs.find((d) => d.canonico === "leitura")
    expect(planAgy?.enforcement).toBe("prompt")
    expect(roCodex?.enforcement).toBe("sandbox")
  })

  it("motor desconhecido não inventa modo", () => {
    expect(modosOferecidos("motor-que-nao-existe", ["plan"])).toEqual([])
  })
})

describe("driftDeModos", () => {
  it("claude 2.1.220: dois modos novos, nenhum sumido", () => {
    expect(driftDeModos("claude-code", CLAUDE_REAL)).toEqual({
      novos: ["manual", "dontAsk"],
      sumidos: [],
    })
  })

  it("codex: em dia", () => {
    expect(driftDeModos("codex", CODEX_REAL)).toEqual({ novos: [], sumidos: [] })
  })

  it("agy: o que ele anuncia é novidade, e nada é acusado de sumido", () => {
    // Nenhuma opção do agy tem `probeId`, então `sumidos` é vazio por
    // construção — acusar id emulado de ter sumido seria alarme automático.
    expect(driftDeModos("agy", AGY_REAL)).toEqual({
      novos: ["accept-edits", "plan"],
      sumidos: [],
    })
  })

  it("modo que SUMIU do motor é acusado", () => {
    // O mais urgente dos dois: continuamos mandando a flag até alguém reparar,
    // e o erro chega como falha de turno em vez de aviso.
    expect(driftDeModos("codex", ["read-only"]).sumidos).toEqual([
      "workspace-write",
      "danger-full-access",
    ])
  })

  it("sonda que NÃO leu (null) não acusa nada", () => {
    // "Não consegui perguntar" ≠ "sumiram todos". Acusar aqui encheria a tela
    // de alarme falso toda vez que o binário não estivesse no PATH.
    expect(driftDeModos("codex", null)).toEqual({ novos: [], sumidos: [] })
  })
})

describe("frasesDoDrift", () => {
  it("cala quando não há drift", () => {
    expect(frasesDoDrift("codex", { novos: [], sumidos: [] })).toEqual([])
  })

  it("o SUMIDO vem primeiro (é o que quebra turno)", () => {
    const f = frasesDoDrift("codex", { novos: ["x"], sumidos: ["y"] })
    expect(f[0]).toContain("não anuncia mais")
  })

  it("o novo do agy carrega a nota que explica o vazio", () => {
    const f = frasesDoDrift("agy", { novos: ["plan"], sumidos: [] })
    expect(f[0]).toContain("revalidar")
  })

  it("nomeia os ids, nunca só a contagem", () => {
    // "2 modos novos" manda você caçar quais; o nome resolve na hora.
    const f = frasesDoDrift("claude-code", { novos: ["manual", "dontAsk"], sumidos: [] })
    expect(f[0]).toContain("manual")
    expect(f[0]).toContain("dontAsk")
  })
})

describe("a ponte pro fio — onde afrouxar não daria sintoma", () => {
  it("cada modo curado aponta pro eixo canônico", () => {
    // Explícito, não derivado por nome: `acceptEdits` do Claude é o nosso
    // "pede", e `workspace-write` do Codex também. Adivinhar por string aqui
    // seria adivinhar no eixo de segurança.
    for (const [agent, cur] of Object.entries(MODOS_CURADOS)) {
      for (const d of cur.defs) {
        expect(d.canonico, `${agent}:${d.id}`).toBeTruthy()
      }
    }
  })

  it("nenhum modo curado mapeia pra algo MAIS permissivo que ele mesmo", () => {
    // A invariante do M0, cobrada na tabela real: `unattended` só pode nascer
    // de canônico que de fato escreve sem pedir.
    for (const cur of Object.values(MODOS_CURADOS)) {
      for (const d of cur.defs) {
        const w = wireDoModo(d.canonico, "leitura")
        const efetivo = modoEfetivo(w.permission, w.planFirst)
        expect(naoAlarga(d.canonico, efetivo), d.id).toBe(true)
      }
    }
  })

  it("planejar NÃO rebaixa quem trabalha em `leitura`", () => {
    // O erro caro: mandar `padrao` fixo junto do plano soltaria a escrita de
    // quem escolheu só leitura.
    expect(wireDoModo("plan", "leitura")).toEqual({
      permission: "leitura",
      planFirst: true,
    })
  })

  it("planejar preserva a base, seja ela qual for", () => {
    expect(wireDoModo("plan", "liberado").permission).toBe("liberado")
    expect(wireDoModo("plan", "padrao").permission).toBe("padrao")
  })

  it("modo normal define a permissão e desliga o plano", () => {
    expect(wireDoModo("auto", "leitura")).toEqual({
      permission: "auto",
      planFirst: false,
    })
  })

  it("ida e volta preserva o modo (menos o plano, que carrega a base)", () => {
    for (const m of ["leitura", "padrao", "auto", "liberado"] as const) {
      const w = wireDoModo(m, "padrao")
      expect(modoEfetivo(w.permission, w.planFirst)).toBe(m)
    }
  })

  it("plano vence a permissão na leitura do efetivo, igual ao motor", () => {
    expect(modoEfetivo("liberado", true)).toBe("plan")
  })
})
