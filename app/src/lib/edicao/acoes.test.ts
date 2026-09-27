// Salvar, manter a minha, descartar e o portão de fechar, com o `invoke`
// simulado nas MESMAS formas que edicao.rs devolve (os testes de lá travam o
// JSON). O texto é o começo real de app/src/lib/db/schema.ts.
import { beforeEach, describe, expect, it, vi } from "vitest"
import { EditorState } from "@codemirror/state"

const invoke = vi.hoisted(() => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({ invoke }))
vi.mock("@/lib/avisos", async () => (await import("@/test/avisosFalsos")).moduloDeAvisosFalsos())

import { avisar } from "@/lib/avisos"
import { useConfirm } from "@/lib/confirm"
import {
  avisoDeSujosDaConversa,
  manterAMinha,
  salvar,
  soltarConversa,
  textoParaODisco,
} from "@/lib/edicao/acoes"
import { __resetParaTeste, obter, registrar, type Buffer } from "@/lib/edicao/buffers"
import { planoDoPortao, resolverPerguntas, textoDaPergunta } from "@/lib/edicao/portao"
import { useAbasDeArquivo } from "@/store/abasDeArquivo"
import { useEdicao } from "@/store/edicao"

const SCHEMA = `import type Database from "@tauri-apps/plugin-sql"

/** ALTER idempotente: engole só a coluna já existente; erro real propaga. */
`
const ROOT = "/Users/viniciusmachado/projetos/frota"
const CHAVE = "app/src/lib/db/schema.ts"
const CAMINHO = `${ROOT}/${CHAVE}`

function buffer(parcial: Partial<Buffer> = {}): Buffer {
  const estado = EditorState.create({ doc: SCHEMA })
  return registrar(
    {
      caminho: CAMINHO,
      root: ROOT,
      relativo: CHAVE,
      estado,
      vista: null,
      base: estado.doc,
      versao: "v1",
      fimDeLinha: "lf",
      bom: false,
      gravavel: true,
      motivo: null,
      versaoDoConflito: null,
      donos: new Map([["c1", CHAVE]]),
      ...parcial,
    },
    ROOT,
    CHAVE,
  )
}

/** Digita no buffer guardado (sem editor montado) e marca sujo, como o editor faz. */
function digitar(b: Buffer, texto: string) {
  b.estado = b.estado.update({ changes: { from: 0, insert: texto } }).state
  useEdicao.getState().marcarSujo(b.caminho, true)
}

beforeEach(() => {
  __resetParaTeste()
  invoke.mockReset()
  vi.mocked(avisar.erro).mockClear()
  useEdicao.setState({ sujos: {}, avisos: {}, modo: {}, salvando: {} })
  useAbasDeArquivo.setState({ porConversa: {}, fechadas: {}, sumidos: {} })
  useConfirm.setState({ req: null, resolve: null })
})

describe("salvar", () => {
  it("grava com a versão lida, apaga o sujo e não mostra toast", async () => {
    const b = buffer()
    digitar(b, "// novo\n")
    invoke.mockResolvedValueOnce("v2")
    expect(await salvar(CAMINHO)).toBe(true)
    expect(invoke).toHaveBeenCalledWith("salvar_arquivo", {
      root: ROOT,
      path: CAMINHO,
      conteudo: `// novo\n${SCHEMA}`,
      versaoEsperada: "v1",
      fimDeLinha: "lf",
      bom: false,
    })
    expect(obter(CAMINHO)?.versao).toBe("v2")
    expect(useEdicao.getState().sujos[CAMINHO]).toBeUndefined()
    expect(avisar.erro).not.toHaveBeenCalled()
  })

  it("arquivo CRLF volta CRLF, mesmo com o CodeMirror guardando \\n", () => {
    const doc = EditorState.create({ doc: "a\r\nb\r\n" }).doc
    expect(doc.toString()).toBe("a\nb\n")
    expect(textoParaODisco({ fimDeLinha: "crlf" }, doc)).toBe("a\r\nb\r\n")
    expect(textoParaODisco({ fimDeLinha: "lf" }, doc)).toBe("a\nb\n")
  })

  it("disco mudou: faixa de conflito, e o texto continua sujo", async () => {
    const b = buffer()
    digitar(b, "x")
    invoke.mockRejectedValueOnce({ tipo: "conflito", versao: "do-agente" })
    expect(await salvar(CAMINHO)).toBe(false)
    expect(useEdicao.getState().avisos[CAMINHO]).toBe("conflito")
    expect(useEdicao.getState().sujos[CAMINHO]).toBe(true)
    expect(b.versaoDoConflito).toBe("do-agente")
    expect(avisar.erro).not.toHaveBeenCalled()
  })

  it("'Manter a minha' adota a versão do disco e o próximo salvar passa", async () => {
    const b = buffer()
    digitar(b, "x")
    invoke.mockRejectedValueOnce({ tipo: "conflito", versao: "do-agente" })
    await salvar(CAMINHO)
    manterAMinha(CAMINHO)
    expect(useEdicao.getState().avisos[CAMINHO]).toBeUndefined()
    expect(useEdicao.getState().sujos[CAMINHO]).toBe(true)
    invoke.mockResolvedValueOnce("v3")
    expect(await salvar(CAMINHO)).toBe(true)
    expect(invoke).toHaveBeenLastCalledWith("salvar_arquivo", expect.objectContaining({ versaoEsperada: "do-agente" }))
  })

  it("arquivo apagado mostra a faixa de sumiço", async () => {
    buffer()
    invoke.mockRejectedValueOnce({ tipo: "sumiu" })
    expect(await salvar(CAMINHO)).toBe(false)
    expect(useEdicao.getState().avisos[CAMINHO]).toBe("sumiu")
  })

  it("falha de disco vira aviso de erro com a causa no detalhe", async () => {
    const b = buffer()
    digitar(b, "x")
    invoke.mockRejectedValueOnce({ tipo: "falhou", detalhe: "Permission denied (os error 13)" })
    expect(await salvar(CAMINHO)).toBe(false)
    expect(avisar.erro).toHaveBeenCalledWith("Não consegui salvar schema.ts.", {
      detalhe: "Permission denied (os error 13)",
    })
    expect(useEdicao.getState().sujos[CAMINHO]).toBe(true)
  })

  it("só leitura nunca chama o disco, e a nota diz por quê", async () => {
    buffer({ gravavel: false, motivo: "Fora das pastas do projeto" })
    expect(await salvar(CAMINHO)).toBe(false)
    expect(invoke).not.toHaveBeenCalled()
    expect(avisar.nota).toHaveBeenCalledWith("schema.ts é só leitura.", {
      detalhe: "Fora das pastas do projeto",
      id: `so-leitura:${CAMINHO}`,
    })
  })
})

