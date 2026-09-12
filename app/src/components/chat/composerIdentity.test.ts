// QUEM VAI RODAR O PRÓXIMO TURNO — e quando isso ainda dá pra mudar.
//
// A guarda principal deste arquivo: numa conversa TRAVADA o composer não pode
// prometer o que o despacho vai descartar. Os estados crus dos seletores
// sobrevivem à troca de conversa (de propósito), então ler o cru numa conversa
// estabelecida mostraria o modelo de OUTRA conversa — e o usuário mandaria um
// turno achando que trocou algo.
import { describe, expect, it } from "vitest"
import {
  notaDeTrocaDeModelo,
  notaDeTrocaDeEsforco,
  notaDeRevezamentoDeMotor,
  identidadeEfetiva,
  identidadeDoDespacho,
  resumoDaIdentidade,
} from "./composerIdentity"

/** Os seletores mostrando uma escolha qualquer, sobrando de outra conversa. */
const SELETORES = {
  agent: "codex",
  model: "gpt-5.6-sol",
  effort: "high",
}

/** O que a conversa carimbou no 1º run (colunas v10/v11/v12 do banco). */
const CARIMBO = {
  agent: "claude-code",
  reqModel: "claude-opus-5[1m]",
  effort: "xhigh",
}

describe("conversa nova: vale o que está nos seletores", () => {
  it("agent, modelo e esforço saem do que você escolheu", () => {
    const id = identidadeEfetiva({
      travada: false,
      modeloDestravado: false,
      escolhaDeEmergencia: null,
      conversa: CARIMBO,
      seletores: SELETORES,
    })
    expect(id).toEqual({
      agent: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      trocouDeModelo: false,
    })
  })

  it("o carimbo da conversa é ignorado enquanto ela não tem turno", () => {
    // Conversa carimbada mas ainda sem envio: o carimbo é aposta, o seletor é a
    // escolha viva.
    const id = identidadeEfetiva({
      travada: false,
      modeloDestravado: false,
      escolhaDeEmergencia: null,
      conversa: CARIMBO,
      seletores: { agent: "agy", model: "default", effort: "default" },
    })
    expect(id.agent).toBe("agy")
    expect(id.model).toBe("default")
  })
})
describe("conversa travada: vale o do 1º run, e o seletor só reflete", () => {
  it("o cru que sobrou de outra conversa NÃO vaza pro próximo turno", () => {
    const id = identidadeEfetiva({
      travada: true,
      modeloDestravado: false,
      escolhaDeEmergencia: null,
      conversa: CARIMBO,
      seletores: SELETORES,
    })
    expect(id).toEqual({
      agent: "claude-code",
      model: "claude-opus-5[1m]",
      effort: "xhigh",
      trocouDeModelo: false,
    })
  })

  it("conversa travada sem modelo/esforço gravados cai em 'default'", () => {
    // É o estado real de conversas antigas (colunas nasceram depois).
    const id = identidadeEfetiva({
      travada: true,
      modeloDestravado: false,
      escolhaDeEmergencia: null,
      conversa: { agent: "claude-code", reqModel: null, effort: null },
      seletores: SELETORES,
    })
    expect(id.model).toBe("default")
    expect(id.effort).toBe("default")
  })

  it("uma escolha de emergência SEM turno falhado é ignorada", () => {
    // Sem a falha não há saída de emergência: trocar o motor no meio do voo é
    // exatamente o que a trava existe pra impedir.
    const id = identidadeEfetiva({
      travada: true,
      modeloDestravado: false,
      escolhaDeEmergencia: "claude-haiku-4-5",
      conversa: CARIMBO,
      seletores: SELETORES,
    })
    expect(id.model).toBe("claude-opus-5[1m]")
    expect(id.trocouDeModelo).toBe(false)
  })
})

describe("a saída de emergência destrava o MODELO, e só ele", () => {
  it("depois de um turno falhado, o modelo escolhido vale no próximo envio", () => {
    const id = identidadeEfetiva({
      travada: true,
      modeloDestravado: true,
      escolhaDeEmergencia: "claude-haiku-4-5",
      conversa: CARIMBO,
      seletores: SELETORES,
    })
    expect(id.model).toBe("claude-haiku-4-5")
    // …e o despacho precisa SABER que foi troca deliberada, senão ele reusa o
    // modelo do 1º run e o reenvio repete o mesmo erro.
    expect(id.trocouDeModelo).toBe(true)
  })

  it("o agent continua travado mesmo com a emergência aberta", () => {
    // Trocar de motor é handoff (sessão nova), não seletor.
    const id = identidadeEfetiva({
      travada: true,
      modeloDestravado: true,
      escolhaDeEmergencia: "claude-haiku-4-5",
      conversa: CARIMBO,
      seletores: SELETORES,
    })
    expect(id.agent).toBe("claude-code")
    expect(id.effort).toBe("xhigh")
  })

  it("emergência aberta mas NADA escolhido ainda mantém o modelo do 1º run", () => {
    const id = identidadeEfetiva({
      travada: true,
      modeloDestravado: true,
      escolhaDeEmergencia: null,
      conversa: CARIMBO,
      seletores: SELETORES,
    })
    expect(id.model).toBe("claude-opus-5[1m]")
    expect(id.trocouDeModelo).toBe(false)
  })
})

