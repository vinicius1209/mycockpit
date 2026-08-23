import { describe, expect, it } from "vitest"
import { _baterJanela, janelaEpoca, subscribeJanela } from "./janelaViva"

describe("época da janela", () => {
  it("é ESTÁVEL entre batidas", () => {
    // `useSyncExternalStore` compara o snapshot por identidade: um valor novo a
    // cada leitura faria o React re-renderizar em loop.
    expect(janelaEpoca()).toBe(janelaEpoca())
  })

  it("muda quando a janela volta, e avisa quem assina", () => {
    let avisos = 0
    const parar = subscribeJanela(() => avisos++)
    const antes = janelaEpoca()
    _baterJanela()
    expect(janelaEpoca()).not.toBe(antes)
    expect(avisos).toBe(1)
    parar()
  })

  it("depois de cancelar, não avisa mais", () => {
    // Assinatura que sobrevive à tela é vazamento — mesmo contrato do
    // `minuteTick`.
    let avisos = 0
    subscribeJanela(() => avisos++)()
    _baterJanela()
    expect(avisos).toBe(0)
  })
})

/** O fonte dos componentes, lido pelo mecanismo do Vite (tipado, e sem `node:fs`
 *  — o tsconfig do `src/` não tem os tipos do node, de propósito). */
const FONTES = import.meta.glob("../components/**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>

describe("onde a época PODE e NÃO PODE entrar", () => {
  it("nenhum elemento com animação que TERMINA ganhou key da época", () => {
    // A regra: `key={epoca}` só vale pra animação INFINITA. Animação que
    // termina sozinha (reveal, rise) replayaria a cada volta da janela — um app
    // inteiro re-animando ao voltar do Command+Tab é pior que um anel parado,
    // e o remédio viraria o sintoma.
    //
    // Este teste lê o FONTE em vez de afirmar uma lista minha: lista eu escrevo
    // errado em silêncio; o fonte é o que roda.
    const erros: string[] = []
    for (const [rel, src] of Object.entries(FONTES)) {
      if (!src.includes("useEpocaDaJanela")) continue
      src.split("\n").forEach((l, n) => {
        if (!/key=\{`?\$?\{?epoca/.test(l)) return
        // olha o elemento inteiro: 12 linhas depois da key bastam
        const bloco = src.split("\n").slice(n, n + 12).join(" ")
        if (/animate-(reveal|cockpit-rise)/.test(bloco)) {
          erros.push(`${rel}:${n + 1}`)
        }
      })
    }
    expect(erros).toEqual([])
  })

  it("os sítios que USAM a época existem de verdade (o teste acima não é vazio)", () => {
    // Sem isto, apagar a feature inteira deixaria o teste acima verde.
    const usos = Object.values(FONTES).filter((src) =>
      src.includes("useEpocaDaJanela"),
    )
    expect(usos.length).toBeGreaterThanOrEqual(4)
  })
})
