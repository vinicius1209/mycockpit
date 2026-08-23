// A rede do eixo de modo (M0). Nada aqui muda comportamento — o que estes
// testes fazem é tornar a invariante de SEGURANÇA verificável antes de a
// refatoração começar.
//
// A invariante: nenhuma tradução entre os quatro vocabulários pode devolver um
// modo mais permissivo que o de origem. Afrouxar aqui não dá sintoma — ninguém
// percebe até um agente escrever onde não devia.

import { describe, expect, it } from "vitest"
import {
  PERMISSIVIDADE,
  ehDesassistido,
  modeFromAutonomy,
  modeFromConversation,
  modeFromSchedule,
  modoEfetivoDoSpawn,
  permissaoDoSpawn,
  naoAlarga,
  type PermissionVocab,
  type SessionMode,
} from "./sessionMode"

const TODOS: SessionMode[] = [
  "plan",
  "leitura",
  "fusionRo",
  "padrao",
  "auto",
  "liberado",
]

describe("a régua de permissividade", () => {
  it("os três de escrita zero empatam", () => {
    // Diferem no PORQUÊ, não no quanto liberam. Inventar hierarquia entre eles
    // criaria uma comparação sem significado.
    expect(PERMISSIVIDADE.plan).toBe(PERMISSIVIDADE.leitura)
    expect(PERMISSIVIDADE.leitura).toBe(PERMISSIVIDADE.fusionRo)
  })

  it("a ordem sobe: nada < pede < sem pedir com freio < sem freio", () => {
    expect(PERMISSIVIDADE.leitura).toBeLessThan(PERMISSIVIDADE.padrao)
    expect(PERMISSIVIDADE.padrao).toBeLessThan(PERMISSIVIDADE.auto)
    expect(PERMISSIVIDADE.auto).toBeLessThan(PERMISSIVIDADE.liberado)
  })

  it("todo modo tem degrau (nenhum fica de fora da régua)", () => {
    for (const m of TODOS) expect(typeof PERMISSIVIDADE[m]).toBe("number")
  })
})

describe("conversa → modo", () => {
  const vocab: PermissionVocab[] = ["leitura", "padrao", "liberado"]

  it("sem plano, é tradução 1:1", () => {
    for (const v of vocab) expect(modeFromConversation(v, false)).toBe(v)
  })

  it("plano VENCE qualquer permissão — inclusive liberado", () => {
    // É o que o motor já faz: o adapters.rs substitui o --permission-mode do
    // modo quando o turno é de plano. Se aqui não vencesse, a tradução diria
    // uma coisa e o spawn faria outra.
    for (const v of vocab) expect(modeFromConversation(v, true)).toBe("plan")
  })

  it("e planejar NUNCA afrouxa o que estava valendo", () => {
    for (const v of vocab) {
      expect(naoAlarga(v, modeFromConversation(v, true))).toBe(true)
    }
  })
})

describe("agendamento → modo", () => {
  it("tradução 1:1; o conjunto é que é menor", () => {
    expect(modeFromSchedule("leitura")).toBe("leitura")
    expect(modeFromSchedule("padrao")).toBe("padrao")
    expect(modeFromSchedule("auto")).toBe("auto")
  })

  it("o agendamento não alcança `liberado` — e isso é PROPOSITAL", () => {
    // Execução sem ninguém na frente não tem quem segure um erro; `auto` é o
    // teto de lá. A tradução não pode inventar um degrau a mais.
    const alcancaveis = (["leitura", "padrao", "auto"] as const).map(modeFromSchedule)
    expect(alcancaveis).not.toContain("liberado")
  })
})

describe("fase de missão → modo", () => {
  it("`auto` CLAMPA: só morde no modo que pausa", () => {
    // Este teste nasceu ERRADO na primeira versão do M0 — afirmava
    // `modeFromAutonomy("auto", "leitura") === "auto"`, ou seja, ligar
    // autonomia numa fase daria escrita a um projeto read-only. A produção
    // (`phasePermission`) sempre clampou; a rede é que estava frouxa, e o M4
    // pegou ao unificar as duas.
    expect(modeFromAutonomy("auto", "padrao")).toBe("auto")
    expect(modeFromAutonomy("auto", "leitura")).toBe("leitura")
    expect(modeFromAutonomy("auto", "liberado")).toBe("liberado")
  })

  it("autonomia NÃO solta escrita em projeto que não escreve", () => {
    // A invariante certa, e ela precisou de duas tentativas: "nunca alarga" é
    // FORTE DEMAIS aqui, porque subir de "Pede" pra "Auto" é justamente o que o
    // toggle existe pra fazer. O que não pode é escrever onde o projeto não
    // escreve.
    expect(ehDesassistido(modeFromAutonomy("auto", "leitura"))).toBe(false)
    expect(ehDesassistido(modeFromAutonomy("inherit", "leitura"))).toBe(false)
  })

  it("`inherit` nunca alarga, em nenhum projeto", () => {
    // Herdar é herdar: aqui a régua forte VALE, porque não há gesto do usuário.
    for (const proj of ["leitura", "padrao", "liberado"] as PermissionVocab[]) {
      expect(naoAlarga(proj, modeFromAutonomy("inherit", proj)), proj).toBe(true)
    }
  })

  it("`auto` sobe no máximo UM degrau, e só a partir do que pausa", () => {
    expect(modeFromAutonomy("auto", "padrao")).toBe("auto") // o ponto do toggle
    expect(modeFromAutonomy("auto", "leitura")).toBe("leitura") // clampado
    expect(modeFromAutonomy("auto", "liberado")).toBe("liberado") // no-op
  })

  it("`inherit` usa o modo do PROJETO, não um default chutado", () => {
    expect(modeFromAutonomy("inherit", "leitura")).toBe("leitura")
    expect(modeFromAutonomy("inherit", "padrao")).toBe("padrao")
  })

  it("`inherit` num projeto restrito NÃO vira auto", () => {
    // O erro caro: tratar "herda" como "pode tudo" numa missão longa rodando
    // sozinha. Herdar é herdar.
    expect(naoAlarga("leitura", modeFromAutonomy("inherit", "leitura"))).toBe(true)
  })
})