describe("o portão de fechar", () => {
  const abrir = (conv: string, ...abertas: string[]) =>
    useAbasDeArquivo.setState((s) => ({
      porConversa: { ...s.porConversa, [conv]: { abertas, vista: null, aoLado: null, navegador: "fechado" } },
    }))

  it("aba limpa fecha no mesmo tique, sem perguntar", () => {
    buffer()
    abrir("c1", CHAVE)
    expect(planoDoPortao("c1", [CHAVE], ROOT)).toEqual({ fechaDireto: [CHAVE], perguntar: [] })
  })

  it("aba suja pergunta; 'Não salvar' descarta o texto", async () => {
    const b = buffer()
    abrir("c1", CHAVE)
    digitar(b, "x")
    const plano = planoDoPortao("c1", [CHAVE], ROOT)
    expect(plano.perguntar).toHaveLength(1)
    const resposta = resolverPerguntas(plano)
    expect(useConfirm.getState().req).toMatchObject({
      title: "Salvar as alterações em schema.ts?",
      alternativa: "Não salvar",
      confirmLabel: "Salvar",
    })
    useConfirm.getState().close("alternativa")
    expect(await resposta).toEqual([CHAVE])
    expect(obter(CAMINHO)).toBeUndefined()
    expect(useEdicao.getState().sujos[CAMINHO]).toBeUndefined()
    expect(invoke).not.toHaveBeenCalled()
  })

  it("'Cancelar' não fecha nada", async () => {
    const b = buffer()
    digitar(b, "x")
    const resposta = resolverPerguntas(planoDoPortao("c1", [CHAVE], ROOT))
    useConfirm.getState().close(false)
    expect(await resposta).toBeNull()
    expect(obter(CAMINHO)).toBeDefined()
  })

  it("'Salvar' que dá conflito não fecha a aba", async () => {
    const b = buffer()
    digitar(b, "x")
    invoke.mockRejectedValueOnce({ tipo: "conflito", versao: "v9" })
    const resposta = resolverPerguntas(planoDoPortao("c1", [CHAVE], ROOT))
    useConfirm.getState().close(true)
    expect(await resposta).toEqual([])
    expect(useEdicao.getState().avisos[CAMINHO]).toBe("conflito")
  })

  it("o lote diz quantos e lista os nomes", () => {
    const perguntas = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts", "f.ts", "g.ts"].map((nome) => ({
      chave: nome,
      caminho: `/p/${nome}`,
      nome,
    }))
    expect(textoDaPergunta(perguntas)).toEqual({
      title: "7 arquivos têm alterações não salvas",
      description: "a.ts, b.ts, c.ts, d.ts, e.ts e mais 2.",
      confirmLabel: "Salvar os 7",
    })
  })
})

describe("apagar a conversa", () => {
  it("avisa do texto que só ela tinha e o descarta ao apagar", () => {
    const b = buffer()
    digitar(b, "x")
    expect(avisoDeSujosDaConversa("c1")).toBe(
      "1 arquivo com alterações não salvas, aberto só nesta conversa, será descartado.",
    )
    soltarConversa("c1")
    expect(obter(CAMINHO)).toBeUndefined()
    expect(useEdicao.getState().sujos[CAMINHO]).toBeUndefined()
  })

  it("arquivo que outra conversa também tem não entra no aviso nem some", () => {
    const b = buffer({ donos: new Map([["c1", CHAVE], ["c2", CHAVE]]) })
    digitar(b, "x")
    expect(avisoDeSujosDaConversa("c1")).toBeNull()
    soltarConversa("c1")
    expect(obter(CAMINHO)).toBeDefined()
  })
})
