import { describe, expect, it } from "vitest"
import {
  alvoDe,
  DIVISOR,
  itensPara,
  ROTULOS,
  type Alvo,
  type Recursos,
  type Sonda,
} from "./contextMenu"

const TUDO: Recursos = { colar: true, revelar: true }
const NADA: Recursos = { colar: false, revelar: false }

const sondaVazia: Sonda = {
  editavel: null,
  imagem: null,
  arquivo: null,
  bloco: null,
  selecao: "",
}

describe("itensPara · campo editável", () => {
  const campo = (extra: Partial<Extract<Alvo, { tipo: "editavel" }>> = {}) =>
    ({
      tipo: "editavel",
      senha: false,
      somenteLeitura: false,
      temSelecao: false,
      temConteudo: true,
      ...extra,
    }) as Alvo

  it("sem seleção não oferece cortar nem copiar (não há o que copiar)", () => {
    expect(itensPara(campo(), TUDO)).toEqual(["colar", DIVISOR, "selecionar-tudo"])
  })

  it("com seleção oferece o conjunto completo de edição", () => {
    expect(itensPara(campo({ temSelecao: true }), TUDO)).toEqual([
      "cortar",
      "copiar",
      "colar",
      DIVISOR,
      "selecionar-tudo",
    ])
  })

  it("campo vazio não oferece selecionar tudo", () => {
    expect(itensPara(campo({ temConteudo: false }), TUDO)).toEqual(["colar"])
  })

  it("campo de senha só deixa ENTRAR texto, nunca tirar o segredo", () => {
    const itens = itensPara(campo({ senha: true, temSelecao: true }), TUDO)
    expect(itens).toEqual(["colar"])
    expect(itens).not.toContain("copiar")
    expect(itens).not.toContain("cortar")
    expect(itens).not.toContain("selecionar-tudo")
  })

  it("campo de senha sem poder colar não abre menu nenhum", () => {
    expect(itensPara(campo({ senha: true }), NADA)).toEqual([])
  })

  it("campo somente-leitura deixa tirar texto, nunca pôr", () => {
    const itens = itensPara(campo({ somenteLeitura: true, temSelecao: true }), TUDO)
    expect(itens).toEqual(["copiar", DIVISOR, "selecionar-tudo"])
    expect(itens).not.toContain("colar")
    expect(itens).not.toContain("cortar")
  })

  it("senha somente-leitura não abre menu nenhum", () => {
    expect(itensPara(campo({ senha: true, somenteLeitura: true }), TUDO)).toEqual([])
  })

  it("sem leitura de área de transferência, 'Colar' some em vez de falhar", () => {
    expect(itensPara(campo({ temSelecao: true }), NADA)).toEqual([
      "cortar",
      "copiar",
      DIVISOR,
      "selecionar-tudo",
    ])
  })
})

describe("itensPara · bloco de texto do produto", () => {
  it("sem seleção oferece só copiar o bloco inteiro", () => {
    expect(
      itensPara({ tipo: "bloco", texto: "oi", selecao: "" }, TUDO),
    ).toEqual(["copiar-bloco"])
  })

  it("com seleção oferece copiar a seleção E o bloco inteiro", () => {
    expect(
      itensPara({ tipo: "bloco", texto: "oi tudo bem", selecao: "tudo" }, TUDO),
    ).toEqual(["copiar", DIVISOR, "copiar-bloco"])
  })

  it("bloco sem texto renderizado não abre menu", () => {
    expect(itensPara({ tipo: "bloco", texto: "", selecao: "" }, TUDO)).toEqual([])
  })
})

describe("itensPara · imagem", () => {
  const img: Alvo = { tipo: "imagem", path: "/x/a.png", nome: "a.png" }

  it("oferece copiar, abrir e mostrar na pasta", () => {
    expect(itensPara(img, TUDO)).toEqual([
      "copiar-imagem",
      DIVISOR,
      "abrir-imagem",
      "revelar-imagem",
    ])
  })

  it("fora do Tauri, 'Mostrar na pasta' some (não há como revelar)", () => {
    expect(itensPara(img, NADA)).toEqual(["copiar-imagem", DIVISOR, "abrir-imagem"])
  })

  it("imagem que o app não conhece por arquivo só deixa copiar os pixels", () => {
    const solta: Alvo = { tipo: "imagem", path: null, nome: "avatar" }
    expect(itensPara(solta, TUDO)).toEqual(["copiar-imagem"])
  })

  it("não oferece 'Salvar como', que não tem implementação real", () => {
    expect(JSON.stringify(itensPara(img, TUDO))).not.toContain("salvar")
  })
})