describe("o resumo da faixa diz o que importa e cala o resto", () => {
  it("'default' não vira texto (não informa nada que o agent já não diga)", () => {
    expect(
      resumoDaIdentidade({
        agent: "claude-code",
        model: "default",
        effort: "default",
        trocouDeModelo: false,
      }),
    ).toBe("Claude Code")
  })

  it("modelo e esforço entram quando foram escolhidos", () => {
    const resumo = resumoDaIdentidade({
      agent: "claude-code",
      model: "claude-opus-5[1m]",
      effort: "xhigh",
      trocouDeModelo: false,
    })
    expect(resumo.startsWith("Claude Code · ")).toBe(true)
    expect(resumo.endsWith(" · xhigh")).toBe(true)
  })

  it("modelo custom fora do catálogo aparece pelo id cru", () => {
    // O input "Modelo custom…" aceita id arbitrário: o letreiro não pode ficar
    // mudo só porque o modelo não está na lista curada.
    expect(
      resumoDaIdentidade({
        agent: "claude-code",
        model: "claude-opus-6-preview",
        effort: "default",
        trocouDeModelo: false,
      }),
    ).toBe("Claude Code · claude-opus-6-preview")
  })

  it("agent desconhecido não quebra o letreiro (cai no primeiro do catálogo)", () => {
    expect(
      resumoDaIdentidade({
        agent: "motor-que-nao-existe",
        model: "default",
        effort: "default",
        trocouDeModelo: false,
      }),
    ).not.toMatch(/undefined|NaN/)
  })
})

describe("notaDeTrocaDeModelo", () => {
  it("registra a troca com os dois lados", () => {
    expect(notaDeTrocaDeModelo("opus", "sonnet")).toBe(
      "Modelo trocado nesta conversa: opus → sonnet. Vale deste turno em diante.",
    )
  })

  it("mesmo modelo NÃO gera linha", () => {
    // Sem isto o fio ganharia um aviso por turno — ruído que ensina a ignorar.
    expect(notaDeTrocaDeModelo("opus", "opus")).toBeNull()
    expect(notaDeTrocaDeModelo(null, null)).toBeNull()
  })

  it("`null` vira 'default' em vez de sumir da frase", () => {
    // "trocado: → sonnet" não diz de onde saiu. O nome do estado importa mais
    // que a elegância da frase.
    expect(notaDeTrocaDeModelo(null, "sonnet")).toContain("default → sonnet")
    expect(notaDeTrocaDeModelo("opus", null)).toContain("opus → default")
  })
})

describe("revezamento de motor (stagedAgent)", () => {
  it("conversa travada com stagedAgent assume o novo motor e sinaliza revezando", () => {
    const id = identidadeEfetiva({
      travada: true,
      modeloDestravado: true,
      escolhaDeEmergencia: null,
      conversa: { agent: "codex", reqModel: "gpt-5.6-sol", effort: "high" },
      seletores: SELETORES,
      stagedAgent: "claude-code",
    })
    expect(id.agent).toBe("claude-code")
    expect(id.revezando).toBe(true)
    expect(id.model).toBe("default")
  })

  it("notaDeRevezamentoDeMotor formata a troca entre motores sem travessão", () => {
    expect(notaDeRevezamentoDeMotor("codex", "claude-code")).toBe(
      "Revezamento de motor nesta conversa: Codex → Claude Code. O contexto recente foi transferido e vale deste turno em diante.",
    )
    expect(notaDeRevezamentoDeMotor("codex", "codex")).toBeNull()
  })
})

