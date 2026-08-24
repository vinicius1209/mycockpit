// Chegar numa seção de Configurações pela paleta ⌘K.
//
// Substituiu a ideia de uma caixa de busca própria (o concorrente tem uma, mas
// com 34 seções; com 17 ela é conforto). O valor real não é a busca: é o efeito
// de segunda ordem de obrigar cada seção a DECLARAR o que contém, o que
// transforma a regra editorial "cada seção responde UMA pergunta" em algo
// verificável.

import { describe, expect, it } from "vitest"
import {
  SETTINGS_SECTIONS,
  casaBusca,
  precisaDeAtencao,
  secoesDisponiveis,
  sectionDef,
} from "@/components/settings/sections"

const acha = (termo: string) =>
  SETTINGS_SECTIONS.filter((s) => casaBusca(s, termo)).map((s) => s.id)

describe("casaBusca — o que a pessoa digita chega na seção certa", () => {
  it("acha pela palavra DECLARADA, que não está no título", () => {
    // O caso que motivou o campo `busca`: "microfone" não aparece em nenhum
    // lugar do rótulo "Ditado" nem da pergunta da seção.
    expect(acha("microfone")).toContain("dictation")
    expect(acha("caffeinate")).toContain("autopilot")
    expect(acha("seatbelt")).toContain("sandbox")
    expect(acha("pull request")).toContain("github")
  })

  it("ignora acento e caixa (ninguém digita acento numa busca apressada)", () => {
    expect(acha("vocabulario")).toContain("dictation")
    expect(acha("VOCABULÁRIO")).toContain("dictation")
    expect(acha("Missao")).toContain("missions")
  })

  it("termos múltiplos são E, não OU", () => {
    // "plano de voo" tem que achar Missões, e não tudo que tem "plano".
    const r = acha("plano voo")
    expect(r).toContain("missions")
    expect(r).not.toContain("ledger")
  })

  it("acha pelo título e pela pergunta também, não só pelas palavras-chave", () => {
    expect(acha("aparência")).toContain("appearance")
    expect(acha("reinícios")).toContain("appearance")
  })

  it("termo sem correspondência não devolve nada (nunca 'a primeira')", () => {
    expect(acha("zzzznaoexiste")).toEqual([])
  })
})

describe("a declaração é obrigatória, e é ela que impede o depósito", () => {
  it("TODA seção declara ao menos 3 palavras do que tem dentro", () => {
    // Seção que não consegue listar o próprio conteúdo é seção que virou
    // depósito — foi assim que "CLIs instaladas" acumulou medidor de uso,
    // hooks de terminal e curador de modelos (build 191).
    for (const s of SETTINGS_SECTIONS) {
      expect(s.busca.length, `seção "${s.id}" sem palavras declaradas`).toBeGreaterThanOrEqual(3)
      expect(s.busca.every((t) => t.trim().length > 0)).toBe(true)
    }
  })

  it("nenhuma seção declara palavra REPETIDA de outra a ponto de virar destino ambíguo", () => {
    // Não proíbe sobreposição (procurar "modelo" pode achar duas seções, e
    // está certo). Proíbe DUAS seções com a MESMA lista inteira, que seria
    // sinal de que uma delas não sabe o que é.
    const assinaturas = SETTINGS_SECTIONS.map((s) =>
      [...s.busca].sort().join("|"),
    )
    expect(new Set(assinaturas).size).toBe(assinaturas.length)
  })
})

describe("secoesDisponiveis — a mesma lista do rail e da paleta", () => {
  it("todo id disponível é uma seção que existe de verdade", () => {
    // O defeito que isto impede: um destino fantasma na paleta, que abre as
    // Configurações num painel vazio.
    const ids = new Set(SETTINGS_SECTIONS.map((s) => s.id))
    for (const id of secoesDisponiveis()) {
      expect(ids.has(id)).toBe(true)
      expect(sectionDef(id).id).toBe(id)
    }
  })
})

describe("badge — estado da seção, fora do nome dela", () => {
  it("Missões carrega o beta como SELO, não dentro do título", () => {
    const m = sectionDef("missions")
    expect(m.badge).toBe("beta")
    // O título voltou a ser só o nome: com "(beta)" dentro, o estado não podia
    // ser lido nem estilizado como estado.
    expect(m.title).toBe("Missões")
    expect(m.title).not.toMatch(/beta/i)
  })
})

describe("precisaDeAtencao — o que merece um ponto no rail", () => {
  const probe = (installed: boolean, auth: string) => ({ installed, auth })

  it("CLI instalada e DESLOGADA: atenção (você instalou, falta terminar)", () => {
    expect(
      precisaDeAtencao("machine", {
        detected: { "claude-code": probe(true, "missing") },
      }),
    ).toBe(true)
  })

  it("CLI NÃO instalada: sem atenção — talvez você não queira aquele motor", () => {
    expect(
      precisaDeAtencao("machine", {
        detected: { codex: probe(false, "missing") },
      }),
    ).toBe(false)
  })

  it("auth 'unknown' não é alarme: não saber não é o mesmo que estar quebrado", () => {
    expect(
      precisaDeAtencao("machine", { detected: { agy: probe(true, "unknown") } }),
    ).toBe(false)
  })

  it("gh instalado e SEM conta: atenção. gh ausente: não", () => {
    expect(precisaDeAtencao("github", { gh: { installed: true, contas: 0 } })).toBe(true)
    // ausente é capacidade opcional, e o resto do app funciona igual.
    expect(precisaDeAtencao("github", { gh: { installed: false, contas: 0 } })).toBe(false)
    expect(precisaDeAtencao("github", { gh: { installed: true, contas: 2 } })).toBe(false)
  })

  it("ANTES de olhar não pinta nada (fatos ausentes = silêncio)", () => {
    // O pior ponto possível é o que aparece enquanto o app ainda não sabe.
    expect(precisaDeAtencao("machine", {})).toBe(false)
    expect(precisaDeAtencao("github", {})).toBe(false)
  })

  it("máquina sem sandbox NUNCA pinta ponto", () => {
    // Não há o que consertar: é fato do sistema. Um ponto que não apaga
    // ensina o usuário a ignorar pontos — e aí o próximo, que importa, some.
    expect(precisaDeAtencao("sandbox", { gh: { installed: true, contas: 0 } })).toBe(false)
  })

  it("seção sem regra própria nunca pinta", () => {
    for (const id of ["appearance", "ledger", "presets", "about"] as const) {
      expect(precisaDeAtencao(id, { detected: { codex: probe(true, "missing") } })).toBe(false)
    }
  })
})