describe("itensPara · arquivo de código", () => {
  const arqComAbs: Alvo = {
    tipo: "arquivo",
    rel: "src/lib/agents.ts",
    abs: "/Users/v/proj/src/lib/agents.ts",
    line: 42,
    texto: "bloco da mensagem",
    selecao: "",
  }

  const arqRelPuro: Alvo = {
    tipo: "arquivo",
    rel: "cacheDoTurno.ts",
    line: null,
    texto: "bloco",
    selecao: "",
  }

  it("com caminho absoluto oferece abrir, copiar caminhos e mostrar na pasta", () => {
    expect(itensPara(arqComAbs, TUDO)).toEqual([
      "abrir-arquivo",
      "copiar-caminho-relativo",
      "copiar-caminho-absoluto",
      "revelar-arquivo",
      DIVISOR,
      "copiar-bloco",
    ])
  })

  it("sem caminho absoluto não oferece copiar absoluto nem mostrar na pasta", () => {
    expect(itensPara(arqRelPuro, TUDO)).toEqual([
      "abrir-arquivo",
      "copiar-caminho-relativo",
      DIVISOR,
      "copiar-bloco",
    ])
  })

  it("com seleção de texto sobre o arquivo inclui copiar seleção", () => {
    const arqComSel: Alvo = { ...arqComAbs, selecao: "agents" }
    expect(itensPara(arqComSel, TUDO)).toEqual([
      "copiar",
      DIVISOR,
      "abrir-arquivo",
      "copiar-caminho-relativo",
      "copiar-caminho-absoluto",
      "revelar-arquivo",
      DIVISOR,
      "copiar-bloco",
    ])
  })
})

describe("itensPara · seleção solta e área vazia", () => {
  it("texto selecionado fora de bloco oferece só copiar", () => {
    expect(itensPara({ tipo: "selecao", texto: "abc" }, TUDO)).toEqual(["copiar"])
  })

  it("área vazia não abre menu (menu vazio é pior que menu ausente)", () => {
    expect(itensPara(null, TUDO)).toEqual([])
  })

  it("seleção em branco não vira item de copiar nada", () => {
    expect(itensPara({ tipo: "selecao", texto: "" }, TUDO)).toEqual([])
  })
})

describe("itensPara · higiene do divisor", () => {
  it("nunca sobra divisor na ponta nem divisor dobrado", () => {
    const alvos: (Alvo | null)[] = [
      { tipo: "editavel", senha: false, somenteLeitura: false, temSelecao: false, temConteudo: false },
      { tipo: "editavel", senha: false, somenteLeitura: true, temSelecao: true, temConteudo: true },
      { tipo: "editavel", senha: false, somenteLeitura: false, temSelecao: true, temConteudo: true },
      { tipo: "bloco", texto: "a", selecao: "" },
      { tipo: "imagem", path: "/a", nome: "a" },
      { tipo: "arquivo", rel: "a.ts", line: null, texto: "a", selecao: "" },
      { tipo: "selecao", texto: "a" },
    ]
    for (const alvo of alvos) {
      for (const rec of [TUDO, NADA]) {
        const itens = itensPara(alvo, rec)
        expect(itens[0]).not.toBe(DIVISOR)
        expect(itens[itens.length - 1]).not.toBe(DIVISOR)
        for (let i = 1; i < itens.length; i++) {
          expect(itens[i] === DIVISOR && itens[i - 1] === DIVISOR).toBe(false)
        }
      }
    }
  })
})

describe("rótulos", () => {
  it("todo item que a regra pode devolver tem rótulo em pt-BR", () => {
    const vistos = new Set<string>()
    const alvos: Alvo[] = [
      { tipo: "editavel", senha: false, somenteLeitura: false, temSelecao: true, temConteudo: true },
      { tipo: "bloco", texto: "a", selecao: "b" },
      { tipo: "imagem", path: "/a", nome: "a" },
      { tipo: "arquivo", rel: "a.ts", abs: "/a.ts", line: 10, texto: "a", selecao: "b" },
      { tipo: "selecao", texto: "a" },
    ]
    for (const alvo of alvos) {
      for (const l of itensPara(alvo, TUDO)) if (l !== DIVISOR) vistos.add(l)
    }
    expect(vistos.size).toBeGreaterThan(0)
    for (const id of vistos) {
      expect(ROTULOS[id as keyof typeof ROTULOS]).toBeTruthy()
    }
  })

  it("nenhum rótulo usa travessão (regra de copy do STYLEGUIDE §7)", () => {
    for (const r of Object.values(ROTULOS)) expect(r).not.toContain("—")
  })

  it("'Mostrar na pasta' não diz Finder, porque o produto também é Linux", () => {
    expect(ROTULOS["revelar-imagem"]).not.toMatch(/finder/i)
    expect(ROTULOS["revelar-arquivo"]).not.toMatch(/finder/i)
  })
})

