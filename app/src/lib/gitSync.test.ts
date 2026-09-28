import { describe, expect, it } from "vitest"
import {
  comoErroDeGit,
  contasParaTrocar,
  gestoDoBotao,
  gestoEmCurso,
  idadeDaBusca,
  pedidoDeConflito,
  quandoDaBranch,
  type ErroDeGit,
} from "@/lib/gitSync"

const NOW = Date.UTC(2026, 8, 28, 15, 0)

/** O stderr real de um push com a conta errada ativa no gh, neste repo. */
const ACESSO: ErroDeGit = {
  tipo: "acesso",
  detalhe: "remote: Repository not found.\nfatal: repository 'https://github.com/vinicius1209/frota.git/' not found",
  dono: "vinicius1209",
  contaAtiva: "vinicius-empresa",
  contas: ["vinicius-empresa", "vinicius1209"],
}

const base = { branch: "main", upstream: "origin/main", ahead: 0, behind: 0, temRemoto: true }

describe("o botão de sincronia", () => {
  it("à frente envia, atrás traz, dos dois lados traz e envia, e o número vai no rótulo", () => {
    expect(gestoDoBotao({ ...base, ahead: 3 })).toEqual({ gesto: "enviar", rotulo: "Enviar 3 commits" })
    expect(gestoDoBotao({ ...base, behind: 1 })).toEqual({ gesto: "trazer", rotulo: "Trazer 1 commit" })
    expect(gestoDoBotao({ ...base, ahead: 3, behind: 2 })).toEqual({
      gesto: "trazer-e-enviar",
      rotulo: "Trazer 2 e enviar 3",
    })
  })

  it("sem upstream publica, em dia só busca, e sem remoto não há botão", () => {
    expect(gestoDoBotao({ ...base, upstream: null })?.gesto).toBe("publicar")
    expect(gestoDoBotao(base)).toEqual({ gesto: null, rotulo: "Em dia com origin/main" })
    expect(gestoDoBotao({ ...base, temRemoto: false })).toBeNull()
    expect(gestoDoBotao({ ...base, branch: null })).toBeNull()
  })

  it("enquanto roda, o tooltip fala no gerúndio", () => {
    expect(gestoEmCurso("enviar", 3, 0)).toBe("Enviando 3 commits…")
    expect(gestoEmCurso("publicar", 0, 0)).toBe("Publicando a branch…")
  })

  it("a busca diz de quando é, e nunca finge que houve uma", () => {
    expect(idadeDaBusca(null, NOW)).toBe("nunca")
    expect(idadeDaBusca(NOW - 20_000, NOW)).toBe("agora há pouco")
    expect(idadeDaBusca(NOW - 3 * 3_600_000, NOW)).toBe("há 3 h")
  })
})

describe("o erro que vem do Rust", () => {
  it("o objeto tipado passa inteiro, e qualquer outra coisa vira outro com o texto", () => {
    expect(comoErroDeGit(ACESSO)).toEqual(ACESSO)
    expect(comoErroDeGit("git não encontrado")).toMatchObject({ tipo: "outro", detalhe: "git não encontrado" })
    expect(comoErroDeGit({ tipo: "inventado", detalhe: "x" }).tipo).toBe("outro")
  })

  it("a conta oferecida é o dono do repositório quando ele está logado", () => {
    expect(contasParaTrocar(ACESSO)).toEqual(["vinicius1209"])
    expect(contasParaTrocar({ ...ACESSO, dono: "outra-org" })).toEqual(["vinicius1209"])
    expect(contasParaTrocar({ ...ACESSO, contas: ["vinicius-empresa"] })).toEqual([])
  })
})

describe("branches e conflito", () => {
  it("a idade da branch é curta, e a atual se diz atual", () => {
    expect(quandoDaBranch({ quando: NOW, atual: true }, NOW)).toBe("atual")
    expect(quandoDaBranch({ quando: NOW - 3_600_000, atual: false }, NOW)).toBe("hoje")
    expect(quandoDaBranch({ quando: NOW - 86_400_000, atual: false }, NOW)).toBe("ontem")
    expect(quandoDaBranch({ quando: NOW - 3 * 86_400_000, atual: false }, NOW)).toBe("3 dias")
  })

  it("o pedido ao agente lista os arquivos e deixa a decisão de continuar com a pessoa", () => {
    const texto = pedidoDeConflito({ tipo: "rebase", atual: 2, total: 3 }, ["app/src-tauri/src/lib.rs", "app/src/store/chat.ts"])
    expect(texto).toContain("- app/src-tauri/src/lib.rs\n- app/src/store/chat.ts")
    expect(texto).toContain("Não continue nem aborte o rebase")
  })
})
