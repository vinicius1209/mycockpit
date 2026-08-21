// A rede do trabalho de fundo.
//
// O bug que motivou não dá pra reproduzir aqui de forma honesta — ele É o
// teardown do vitest, e um teste que derruba o próprio ambiente não é teste, é
// sabotagem. O que dá pra fixar é a propriedade que faltava e que torna o bug
// impossível: trabalho de fundo é OBSERVÁVEL. Se `aguardeFundo` voltar com
// promessa ainda em voo, a corrida volta junto.

import { describe, expect, it } from "vitest"
import { aguardeFundo, deFundo, emVooAgora } from "./deFundo"

const daqui = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe("deFundo", () => {
  it("devolve a promessa INTACTA (não é um wrapper que troca o valor)", async () => {
    const p = Promise.resolve(42)
    expect(deFundo(p)).toBe(p)
    await expect(p).resolves.toBe(42)
  })

  it("conta enquanto está em voo e solta ao terminar", async () => {
    expect(emVooAgora()).toBe(0)
    void deFundo(daqui(5))
    expect(emVooAgora()).toBe(1)
    await aguardeFundo()
    expect(emVooAgora()).toBe(0)
  })

  it("espera de verdade: o efeito JÁ aconteceu quando aguardeFundo volta", async () => {
    // É esta a garantia que o CI precisava. Sem ela o teste terminava antes, e
    // o efeito caía num ambiente que já não existia.
    let feito = false
    void deFundo(daqui(5).then(() => void (feito = true)))
    expect(feito).toBe(false)
    await aguardeFundo()
    expect(feito).toBe(true)
  })

  it("drena trabalho que agenda MAIS trabalho", async () => {
    // O caso real: o import resolve, o `.then` chama a store, a store agenda um
    // persist. Uma rodada só não bastaria.
    let etapas = 0
    void deFundo(
      daqui(1).then(() => {
        etapas++
        void deFundo(daqui(1).then(() => void etapas++))
      }),
    )
    await aguardeFundo()
    expect(etapas).toBe(2)
  })

  it("falha de fundo NÃO derruba quem esperou", async () => {
    // Fundo é best-effort por definição; `aguardeFundo` responde "acabou", não
    // "deu certo". Quem precisa do resultado não deveria estar no fundo.
    void deFundo(Promise.reject(new Error("boom")))
    await expect(aguardeFundo()).resolves.toBeUndefined()
    expect(emVooAgora()).toBe(0)
  })

  it("trabalho que não drena no limite LANÇA em vez de pendurar a suíte", async () => {
    // Um `while` mudo aqui viraria CI travado sem mensagem — o pior desfecho,
    // porque não aponta pra lugar nenhum.
    //
    // A realimentação é LIMITADA de propósito, e a primeira versão deste teste
    // ensinou o porquê: um `Promise.resolve().then(realimenta)` infinito não
    // testa o guard, ele afoga o event loop em microtasks e trava o processo
    // inteiro — inclusive a drenagem do `afterEach`. O guard protege contra
    // laço; nada protege contra bomba de microtask, e não é papel dele.
    let rodadas = 0
    const realimenta = () => {
      if (rodadas++ >= 40) return
      void deFundo(daqui(0).then(realimenta))
    }
    realimenta()
    await expect(aguardeFundo()).rejects.toThrow(/laço/)
  })

  it("sem trabalho nenhum, sai na hora (custo zero pra quem não usa)", async () => {
    const t0 = performance.now()
    await aguardeFundo()
    expect(performance.now() - t0).toBeLessThan(5)
  })
})

describe("o gate de plano passou a ser esperável", () => {
  it("depois de aguardeFundo, o pedido ESTÁ na fila de interações", async () => {
    // A prova de ponta: `pushPlanGate` dispara um import dinâmico (quebra de
    // ciclo) que antes ninguém conseguia observar. Este teste só é escrevível
    // porque o fundo virou contável.
    const { useChat } = await import("@/store/chat")
    const { useInteractions } = await import("@/store/interactions")
    const { planRequestId } = await import("@/lib/planGate")

    const convId = "conv-fundo"
    useChat.setState((s) => ({
      byId: {
        ...s.byId,
        [convId]: {
          ...(s.byId[convId] ?? ({} as never)),
          id: convId,
          items: [],
        },
      },
    }))

    useChat.getState().pushPlanGate(convId, "plano proposto")
    await aguardeFundo()

    const gate = useChat
      .getState()
      .byId[convId]?.items.find((i) => i.kind === "planGate")
    expect(gate).toBeTruthy()
    const fila = useInteractions.getState().queue
    expect(fila.some((i) => i.id === planRequestId(gate!.id))).toBe(true)
  })
})