describe("alvoDe · precedência", () => {
  it("campo editável ganha de tudo (lá o botão direito tem função a cumprir)", () => {
    const alvo = alvoDe({
      ...sondaVazia,
      editavel: { senha: false, somenteLeitura: false, temSelecao: false, temConteudo: true },
      imagem: { path: "/a", nome: "a" },
      arquivo: { rel: "a.ts", line: null },
      bloco: { texto: "m" },
      selecao: "s",
    })
    expect(alvo?.tipo).toBe("editavel")
  })

  it("imagem ganha do bloco, porque o anexo mora dentro da mensagem", () => {
    const alvo = alvoDe({
      ...sondaVazia,
      imagem: { path: "/a", nome: "a" },
      bloco: { texto: "m" },
    })
    expect(alvo?.tipo).toBe("imagem")
  })

  it("arquivo ganha do bloco genérico", () => {
    const alvo = alvoDe({
      ...sondaVazia,
      arquivo: { rel: "src/a.ts", abs: "/p/src/a.ts", line: 12 },
      bloco: { texto: "mensagem inteira" },
      selecao: "sel",
    })
    expect(alvo).toEqual({
      tipo: "arquivo",
      rel: "src/a.ts",
      abs: "/p/src/a.ts",
      line: 12,
      texto: "mensagem inteira",
      selecao: "sel",
    })
  })

  it("bloco carrega a seleção junto, pra oferecer as duas cópias", () => {
    const alvo = alvoDe({ ...sondaVazia, bloco: { texto: "m" }, selecao: "s" })
    expect(alvo).toEqual({ tipo: "bloco", texto: "m", selecao: "s" })
  })

  it("seleção solta fora de bloco vira alvo de seleção", () => {
    expect(alvoDe({ ...sondaVazia, selecao: "abc" })).toEqual({
      tipo: "selecao",
      texto: "abc",
    })
  })

  it("clique em área sem nada não tem alvo", () => {
    expect(alvoDe(sondaVazia)).toBeNull()
  })
})

describe("tabela dentro de bloco (capricho R1)", () => {
  const tabela = { cabecalho: true, linhas: [["Motor", "Custo"], ["Codex", "US$ 0,20"]] }

  it("clique sobre tabela oferece copiar para planilha e como Markdown, depois do texto", () => {
    expect(itensPara({ tipo: "bloco", texto: "Motor Custo", selecao: "", tabela }, NADA)).toEqual([
      "copiar-bloco",
      "copiar-tabela-planilha",
      "copiar-tabela-markdown",
    ])
  })

  it("bloco sem tabela, ou tabela vazia, segue só com as cópias de texto", () => {
    expect(itensPara({ tipo: "bloco", texto: "oi", selecao: "" }, NADA)).toEqual(["copiar-bloco"])
    expect(
      itensPara({ tipo: "bloco", texto: "oi", selecao: "", tabela: { cabecalho: false, linhas: [] } }, NADA),
    ).toEqual(["copiar-bloco"])
  })

  it("a sonda leva a tabela até o alvo", () => {
    expect(alvoDe({ ...sondaVazia, bloco: { texto: "Motor", tabela } })).toEqual({
      tipo: "bloco",
      texto: "Motor",
      selecao: "",
      tabela,
    })
  })

  it("rótulos dizem o destino da cópia", () => {
    expect(ROTULOS["copiar-tabela-planilha"]).toBe("Copiar tabela para planilha")
    expect(ROTULOS["copiar-tabela-markdown"]).toBe("Copiar tabela como Markdown")
  })
})

describe("citar trecho pelo menu (capricho R3)", () => {
  it("seleção dentro de mensagem citável oferece citar logo depois de copiar", () => {
    expect(itensPara({ tipo: "bloco", texto: "resposta", selecao: "trecho", citavel: "t1" }, NADA)).toEqual([
      "copiar",
      "citar-trecho",
      "divisor",
      "copiar-bloco",
    ])
  })

  it("sem seleção, ou fora de mensagem citável, não há citar", () => {
    expect(itensPara({ tipo: "bloco", texto: "resposta", selecao: "", citavel: "t1" }, NADA)).not.toContain("citar-trecho")
    expect(itensPara({ tipo: "bloco", texto: "resposta", selecao: "trecho" }, NADA)).not.toContain("citar-trecho")
  })

  it("a sonda só leva o item citável quando há seleção", () => {
    expect(alvoDe({ ...sondaVazia, bloco: { texto: "r", citavel: "t1" }, selecao: "tr" })).toMatchObject({ citavel: "t1" })
    expect(alvoDe({ ...sondaVazia, bloco: { texto: "r", citavel: "t1" }, selecao: "" })).not.toHaveProperty("citavel")
    expect(ROTULOS["citar-trecho"]).toBe("Citar trecho")
  })
})