describe("naoAlarga — a invariante que manda na refatoração", () => {
  it("igual passa; apertar passa", () => {
    expect(naoAlarga("padrao", "padrao")).toBe(true)
    expect(naoAlarga("liberado", "leitura")).toBe(true)
    expect(naoAlarga("auto", "padrao")).toBe(true)
  })

  it("afrouxar NÃO passa, em qualquer par", () => {
    expect(naoAlarga("leitura", "padrao")).toBe(false)
    expect(naoAlarga("padrao", "auto")).toBe(false)
    expect(naoAlarga("auto", "liberado")).toBe(false)
    expect(naoAlarga("plan", "liberado")).toBe(false)
  })

  it("é reflexiva em todos os modos (nenhum se afrouxa sozinho)", () => {
    for (const m of TODOS) expect(naoAlarga(m, m)).toBe(true)
  })
})

describe("ehDesassistido", () => {
  it("escreve sem pedir a partir de `auto`", () => {
    expect(ehDesassistido("auto")).toBe(true)
    expect(ehDesassistido("liberado")).toBe(true)
  })

  it("quem pede, ou quem não escreve, não é desassistido", () => {
    expect(ehDesassistido("padrao")).toBe(false)
    expect(ehDesassistido("leitura")).toBe(false)
    expect(ehDesassistido("plan")).toBe(false)
    expect(ehDesassistido("fusionRo")).toBe(false)
  })
})

describe("o último metro: do chip até o processo", () => {
  it("a CONVERSA vence o projeto", () => {
    // O bug de 23/08/2026: conversa nova em "Liberado", processo nascendo com o
    // modo do PROJETO. O chip mostrava um valor que nunca chegava ao spawn.
    expect(modoEfetivoDoSpawn("liberado", "padrao")).toBe("liberado")
    expect(modoEfetivoDoSpawn("leitura", "liberado")).toBe("leitura")
  })

  it("sem modo na conversa, HERDA o projeto (null ≠ 'sem modo')", () => {
    expect(modoEfetivoDoSpawn(null, "liberado")).toBe("liberado")
    expect(modoEfetivoDoSpawn(undefined, "leitura")).toBe("leitura")
  })

  it("sem os dois, o default é o que PEDE — nunca o que libera", () => {
    // Fail-closed: ausência de configuração não pode virar permissão ampla.
    expect(modoEfetivoDoSpawn(null, null)).toBe("padrao")
  })

  it("`plan` viaja como LEITURA, porque planejar não edita", () => {
    // O planFirst continua indo junto; a permissão que o acompanha é a mais
    // apertada que não quebra o turno.
    expect(permissaoDoSpawn("plan")).toBe("leitura")
  })

  it("`fusionRo` usa o nome que o Rust entende", () => {
    // Vocabulário do backend é "fusion-ro"; mandar "fusionRo" seria erro de
    // parse na fronteira — e o enum do Rust é exaustivo, então viraria falha do
    // turno em vez de fail-open.
    expect(permissaoDoSpawn("fusionRo")).toBe("fusion-ro")
  })

  it("os demais atravessam 1:1", () => {
    for (const m of ["leitura", "padrao", "auto", "liberado"] as const) {
      expect(permissaoDoSpawn(m)).toBe(m)
    }
  })

  it("nenhuma tradução AFROUXA o que o usuário escolheu", () => {
    for (const m of TODOS) {
      const saida = permissaoDoSpawn(m)
      const comoModo = (saida === "fusion-ro" ? "fusionRo" : saida) as SessionMode
      expect(naoAlarga(m, comoModo), m).toBe(true)
    }
  })
})

describe("o caso do usuário, 23/08/2026", () => {
  it("conversa NOVA em Liberado, projeto em Pede → o processo nasce LIBERADO", () => {
    // Relato: conversa nova aberta em "Liberado", sem trocar nada durante o
    // turno, e o Claude pedindo permissão a cada Bash. O chip lia
    // `conv.sessionMode`; o spawn mandava `project.permissionMode`.
    expect(permissaoDoSpawn(modoEfetivoDoSpawn("liberado", "padrao"))).toBe(
      "liberado",
    )
  })

  it("e o inverso, que é o lado PERIGOSO: Só lê na conversa CONFINA", () => {
    // O mesmo desencontro deixava o sandbox (S1-S4) inerte: ele decide pelo
    // `req.permission`, então escolher "Só lê" no chip não confinava nada a
    // menos que o PROJETO já estivesse em leitura. Garantia de segurança
    // pendurada em controle desconectado é pior que nenhuma — ela é exibida.
    expect(permissaoDoSpawn(modoEfetivoDoSpawn("leitura", "liberado"))).toBe(
      "leitura",
    )
  })
})