describe("o esforço segue a regra do modelo", () => {
  it("fora de voo, o esforço escolhido vale no próximo envio e o despacho sabe", () => {
    const id = identidadeEfetiva({
      travada: true,
      modeloDestravado: true,
      escolhaDeEmergencia: null,
      escolhaDeEsforco: "low",
      conversa: CARIMBO,
      seletores: SELETORES,
    })
    expect(id.effort).toBe("low")
    expect(id.trocouDeEsforco).toBe(true)
    // trocar o esforço não mexe no modelo carimbado
    expect(id.model).toBe("claude-opus-5[1m]")
    expect(id.trocouDeModelo).toBe(false)
  })

  it("com turno em voo a escolha é ignorada (a flag já foi no spawn)", () => {
    const id = identidadeEfetiva({
      travada: true,
      modeloDestravado: false,
      escolhaDeEmergencia: null,
      escolhaDeEsforco: "low",
      conversa: CARIMBO,
      seletores: SELETORES,
    })
    expect(id.effort).toBe("xhigh")
    expect(id.trocouDeEsforco).toBeUndefined()
  })

  it("voltar pra 'default' é troca legítima, não ausência de escolha", () => {
    // É o que o seletor faz quando o modelo novo não aceita o degrau atual.
    const id = identidadeEfetiva({
      travada: true,
      modeloDestravado: true,
      escolhaDeEmergencia: "gpt-5.5",
      escolhaDeEsforco: "default",
      conversa: CARIMBO,
      seletores: SELETORES,
    })
    expect(id.effort).toBe("default")
    expect(id.trocouDeEsforco).toBe(true)
  })

  it("o cru dos seletores continua sem vazar pro esforço de uma conversa travada", () => {
    const id = identidadeEfetiva({
      travada: true,
      modeloDestravado: true,
      escolhaDeEmergencia: null,
      conversa: CARIMBO,
      seletores: SELETORES,
    })
    expect(id.effort).toBe("xhigh")
  })
})

describe("notaDeTrocaDeEsforco", () => {
  it("registra a troca com os dois lados, sem travessão", () => {
    expect(notaDeTrocaDeEsforco("xhigh", "low")).toBe(
      "Esforço trocado nesta conversa: xhigh → low. Vale deste turno em diante.",
    )
  })

  it("mesmo esforço NÃO gera linha, e null vira 'default'", () => {
    expect(notaDeTrocaDeEsforco("high", "high")).toBeNull()
    expect(notaDeTrocaDeEsforco(null, null)).toBeNull()
    expect(notaDeTrocaDeEsforco(null, "high")).toContain("default → high")
  })
})

describe("identidadeDoDespacho: o que o envio usa e o que o fio registra", () => {
  const CONV = { agent: "codex", stagedAgent: null, reqModel: "gpt-5.6-sol", effort: "high" }
  const PEDIDO = { agent: "codex", model: "gpt-5.5", effort: "low" }

  it("conversa travada sem troca deliberada ignora o pedido e não escreve nada no fio", () => {
    const d = identidadeDoDespacho({ locked: true, conv: CONV, cfg: PEDIDO })
    expect([d.model, d.effort]).toEqual(["gpt-5.6-sol", "high"])
    expect([d.modelChangeNotice, d.effortChangeNotice, d.agentChangeNotice]).toEqual([null, null, null])
  })

  it("troca só de esforço: vale o novo esforço, o modelo segue o carimbado, e só o esforço vira linha", () => {
    const d = identidadeDoDespacho({ locked: true, conv: CONV, cfg: { ...PEDIDO, effortSwitched: true } })
    expect(d.effort).toBe("low")
    expect(d.model).toBe("gpt-5.6-sol")
    expect(d.effortChangeNotice).toBe(
      "Esforço trocado nesta conversa: high → low. Vale deste turno em diante.",
    )
    expect(d.modelChangeNotice).toBeNull()
  })

  it("troca só de modelo continua como antes (o esforço fica)", () => {
    const d = identidadeDoDespacho({ locked: true, conv: CONV, cfg: { ...PEDIDO, modelSwitched: true } })
    expect([d.model, d.effort]).toEqual(["gpt-5.5", "high"])
    expect(d.modelChangeNotice).toContain("gpt-5.6-sol → gpt-5.5")
    expect(d.effortChangeNotice).toBeNull()
  })

  it("revezamento de motor leva o pedido inteiro e registra só o revezamento", () => {
    const d = identidadeDoDespacho({
      locked: true,
      conv: CONV,
      cfg: { agent: "claude-code", model: null, effort: "xhigh" },
    })
    expect(d.isAgentSwitch).toBe(true)
    expect([d.agent, d.model, d.effort]).toEqual(["claude-code", null, "xhigh"])
    expect(d.agentChangeNotice).toContain("Codex → Claude Code")
    expect([d.modelChangeNotice, d.effortChangeNotice]).toEqual([null, null])
  })

  it("conversa nova usa o pedido e não fala de troca", () => {
    const d = identidadeDoDespacho({ locked: false, conv: CONV, cfg: PEDIDO })
    expect([d.agent, d.model, d.effort]).toEqual(["codex", "gpt-5.5", "low"])
    expect([d.modelChangeNotice, d.effortChangeNotice]).toEqual([null, null])
  })
})
