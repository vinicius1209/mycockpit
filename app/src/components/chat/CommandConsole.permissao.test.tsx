// A PERMISSÃO NO COMPOSER DE VERDADE (não no helper puro).
//
// `lib/permission` já tinha teste; o que faltava era provar que o COMPOSER usa
// a regra em vez de contornar — e ele contornava em dois pontos: a precedência
// estava copiada inline na `ExecutionRow`, e a faixa lia o projeto EM FOCO
// enquanto o despacho lê o projeto DONO do fio (`lib/sendTarget`). Este arquivo
// existe para que essa divergência não volte.
import { beforeEach, describe, expect, it } from "vitest"
import {
  CONV,
  PROJ_DONO,
  PROJ_FOCO,
  app,
  chat,
  config,
  conversa,
  modoMarcado,
  montar,
  projeto,
  resetarBancada,
} from "./CommandConsole.harness"

beforeEach(resetarBancada)

describe("a faixa mostra o modo do projeto que VAI RODAR", () => {
  it("o dono do fio manda, não o projeto em foco", async () => {
    // O despacho resolve o projeto por `conv.projectId` e diz por quê:
    // "cwd, permissão e lições são os do fio, não os da tela". Se a faixa
    // mostrasse o foco, o segmented estaria editando um projeto e o turno
    // rodando com o modo de outro.
    app.projects = [projeto(PROJ_FOCO, "leitura"), projeto(PROJ_DONO, "liberado")]
    expect(modoMarcado(await montar())).toBe("Liberado")
  })

  it("conversa ainda não hidratada cai no foco (é a melhor aproximação)", async () => {
    app.projects = [projeto(PROJ_FOCO, "leitura"), projeto(PROJ_DONO, "liberado")]
    chat.byId = {}
    expect(modoMarcado(await montar())).toBe("Só lê")
  })

  it("o .mycockpit/config.toml do dono vence o cache do SQLite", async () => {
    app.projects = [projeto(PROJ_FOCO, "liberado"), projeto(PROJ_DONO, "leitura")]
    app.mycockpit = { [PROJ_DONO]: config("padrao") }
    expect(modoMarcado(await montar())).toBe("Pede")
  })

  it("trocar de conversa troca o modo mostrado", async () => {
    // A conversa nova é de OUTRO projeto: se o modo da anterior sobrevivesse, a
    // faixa afirmaria uma permissão que o próximo envio não vai usar.
    const OUTRA = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d"
    app.projects = [projeto(PROJ_FOCO, "leitura"), projeto(PROJ_DONO, "liberado")]
    chat.byId = {
      [CONV]: conversa({ projectId: PROJ_DONO }),
      [OUTRA]: conversa({ projectId: PROJ_FOCO }),
    }
    expect(modoMarcado(await montar())).toBe("Liberado")
    chat.activeId = OUTRA
    expect(modoMarcado(await montar())).toBe("Só lê")
  })

  it("sem projeto nenhum, o segmented inteiro fica desabilitado", async () => {
    // `disabled={!project}`: não há `.mycockpit` onde gravar. Segmented clicável
    // que não grava nada é pior que segmented apagado — parece que mudou.
    app.projects = []
    const html = await montar()
    const radios = html.match(/<button[^>]*role="radio"[^>]*>/g) ?? []
    expect(radios).toHaveLength(3)
    expect(radios.every((b) => b.includes("disabled"))).toBe(true)
  })
})

describe("o aviso de que a troca só vale no próximo envio", () => {
  it("com turno em andamento, o composer diz isso na cara", async () => {
    // O `--permission-mode` é fixo no spawn: trocar com turno em voo não muda o
    // turno em voo. É a promessa que a copy faz — e ela precisa ser verdade.
    expect(await montar({ running: true })).toContain(
      "Turno em andamento: a permissão vale a partir do próximo envio.",
    )
  })

  it("em repouso, o aviso não aparece", async () => {
    expect(await montar()).not.toContain("Turno em andamento")
  })
})

describe("quem obedece ao modo é a CLI da conversa", () => {
  it("conversa de Antigravity avisa que o motor ignora o modo", async () => {
    // Conversa AINDA sem turno: quem obedece é o agent do SELETOR (o que vai
    // rodar), não o carimbo da conversa — o carimbo é uma aposta que o 1º envio
    // confirma. Aqui o seletor nasce no default global.
    app.settings.defaultAgent = "agy"
    expect(await montar()).toContain("Antigravity IGNORA este modo")
  })

  it("conversa TRAVADA usa o agent do 1º run pra escolher a nota", async () => {
    // `convAgent = hasExecutorTurn(items) ? conv.agent : effectiveDest` — quem
    // obedece é a CLI que já está rodando o fio, não o seletor.
    app.projects = [projeto(PROJ_FOCO, "padrao"), projeto(PROJ_DONO, "padrao")]
    chat.byId = {
      [CONV]: conversa({
        agent: "agy",
        items: [
          { id: "u1", kind: "user", text: "sobe o servidor", ts: 1_755_300_000_000 },
        ],
      }),
    }
    expect(await montar()).toContain("Antigravity IGNORA este modo")
  })
})
